import { tool } from 'ai';
import { z } from 'zod';
import PDFDocument from 'pdfkit';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { latestGraphFilename } from './graph.js';

const OUTPUT_DIR = './outputs';

export const exportPdf = tool({
  description:
    'Save a finished report as a downloadable PDF file. The content field must be a complete, detailed report in plain prose with all requested figures and news. If generateGraph was used, pass its returned PNG filename as imageFilename so the graph is embedded in the PDF.',
  inputSchema: z.object({
    title: z.string().describe('Short title for the report, used as the filename and heading'),
    content: z.string().describe('The full body text to put in the PDF'),
    imageFilename: z.string().optional().describe('The PNG filename returned by generateGraph, if a graph was requested'),
  }),
