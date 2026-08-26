import { tool } from 'ai';
import { z } from 'zod';
import { Daytona } from '@daytona/sdk';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';

const output = './outputs';

export let latestGraphFilename: string | undefined;

export function resetLatestGraph() {
  latestGraphFilename = undefined;
}

//Spins up a throwaway Daytona sandbox, runs some Python in it, and downloads
// one file it produced. This is the reusable bit — the sandbox itself doesn't
// know or care that it's making a chart. Copy this into other projects
//        whenever you need to run generated code somewhere isolated and pull a
// result file back out.
async function runPythonAndDownloadFile(code: string, resultFilename: string) {
  const daytona = new Daytona();
  const sandbox = await daytona.create({ language: 'python' });

  try {
    const result = await sandbox.process.codeRun(code);
    if (result.exitCode !== 0) {
      throw new Error(result.result);
    }
    return await sandbox.fs.downloadFile(resultFilename);
  } finally {
    await sandbox.delete();
  }
}

export const generateGraph = tool({
  description:
    'Generate a graph image from structured data. Call this only after searchFinance returns real numeric figures. Always provide a chart type and at least one point with a label and number. Do not call this with empty points or invented values.',
  inputSchema: z.object({
    title: z.string().describe('Chart title , make it relevant to the figures of the chart'),
    type: z.enum(['bar', 'line']).describe('The field must be named "type" (not "chartType"). Use bar for comparing figures and line for figures over time'),
    points: z.array(
      z.object({
        label: z.string().describe('e.g. a company name or date'),
        value: z.number().describe('The numerical value to plot'),
      })
    ).min(1).describe('Real numeric data points from searchFinance'),
  }),
  execute: async ({ title, type, points }) => {
    if (!existsSync(output)) mkdirSync(output);

    const labels = points.map(p => JSON.stringify(p.label)).join(', ');
    const values = points.map(p => p.value).join(', ');

    const pythonCode = `

import matplotlib

matplotlib.use('Agg')
import matplotlib.pyplot as plt

labels = [${labels}]
values = [${values}]

plt.figure(figsize=(6, 4))
if "${type}" == "bar":
    plt.bar(labels, values)
else:
    plt.plot(labels, values, marker='o')

plt.title(${JSON.stringify(title)})
plt.tight_layout()
plt.savefig('graph.png')
`;

    try {
      const fileBuffer = await runPythonAndDownloadFile(pythonCode, 'graph.png');

      const safeName = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const filename = `${safeName}-${Date.now()}.png`;
      writeFileSync(`${output}/${filename}`, fileBuffer);
      latestGraphFilename = filename;

      return { filename };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { error: `graph generation failed: ${message}` };
    }
  },
});