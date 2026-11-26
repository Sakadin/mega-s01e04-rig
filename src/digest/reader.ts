import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestResult, DigestRow, DigestStatus, ReadNight } from './types.js';

type RunEvent = {
  at: string;
  job: string;
  status: DigestStatus;
  owner: string | null;
  error?: string;
};

function parseEvent(line: string): RunEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  if (
    typeof event.at !== 'string' ||
    typeof event.job !== 'string' ||
    (event.status !== 'ok' && event.status !== 'retry' && event.status !== 'fail') ||
    (typeof event.owner !== 'string' && event.owner !== null) ||
    (event.error !== undefined && typeof event.error !== 'string')
  ) return null;

  return {
    at: event.at,
    job: event.job,
    status: event.status,
    owner: event.owner,
    error: event.error,
  };
}

export const readNight: ReadNight = (runsDir, night) => {
  // Check the full name before joining paths; calendar validation is not needed.
  if (night.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(night)) {
    throw new RangeError('Night must use YYYY-MM-DD format');
  }

  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const result: DigestResult = { rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } };
  const jobs = new Map<string, DigestRow>();
  const lines = contents.split('\n');
  // Neither an empty file nor a terminating newline supplies an extra record.
  if (lines.at(-1) === '') lines.pop();

  for (const line of lines) {
    const event = parseEvent(line);
    if (event === null) {
      result.badLines += 1;
      continue;
    }

    result.counts[event.status] += 1;
    const row = jobs.get(event.job);
    if (row) {
      row.owner = event.owner;
      row.runs += 1;
      if (event.status === 'retry') row.retries += 1;
      row.lastStatus = event.status;
      if (event.error !== undefined) row.lastError = event.error;
      row.lastAt = event.at;
    } else {
      jobs.set(event.job, {
        job: event.job,
        owner: event.owner,
        runs: 1,
        retries: event.status === 'retry' ? 1 : 0,
        lastStatus: event.status,
        lastError: event.error ?? null,
        firstAt: event.at,
        lastAt: event.at,
      });
    }
  }

  result.rows = [...jobs.values()].sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return result;
};
