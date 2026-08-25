
import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import { streamText, stepCountIs } from 'ai';
import { model } from './lib/ai.js';
import { searchFinanceData } from './tools/search.js';
import { exportPdf } from './tools/exportPdf.js';
import { exportCsv } from './tools/exportCsv.js';
import { generateGraph, resetLatestGraph } from './tools/graph.js';

const app = express();
app.use(express.json());
app.use(express.static('public'));
app.use('/outputs', express.static('outputs'));

type ChatMessage = { role: 'user' | 'assistant'; content: string };
const messages: ChatMessage[] = [];

// When the model calls a tool with the wrong field names, the AI SDK wraps
// the real reason (a Zod validation error) a few layers deep inside the
// tool call. This just digs it out so we can show the model what it did
// wrong instead of a generic "try again".
function describeInvalidToolCall(call: any): string {
  const schemaError = call.error?.cause?.cause?.message ?? call.error?.message;
  return `Your call to ${call.toolName} was invalid: ${schemaError ?? 'bad input'}. Fix it and call the tool again with the correct field names.`;
}

app.post('/chat', async (req: Request, res: Response) => {
  const { message } = req.body;
  const deliverables: string[] = Array.isArray(req.body.deliverables) ? req.body.deliverables : [];

  const requestedPdf = deliverables.includes('pdf');
  const requestedCsv = deliverables.includes('csv');
  const requestedGraph = deliverables.includes('graph');
  const requestedOutput = requestedPdf || requestedCsv || requestedGraph;

  messages.push({ role: 'user', content: message });
  resetLatestGraph();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const searchData = await searchFinanceData(message);
    const instructions = `You are a finance research assistant with four tools: searchFinance, exportPdf, exportCsv, and generateGraph.

Rules:
1. Always use the supplied search results as the source of truth. Never invent financial facts, figures, or prices.
2. Ignore search metadata such as source cost, relevance score, deduction dollars, and character counts.
3. The selected deliverables are: ${deliverables.join(', ') || 'none'}.
4. Search results are already available, but call searchFinance again when more information is needed.
5. Complete every selected deliverable before replying. Use only real data from searchFinance.
6. For a selected graph, call generateGraph with a valid bar or line type and real numeric points. If graph is the only selection, create only the graph.
7. If graph is selected with PDF, call generateGraph first, wait for its result, then call exportPdf with its returned imageFilename so the graph is embedded.
8. If graph is selected with CSV, include the graph data and returned PNG filename in exportCsv.
9. For a selected PDF, include a complete detailed report with all requested figures and news.
10. For a selected CSV, include every useful real numeric value in rows.
11. After all selected deliverables finish, reply with a short plain-prose confirmation only. Do not output the report, CSV, Markdown, or file contents in chat.
12. Never use Markdown syntax (no **, #, bullet dashes, numbered lists, code fences). Reply in plain natural prose, every time.`;

    const tools = {
      ...(requestedPdf ? { exportPdf } : {}),
      ...(requestedCsv ? { exportCsv } : {}),
      ...(requestedGraph ? { generateGraph } : {}),
    };

    let modelMessages: ChatMessage[] = [
      ...messages.slice(0, -1),
      {
        role: 'user',
        content: `${message}\n\nFresh search results for this request. The selected deliverables are ${deliverables.join(', ') || 'none'}. Use these results for this request and do not use facts from older requests:\n${JSON.stringify(searchData)}`,
      },
    ];

    let text = '';
    const files: string[] = [];
    const images: string[] = [];
    const errors: string[] = [];

    // Our local Ollama model doesn't actually honor toolChoice: 'required'
    // (this provider just ignores it), and it's small enough that it
    // sometimes replies in plain text instead of calling a tool, or gets a
    // field name wrong. If that happens for a deliverable request, tell it
    // exactly what went wrong and give it another attempt.
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const result = streamText({
        model,
        instructions,
        ...(requestedOutput ? { tools, toolChoice: 'required' as const } : {}),
        maxRetries: 0,
        stopWhen: stepCountIs(20),
        messages: modelMessages,
      });

      text = '';
      for await (const chunk of result.textStream) {
        text += chunk;
        if (!requestedOutput) send('text', chunk);
      }
      if (!text) text = await result.text;

      files.length = 0;
      images.length = 0;
      errors.length = 0;
      for (const toolResult of await result.toolResults) {
        if (!toolResult) continue;
        const output = toolResult.output as { filename?: string; error?: string };
        if (output?.error) errors.push(`${toolResult.toolName}: ${output.error}`);
        if (!output?.filename) continue;

        if (toolResult.toolName === 'generateGraph') {
          images.push(output.filename);
        } else {
          files.push(output.filename);
        }
      }

      if (!requestedOutput) break;

      const gotPdf = !requestedPdf || files.some((file) => file.endsWith('.pdf'));
      const gotCsv = !requestedCsv || files.some((file) => file.endsWith('.csv'));
      const gotGraph = !requestedGraph || images.length > 0;
      if (gotPdf && gotCsv && gotGraph) break;

      if (attempt < MAX_ATTEMPTS) {
        const invalidCall = (await result.toolCalls).find((call: any) => call.invalid);
        const problem = invalidCall
          ? describeInvalidToolCall(invalidCall)
          : `You did not finish the selected deliverables (${deliverables.join(', ')}). Call the required tool now, using the real numbers from the search results above. Do not reply with plain text.`;

        modelMessages = [...modelMessages, { role: 'user', content: problem }];
      }
