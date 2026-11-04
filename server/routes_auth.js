import { q, tx } from './db.js';
import { get, post, patch, del } from './router.js';
import { v, bad, HttpError, hashPassword, verifyPassword, randomToken, sha256, rateLimit, rateReset } from './lib.js';
import { getCtx, audit, seedCategories } from './core.js';
import { sendMail, mailConfigured } from './mailer.js';
import { leaveCouple, coupleSummary } from './routes_couple.js';

const SESSION_DAYS = 30;
const sqlNow = (ms = 0) => new Date(Date.now() + ms).toISOString().replace('T', ' ').slice(0, 19);

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, avatar: u.avatar || null, created_at: u.created_at });

function createSession(req, userId) {
  const token = randomToken(32);
  q.run(
    'INSERT INTO sessions(token_hash,user_id,user_agent,ip,expires_at) VALUES (?,?,?,?,?)',
    sha256(token), userId, String(req.headers['user-agent'] || '').slice(0, 200), req.ip, sqlNow(SESSION_DAYS * 864e5),
  );
  req.setSession(token, SESSION_DAYS * 86400);
}

function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw bad('A senha deve ter pelo menos 8 caracteres.', 'password');
  if (pw.length > 200) throw bad('Senha muito longa.', 'password');
  if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) throw bad('Use letras e números na senha.', 'password');
}

export function mePayload(user, ip) {
  const ctx = getCtx(user, ip);
  return { user: publicUser(user), couple: ctx.coupleId ? coupleSummary(ctx) : null };
}

post('/api/auth/register', (req) => {
  rateLimit('reg:' + req.ip, 10, 3600_000);
  const name = v.str(req.body.name, { field: 'nome', min: 2, max: 60 });
  const email = v.email(req.body.email);
  validatePassword(req.body.password);
  if (q.get('SELECT 1 FROM users WHERE email=?', email)) throw new HttpError(409, 'Este e-mail já está cadastrado.', 'email');
  const user = tx(() => {
    const id = Number(q.run('INSERT INTO users(name,email,password_hash) VALUES (?,?,?)', name, email, hashPassword(req.body.password)).lastInsertRowid);
    seedCategories('personal', id, null);
    return q.get('SELECT * FROM users WHERE id=?', id);
  });
  createSession(req, user.id);
  audit({ userId: user.id, ip: req.ip }, 'auth.register', 'user', user.id);
  req.status = 201;
  return mePayload(user, req.ip);
}, { auth: false });

post('/api/auth/login', (req) => {
  const email = v.email(req.body.email);
  const key = `login:${email}:${req.ip}`;
  rateLimit(key, 8, 15 * 60_000);
  const user = q.get('SELECT * FROM users WHERE email=?', email);
  // Executa o hash mesmo sem usuário para não vazar existência por tempo de resposta.
  const ok = user
    ? verifyPassword(String(req.body.password || ''), user.password_hash)
    : (verifyPassword('x', hashPassword('y')), false);
  if (!ok) {
    audit({ userId: user?.id ?? null, ip: req.ip }, 'auth.login_failed', 'user', user?.id ?? null);
    throw new HttpError(401, 'E-mail ou senha incorretos.');
  }
  rateReset(key);
  q.run("UPDATE users SET last_login_at=datetime('now') WHERE id=?", user.id);
  createSession(req, user.id);
  audit({ userId: user.id, ip: req.ip }, 'auth.login', 'user', user.id);
  return mePayload(user, req.ip);
}, { auth: false });

post('/api/auth/logout', (req) => {
  if (req.session) q.run('DELETE FROM sessions WHERE id=?', req.session.id);
  req.clearSession();
  return { ok: true };
}, { auth: false });

get('/api/auth/me', (req) => mePayload(req.user, req.ip));

post('/api/auth/forgot', async (req) => {
  const email = v.email(req.body.email);
  rateLimit('forgot:' + req.ip, 8, 3600_000);
  rateLimit('forgot:' + email, 3, 3600_000);
  const user = q.get('SELECT * FROM users WHERE email=?', email);
  const out = { ok: true, message: 'Se o e-mail estiver cadastrado, enviaremos as instruções de recuperação.' };
  if (!user) return out;
  const token = randomToken(32);
  q.run('INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES (?,?,?)', sha256(token), user.id, sqlNow(3600_000));
  const base = (process.env.APP_URL || `${req.proto}://${req.headers.host}`).replace(/\/$/, '');
  const link = `${base}/#/redefinir/${token}`;
  try {
    await sendMail({
      to: user.email, subject: 'NEXO — redefinição de senha',
      text: `Olá, ${user.name}!\n\nPara criar uma nova senha, acesse (válido por 1 hora):\n${link}\n\nSe não foi você, ignore este e-mail.\n\nNEXO — Juntos, mais longe.`,
    });
  } catch (e) { console.error(e.message); }
  audit({ userId: user.id, ip: req.ip }, 'auth.forgot', 'user', user.id);
  // Somente em desenvolvimento e sem e-mail configurado: devolve o link para facilitar testes.
  if (!mailConfigured() && process.env.NODE_ENV !== 'production') out.dev_link = link;
  return out;
}, { auth: false });

