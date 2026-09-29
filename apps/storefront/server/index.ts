import express from 'express';
import type { ErrorRequestHandler } from 'express';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSettings } from './config.js';
import { registerRealtime } from './realtime.js';
import { registerAgent } from './agent.js';
import { registerCatalogue } from './catalogue.js';
import { registerOrders } from './orders.js';
import { registerLiveVoice } from './liveVoice.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const settings = loadSettings(root);
const production = process.argv.includes('--production');
const app = express();
app.disable('x-powered-by');
app.use((request, response, next) => {
  const host = request.get('host') || '';
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) { response.status(400).json({ detail: 'ローカルホストからのみ利用できます。' }); return; }
  response.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
  if (request.method === 'POST') {
    if (request.get('origin') !== `${request.protocol}://${host}`) { response.status(403).json({ detail: '同じ画面からの接続のみ許可しています。' }); return; }
    if (!request.is('application/json')) { response.status(415).json({ detail: 'JSON リクエストが必要です。' }); return; }
  }
  next();
});
app.use(express.json({ limit: '128kb' }));
registerRealtime(app, settings);
const closeLiveVoice = registerLiveVoice(app, settings);
const closeAgents = registerAgent(app, settings, root);
const closeCatalogue = registerCatalogue(app, settings);
const closeOrders = registerOrders(app, settings);
app.use('/api', (_request, response) => { response.status(404).json({ detail: 'API が見つかりません。' }); });
const httpServer = createServer(app);
let closeVite: (() => Promise<void>) | undefined;
if (production) {
  app.use(express.static(path.join(root, 'dist'), { index: false }));
  app.get(['/', '/shop'], (_request, response) => response.sendFile(path.join(root, 'dist/index.html')));
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({ root, appType: 'custom', server: { middlewareMode: true, hmr: { server: httpServer } } });
  closeVite = () => vite.close();
  app.use(vite.middlewares);
  app.get(['/', '/shop'], async (request, response, next) => {
    try {
      const template = await readFile(path.join(root, 'index.html'), 'utf8');
      response.type('html').send(await vite.transformIndexHtml(request.originalUrl, template));
    } catch (error) { next(error); }
  });
}
const onError: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  const status = error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : 500;
  response.status(status >= 400 && status < 600 ? status : 500).json({ detail: 'リクエストを処理できませんでした。' });
};
app.use(onError);
async function listen(port: number): Promise<number> {
  try {
    await new Promise<void>((resolve, reject) => {
      const failed = (error: NodeJS.ErrnoException) => { httpServer.off('listening', ready); reject(error); };
      const ready = () => { httpServer.off('error', failed); resolve(); };
      httpServer.once('error', failed); httpServer.once('listening', ready); httpServer.listen(port, '127.0.0.1');
    });
    return port;
  } catch (error) {
    if (!production && error && typeof error === 'object' && 'code' in error && error.code === 'EADDRINUSE' && port < Math.min(settings.PORT + 20, 65535)) return listen(port + 1);
    throw error;
  }
}
const port = await listen(settings.PORT);
console.log(`Maikuro Coffee: http://127.0.0.1:${port}/shop`);
async function shutdown() {
  closeLiveVoice();
  closeAgents();
  await Promise.all([closeCatalogue(), closeOrders()]);
  await closeVite?.();
  httpServer.closeAllConnections();
  httpServer.close(() => process.exit(0));
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
process.once('exit', closeAgents);