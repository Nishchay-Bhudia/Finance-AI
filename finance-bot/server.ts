
import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import { streamText, stepCountIs, type StopCondition, type ToolSet } from 'ai';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { model } from './lib/ai.js';
import { searchFinanceData } from './tools/search.js';
import { exportPdf } from './tools/exportPdf.js';
import { exportCsv } from './tools/exportCsv.js';
import { generateGraph, resetLatestGraph } from './tools/graph.js';

const app = express();
app.use(express.json());
app.use(express.static('public'));
app.use('/outputs', express.static('outputs'));

type ChatMessage = { role: 'user' | 'assistant'; content: string; files?: string[]; images?: string[] };
type Conversation = { filename: string; title?: string; messages: ChatMessage[] };

const CHATS_DIR = './outputs';

const conversations = new Map<string, Conversation>();

function loadConversations() {
  if (!existsSync(CHATS_DIR)) return;

  for (const file of readdirSync(CHATS_DIR)) {
    if (!file.endsWith('.json')) continue;

    try {
      const saved = JSON.parse(readFileSync(`${CHATS_DIR}/${file}`, 'utf8'));
      conversations.set(saved.chatId, { filename: file, title: saved.title, messages: saved.messages });
    } catch {
    }
  }
}

loadConversations();

function saveConversation(chatId: string, conversation: Conversation) {
  if (!existsSync(CHATS_DIR)) mkdirSync(CHATS_DIR);
  const filepath = `${CHATS_DIR}/${conversation.filename}`;
  writeFileSync(filepath, JSON.stringify({ chatId, title: conversation.title, messages: conversation.messages }, null, 2));
}

function describeInvalidToolCall(call: any): string {
  const schemaError = call.error?.cause?.cause?.message ?? call.error?.message;
  return `Your call to ${call.toolName} was invalid: ${schemaError ?? 'bad input'}. Fix it and call the tool again with the correct field names.`;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/^[-*]\s+/gm, '• ');
}

function inferDeliverables(message: string): string[] {
  const text = message.toLowerCase();
  const found: string[] = [];

  if (/\bpdf\b|\breport\b|\bdocument\b/.test(text)) found.push('pdf');
  if (/\bcsv\b|\bspreadsheet\b|\bexcel\b/.test(text)) found.push('csv');
  if (/\bgraph\b|\bchart\b|\bplot\b|\bvisuali[sz]e/.test(text)) found.push('graph');

  return found;
}

function deliverablesSatisfied(deliverables: string[]): StopCondition<ToolSet> {
  const requestedPdf = deliverables.includes('pdf');
  const requestedCsv = deliverables.includes('csv');
  const requestedGraph = deliverables.includes('graph');

  return ({ steps }) => {
    let gotPdf = !requestedPdf;
    let gotCsv = !requestedCsv;
    let gotGraph = !requestedGraph;

    for (const step of steps) {
      for (const toolResult of step.toolResults) {
        const output = (toolResult as any).output as { filename?: string } | undefined;
        if (!output?.filename) continue;

        if ((toolResult as any).toolName === 'generateGraph') gotGraph = true;
        else if (output.filename.endsWith('.pdf')) gotPdf = true;
        else if (output.filename.endsWith('.csv')) gotCsv = true;
      }
    }

    return gotPdf && gotCsv && gotGraph;
  };
}

app.get('/chats', (_req: Request, res: Response) => {
  const chats = [...conversations.entries()].map(([chatId, conversation]) => ({
    chatId,
    preview: conversation.title ?? conversation.messages[0]?.content.slice(0, 60) ?? 'New chat',
  }));
  res.json(chats);
});

app.get('/chats/:chatId', (req: Request, res: Response) => {
  const conversation = conversations.get(String(req.params.chatId));
  res.json(conversation?.messages ?? []);
});

app.patch('/chats/:chatId', (req: Request, res: Response) => {
  const chatId = String(req.params.chatId);
  const conversation = conversations.get(chatId);
  if (!conversation) {
    res.status(404).json({ error: 'No chat with that id.' });
    return;
  }

  const title = String(req.body.title ?? '').trim().slice(0, 60);
  if (!title) {
    res.status(400).json({ error: 'Title cannot be empty.' });
    return;
  }

  conversation.title = title;
  saveConversation(chatId, conversation);
  res.json({ chatId, title });
});

