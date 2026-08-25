import { tool } from 'ai';
import { z } from 'zod';
import { Daytona } from '@daytona/sdk';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';

const output = './outputs';

export let latestGraphFilename: string | undefined;

export function resetLatestGraph() {
  latestGraphFilename = undefined;
}
