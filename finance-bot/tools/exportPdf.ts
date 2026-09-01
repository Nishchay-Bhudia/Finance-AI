import { tool } from 'ai';
import { z } from 'zod';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { runPythonAndDownloadFile } from './graph.js';

const output = './outputs';

function stripMarkdown(text: string) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/^[-*]\s+/gm, '• ');
}

export const exportPdf = tool({
  description:
    'Save a finished report as a downloadable PDF file. Requires both title and content - do not call this with content alone. The content field must be a complete, detailed report in plain prose with all requested figures and news. Include chartType and chartPoints whenever the report has real numeric data to plot (like a price history) - this makes the PDF a lot more useful than plain text.',
  inputSchema: z.object({
    title: z.string().describe('Short title for the report, used as the filename and heading. Required on every call, even when content is long.'),
    content: z.string().describe('The full body text to put in the PDF'),
    chartType: z.enum(['bar', 'line']).nullish().describe('Set this (with chartPoints) to have exportPdf draw a chart into the report'),
    chartPoints: z.array(
      z.object({
        label: z.string().describe('e.g. a company name or date'),
        value: z.number().describe('The numerical value to plot'),
      })
    ).nullish().describe('Real numeric data points to chart alongside the report - only used when chartType is also set'),
  }),
  execute: async ({ title, content, chartType, chartPoints }) => {
    if (content.trim().length < 150) {
      return { error: 'content is too short - write at least a few full sentences covering the figure and its context, not just one line.' };
    }

    if (!existsSync(output)) mkdirSync(output);

    const paragraphs = stripMarkdown(content)
      .split(/\n+/)
      .map((p) => p.trim())
      .filter(Boolean);

    const points = chartType && chartPoints && chartPoints.length > 0 ? chartPoints : [];
    const labels = points.map((p) => JSON.stringify(p.label)).join(', ');
    const values = points.map((p) => p.value).join(', ');

    const pythonCode = `
import subprocess
import sys

subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "--target", "/tmp/pylibs", "reportlab"])
sys.path.insert(0, "/tmp/pylibs")

import html
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image

title = ${JSON.stringify(title)}
paragraphs = ${JSON.stringify(paragraphs)}
chart_type = ${JSON.stringify(chartType ?? '')}
labels = [${labels}]
values = [${values}]

styles = getSampleStyleSheet()
title_style = ParagraphStyle("ReportTitle", parent=styles["Title"], fontSize=22, textColor=colors.HexColor("#111827"), spaceAfter=20)
body_style = ParagraphStyle("ReportBody", parent=styles["BodyText"], fontSize=11, leading=17, textColor=colors.HexColor("#1f2937"), spaceAfter=10)

elements = [Paragraph(html.escape(title), title_style)]
for paragraph in paragraphs:
    elements.append(Paragraph(html.escape(paragraph), body_style))
    elements.append(Spacer(1, 4))

if chart_type and values:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import io

    BLUE = "#2563EB"
    GREEN = "#16A34A"
    RED = "#DC2626"
    GRID_COLOR = "#E5E7EB"

    fig, ax = plt.subplots(figsize=(6.5, 3.6))
    plt.rcParams.update({"font.size": 10, "axes.edgecolor": GRID_COLOR})

    if chart_type == "bar":
        pairs = sorted(zip(labels, values), key=lambda pair: pair[1])
        sorted_labels = [pair[0] for pair in pairs]
        sorted_values = [pair[1] for pair in pairs]
        ax.barh(range(len(sorted_labels)), sorted_values, color=BLUE)
        ax.set_yticks(range(len(sorted_labels)))
        ax.set_yticklabels(sorted_labels)
        ax.xaxis.grid(True, color=GRID_COLOR)
    else:
        change = values[-1] - values[0]
        trend_color = GREEN if change >= 0 else RED
        ax.plot(range(len(values)), values, color=trend_color, linewidth=2.4)
        ax.set_xticks(range(len(labels)))
        ax.set_xticklabels(labels, rotation=30, ha="right")
        ax.yaxis.grid(True, color=GRID_COLOR)

    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.set_axisbelow(True)
    fig.tight_layout()

    buffer = io.BytesIO()
    fig.savefig(buffer, format="png", dpi=170)
    buffer.seek(0)
    elements.append(Spacer(1, 16))
    elements.append(Image(buffer, width=6.5 * inch, height=3.6 * inch))

doc = SimpleDocTemplate("report.pdf", pagesize=letter, topMargin=0.85 * inch, bottomMargin=0.85 * inch, leftMargin=0.85 * inch, rightMargin=0.85 * inch)
doc.build(elements)
`;

    try {
      const fileBuffer = await runPythonAndDownloadFile(pythonCode, 'report.pdf');

      const safeName = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const filename = `${safeName}-${Date.now()}.pdf`;
      writeFileSync(`${output}/${filename}`, fileBuffer);

      return { filename };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { error: `pdf generation failed: ${message}` };
    }
  },
});
