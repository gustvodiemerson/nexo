import { q } from './db.js';
import { get, post, del } from './router.js';
import { v, bad, rateLimit } from './lib.js';
import { parseScope, audit } from './core.js';
import { answer, aiStatus } from './ai.js';

get('/api/ai/status', () => aiStatus());

get('/api/ai/history', (req) => {
  const scope = parseScope(req.ctx, req.query.scope);
  const rows = q.all('SELECT id, role, content, provider, created_at FROM ai_messages WHERE user_id=? AND scope=? ORDER BY id DESC LIMIT 60', req.user.id, scope).reverse();
  return { scope, messages: rows };
});

post('/api/ai/chat', async (req) => {
  const ctx = req.ctx;
  rateLimit('ai:' + ctx.userId, 30, 3600_000);
  const scope = parseScope(ctx, req.body.scope);
  const message = v.str(req.body.message, { field: 'mensagem', max: 1000 });
  const history = q.all('SELECT role, content FROM ai_messages WHERE user_id=? AND scope=? ORDER BY id DESC LIMIT 8', ctx.userId, scope).reverse();
  const res = await answer(ctx, scope, message, history);
  q.run('INSERT INTO ai_messages(user_id,scope,role,content) VALUES (?,?,?,?)', ctx.userId, scope, 'user', message);
  q.run('INSERT INTO ai_messages(user_id,scope,role,content,provider) VALUES (?,?,?,?,?)', ctx.userId, scope, 'assistant', res.text, res.provider);
  audit(ctx, 'ai.chat', 'ai', null, { provider: res.provider }, scope === 'couple' ? 'couple' : 'personal');
  return { reply: res.text, provider: res.provider, scope };
});

del('/api/ai/history', (req) => {
  q.run('DELETE FROM ai_messages WHERE user_id=?', req.user.id);
  return { ok: true };
});
