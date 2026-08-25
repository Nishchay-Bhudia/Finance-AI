import { tool } from 'ai';
import { z } from 'zod';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { latestGraphFilename } from './graph.js';

const outputDir = './outputs';

export const exportCsv = tool({
  description:
    'Save structured data as a downloadable CSV file. You must call this tool to produce a CSV. Only call this with real data obtained from searchFinance, never placeholder values. If generateGraph was used, include its PNG filename in graphFilename and include the graph data in rows.',
  inputSchema: z.object({
    title: z.string().describe('Short title used as the filename, something relevant to what is inside the csv'),
    rows: z.array(
      z.object({
        label: z.string().describe('Name of the item, e.g. a ticker or metric'),
        value: z.string().describe('The value for that item'),
      })
    ).describe('One object per row of the CSV'),
    graphFilename: z.string().optional().describe('The PNG filename returned by generateGraph'),
  }),
  execute: async ({ title, rows, graphFilename }) => {
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir);
    }

    const safeName = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const filename = `${safeName}-${Date.now()}.csv`;
    const filepath = `${outputDir}/${filename}`;

    const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const header = 'label,value';
    const lines = rows.map(row => `${escape(row.label)},${escape(row.value)}`);
    const currentGraph = graphFilename ?? latestGraphFilename;
    if (currentGraph) lines.push(`${escape('graph_file')},${escape(currentGraph)}`);
    const csv = [header, ...lines].join('\n');

    writeFileSync(filepath, csv);
