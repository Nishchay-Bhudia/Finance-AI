import { tool } from 'ai';
import { z } from 'zod';
import { Daytona } from '@daytona/sdk';
import { put } from '@vercel/blob';

export let latestGraphFilename: string | undefined ;

export function resetLatestGraph() {
  latestGraphFilename = undefined;
}

export async function runPythonAndDownloadFile(code: string, resultFilename: string) {
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

export type ChartPoint = { label: string; value: number };

export async function makeChartImage(title: string, type: 'bar' | 'line', points: ChartPoint[]) {
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

BLUE = "#2563EB"
GREEN = "#16A34A"
RED = "#DC2626"
GRID_COLOR = "#E5E7EB"
TEXT_COLOR = "#111827"

plt.rcParams.update({
    "font.size": 10,
    "text.color": TEXT_COLOR,
    "axes.edgecolor": GRID_COLOR,
    "figure.facecolor": "white",
    "axes.facecolor": "white",
})


def hide_borders():
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_visible(False)
    ax.tick_params(length=0)


if chart_type == "bar":
    pairs = sorted(zip(labels, values), key=lambda pair: pair[1])
    sorted_labels = [pair[0] for pair in pairs]
    sorted_values = [pair[1] for pair in pairs]

    height = max(1.8, min(4.5, len(sorted_labels) * 0.8 + 1))
    fig, ax = plt.subplots(figsize=(7.5, height))

    y = range(len(sorted_labels))
    bars = ax.barh(y, sorted_values, color=BLUE, height=0.6, zorder=3)
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
            fontsize=9.5,
            fontweight="bold",
        )

    hide_borders()
    ax.set_title(title, loc="left", pad=16, fontsize=16, fontweight="bold")
    plt.tight_layout()

else:
    fig, ax = plt.subplots(figsize=(7.5, 4.6))

    change = values[-1] - values[0]
    percent_change = (change / values[0] * 100) if values[0] else 0
    trend_color = GREEN if change >= 0 else RED

    x = range(len(labels))
    ax.plot(x, values, color=trend_color, linewidth=2.6, zorder=3)
    ax.fill_between(x, values, min(values), color=trend_color, alpha=0.08, zorder=1)

    ax.scatter(
        [0, len(values) - 1],
        [values[0], values[-1]],
        color=trend_color,
        s=45,
        zorder=4,
        edgecolor="white",
        linewidth=1.5,
    )
    ax.annotate(
        f"{values[-1]:g}",
        (len(values) - 1, values[-1]),
        xytext=(8, 0),
        textcoords="offset points",
        va="center",
        fontsize=10,
        fontweight="bold",
        color=trend_color,
    )

    ax.set_xticks(x)
    if any(len(str(label)) > 8 for label in labels):
        ax.set_xticklabels(labels, rotation=30, ha="right")
    else:
        ax.set_xticklabels(labels)

    ax.yaxis.grid(True, color=GRID_COLOR)
    ax.set_axisbelow(True)
    hide_borders()

    fig.subplots_adjust(top=0.78, bottom=0.2)
    fig.text(0.06, 0.93, title, fontsize=16, fontweight="bold")
    fig.text(
        0.06,
        0.86,
        f"{change:+.2f} ({percent_change:+.1f}%)",
        fontsize=11,
        fontweight="bold",
        color=trend_color,
    )

plt.savefig("graph.png", dpi=170)
`;

  return runPythonAndDownloadFile(pythonCode, 'graph.png');
}

export const generateGraph = tool({
  description:
    'Generate a graph image from structured data. Call this only after searchFinance returns real numeric figures. Always provide a chart type and at least one point with a label and number. Do not call this with empty points or invented values. A single point makes a boring, near-useless graph - if the search results include a price history (a list of dates/prices, not just the latest price), pass several of those points instead of just one.',
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
    try {
      const fileBuffer = await makeChartImage(title, type, points);

      const safeName = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const filename = `${safeName}-${Date.now()}.png`;
      const blob = await put(`files/${filename}`, fileBuffer, {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'image/png',
      });
      latestGraphFilename = filename;

      return { filename, url: blob.url, downloadUrl: blob.downloadUrl };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { error: `graph generation failed: ${message}` };
    }
  },
});