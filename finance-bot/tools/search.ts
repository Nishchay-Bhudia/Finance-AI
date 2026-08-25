import { tool } from 'ai';
import { z } from 'zod';

export const searchFinance = tool({
  description:
    'Search for real, current financial data such as stock prices, tickers, market metrics, or company financial news. You must call this before stating any financial fact. If you need data on multiple companies, call this once per company, not once for both together.',
  inputSchema: z.object({
    query: z.string().describe('The financial question or company/ticker to search for'),
  }),
  execute: async ({ query }) => searchFinanceData(query),
});

export async function searchFinanceData(query: string) {
  const searchQuery = `${query}. Return actual financial figures and current news in the result content. Do not return only source metadata, result costs, relevance scores, or character counts.`;

  const res = await fetch('https://api.valyu.network/v1/deepsearch', {
    method: 'POST',
    signal: AbortSignal.timeout(30000),
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.VALYU_API_KEY!,
    },
    body: JSON.stringify({
      query: searchQuery,
      search_type: 'all',
      max_num_results: 5,
    }),
  });

  if (!res.ok) {
    return { error: `Valyu request failed: ${res.status}` };
  }

  const data = await res.json() as { results?: { title: string; url: string; content: string }[] };

  // We're running a small local model with a limited context window. Valyu's
  // raw results include the full scraped page text per result, which is way
  // more than the model needs (or can even fit) to pull out a few figures.
  // Keep only what matters, and cap each result's content so the whole
  // payload stays small.
  const results = (data.results ?? []).map((result) => ({
    title: result.title,
    url: result.url,
    content: result.content.slice(0, 1000),
  }));

  return { results };
}