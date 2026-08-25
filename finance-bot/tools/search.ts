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
