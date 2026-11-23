import { q } from './db.js';
import { get, post, del } from './router.js';
import { v, bad, rateLimit, HttpError } from './lib.js';
import { parseScope, audit } from './core.js';
import { answer, aiStatus, readReceipt, visionProviders } from './ai.js';

get('/api/ai/status', () => ({ ...aiStatus(), receipts: visionProviders().length > 0 }));

get('/api/ai/history', async (req) => {
  const scope = parseScope(req.ctx, req.query.scope);
  const rows = (await q.all('SELECT id, role, content, provider, created_at FROM ai_messages WHERE user_id=? AND scope=? ORDER BY id DESC LIMIT 60', req.user.id, scope)).reverse();
  return { scope, messages: rows };
});

post('/api/ai/chat', async (req) => {
  const ctx = req.ctx;
  await rateLimit('ai:' + ctx.userId, 30, 3600_000);
  const scope = parseScope(ctx, req.body.scope);
  const message = v.str(req.body.message, { field: 'mensagem', max: 1000 });
  const history = (await q.all('SELECT role, content FROM ai_messages WHERE user_id=? AND scope=? ORDER BY id DESC LIMIT 8', ctx.userId, scope)).reverse();
  const res = await answer(ctx, scope, message, history);
  await q.run('INSERT INTO ai_messages(user_id,scope,role,content) VALUES (?,?,?,?)', ctx.userId, scope, 'user', message);
  await q.run('INSERT INTO ai_messages(user_id,scope,role,content,provider) VALUES (?,?,?,?,?)', ctx.userId, scope, 'assistant', res.text, res.provider);
  await audit(ctx, 'ai.chat', 'ai', null, { provider: res.provider }, scope === 'couple' ? 'couple' : 'personal');
  return { reply: res.text, provider: res.provider, scope, proposal: res.proposal || null };
});

del('/api/ai/history', async (req) => {
  await q.run('DELETE FROM ai_messages WHERE user_id=?', req.user.id);
  return { ok: true };
});

// Foto de nota fiscal -> itens e valores (a IA só lê; quem registra é o usuário, confirmando no app).
post('/api/ai/receipt', async (req) => {
  const ctx = req.ctx;
  await rateLimit('rcpt:' + ctx.userId, 20, 3600_000);
  const m = /^data:((?:image\/(?:jpeg|png|webp))|application\/pdf);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body.image || ''));
  if (!m) throw bad('Envie uma foto (JPEG, PNG, WebP) ou um PDF.', 'image');
  if (m[2].length > (m[1] === 'application/pdf' ? 2_000_000 : 1_600_000)) throw bad(m[1] === 'application/pdf' ? 'O PDF é grande demais (máx. ~1,4 MB). Tire um print ou foto do comprovante.' : 'A foto ficou grande demais. Tente de novo com menos zoom.', 'image');
  const r = await readReceipt(ctx, { mime: m[1], b64: m[2] });
  if (r.unavailable) throw new HttpError(503, m[1] === 'application/pdf' ? 'Para ler PDF é preciso a GEMINI_API_KEY no servidor. Envie como foto ou print.' : 'Para ler notas fiscais é preciso ligar uma IA com visão no servidor (ex.: GEMINI_API_KEY, que tem plano gratuito). Você ainda pode registrar manualmente.');
  if (r.failed) throw new HttpError(502, 'A IA não conseguiu ler a nota agora. Tente de novo com a foto mais nítida e bem enquadrada.');
  await audit(ctx, 'ai.receipt', 'ai', null, { provider: r.provider, items: r.items.length }, 'personal');
  return { receipt: r };
});
