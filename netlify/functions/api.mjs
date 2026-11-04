// API do NEXO como Netlify Function (v2). Todas as rotas /api/* passam por aqui.
import { handleRequest } from '../../server/handler.js';

export default async (request, context) => {
  const url = new URL(request.url);
  const method = request.method;
  const headers = Object.fromEntries(request.headers);
  let rawBody = '';
  if (method !== 'GET' && method !== 'HEAD') rawBody = await request.text();
  const ip = headers['x-nf-client-connection-ip'] || context?.ip || (headers['x-forwarded-for'] || '').split(',')[0].trim() || '0.0.0.0';
  const out = await handleRequest({ method, url, headers, rawBody, ip, proto: url.protocol.replace(':', '') });
  return new Response(out.body, { status: out.status, headers: out.headers });
};

export const config = { path: '/api/*' };
