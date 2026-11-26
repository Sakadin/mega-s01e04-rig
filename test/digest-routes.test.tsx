import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const tempDirs: string[] = [];

async function runsDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rig-digest-routes-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function appFor(dir: string) {
  return createApp({
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir: dir,
  });
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, '').replace(/&mdash;/g, '—').trim();
}

function tableFrom(html: string): { headers: string[]; rows: string[][]; classes: string[][] } {
  const table = html.match(/<table\b[^>]*>([\s\S]*?)<\/table>/i)?.[1];
  if (!table) throw new Error('digest page did not contain a table');
  const rowMarkup = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1]);
  const cells = (row: string, tag: 'th' | 'td') =>
    [...row.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi'))].map((match) => stripTags(match[1]));
  const classes = (row: string) =>
    [...row.matchAll(/<td\b([^>]*)>[\s\S]*?<\/td>/gi)].map((match) =>
      match[1].match(/\bclass="([^"]*)"/)?.[1] ?? '',
    );
  return {
    headers: cells(rowMarkup[0] ?? '', 'th'),
    rows: rowMarkup.slice(1).map((row) => cells(row, 'td')),
    classes: rowMarkup.slice(1).map(classes),
  };
}

describe('digest routes', () => {
  it('serves equivalent sorted HTML and JSON for a populated night', async () => {
    const dir = await runsDir();
    await writeFile(
      join(dir, '2026-10-28.jsonl'),
      [
        JSON.stringify({ at: '2026-10-28T09:00:00-07:00', job: 'zeta', status: 'ok', owner: null }),
        JSON.stringify({ at: '2026-10-28T09:01:00+02:00', job: 'alpha', status: 'retry', owner: 'Ada' }),
        JSON.stringify({ at: '2026-10-28T09:02:00+02:00', job: 'alpha', status: 'retry', owner: 'Ada', error: 'first retry' }),
        JSON.stringify({ at: '2026-10-28T09:03:00+02:00', job: 'alpha', status: 'retry', owner: 'Ada', error: 'latest retry' }),
        JSON.stringify({ at: '2026-10-28T09:04:00+02:00', job: 'alpha', status: 'fail', owner: 'Ada', error: 'final failure' }),
        JSON.stringify({ at: '2026-10-28T09:06:00+02:00', job: 'beta', status: 'retry', owner: 'Bea' }),
        JSON.stringify({ at: '2026-10-28T09:07:00+02:00', job: 'beta', status: 'retry', owner: 'Bea' }),
        JSON.stringify({ at: '2026-10-28T09:05:00-07:00', job: 'zeta', status: 'fail', owner: null, error: 'zeta failure' }),
      ].join('\n') + '\n',
    );

    const app = appFor(dir);
    const [htmlResponse, jsonResponse] = await Promise.all([
      app.request('/digest/2026-10-28'),
      app.request('/api/digest/2026-10-28'),
    ]);
    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);

    const html = await htmlResponse.text();
    const result = await jsonResponse.json();
    expect(Object.keys(result).sort()).toEqual(['badLines', 'counts', 'rows']);
    expect(result.badLines).toBe(0);
    expect(result.counts).toEqual({ ok: 1, retry: 5, fail: 2 });
    expect(result.rows.map((row: { job: string }) => row.job)).toEqual(['alpha', 'beta', 'zeta']);
    expect(result.rows.map((row: { runs: number }) => row.runs).reduce((a: number, b: number) => a + b, 0)).toBe(8);
    expect(result.counts.ok + result.counts.retry + result.counts.fail).toBe(8);
    expect(result.rows.map((row: { retries: number }) => row.retries).reduce((a: number, b: number) => a + b, 0)).toBe(result.counts.retry);
    expect(result.rows[0]).toMatchObject({ retries: 3, lastStatus: 'fail', lastError: 'final failure' });
    expect(result.rows[0].firstAt).toBe('2026-10-28T09:01:00+02:00');
    expect(result.rows[0].lastAt).toBe('2026-10-28T09:04:00+02:00');
    expect(result.rows[2]).toMatchObject({ owner: null, lastStatus: 'fail' });

    const table = tableFrom(html);
    expect(table.headers).toEqual([
      'job', 'owner', 'runs', 'retries', 'last status', 'last error', 'first time', 'last time',
    ]);
    expect(table.rows.map((row) => row[0])).toEqual(result.rows.map((row: { job: string }) => row.job));
    expect(table.rows[0]).toEqual([
      'alpha', 'Ada', '4', '3 ⚠', 'fail ⚠', 'final failure',
      '2026-10-28T09:01:00+02:00', '2026-10-28T09:04:00+02:00',
    ]);
    expect(table.rows[1]).toEqual([
      'beta', 'Bea', '2', '2', 'retry', '—',
      '2026-10-28T09:06:00+02:00', '2026-10-28T09:07:00+02:00',
    ]);
    expect(table.rows[2]).toEqual([
      'zeta', '—', '2', '0', 'fail ⚠', 'zeta failure',
      '2026-10-28T09:00:00-07:00', '2026-10-28T09:05:00-07:00',
    ]);
    expect(table.classes[0][3]).toBe('warn');
    expect(table.classes[0][4]).toBe('warn');
    expect(table.classes[1][3]).toBe('');
    expect(table.classes[1][4]).toBe('');
    expect(table.classes[2][3]).toBe('');
    expect(table.classes[2][4]).toBe('warn');
    expect(result.rows[2].owner).toBeNull();
  });

  it('returns 404 from both routes when the night file is missing', async () => {
    const app = appFor(await runsDir());
    const [html, json] = await Promise.all([
      app.request('/digest/2099-01-01'),
      app.request('/api/digest/2099-01-01'),
    ]);
    expect(html.status).toBe(404);
    expect(json.status).toBe(404);
  });

  it('renders an empty night with no rows and zero counts', async () => {
    const dir = await runsDir();
    await writeFile(join(dir, '2026-10-28.jsonl'), '');
    const app = appFor(dir);
    const [htmlResponse, jsonResponse] = await Promise.all([
      app.request('/digest/2026-10-28'),
      app.request('/api/digest/2026-10-28'),
    ]);
    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    expect(await htmlResponse.text()).toMatch(/nothing ran/i);
    expect(await jsonResponse.json()).toEqual({ rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
  });

  it('counts and ignores malformed JSON and schema-invalid lines', async () => {
    const dir = await runsDir();
    await writeFile(
      join(dir, '2026-10-28.jsonl'),
      [
        '{not json',
        JSON.stringify({ at: '2026-10-28T10:00:00+05:30', job: 'valid', status: 'ok', owner: null }),
        JSON.stringify({ at: '2026-10-28T10:01:00+05:30', job: 'bad-status', status: 'running', owner: null }),
        JSON.stringify({ at: '2026-10-28T10:02:00+05:30', job: 'bad-owner', status: 'fail', owner: 42 }),
      ].join('\n') + '\n',
    );
    const app = appFor(dir);
    const [htmlResponse, jsonResponse] = await Promise.all([
      app.request('/digest/2026-10-28'),
      app.request('/api/digest/2026-10-28'),
    ]);
    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    const html = await htmlResponse.text();
    const result = await jsonResponse.json();
    expect(html).toContain('bad lines: 3');
    expect(result.badLines).toBe(3);
    expect(result.rows.map((row: { job: string }) => row.job)).toEqual(['valid']);
    expect(result.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
    expect(html).toContain('valid');
    expect(html).not.toContain('bad-status');
    expect(html).not.toContain('bad-owner');
  });
});
