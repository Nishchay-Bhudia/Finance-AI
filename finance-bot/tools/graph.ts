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
import numpy as np
from matplotlib.ticker import FuncFormatter

labels = [${labels}]
values = [${values}]
chart_type = "${type}"
title = ${JSON.stringify(title)}


plt.rcParams.update({
    "font.family": "DejaVu Sans",
    "font.size": 10,
    "axes.titlesize": 17,
    "axes.titleweight": "bold",
    "axes.labelsize": 10,
    "axes.edgecolor": "#D1D5DB",
    "axes.linewidth": 0.8,
    "xtick.color": "#6B7280",
    "ytick.color": "#6B7280",
    "text.color": "#111827",
    "figure.facecolor": "#FFFFFF",
    "axes.facecolor": "#FFFFFF",
    "savefig.facecolor": "#FFFFFF",
})

# Convert values safely
values = np.asarray(values, dtype=float)



if chart_type == "bar":
    width = max(7, min(12, len(labels) * 0.85))
    height = 5.2
else:
    width = max(7, min(12, len(labels) * 0.75))
    height = 5.2

fig, ax = plt.subplots(figsize=(width, height))



def format_value(value):
    value = float(value)

    if abs(value) >= 1_000_000_000:
        return f"{value / 1_000_000_000:.1f}B"
    elif abs(value) >= 1_000_000:
        return f"{value / 1_000_000:.1f}M"
    elif abs(value) >= 1_000:
        return f"{value / 1_000:.1f}K"
    elif value == int(value):
        return f"{int(value)}"
    else:
        return f"{value:.2f}".rstrip("0").rstrip(".")


def clean_spines():
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_visible(False)
    ax.spines["bottom"].set_color("#E5E7EB")

    ax.tick_params(
        axis="both",
        which="both",
        length=0,
        pad=7
    )




if chart_type == "bar":

    # Sort bars from smallest → largest
    order = np.argsort(values)
    sorted_labels = np.asarray(labels)[order]
    sorted_values = values[order]

    # Horizontal bars are much easier to read for categories
    y = np.arange(len(sorted_labels))

    bars = ax.barh(
        y,
        sorted_values,
        height=0.62,
        color="#2563EB",
        alpha=0.92,
        edgecolor="none"
    )

    ax.set_yticks(y)
    ax.set_yticklabels(sorted_labels)

    # Subtle horizontal grid
    ax.xaxis.grid(
        True,
        color="#E5E7EB",
        linewidth=0.8,
        alpha=0.8
    )
    ax.yaxis.grid(False)
    ax.set_axisbelow(True)

    # Add values to the end of bars
    max_value = max(abs(sorted_values)) if len(sorted_values) else 1
    offset = max_value * 0.015

    for bar, value in zip(bars, sorted_values):
        ax.text(
            value + offset,
            bar.get_y() + bar.get_height() / 2,
            format_value(value),
            va="center",
            ha="left",
            fontsize=9.5,
            fontweight="600",
            color="#374151"
        )

    # Extra room for value labels
    ax.set_xlim(
        left=min(0, sorted_values.min() * 1.05),
        right=sorted_values.max() * 1.15
    )

    clean_spines()


else:

    x = np.arange(len(labels))

    # Main line
    ax.plot(
        x,
        values,
        linewidth=2.8,
        color="#2563EB",
        marker="o",
        markersize=6,
        markerfacecolor="#FFFFFF",
        markeredgecolor="#2563EB",
        markeredgewidth=2,
        solid_capstyle="round",
        zorder=3
    )

    # Subtle area beneath the line
    ax.fill_between(
        x,
        values,
        0,
        alpha=0.07,
        color="#2563EB",
        zorder=1
    )

    ax.set_xticks(x)
    ax.set_xticklabels(labels)

    # Horizontal grid only
    ax.yaxis.grid(
        True,
        color="#E5E7EB",
        linewidth=0.8,
        alpha=0.8
    )
    ax.xaxis.grid(False)
    ax.set_axisbelow(True)

    # Highlight the latest/highest point
    if len(values) > 0:
        max_idx = np.argmax(values)

        ax.scatter(
            x[max_idx],
            values[max_idx],
            s=65,
            color="#2563EB",
            edgecolor="#FFFFFF",
            linewidth=2,
            zorder=4
        )

        ax.annotate(
            format_value(values[max_idx]),
            xy=(x[max_idx], values[max_idx]),
            xytext=(0, 12),
            textcoords="offset points",
            ha="center",
            fontsize=9.5,
            fontweight="600",
            color="#374151"
        )

    clean_spines()



ax.set_title(
    title,
    loc="left",
    pad=18,
    color="#111827"
)

# Remove unnecessary axis labels
ax.set_xlabel("")
ax.set_ylabel("")

# Rotate long x-axis labels when necessary
if chart_type != "bar":
    if any(len(str(label)) > 10 for label in labels):
        plt.setp(
            ax.get_xticklabels(),
            rotation=35,
            ha="right"
        )

#

fig.subplots_adjust(
    left=0.08,
    right=0.96,
    top=0.86,
    bottom=0.14
)

plt.savefig(
    "graph.png",
    dpi=180,
    bbox_inches="tight",
    pad_inches=0.25
)

plt.close(fig)
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