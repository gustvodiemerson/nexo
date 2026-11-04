// Utilidades HTTP, validação e erros — sem dependências externas.
import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message, field) { super(message); this.status = status; this.field = field; }
}
export const bad = (msg, field) => new HttpError(400, msg, field);
export const forbidden = (msg = 'Acesso negado.') => new HttpError(403, msg);
export const notFound = (msg = 'Não encontrado.') => new HttpError(404, msg);

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (n = 32) => crypto.randomBytes(n).toString('base64url');
export const uuid = () => crypto.randomUUID();

// ---------- validação ----------
export const v = {
  str(val, { field = 'campo', min = 0, max = 500, required = true } = {}) {
    if (val === undefined || val === null || val === '') {
      if (required) throw bad(`Informe ${field}.`, field);
      return null;
    }
    if (typeof val !== 'string') throw bad(`${field} inválido.`, field);
    const s = val.trim();
    if (required && s.length < Math.max(min, 1)) throw bad(`Informe ${field}.`, field);
    if (s.length < min) throw bad(`${field} muito curto.`, field);
    if (s.length > max) throw bad(`${field} muito longo (máx. ${max}).`, field);
    return s;
  },
  cents(val, { field = 'valor', allowZero = false, required = true } = {}) {
    if (val === undefined || val === null || val === '') {
      if (required) throw bad(`Informe ${field}.`, field);
      return null;
    }
    const n = Number(val);
    if (!Number.isInteger(n)) throw bad(`${field} inválido.`, field);
    if (n < 0 || (!allowZero && n === 0)) throw bad(`${field} deve ser maior que zero.`, field);
    if (n > 100_000_000_000_00) throw bad(`${field} acima do limite.`, field);
    return n;
  },
  int(val, { field = 'campo', min = -1e12, max = 1e12, required = true } = {}) {
    if (val === undefined || val === null || val === '') {
      if (required) throw bad(`Informe ${field}.`, field);
      return null;
    }
    const n = Number(val);
    if (!Number.isInteger(n) || n < min || n > max) throw bad(`${field} inválido.`, field);
    return n;
  },
  date(val, { field = 'data', required = true } = {}) {
    if (val === undefined || val === null || val === '') {
      if (required) throw bad(`Informe ${field}.`, field);
      return null;
    }
    if (typeof val !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(val)) throw bad(`${field} inválida.`, field);
    const d = new Date(val + 'T00:00:00Z');
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== val) throw bad(`${field} inválida.`, field);
    const y = Number(val.slice(0, 4));
    if (y < 1990 || y > 2100) throw bad(`${field} fora do intervalo.`, field);
    return val;
  },
  oneOf(val, list, { field = 'campo', required = true, def } = {}) {
    if (val === undefined || val === null || val === '') {
      if (def !== undefined) return def;
      if (required) throw bad(`Informe ${field}.`, field);
      return null;
    }
    if (!list.includes(val)) throw bad(`${field} inválido.`, field);
    return val;
  },
  bool(val, def = false) { return val === undefined || val === null ? (def ? 1 : 0) : (val === true || val === 1 || val === '1' ? 1 : 0); },
  email(val) {
    const s = v.str(val, { field: 'e-mail', max: 254 }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) throw bad('E-mail inválido.', 'email');
    return s;
  },
};

// ---------- datas ----------
export const todayISO = (tz = process.env.APP_TZ || 'America/Sao_Paulo') => {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date()); }
  catch { return new Date().toISOString().slice(0, 10); }
};
export function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const total = (y * 12 + (m - 1)) + n;
  const ny = Math.floor(total / 12), nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}
export function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
export const monthStart = (iso) => iso.slice(0, 7) + '-01';
export const monthEnd = (iso) => { const [y, m] = iso.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
export const ym = (iso) => iso.slice(0, 7);

// ---------- cookies ----------
export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// ---------- rate limit em memória ----------
const buckets = new Map();
export function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key) || { n: 0, reset: now + windowMs };
  if (now > b.reset) { b.n = 0; b.reset = now + windowMs; }
  b.n++; buckets.set(key, b);
  if (b.n > max) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
}
export function rateReset(key) { buckets.delete(key); }
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k); }, 60_000).unref();

// ---------- senha ----------
export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `${salt}:${hash}`;
}
export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  const buf = Buffer.from(hash, 'hex');
  return buf.length === test.length && crypto.timingSafeEqual(buf, test);
}
