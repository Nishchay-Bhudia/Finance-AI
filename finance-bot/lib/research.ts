import { generateText, streamText, Output } from 'ai';
import { z } from 'zod';
import { model } from './ai.js';
import { searchFinanceData } from '../tools/search.js';

export type Depth = 'fast' | 'standard' | 'deep';

const ROUND_CAPS: Record<Depth, number> = { fast: 1, standard: 3, deep: 6 };

type Finding = { id: number; title: string; url: string; content: string };

const PLAN_SCHEMA = z.object({
  queries: z.array(z.string()).min(1).max(4),
});

const REFLECT_SCHEMA = z.object({
  satisfied: z.boolean(),
  gaps: z.array(z.string()),
});

function poolText(findings: Finding[]) {
  return findings.map((f) => `[${f.id}] ${f.title}: ${f.content}`).join('\n\n');
}

async function plan(message: string, findings: Finding[], gaps: string[]) {
  const instructions = gaps.length
    ? `You are researching: "${message}". You already know:\n${poolText(findings)}\n\nHere is what's still missing:\n${gaps.join('\n')}\n\nWrite up to 4 specific search queries that fill those gaps. Do not repeat what you already know.`
    : `You are researching: "${message}". Break this into up to 4 independent, specific search queries that together would let you answer it fully. Each query should probe a different angle - a different company, metric, or time period. Do not write near-duplicate queries.`;

  const result = await generateText({
    model,
    output: Output.object({ schema: PLAN_SCHEMA }),
    instructions,
    messages: [{ role: 'user', content: message }],
  });

  return result.output.queries;
}

async function search(queries: string[], findings: Finding[]) {
  const seen = new Set(findings.map((f) => f.url));
  const batches = await Promise.all(queries.map((query) => searchFinanceData(query)));

  const added: Finding[] = [];
  let nextId = findings.length + 1;

  for (const batch of batches) {
    if ('error' in batch) continue;

    for (const result of batch.results) {
      if (seen.has(result.url)) continue;
      seen.add(result.url);
      added.push({ id: nextId++, title: result.title, url: result.url, content: result.content });
    }
  }

  return added;
}

async function reflect(message: string, findings: Finding[]) {
  const instructions = `You are researching: "${message}". Here is everything found so far:\n\n${poolText(findings)}\n\nCan you fully and confidently answer the question with specific real figures? If yes, say satisfied and leave gaps empty. If no, list the specific missing facts as concrete, searchable items, not vague statements.`;

  const result = await generateText({
    model,
    output: Output.object({ schema: REFLECT_SCHEMA }),
    instructions,
    messages: [{ role: 'user', content: message }],
  });

  return result.output;
}

function synthesize(message: string, findings: Finding[]) {
  const instructions = `You are a finance research assistant. Using only the numbered sources below, answer the question in a few real sentences, citing the source number in brackets right after each claim that depends on it, like "Apple's revenue grew 8% [2]". Never invent facts not in the sources. Plain prose, no Markdown.\n\nSources:\n${poolText(findings)}`;

  return streamText({
    model,
    instructions,
    messages: [{ role: 'user', content: message }],
  });
}

export async function runDeepResearch(message: string, depth: Depth) {
  const maxRounds = ROUND_CAPS[depth];
  let findings: Finding[] = [];
  let gaps: string[] = [];

  for (let round = 0; round < maxRounds; round++) {
    const queries = await plan(message, findings, gaps);
    const added = await search(queries, findings);
    findings = [...findings, ...added];

    const reflection = await reflect(message, findings);
    if (reflection.satisfied) break;
    gaps = reflection.gaps;
  }

  return { findings, result: synthesize(message, findings) };
}
