import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { startBeating } from './heartbeat.js';
import { lane } from './lane.js';

const config = loadConfig();
const port = Number(process.env.PORT ?? 8787);

startBeating(lane().id, config.beatEverySeconds);
serve({ fetch: createApp(config).fetch, port, hostname: '127.0.0.1' }, (address) => {
  console.log(`rig · ${lane().id} · http://localhost:${address.port}`);
  // A capture starts this same server on PORT=0; IPC reports the OS-assigned port.
  process.send?.({ type: 'rig-listening', port: address.port });
});
