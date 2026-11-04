export const routes = [];
export class Raw { constructor(body, type = 'application/octet-stream', headers = {}) { this.body = body; this.type = type; this.headers = headers; } }
// opts.auth: true (padrão) exige sessão válida.
export function route(method, pattern, handler, opts = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handler, auth: opts.auth !== false });
}
export const get = (p, h, o) => route('GET', p, h, o);
export const post = (p, h, o) => route('POST', p, h, o);
export const patch = (p, h, o) => route('PATCH', p, h, o);
export const del = (p, h, o) => route('DELETE', p, h, o);
export function match(method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(pathname); if (!m) continue;
    const params = {}; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    return { route: r, params };
  }
  return null;
}
export function pathExists(pathname) { return routes.some((r) => r.re.test(pathname)); }
