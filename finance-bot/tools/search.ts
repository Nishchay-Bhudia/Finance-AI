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
    signal: AbortSignal.timeout(60000),
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.VALYU_API_KEY!, // ! is like saying trust me to ts this is legit
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

  const data = await res.json() as { results?: { title: string; url: string; content: unknown }[] };

  // Keep only what matters, and cap each result's content so the whole
  // payload stays small. Valyu doesn't always send content as a string -
  // a result that's just a single price sometimes comes back as a plain
  // number, so convert to string before trying to slice it.
  const results = (data.results ?? []).map((result) => ({
    title: result.title,
    url: result.url,
    content: String(result.content).slice(0, 1000),
  }));

  return { results };
}