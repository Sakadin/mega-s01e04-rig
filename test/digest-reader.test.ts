import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readNight } from '../src/digest/reader.js';

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return { ...fs, readFileSync: vi.fn(fs.readFileSync) };
});

const night = '2026-10-28';
const event = { at: '2026-10-28T23:00:00+01:00', job: 'job', status: 'ok', owner: 'rook' };
const empty = { rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } };
let runsDir: string;

function writeLines(lines: string[], separator = '\n'): void {
  writeFileSync(join(runsDir, `${night}.jsonl`), lines.join(separator));
}

beforeEach(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-reader-'));
});

afterEach(() => {
  rmSync(runsDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('readNight fixtures (read-only)', () => {
  it('aggregates the five jobs, one bad line and raw event counts for 2026-10-28', () => {
    expect(readNight('runs', night)).toEqual({
      rows: [
        {
          job: 'digest/render', owner: null, runs: 1, retries: 0,
          lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00',
        },
        {
          job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3,
          lastStatus: 'ok', lastError: 'upstream 503',
          firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
        },
        {
          job: 'lane/sync', owner: 'rook', runs: 8, retries: 1,
          lastStatus: 'ok', lastError: 'lock held',
          firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00',
        },
        {
          job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0,
          lastStatus: 'fail', lastError: 'quota exceeded',
          firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00',
        },
        {
          job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0,
          lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00',
        },
      ],
      badLines: 1,
      counts: { ok: 10, retry: 4, fail: 1 },
    });
  });

  it('reads the other fixture without confusing job counts with event counts', () => {
    const digest = readNight('runs', '2026-10-27');
    expect(digest?.rows.map((row) => row.job)).toEqual([
      'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(digest?.rows.find((row) => row.job === 'lane/sync')?.runs).toBe(4);
    expect(digest?.counts).toEqual({ ok: 7, retry: 0, fail: 0 });
    expect(digest?.badLines).toBe(0);
  });
});

describe('readNight aggregation', () => {
  it('keeps file order, original offsets, last owner/status and the latest supplied error', () => {
    writeLines([
      JSON.stringify({ ...event, status: 'retry', error: 'first error' }),
      JSON.stringify({ ...event, at: '2026-10-29T02:00:00+05:30', status: 'fail', error: 'last error' }),
      JSON.stringify({ ...event, at: '2026-10-28T19:00:00-04:00', owner: null }),
    ]);

    expect(readNight(runsDir, night)).toEqual({
      rows: [{
        job: 'job', owner: null, runs: 3, retries: 1, lastStatus: 'ok', lastError: 'last error',
        firstAt: event.at, lastAt: '2026-10-28T19:00:00-04:00',
      }],
      badLines: 0,
      counts: { ok: 1, retry: 1, fail: 1 },
    });
  });

  it('accepts empty string fields without coercion and keeps an explicitly empty last error', () => {
    writeLines([
      JSON.stringify({ ...event, at: '', job: '', owner: '', status: 'retry', error: 'old error' }),
      JSON.stringify({ ...event, at: '', job: '', owner: '', error: '' }),
      JSON.stringify({ ...event, at: '', job: '', owner: '' }),
    ]);
    expect(readNight(runsDir, night)?.rows).toEqual([{
      job: '', owner: '', runs: 3, retries: 1, lastStatus: 'ok', lastError: '', firstAt: '', lastAt: '',
    }]);
  });

  it('sorts jobs by string order and safely handles object prototype names', () => {
    const names = ['z', 'toString', '__proto__', 'a', 'A', 'constructor'];
    writeLines(names.map((job) => JSON.stringify({ ...event, job })));
    expect(readNight(runsDir, night)?.rows.map((row) => row.job)).toEqual([
      'A', '__proto__', 'a', 'constructor', 'toString', 'z',
    ]);
  });

  it('ignores extra fields on an otherwise valid event', () => {
    writeLines([JSON.stringify({ ...event, extra: { nested: true } })]);
    expect(readNight(runsDir, night)).toEqual({
      rows: [{
        job: event.job, owner: event.owner, runs: 1, retries: 0,
        lastStatus: 'ok', lastError: null, firstAt: event.at, lastAt: event.at,
      }],
      badLines: 0,
      counts: { ok: 1, retry: 0, fail: 0 },
    });
  });

  it('does not cache earlier reads', () => {
    writeLines([JSON.stringify(event)]);
    expect(readNight(runsDir, night)?.counts.ok).toBe(1);
    writeLines([]);
    expect(readNight(runsDir, night)).toEqual(empty);
  });
});

describe('readNight malformed input', () => {
  const { at: _at, ...noAt } = event;
  const { job: _job, ...noJob } = event;
  const { status: _status, ...noStatus } = event;
  const { owner: _owner, ...noOwner } = event;
  const malformed: [string, string][] = [
    ['broken JSON', '{"job":'],
    ['blank line', ''],
    ['whitespace line', ' \t '],
    ['null', 'null'],
    ['array', '[]'],
    ['string', '"text"'],
    ['number', '42'],
    ['boolean', 'true'],
    ['empty object', '{}'],
    ['missing at', JSON.stringify(noAt)],
    ['missing job', JSON.stringify(noJob)],
    ['missing status', JSON.stringify(noStatus)],
    ['missing owner', JSON.stringify(noOwner)],
    ['non-string at', JSON.stringify({ ...event, at: 42 })],
    ['non-string job', JSON.stringify({ ...event, job: null })],
    ['unknown status', JSON.stringify({ ...event, status: 'success' })],
    ['non-string status', JSON.stringify({ ...event, status: 1 })],
    ['invalid owner', JSON.stringify({ ...event, owner: false })],
    ['null error', JSON.stringify({ ...event, error: null })],
    ['non-string error', JSON.stringify({ ...event, error: 503 })],
    ['nested error', JSON.stringify({ ...event, error: { message: 'bad' } })],
    ['multiple objects on one line', `${JSON.stringify(event)} ${JSON.stringify(event)}`],
  ];

  it.each(malformed)('counts and skips %s', (_name, line) => {
    writeLines([line, '']);
    expect(readNight(runsDir, night)).toEqual({ ...empty, badLines: 1 });
  });

  it('continues after errors without changing counts, owner, timestamps or last error', () => {
    writeLines([
      JSON.stringify({ ...event, status: 'retry', error: 'keep me' }),
      '{broken',
      JSON.stringify({ ...event, at: 'bad schema', owner: null, status: 'fail', error: 503 }),
      JSON.stringify({ ...event, at: '2026-10-29T00:00:00+01:00' }),
      'null',
    ]);
    expect(readNight(runsDir, night)).toEqual({
      rows: [{
        job: 'job', owner: 'rook', runs: 2, retries: 1, lastStatus: 'ok', lastError: 'keep me',
        firstAt: event.at, lastAt: '2026-10-29T00:00:00+01:00',
      }],
      badLines: 3,
      counts: { ok: 1, retry: 1, fail: 0 },
    });
  });

  it.each(['\n', '\r\n'])('handles %j line endings without a phantom trailing record', (separator) => {
    writeLines([JSON.stringify(event), '', JSON.stringify(event), ''], separator);
    const digest = readNight(runsDir, night);
    expect(digest?.badLines).toBe(1);
    expect(digest?.rows[0].runs).toBe(2);
    expect(digest?.counts).toEqual({ ok: 2, retry: 0, fail: 0 });
  });

  it('counts each actual blank line, but not a final newline', () => {
    writeLines(['', '', '']);
    expect(readNight(runsDir, night)).toEqual({ ...empty, badLines: 2 });
  });
});

describe('readNight file lookup', () => {
  it('distinguishes a missing file from an empty file', () => {
    expect(readNight(runsDir, night)).toBeNull();
    writeLines([]);
    expect(readNight(runsDir, night)).toEqual(empty);
  });

  it('returns null when the runs directory does not exist', () => {
    expect(readNight(join(runsDir, 'missing'), night)).toBeNull();
  });

  it.each(['EACCES', 'EPERM', 'EIO', 'EISDIR', 'ENOTDIR'])('propagates %s instead of reporting a missing night', (code) => {
    const failure = Object.assign(new Error('Cannot read run log'), { code });
    vi.mocked(readFileSync).mockImplementationOnce(() => { throw failure; });
    let caught: unknown;
    try {
      readNight(runsDir, night);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(failure);
  });

  it('propagates unexpected errors without a filesystem code', () => {
    const failure = new Error('Unexpected read failure');
    vi.mocked(readFileSync).mockImplementationOnce(() => { throw failure; });
    expect(() => readNight(runsDir, night)).toThrow(failure);
  });

  it.each([
    '', '..', '../2026-10-28', 'nested/2026-10-28', '/2026-10-28',
    '..\\2026-10-28', '%2e%2e%2f2026-10-28', '2026-10-28.jsonl',
    '2026-1-28', '2026-10-8', '2026-10-28\n', '2026-10-28\r\n',
    '2026-10-28\0', ' 2026-10-28', '2026-10-28 ',
  ])('rejects invalid night %j before touching the filesystem', (invalid) => {
    expect(() => readNight(runsDir, invalid)).toThrow(RangeError);
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it('checks filename format without adding calendar-date validation', () => {
    writeFileSync(join(runsDir, '2026-99-99.jsonl'), '');
    expect(readNight(runsDir, '2026-99-99')).toEqual(empty);
  });
});
