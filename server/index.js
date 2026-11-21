// Servidor local (desenvolvimento e testes): serve o frontend e a API usando o mesmo handler da Netlify Function.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { q, closeDb } from './db.js';
import { handleRequest, SECURITY } from './handler.js';
import { runGlobalJobs } from './jobs.js';
import { rateCleanup } from './lib.js';
import { eventsCleanup } from './core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(__dirname, '../public');
const PROD = process.env.NODE_ENV === 'production';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const MAX_BODY = 2_500_000;
const sqlNow = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};

function send(res, status, body, type, extra = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': buf.length, ...SECURITY, ...extra });
  res.end(buf);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('grande'), { tooBig: true })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function clientIp(req) {
  if (TRUST_PROXY) { const xf = req.headers['x-forwarded-for']; if (xf) return String(xf).split(',')[0].trim(); }
  return req.socket.remoteAddress || '0.0.0.0';
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  let file = path.resolve(PUBLIC, '.' + rel);
  if (!file.startsWith(PUBLIC + path.sep) && file !== PUBLIC) return send(res, 403, 'Acesso negado', 'text/plain');
  let st; try { st = fs.statSync(file); } catch { st = null; }
  if (!st || !st.isFile()) {
    if (path.extname(rel)) return send(res, 404, 'Não encontrado', 'text/plain; charset=utf-8');
    file = path.join(PUBLIC, 'index.html'); try { st = fs.statSync(file); } catch { return send(res, 404, 'Frontend não encontrado', 'text/plain'); }
  }
  const ext = path.extname(file).toLowerCase();
  const etag = `W/"${st.size}-${Math.floor(st.mtimeMs)}"`;
  const cache = ext === '.woff2' ? 'public, max-age=31536000, immutable' : 'no-cache';
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': cache, ...SECURITY }); return res.end(); }
  const buf = fs.readFileSync(file);
  send(res, 200, req.method === 'HEAD' ? '' : buf, MIME[ext] || 'application/octet-stream', { ETag: etag, 'Cache-Control': cache, ...(req.method === 'HEAD' ? { 'Content-Length': buf.length } : {}) });
}

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const proto = TRUST_PROXY && req.headers['x-forwarded-proto'] ? String(req.headers['x-forwarded-proto']).split(',')[0] : (req.socket.encrypted ? 'https' : 'http');
      const url = new URL(req.url, 'http://localhost');
      if (PROD && proto === 'https') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      if (url.pathname.startsWith('/api/')) {
        let rawBody = '';
        try { rawBody = await readBody(req); } catch (e) { return send(res, e.tooBig ? 413 : 400, JSON.stringify({ error: 'Conteúdo inválido ou grande demais.' }), 'application/json; charset=utf-8'); }
        const out = await handleRequest({ method: req.method, url, headers: req.headers, rawBody, ip: clientIp(req), proto });
        const body = Buffer.isBuffer(out.body) ? out.body : Buffer.from(out.body ?? '');
        res.writeHead(out.status, { ...out.headers, 'Content-Length': body.length });
        return res.end(body);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Método não permitido', 'text/plain');
      return serveStatic(req, res, url);
    } catch (e) {
      console.error('[fatal]', e);
      if (!res.headersSent) send(res, 500, JSON.stringify({ error: 'Erro interno.' }), 'application/json; charset=utf-8');
    }
  });
}

async function housekeeping() {
  await q.run('DELETE FROM sessions WHERE expires_at<?', sqlNow());
  await q.run('DELETE FROM password_resets WHERE expires_at<?', sqlNow());
  await rateCleanup(); await eventsCleanup();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const server = createServer();
  server.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`NEXO rodando em http://localhost:${port}`));
  runGlobalJobs().catch((e) => console.error('jobs iniciais falharam', e.message));
  setInterval(() => runGlobalJobs().catch((e) => console.error(e.message)), 3600_000).unref();
  setInterval(() => housekeeping().catch((e) => console.error(e.message)), 6 * 3600_000).unref();
  const stop = () => { server.close(async () => { await closeDb(); process.exit(0); }); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
