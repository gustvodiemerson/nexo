// Núcleo HTTP independente de plataforma: recebe {method,url,headers,body,ip,proto} e devolve {status,headers,body}.
// Usado pelo servidor local (index.js) e pela Netlify Function (netlify/functions/api.mjs).
import { q } from './db.js';
import { match, pathExists, Raw } from './router.js';
import { HttpError, parseCookies, sha256 } from './lib.js';
import { getCtx, pollEvents } from './core.js';
import './routes_auth.js';
import './routes_couple.js';
import './routes_finance.js';
import './routes_vault.js';
import './routes_reports.js';
import './routes_social.js';
import './routes_ai.js';

const PROD = process.env.NODE_ENV === 'production' || !!process.env.NETLIFY;
const COOKIE = 'nexo_sid';
const MAX_BODY = 1_000_000;
const sqlNow = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

export const SECURITY = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

const json = (status, obj, extra = {}) => ({ status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY, ...extra }, body: JSON.stringify(obj) });

async function authenticate(req) {
  const token = parseCookies(req.headers.cookie || '')[COOKIE];
  if (!token) return;
  const s = await q.get('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?', sha256(token), sqlNow());
  if (!s) return;
  const user = await q.get('SELECT * FROM users WHERE id=?', s.user_id);
  if (!user) return;
  req.session = s; req.user = user; req.ctx = await getCtx(user, req.ip);
  if (Date.now() - new Date(s.last_seen_at.replace(' ', 'T') + 'Z').getTime() > 300_000) await q.run("UPDATE sessions SET last_seen_at=datetime('now') WHERE id=?", s.id);
}

// in: { method, url: URL, headers (minúsculas), rawBody: string, ip, proto }
export async function handleRequest(input) {
  const req = { ...input };
  const secure = req.proto === 'https';
  let setCookie = null;
  req.setSession = (token, maxAge) => { setCookie = `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure || PROD ? '; Secure' : ''}`; };
  req.clearSession = () => { setCookie = `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure || PROD ? '; Secure' : ''}`; };
  const extra = () => (setCookie ? { 'Set-Cookie': setCookie } : {});
  const { url } = req;
  try {
    if (url.pathname === '/api/health') return json(200, { ok: true, time: new Date().toISOString() });
    const m = match(req.method, url.pathname);
    if (!m) {
      if (pathExists(url.pathname)) throw new HttpError(405, 'Método não permitido.');
      throw new HttpError(404, 'Recurso não encontrado.');
    }
    // Proteção CSRF: origem precisa coincidir; mutações exigem JSON.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.origin;
      if (origin) { let ok = false; try { ok = new URL(origin).host === (req.headers.host || url.host); } catch {} if (!ok) throw new HttpError(403, 'Origem não permitida.'); }
    }
    req.query = Object.fromEntries(url.searchParams);
    req.params = m.params;
    req.body = {};
    if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT') {
      const raw = req.rawBody || '';
      if (raw.length > MAX_BODY) throw new HttpError(413, 'Conteúdo grande demais.');
      if (raw) {
        if (!String(req.headers['content-type'] || '').includes('application/json')) throw new HttpError(415, 'Envie os dados em JSON.');
        try { req.body = JSON.parse(raw); } catch { throw new HttpError(400, 'JSON inválido.'); }
        if (req.body === null || typeof req.body !== 'object' || Array.isArray(req.body)) throw new HttpError(400, 'Corpo inválido.');
      }
    }
    await authenticate(req);
    if (m.route.auth && !req.user) throw new HttpError(401, 'Sessão expirada. Entre novamente.');
    req.status = 200;
    const out = await m.route.handler(req);
    if (out instanceof Raw) return { status: req.status, headers: { 'Content-Type': out.type, 'Cache-Control': 'no-store', ...SECURITY, ...out.headers, ...extra() }, body: out.body };
    return json(req.status, out ?? { ok: true }, extra());
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.message, field: e.field }, extra());
    console.error('[erro]', req.method, url.pathname, e);
    return json(500, { error: 'Erro interno. Tente novamente em instantes.' }, extra());
  }
}
