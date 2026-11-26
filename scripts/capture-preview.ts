import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { html } from 'hono/html';
import { loadConfig } from '../src/config.js';

const repo = fileURLToPath(new URL('../', import.meta.url));
const night = '2026-10-28';
type Mode = 'marked' | 'clean';
type Options = { mode: Mode; output: string };

class CaptureError extends Error {}

export function parseOptions(args: string[]): Options {
  if (args.length !== 4 || args[0] !== '--mode' || args[2] !== '--output' ||
      (args[1] !== 'marked' && args[1] !== 'clean') || !isAbsolute(args[3])) {
    throw new CaptureError('Usage: pnpm capture:preview --mode marked|clean --output /absolute/path/index.html');
  }
  return { mode: args[1], output: args[3] };
}

async function outsideRepo(output: string): Promise<void> {
  // Resolve symlinked parents too. The parent must exist; exclusive creation below
  // also refuses an existing output or a final-component symlink.
  const parent = await realpath(dirname(output));
  const root = await realpath(repo);
  const path = relative(root, parent);
  if (path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))) {
    throw new CaptureError('Output must be outside the checkout, including through symlinks.');
  }
}

function readyPort(child: ChildProcess, signal: AbortSignal): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const finish = (port?: number) => {
      child.off('message', onMessage);
      child.off('error', onFailure);
      child.off('exit', onFailure);
      signal.removeEventListener('abort', onFailure);
      if (port === undefined) reject(new CaptureError('Server did not become ready.'));
      else resolvePort(port);
    };
    const onMessage = (message: unknown) => {
      if (typeof message === 'object' && message !== null && 'type' in message &&
          message.type === 'rig-listening' && 'port' in message &&
          typeof message.port === 'number' && Number.isInteger(message.port) &&
          message.port > 0 && message.port <= 65535) finish(message.port);
    };
    const onFailure = () => finish();
    child.on('message', onMessage);
    child.once('error', onFailure);
    child.once('exit', onFailure);
    signal.addEventListener('abort', onFailure, { once: true });
    if (signal.aborted) onFailure();
  });
}

function getDigest(port: number, signal: AbortSignal): Promise<Buffer> {
  return new Promise((resolveBody, reject) => {
    // node:http connects directly to loopback: no proxy, redirects or app.request().
    const request = get({ hostname: '127.0.0.1', port, path: `/digest/${night}`, signal }, (response) => {
      if (response.statusCode !== 200 || !response.headers['content-type']?.startsWith('text/html')) {
        response.resume();
        reject(new CaptureError('Digest GET did not return HTTP 200 HTML.'));
        return;
      }
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.once('end', () => resolveBody(Buffer.concat(chunks)));
      response.once('error', () => reject(new CaptureError('Digest response was incomplete.')));
    });
    request.once('error', () => reject(new CaptureError('Digest GET failed.')));
  });
}

export async function verifyHtml(body: Buffer, marker: string): Promise<void> {
  const page = body.toString('utf8');
  const banner = String(await html`<span class="marker">${marker}</span>`);
  if (!/^<!doctype html>/i.test(page) || !page.endsWith('</html>') ||
      !page.includes(`<h1>digest · ${night}</h1>`) || !page.includes(banner) ||
      !page.includes('<style>') || !page.includes('<table>')) {
    throw new CaptureError('Digest is incomplete or its banner does not match the selected mode.');
  }
  if (/<(?:script|link|img|iframe|object|embed|audio|video|source|base)\b/i.test(page) ||
      /\b(?:src|srcset|href)\s*=|@import\b|url\s*\(/i.test(page)) {
    throw new CaptureError('Digest must be self-contained HTML without scripts or external resources.');
  }
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
  const exited = once(child, 'exit');
  const kill = setTimeout(() => child.kill('SIGKILL'), 2_000);
  try {
    child.kill('SIGTERM');
    await exited;
  } finally {
    clearTimeout(kill);
  }
}

// Returns the now-closed port so tests can verify that the real server is gone.
export async function capturePreview(
  options: Options,
  env: NodeJS.ProcessEnv = process.env,
  signal: AbortSignal = new AbortController().signal,
): Promise<number> {
  if (!isAbsolute(options.output)) throw new CaptureError('Output must be an absolute path.');
  await outsideRepo(options.output);
  const marker = options.mode === 'marked' ? env.LANE_MARKER?.trim() : '';
  if (options.mode === 'marked' && !marker) throw new CaptureError('Marked capture requires LANE_MARKER.');
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
  deadline.throwIfAborted();
  const workspace = await mkdtemp(join(env.RUNNER_TEMP ?? env.TMPDIR ?? tmpdir(), 'rig-capture-'));
  let child: ChildProcess | undefined;
  try {
    const config = loadConfig(join(repo, 'rig.json'));
    await writeFile(join(workspace, 'rig.json'), JSON.stringify({ ...config, runsDir: resolve(repo, config.runsDir) }));
    deadline.throwIfAborted();
    child = fork(join(repo, 'src/server.ts'), [], {
      cwd: workspace,
      execArgv: ['--import', import.meta.resolve('tsx')],
      // No inherited secrets, NODE_OPTIONS, PORT or .env loader. Heartbeat stays
      // in the disposable workspace; the repository's runs remain read-only.
      env: {
        PATH: env.PATH,
        TMPDIR: workspace,
        TSX_TSCONFIG_PATH: join(repo, 'tsconfig.json'),
        PORT: '0',
        LANE_ID: env.LANE_ID ?? 'lane-07',
        LANE_MARKER: marker ?? '',
      },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    const port = await readyPort(child, deadline);
    const body = await getDigest(port, deadline);
    await verifyHtml(body, marker || 'no marker set');
    deadline.throwIfAborted();
    // Preserve the entire HTTP response body byte-for-byte. Never overwrite a
    // file, follow a final symlink, or print page contents or marker values.
    await writeFile(options.output, body, { flag: 'wx', mode: 0o600 });
    return port;
  } finally {
    try {
      if (child) await stop(child);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.on('SIGINT', abort);
  process.on('SIGTERM', abort);
  try {
    await capturePreview(parseOptions(process.argv.slice(2)), process.env, controller.signal);
    console.log('Preview captured and verified; server stopped. No page content was logged.');
  } catch (error) {
    console.error(error instanceof CaptureError ? error.message : 'Capture failed; check output location and dependencies.');
    process.exitCode = 1;
  } finally {
    process.off('SIGINT', abort);
    process.off('SIGTERM', abort);
  }
}
