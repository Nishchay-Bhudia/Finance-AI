
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