app.delete('/chats/:chatId', (req: Request, res: Response) => {
  const chatId = String(req.params.chatId);
  const conversation = conversations.get(chatId);
  if (!conversation) {
    res.status(404).json({ error: 'No chat with that id.' });
    return;
  }

  const filepath = `${CHATS_DIR}/${conversation.filename}`;
  if (existsSync(filepath)) unlinkSync(filepath);
  conversations.delete(chatId);
  res.json({ deleted: true });
});

app.post('/chat', async (req: Request, res: Response) => {
  const { message, chatId } = req.body;
  const checkedDeliverables: string[] = Array.isArray(req.body.deliverables) ? req.body.deliverables : [];
  const deliverables = Array.from(new Set([...checkedDeliverables, ...inferDeliverables(message)]));

  const requestedPdf = deliverables.includes('pdf');
  const requestedCsv = deliverables.includes('csv');
  const requestedGraph = deliverables.includes('graph');
  const requestedOutput = requestedPdf || requestedCsv || requestedGraph;

  if (!conversations.has(chatId)) {
    const safeName = message.slice(0, 60).toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const filename = `${safeName || 'chat'}-${chatId}.json`;
    conversations.set(chatId, { filename, messages: [] });
  }
  const conversation = conversations.get(chatId)!;
  const messages = conversation.messages;

  messages.push({ role: 'user', content: message });
  saveConversation(chatId, conversation);
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
6. For a selected graph, call generateGraph with a valid bar or line type and real numeric points. Prefer several points over one - if the search results include a price history, plot multiple dates instead of just the latest price.
7. For a selected PDF, the content field must be several full sentences or paragraphs, not a single line - cover the figure itself, what it means, and any other real facts or news from the search results. A one-sentence report is not acceptable. If there's a real price history or other numeric series in the search results, pass chartType and chartPoints to exportPdf so the report includes its own chart.
8. For a selected CSV, include every useful real numeric value in rows.
9. After all selected deliverables finish, also tell the user what you found - a few real sentences with the actual figures and facts, in your own words, said directly in chat. Do not just say the files are ready with nothing else. Do not paste the full report, CSV, or Markdown into chat.
10. Never use Markdown syntax (no **, #, bullet dashes, numbered lists, code fences). Reply in plain natural prose, every time.`;

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

    const MAX_ATTEMPTS = 5;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const result = streamText({
        model,
        instructions,
        ...(requestedOutput ? { tools, toolChoice: 'required' as const } : {}),
        maxRetries: 0,
        stopWhen: requestedOutput
          ? [stepCountIs(50), deliverablesSatisfied(deliverables)]
          : stepCountIs(50),
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
          : errors.length > 0
            ? `${errors.join(' ')} Fix that and call the tool again.`
            : `You did not finish the selected deliverables (${deliverables.join(', ')}). Call the required tool now, using the real numbers from the search results above. Do not reply with plain text.`;

        modelMessages = [...modelMessages, { role: 'user', content: problem }];
      }
    }

    let outputText: string;
    if (!requestedOutput) {
      outputText = stripMarkdown(text);
    } else {
      const gotPdf = !requestedPdf || files.some((file) => file.endsWith('.pdf'));
      const gotCsv = !requestedCsv || files.some((file) => file.endsWith('.csv'));
      const gotGraph = !requestedGraph || images.length > 0;

      if (gotPdf && gotCsv && gotGraph) {
        const summaryResult = streamText({
          model,
          instructions: `You are a finance research assistant. The user asked: "${message}". You already generated the requested files (${deliverables.join(', ')}) from the search results below - do not describe making the files. Write a short chat reply, a few real sentences, sharing the actual figures and facts you found. Plain prose, no Markdown.\n\nSearch results:\n${JSON.stringify(searchData)}`,
          maxRetries: 0,
          messages: [{ role: 'user', content: message }],
        });

        let summaryText = '';
        for await (const chunk of summaryResult.textStream) {
          summaryText += chunk;
          send('text', chunk);
        }
        if (!summaryText) summaryText = await summaryResult.text;

        outputText = stripMarkdown(summaryText).trim() || 'Your selected deliverables are ready.';
      } else {
        outputText = `I could not complete the selected deliverables. ${errors.join(' ') || 'A required tool did not finish.'}`;
      }
    }

    messages.push({
      role: 'assistant',
      content: outputText,
      files: files.length > 0 ? files : undefined,
      images: images.length > 0 ? images : undefined,
    });
    saveConversation(chatId, conversation);

    send('done', { text: outputText, files, images, usedSearch: true });
  } catch (error) {
    send('error', error instanceof Error ? error.message : 'Something went wrong.');
  } finally {
    res.end();
  }
});

app.listen(3000, () => console.log('http://localhost:3000'));
