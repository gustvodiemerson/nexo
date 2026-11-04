// Servidor HTTP do NEXO — sem dependências externas (Node >= 22.5).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, q } from './db.js';
import { match, pathExists, Raw } from './router.js';
import { HttpError, parseCookies, sha256 } from './lib.js';
import { getCtx, addClient, removeClient } from './core.js';
import './routes_auth.js';
import './routes_couple.js';
import './routes_finance.js';
import './routes_vault.js';
import './routes_reports.js';
import './routes_social.js';
import './routes_ai.js';
import { runGlobalJobs } from './jobs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(__dirname, '../public');
const PROD = process.env.NODE_ENV === 'production';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const COOKIE = 'nexo_sid';
const MAX_BODY = 1_000_000;
const sqlNow = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};

const SECURITY = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

function clientIp(req) {
  if (TRUST_PROXY) { const xf = req.headers['x-forwarded-for']; if (xf) return String(xf).split(',')[0].trim(); }
  return req.socket.remoteAddress || '0.0.0.0';
}

function send(res, status, body, type, extra = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': buf.length, ...SECURITY, ...extra });
  res.end(buf);
}
const sendJson = (res, status, obj, extra = {}) => send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store', ...extra });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new HttpError(413, 'Conteúdo grande demais.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function authenticate(req) {
  const token = parseCookies(req.headers.cookie || '')[COOKIE];
  if (!token) return;
  const s = q.get('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?', sha256(token), sqlNow());
  if (!s) return;
  const user = q.get('SELECT * FROM users WHERE id=?', s.user_id);
  if (!user) return;
  req.session = s; req.user = user; req.ctx = getCtx(user, req.ip);
  if (Date.now() - new Date(s.last_seen_at.replace(' ', 'T') + 'Z').getTime() > 300_000) q.run("UPDATE sessions SET last_seen_at=datetime('now') WHERE id=?", s.id);
}

async function handleApi(req, res, url) {
  const secure = req.proto === 'https';
  let setCookie = null;
  req.setSession = (token, maxAge) => { setCookie = `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure || PROD ? '; Secure' : ''}`; };
  req.clearSession = () => { setCookie = `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure || PROD ? '; Secure' : ''}`; };
  const extra = () => (setCookie ? { 'Set-Cookie': setCookie } : {});
  try {
    const m = match(req.method, url.pathname);
    if (!m) {
      if (pathExists(url.pathname)) throw new HttpError(405, 'Método não permitido.');
      throw new HttpError(404, 'Recurso não encontrado.');
    }
    // Proteção CSRF: origem precisa coincidir; mutações exigem JSON.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.origin;
      if (origin) { let ok = false; try { ok = new URL(origin).host === req.headers.host; } catch {} if (!ok) throw new HttpError(403, 'Origem não permitida.'); }
    }
    req.query = Object.fromEntries(url.searchParams);
    req.params = m.params;
    req.body = {};
    if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT') {
      const raw = await readBody(req);
      if (raw) {
        if (!String(req.headers['content-type'] || '').includes('application/json')) throw new HttpError(415, 'Envie os dados em JSON.');
        try { req.body = JSON.parse(raw); } catch { throw new HttpError(400, 'JSON inválido.'); }
        if (req.body === null || typeof req.body !== 'object' || Array.isArray(req.body)) throw new HttpError(400, 'Corpo inválido.');
      }
    }
    authenticate(req);
    if (m.route.auth && !req.user) throw new HttpError(401, 'Sessão expirada. Entre novamente.');
    req.status = 200;
    const out = await m.route.handler(req);
    if (out instanceof Raw) return send(res, req.status, out.body, out.type, { 'Cache-Control': 'no-store', ...out.headers, ...extra() });
    return sendJson(res, req.status, out ?? { ok: true }, extra());
  } catch (e) {
    if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message, field: e.field }, extra());
    console.error('[erro]', req.method, url.pathname, e);
    return sendJson(res, 500, { error: 'Erro interno. Tente novamente em instantes.' }, extra());
  }
}

function handleEvents(req, res) {
  authenticate(req);
  if (!req.user) return sendJson(res, 401, { error: 'Sessão expirada.' });
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', ...SECURITY });
  res.write('retry: 3000\nevent: hello\ndata: {}\n\n');
  const uid = req.user.id;
  addClient(uid, res);
  req.on('close', () => removeClient(uid, res));
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
  const cache = file.endsWith('sw.js') || ext === '.html' ? 'no-cache' : ext === '.woff2' ? 'public, max-age=31536000, immutable' : 'no-cache';
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': cache, ...SECURITY }); return res.end(); }
  const buf = fs.readFileSync(file);
  send(res, 200, req.method === 'HEAD' ? '' : buf, MIME[ext] || 'application/octet-stream', { ETag: etag, 'Cache-Control': cache, ...(req.method === 'HEAD' ? { 'Content-Length': buf.length } : {}) });
}

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      req.ip = clientIp(req);
      req.proto = TRUST_PROXY && req.headers['x-forwarded-proto'] ? String(req.headers['x-forwarded-proto']).split(',')[0] : (req.socket.encrypted ? 'https' : 'http');
      const url = new URL(req.url, 'http://localhost');
      if (PROD && req.proto === 'https') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      if (url.pathname === '/api/health') return sendJson(res, 200, { ok: true, time: new Date().toISOString() });
      if (url.pathname === '/api/events' && req.method === 'GET') return handleEvents(req, res);
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Método não permitido', 'text/plain');
      return serveStatic(req, res, url);
    } catch (e) {
      console.error('[fatal]', e);
      if (!res.headersSent) sendJson(res, 500, { error: 'Erro interno.' });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const server = createServer();
  server.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`NEXO rodando em http://localhost:${port}`));
  try { runGlobalJobs(); } catch (e) { console.error('jobs iniciais falharam', e.message); }
  setInterval(() => { try { runGlobalJobs(); } catch (e) { console.error(e.message); } }, 3600_000).unref();
  // Limpeza periódica de sessões e tokens expirados.
  setInterval(() => { try { q.run('DELETE FROM sessions WHERE expires_at<?', sqlNow()); q.run('DELETE FROM password_resets WHERE expires_at<?', sqlNow()); } catch {} }, 6 * 3600_000).unref();
  const stop = () => { server.close(() => { try { db.close(); } catch {} process.exit(0); }); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
