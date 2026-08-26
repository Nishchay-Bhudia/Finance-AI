import { tool } from 'ai';
import { z } from 'zod';
import PDFDocument from 'pdfkit';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { latestGraphFilename } from './graph.js';

const OUTPUT_DIR = './outputs';

export const exportPdf = tool({
  description:
    'Save a finished report as a downloadable PDF file. Requires both title and content - do not call this with content alone. The content field must be a complete, detailed report in plain prose with all requested figures and news. If generateGraph was used, pass its returned PNG filename as imageFilename so the graph is embedded in the PDF.',
  inputSchema: z.object({
    title: z.string().describe('Short title for the report, used as the filename and heading. Required on every call, even when content is long.'),
    content: z.string().describe('The full body text to put in the PDF'),
    imageFilename: z.string().optional().describe('The PNG filename returned by generateGraph, if a graph was requested'),
  }),
  execute: async ({ title, content, imageFilename }) => {
    if (!existsSync(OUTPUT_DIR)) {
      mkdirSync(OUTPUT_DIR);
    }

    const safeName = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const filename = `${safeName}-${Date.now()}.pdf`;
    const filepath = `${OUTPUT_DIR}/${filename}`;

    // generateGraph sets latestGraphFilename right before this tool usually
    // gets called, so that's the fallback if the model forgets to pass it.
    const graphFilename = imageFilename ?? latestGraphFilename;

    await new Promise<void>((resolve, reject) => {
      const doc = new PDFDocument();
      const stream = createWriteStream(filepath);

      doc.pipe(stream);
      doc.fontSize(20).text(title, { underline: true });
      doc.moveDown();

      const plainContent = content.replace(/\*\*/g, '').replace(/^#+\s*/gm, '').replace(/^-\s*/gm, '');
      doc.fontSize(12).text(plainContent);

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