import { tool } from 'ai';
import { z } from 'zod';
import { Daytona } from '@daytona/sdk';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';

const output = './outputs';

export let latestGraphFilename: string | undefined;

export function resetLatestGraph() {
  latestGraphFilename = undefined;
}

// Spins up a throwaway Daytona sandbox, runs some Python in it, and downloads
// one file it produced. This is the reusable bit — the sandbox itself doesn't
// know or care that it's making a chart. Copy this into other projects
// whenever you need to run generated code somewhere isolated and pull a
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
