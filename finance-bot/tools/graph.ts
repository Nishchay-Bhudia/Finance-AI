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
matplotlib.use("Agg")
import matplotlib.pyplot as plt

labels = [${labels}]
values = [${values}]
chart_type = "${type}"
title = ${JSON.stringify(title)}

ACCENT = "#2563EB"
GRID_COLOR = "#E5E7EB"

# matplotlib's defaults look dated - a few tweaks go a long way.
plt.rcParams.update({
    "font.size": 10,
    "axes.titlesize": 16,
    "axes.titleweight": "bold",
    "axes.edgecolor": GRID_COLOR,
    "figure.facecolor": "white",
    "axes.facecolor": "white",
})

fig, ax = plt.subplots(figsize=(7, 4.5))


def hide_borders():
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_visible(False)
    ax.tick_params(length=0)


if chart_type == "bar":
    # sort so the biggest bar ends up on top - easier to scan
    pairs = sorted(zip(labels, values), key=lambda pair: pair[1])
    sorted_labels = [pair[0] for pair in pairs]
    sorted_values = [pair[1] for pair in pairs]

    y = range(len(sorted_labels))
    bars = ax.barh(y, sorted_values, color=ACCENT, height=0.6)
    ax.set_yticks(y)
    ax.set_yticklabels(sorted_labels)
    ax.xaxis.grid(True, color=GRID_COLOR)
    ax.set_axisbelow(True)

    for bar, value in zip(bars, sorted_values):
        ax.text(
            bar.get_width(),
            bar.get_y() + bar.get_height() / 2,
            f" {value:g}",
            va="center",
            fontsize=9,
        )

else:
    x = range(len(labels))
    ax.plot(x, values, color=ACCENT, marker="o", linewidth=2.5)
    ax.fill_between(x, values, min(values), color=ACCENT, alpha=0.08)
    ax.set_xticks(x)
    ax.yaxis.grid(True, color=GRID_COLOR)
    ax.set_axisbelow(True)

    if any(len(str(label)) > 8 for label in labels):
        ax.set_xticklabels(labels, rotation=30, ha="right")
    else:
        ax.set_xticklabels(labels)

    # label the most recent point so the current value is obvious
    if values:
        ax.annotate(
            f"{values[-1]:g}",
            (len(values) - 1, values[-1]),
            xytext=(6, 0),
            textcoords="offset points",
            va="center",
            fontsize=9,
            fontweight="bold",
        )

hide_borders()
ax.set_title(title, loc="left", pad=14)
plt.tight_layout()
plt.savefig("graph.png", dpi=160)
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