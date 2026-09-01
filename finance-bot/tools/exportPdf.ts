import { tool } from 'ai';
import { z } from 'zod';
import PDFDocument from 'pdfkit';
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { latestGraphFilename, makeChartImage } from './graph.js';

const OUTPUT_DIR = './outputs';

// The model writes in plain prose already, but it slips into Markdown
// habits sometimes anyway (**bold**, "- " bullets, # headings). pdfkit
// doesn't understand any of that - it would print the * and # characters
// literally - so this strips the syntax down to plain, readable text
// before it goes in the PDF.
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1') // **bold** -> bold
    .replace(/__(.+?)__/g, '$1')     // __bold__ -> bold
    .replace(/\*(.+?)\*/g, '$1')     // *italic* -> italic
    .replace(/`([^`]+)`/g, '$1')     // `code` -> code
    .replace(/^#+\s*/gm, '')         // # Heading -> Heading
    .replace(/^[-*]\s+/gm, '• '); // "- item" / "* item" -> "• item"
}

export const exportPdf = tool({
  description:
    'Save a finished report as a downloadable PDF file. Requires both title and content - do not call this with content alone. The content field must be a complete, detailed report in plain prose with all requested figures and news. Include chartType and chartPoints whenever the report has real numeric data to plot (like a price history) - this makes the PDF a lot more useful than plain text. If generateGraph was already called separately, pass its returned PNG filename as imageFilename instead.',
  inputSchema: z.object({
    title: z.string().describe('Short title for the report, used as the filename and heading. Required on every call, even when content is long.'),
    content: z.string().describe('The full body text to put in the PDF'),
    imageFilename: z.string().optional().describe('The PNG filename returned by generateGraph, if a graph was requested separately'),
    chartType: z.enum(['bar', 'line']).optional().describe('Set this (with chartPoints) to have exportPdf draw its own graph, instead of needing a separate generateGraph call first'),
    chartPoints: z.array(
      z.object({
        label: z.string().describe('e.g. a company name or date'),
        value: z.number().describe('The numerical value to plot'),
      })
    ).optional().describe('Real numeric data points to chart alongside the report - only used when chartType is also set'),
  }),
  execute: async ({ title, content, imageFilename, chartType, chartPoints }) => {
    if (!existsSync(OUTPUT_DIR)) {
      mkdirSync(OUTPUT_DIR);
    }

    const safeName = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const filename = `${safeName}-${Date.now()}.pdf`;
    const filepath = `${OUTPUT_DIR}/${filename}`;

    // Prefer drawing our own chart from real data over reusing whatever
    // graph happened to be generated most recently - that fallback still
    // exists for when the model calls generateGraph separately first.
    let graphFilename = imageFilename ?? latestGraphFilename;
    if (chartType && chartPoints && chartPoints.length > 0) {
      const chartBuffer = await makeChartImage(title, chartType, chartPoints);
      graphFilename = `${safeName}-chart-${Date.now()}.png`;
      writeFileSync(`${OUTPUT_DIR}/${graphFilename}`, chartBuffer);
    }

    await new Promise<void>((resolve, reject) => {
      const doc = new PDFDocument();
      const stream = createWriteStream(filepath);

      doc.pipe(stream);
      doc.fontSize(20).text(title, { underline: true });
      doc.moveDown();

      doc.fontSize(12).text(stripMarkdown(content));

      const imagePath = graphFilename ? join(OUTPUT_DIR, graphFilename) : undefined;
      if (imagePath && existsSync(imagePath)) {
        doc.moveDown();
        doc.fontSize(14).text('Graph');
        doc.image(imagePath, { fit: [500, 320], align: 'center' });
      }

      doc.end();

      stream.on('finish', () => resolve());
      stream.on('error', reject);
    });

    return { filename, path: filepath };
  },
});