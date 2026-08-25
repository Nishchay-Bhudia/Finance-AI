
import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import { streamText, stepCountIs } from 'ai';
import { model } from './lib/ai.js';
import { searchFinanceData } from './tools/search.js';
import { exportPdf } from './tools/exportPdf.js';
import { exportCsv } from './tools/exportCsv.js';
import { generateGraph, resetLatestGraph } from './tools/graph.js';