post('/api/auth/reset', (req) => {
  rateLimit('reset:' + req.ip, 10, 3600_000);
  const token = v.str(req.body.token, { field: 'token', max: 200 });
  validatePassword(req.body.password);
  const row = q.get('SELECT * FROM password_resets WHERE token_hash=?', sha256(token));
  if (!row || row.used_at || row.expires_at < sqlNow()) throw bad('Link inválido ou expirado. Solicite um novo.');
  tx(() => {
    q.run('UPDATE users SET password_hash=? WHERE id=?', hashPassword(req.body.password), row.user_id);
    q.run("UPDATE password_resets SET used_at=datetime('now') WHERE id=?", row.id);
    q.run('DELETE FROM sessions WHERE user_id=?', row.user_id); // encerra todas as sessões
  });
  audit({ userId: row.user_id, ip: req.ip }, 'auth.password_reset', 'user', row.user_id);
  return { ok: true };
}, { auth: false });

// ---------- perfil e segurança ----------
patch('/api/profile', (req) => {
  const name = v.str(req.body.name, { field: 'nome', min: 2, max: 60 });
  let avatar = req.user.avatar;
  if (req.body.avatar !== undefined) {
    if (req.body.avatar === null || req.body.avatar === '') avatar = null;
    else {
      const a = String(req.body.avatar);
      if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(a)) throw bad('Imagem inválida.', 'avatar');
      if (a.length > 300_000) throw bad('Imagem muito grande.', 'avatar');
      avatar = a;
    }
  }
  q.run('UPDATE users SET name=?, avatar=? WHERE id=?', name, avatar, req.user.id);
  audit(req.ctx, 'profile.update', 'user', req.user.id);
  return mePayload(q.get('SELECT * FROM users WHERE id=?', req.user.id), req.ip);
});

post('/api/profile/password', (req) => {
  rateLimit('chpw:' + req.user.id, 6, 15 * 60_000);
  if (!verifyPassword(String(req.body.current || ''), req.user.password_hash)) throw bad('Senha atual incorreta.', 'current');
  validatePassword(req.body.password);
  tx(() => {
    q.run('UPDATE users SET password_hash=? WHERE id=?', hashPassword(req.body.password), req.user.id);
    q.run('DELETE FROM sessions WHERE user_id=? AND id<>?', req.user.id, req.session.id);
  });
  audit(req.ctx, 'auth.password_change', 'user', req.user.id);
  return { ok: true };
});

get('/api/profile/sessions', (req) => ({
  sessions: q.all('SELECT id, user_agent, ip, created_at, last_seen_at FROM sessions WHERE user_id=? ORDER BY last_seen_at DESC', req.user.id)
    .map((s) => ({ ...s, current: s.id === req.session.id })),
}));

del('/api/profile/sessions/:id', (req) => {
  q.run('DELETE FROM sessions WHERE id=? AND user_id=? AND id<>?', Number(req.params.id), req.user.id, req.session.id);
  return { ok: true };
});

del('/api/profile/sessions', (req) => {
  q.run('DELETE FROM sessions WHERE user_id=? AND id<>?', req.user.id, req.session.id);
  return { ok: true };
});

// Exclusão de conta (exige senha). Dados pessoais são apagados; dados do casal permanecem com o parceiro.
post('/api/profile/delete', (req) => {
  rateLimit('delacc:' + req.user.id, 5, 15 * 60_000);
  if (!verifyPassword(String(req.body.password || ''), req.user.password_hash)) throw bad('Senha incorreta.', 'password');
  tx(() => {
    if (req.ctx.coupleId) leaveCouple(req.ctx);
    audit({ userId: null, ip: req.ip }, 'auth.account_deleted', 'user', req.user.id);
    q.run('DELETE FROM users WHERE id=?', req.user.id);
  });
  req.clearSession();
  return { ok: true };
});
