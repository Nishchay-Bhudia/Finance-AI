import { tool } from 'ai';
import { z } from 'zod';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { runPythonAndDownloadFile } from './graph.js';

const output = './outputs';

export const exportCsv = tool({
  description:
    'Save structured data as a downloadable CSV file. You must call this tool to produce a CSV. Only call this with real data obtained from searchFinance, never placeholder values.',
  inputSchema: z.object({
    title: z.string().describe('Short title used as the filename, something relevant to what is inside the csv'),
    rows: z.array(
      z.object({
        label: z.string().describe('Name of the item, e.g. a ticker or metric'),
        value: z.string().describe('The value for that item'),
      })
    ).describe('One object per row of the CSV'),
  }),
  execute: async ({ title, rows }) => {
    if (!existsSync(output)) mkdirSync(output);

    const pythonCode = `
import csv

rows = ${JSON.stringify(rows)}

with open("data.csv", "w", newline="") as f:
    writer = csv.writer(f)
    writer.writerow(["label", "value"])
    for row in rows:
        writer.writerow([row["label"], row["value"]])
`;

    try {
      const fileBuffer = await runPythonAndDownloadFile(pythonCode, 'data.csv');

      const safeName = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const filename = `${safeName}-${Date.now()}.csv`;
      writeFileSync(`${output}/${filename}`, fileBuffer);

      return { filename };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { error: `csv generation failed: ${message}` };
    }
  },
});
