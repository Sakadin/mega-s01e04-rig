import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { capturePreview, parseOptions, verifyHtml } from '../scripts/capture-preview.js';

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rig-preview-test-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('command-driven preview capture', () => {
  it('captures the real running digest with a safely escaped synthetic marker and stops its server', async () => {
    const dir = await tempDir();
    const output = join(dir, 'index.html');
    const port = await capturePreview({ mode: 'marked', output }, {
      ...process.env, TMPDIR: dir, PORT: '8787', LANE_MARKER: 'SYNTHETIC<&>',
      NODE_OPTIONS: '--this-must-not-reach-the-child',
    });
    const page = await readFile(output, 'utf8');
    expect(page).toContain('<span class="marker">SYNTHETIC&lt;&amp;&gt;</span>');
    expect(page).toContain('bad lines: 1');
    expect(page.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1].match(/<tr>/g)).toHaveLength(5);
    expect(page).toMatch(/^<!doctype html>[\s\S]*<\/html>$/);
    expect(page).not.toMatch(/<script\b|<link\b|\bsrc=/i);
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
    // Disposable configuration and heartbeat workspace were removed.
    expect(await readdir(dir)).toEqual(['index.html']);
  });

  it('clean mode overrides an inherited marker and captures the same complete sample page', async () => {
    const dir = await tempDir();
    const output = join(dir, 'index.html');
    await capturePreview({ mode: 'clean', output }, { ...process.env, TMPDIR: dir, LANE_MARKER: 'DO-NOT-COPY' });
    const page = await readFile(output, 'utf8');
    expect(page).toContain('<span class="marker">no marker set</span>');
    expect(page).not.toContain('DO-NOT-COPY');
    expect(page).toContain('<h1>digest · 2026-10-28</h1>');
    expect(page).toContain('bad lines: 1');
  });

  it('refuses an output in the checkout, including a symlinked parent', async () => {
    const dir = await tempDir();
    await symlink(resolve('.'), join(dir, 'checkout'));
    for (const output of [resolve('forbidden-preview.html'), join(dir, 'checkout', 'forbidden-preview.html')]) {
      await expect(capturePreview({ mode: 'clean', output })).rejects.toThrow('outside the checkout');
    }
  });

  it('does not overwrite files or follow final-component symlinks', async () => {
    const dir = await tempDir();
    const output = join(dir, 'existing.html');
    await writeFile(output, 'keep this file');
    await symlink(output, join(dir, 'link.html'));
    for (const path of [output, join(dir, 'link.html')]) {
      await expect(capturePreview({ mode: 'clean', output: path }, { ...process.env, TMPDIR: dir })).rejects.toThrow();
    }
    expect(await readFile(output, 'utf8')).toBe('keep this file');
    expect((await readdir(dir)).sort()).toEqual(['existing.html', 'link.html']);
  });

  it('fails closed when marked mode has no marker', async () => {
    const output = join(await tempDir(), 'index.html');
    await expect(capturePreview({ mode: 'marked', output }, { LANE_MARKER: '  ' })).rejects.toThrow('requires LANE_MARKER');
  });

  it('honors cancellation without creating a preview', async () => {
    const output = join(await tempDir(), 'index.html');
    await expect(capturePreview({ mode: 'clean', output }, process.env, AbortSignal.abort())).rejects.toThrow();
    await expect(readFile(output)).rejects.toThrow();
  });

  it('requires explicit CLI mode and absolute output without printing supplied values', () => {
    expect(parseOptions(['--mode', 'clean', '--output', '/outside/index.html'])).toEqual({ mode: 'clean', output: '/outside/index.html' });
    for (const args of [[], ['--mode', 'unknown', '--output', '/outside/index.html'], ['--mode', 'clean', '--output', 'local.html']]) {
      expect(() => parseOptions(args)).toThrow('Usage:');
    }
  });

  it('rejects truncated pages, missing banners, client scripts and external resources', async () => {
    const page = '<!doctype html><html><style></style><span class="marker">no marker set</span><h1>digest · 2026-10-28</h1><table></table></html>';
    await expect(verifyHtml(Buffer.from(page), 'no marker set')).resolves.toBeUndefined();
    for (const invalid of [page.slice(0, -7), page.replace('no marker set', 'wrong'),
      page.replace('</html>', '<script></script></html>'),
      page.replace('<style>', '<style>@import "https://example.invalid/style.css";')]) {
      await expect(verifyHtml(Buffer.from(invalid), 'no marker set')).rejects.toThrow();
    }
  });
});
