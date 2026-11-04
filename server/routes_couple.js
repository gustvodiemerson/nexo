import crypto from 'node:crypto';
import { q, tx } from './db.js';
import { get, post, patch, del } from './router.js';
import { v, bad, forbidden, notFound, HttpError, rateLimit } from './lib.js';
import { getCtx, audit, seedCategories, notify, emit, coupleMemberIds, accountBalances } from './core.js';

const sqlNow = (ms = 0) => new Date(Date.now() + ms).toISOString().replace('T', ' ').slice(0, 19);
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem caracteres ambíguos
const genCode = () => Array.from(crypto.randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join('');
const MAX_MEMBERS = 2;

export function coupleSummary(ctx) {
  const c = q.get('SELECT * FROM couples WHERE id=?', ctx.coupleId);
  if (!c) return null;
  const members = q.all(
    `SELECT u.id, u.name, u.avatar, m.role, m.can_edit, m.share_personal_total, m.joined_at
     FROM couple_members m JOIN users u ON u.id=m.user_id WHERE m.couple_id=? ORDER BY m.joined_at, u.id`, c.id,
  ).map((m) => ({ ...m, can_edit: !!m.can_edit, share_personal_total: !!m.share_personal_total, me: m.id === ctx.userId }));
  const invites = ctx.role === 'owner'
    ? q.all("SELECT id, code, status, expires_at, created_at FROM invites WHERE couple_id=? AND status='pending' AND expires_at>? ORDER BY id DESC", c.id, sqlNow())
    : [];
  return { id: c.id, name: c.name, cover: c.cover, role: ctx.role, can_edit: ctx.canEditCouple, full: members.length >= MAX_MEMBERS, members, invites };
}

// Sai do casal. Com parceiro restante, os dados do casal passam a pertencer a ele; sem parceiro, o casal é apagado.
export function leaveCouple(ctx) {
  const cid = ctx.coupleId; if (!cid) return;
  const others = coupleMemberIds(cid).filter((id) => id !== ctx.userId);
  if (!others.length) {
    q.run('DELETE FROM couples WHERE id=?', cid);
    return;
  }
  const partner = others[0], me = ctx.userId;
  for (const t of ['accounts', 'categories', 'recurring', 'budgets', 'vaults', 'goals', 'investments', 'transactions']) {
    q.run(`UPDATE ${t} SET user_id=? WHERE scope='couple' AND couple_id=? AND user_id=?`, partner, cid, me);
  }
  q.run('UPDATE vault_movements SET user_id=? WHERE user_id=? AND vault_id IN (SELECT id FROM vaults WHERE couple_id=?)', partner, me, cid);
  q.run('UPDATE investment_entries SET user_id=? WHERE user_id=? AND investment_id IN (SELECT id FROM investments WHERE couple_id=?)', partner, me, cid);
  q.run('UPDATE invites SET created_by=? WHERE created_by=? AND couple_id=?', partner, me, cid);
  q.run('UPDATE invites SET accepted_by=NULL WHERE accepted_by=? AND couple_id=?', me, cid);
  q.run('UPDATE couples SET created_by=? WHERE id=? AND created_by=?', partner, cid, me);
  q.run('DELETE FROM couple_members WHERE couple_id=? AND user_id=?', cid, me);
  q.run("UPDATE couple_members SET role='owner', can_edit=1 WHERE couple_id=? AND user_id=?", cid, partner);
  notify(partner, { type: 'couple', title: 'Seu parceiro saiu do casal', body: 'Os dados compartilhados continuam com você.', link: '#/casal' });
}

get('/api/couple', (req) => ({ couple: req.ctx.coupleId ? coupleSummary(req.ctx) : null }));

post('/api/couple', (req) => {
  if (req.ctx.coupleId) throw bad('Você já faz parte de um casal.');
  const name = v.str(req.body.name, { field: 'nome do casal', min: 2, max: 60 });
  const id = tx(() => {
    const cid = Number(q.run('INSERT INTO couples(name,created_by) VALUES (?,?)', name, req.user.id).lastInsertRowid);
    q.run("INSERT INTO couple_members(couple_id,user_id,role) VALUES (?,?, 'owner')", cid, req.user.id);
    seedCategories('couple', req.user.id, cid);
    return cid;
  });
  const ctx = getCtx(req.user, req.ip);
  audit(ctx, 'couple.create', 'couple', id, { name }, 'couple');
  req.status = 201;
  return { couple: coupleSummary(ctx) };
});

patch('/api/couple', (req) => {
  const ctx = req.ctx;
  if (!ctx.coupleId) throw bad('Você ainda não faz parte de um casal.');
  if (ctx.role !== 'owner') throw forbidden('Somente quem criou o casal pode alterar estes dados.');
  const name = v.str(req.body.name, { field: 'nome do casal', min: 2, max: 60 });
  let cover = q.get('SELECT cover FROM couples WHERE id=?', ctx.coupleId).cover;
  if (req.body.cover !== undefined) {
    if (!req.body.cover) cover = null;
    else {
      const a = String(req.body.cover);
      if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(a)) throw bad('Imagem inválida.', 'cover');
      if (a.length > 450_000) throw bad('Imagem muito grande.', 'cover');
      cover = a;
    }
  }
  q.run('UPDATE couples SET name=?, cover=? WHERE id=?', name, cover, ctx.coupleId);
  audit(ctx, 'couple.update', 'couple', ctx.coupleId, { name }, 'couple');
  emit(coupleMemberIds(ctx.coupleId), 'change', { scope: 'couple', what: 'couple', by: ctx.userId });
  return { couple: coupleSummary(ctx) };
});

// ----- convites -----
post('/api/couple/invites', (req) => {
  const ctx = req.ctx;
  if (!ctx.coupleId) throw bad('Crie o casal antes de convidar alguém.');
  if (ctx.role !== 'owner') throw forbidden('Somente quem criou o casal pode convidar.');
  rateLimit('invite:' + ctx.userId, 20, 3600_000);
  if (coupleMemberIds(ctx.coupleId).length >= MAX_MEMBERS) throw bad('O casal já está completo.');
  q.run("UPDATE invites SET status='expired' WHERE couple_id=? AND status='pending' AND expires_at<=?", ctx.coupleId, sqlNow());
  const code = genCode();
  const id = Number(q.run('INSERT INTO invites(couple_id,code,created_by,expires_at) VALUES (?,?,?,?)', ctx.coupleId, code, ctx.userId, sqlNow(7 * 864e5)).lastInsertRowid);
  audit(ctx, 'couple.invite_create', 'invite', id, null, 'couple');
  req.status = 201;
  const base = (process.env.APP_URL || `${req.proto}://${req.headers.host}`).replace(/\/$/, '');
  return { invite: { id, code, link: `${base}/#/convite/${code}`, expires_at: sqlNow(7 * 864e5) } };
});

del('/api/couple/invites/:id', (req) => {
  const ctx = req.ctx;
  if (ctx.role !== 'owner') throw forbidden();
  const r = q.run("UPDATE invites SET status='revoked' WHERE id=? AND couple_id=? AND status='pending'", Number(req.params.id), ctx.coupleId);
  if (!r.changes) throw notFound('Convite não encontrado.');
  audit(ctx, 'couple.invite_revoke', 'invite', Number(req.params.id), null, 'couple');
  return { ok: true };
});

// Pré-visualização do convite (para confirmar antes de entrar).
get('/api/invites/:code', (req) => {
  rateLimit('invprev:' + req.ip, 30, 600_000);
  const code = String(req.params.code).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const inv = q.get(
    `SELECT i.*, c.name AS couple_name, u.name AS inviter FROM invites i JOIN couples c ON c.id=i.couple_id JOIN users u ON u.id=i.created_by WHERE i.code=?`, code,
  );
  if (!inv || inv.status !== 'pending' || inv.expires_at <= sqlNow()) throw notFound('Convite inválido, expirado ou revogado.');
  return { invite: { couple_name: inv.couple_name, inviter: inv.inviter, expires_at: inv.expires_at } };
}, { auth: false });

post('/api/couple/join', (req) => {
  const ctx = req.ctx;
  rateLimit('join:' + ctx.userId, 10, 15 * 60_000);
  if (ctx.coupleId) throw bad('Você já faz parte de um casal. Saia dele antes de aceitar outro convite.');
  const code = String(req.body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < 6) throw bad('Código inválido.', 'code');
  const result = tx(() => {
    const inv = q.get('SELECT * FROM invites WHERE code=?', code);
    if (!inv || inv.status !== 'pending' || inv.expires_at <= sqlNow()) throw new HttpError(404, 'Convite inválido, expirado ou revogado.', 'code');
    if (inv.created_by === ctx.userId) throw bad('Você não pode aceitar o próprio convite.', 'code');
    if (coupleMemberIds(inv.couple_id).length >= MAX_MEMBERS) throw bad('Este casal já está completo.', 'code');
    q.run("INSERT INTO couple_members(couple_id,user_id,role) VALUES (?,?, 'member')", inv.couple_id, ctx.userId);
    q.run("UPDATE invites SET status='accepted', accepted_by=? WHERE id=?", ctx.userId, inv.id);
    return inv;
  });
  const nctx = getCtx(req.user, req.ip);
  audit(nctx, 'couple.join', 'couple', result.couple_id, null, 'couple');
  notify(result.created_by, { type: 'couple', title: `${req.user.name} entrou no casal 💜`, body: 'Agora vocês compartilham o ambiente do casal.', link: '#/casal' });
  emit(coupleMemberIds(result.couple_id), 'change', { scope: 'couple', what: 'couple', by: ctx.userId });
  return { couple: coupleSummary(nctx) };
});

// Permissões do outro membro (somente o dono): editar ou somente leitura.
patch('/api/couple/members/:id', (req) => {
  const ctx = req.ctx;
  if (ctx.role !== 'owner') throw forbidden('Somente quem criou o casal pode alterar permissões.');
  const uid = Number(req.params.id);
  if (uid === ctx.userId) throw bad('Você não pode alterar a própria permissão.');
  const m = q.get('SELECT 1 FROM couple_members WHERE couple_id=? AND user_id=?', ctx.coupleId, uid);
  if (!m) throw notFound();
  q.run('UPDATE couple_members SET can_edit=? WHERE couple_id=? AND user_id=?', v.bool(req.body.can_edit, true), ctx.coupleId, uid);
  audit(ctx, 'couple.permission', 'user', uid, { can_edit: !!req.body.can_edit }, 'couple');
  return { couple: coupleSummary(ctx) };
});

// Privacidade própria: compartilhar o total pessoal com o parceiro.
patch('/api/couple/me', (req) => {
  const ctx = req.ctx;
  if (!ctx.coupleId) throw bad('Você ainda não faz parte de um casal.');
  q.run('UPDATE couple_members SET share_personal_total=? WHERE couple_id=? AND user_id=?', v.bool(req.body.share_personal_total, false), ctx.coupleId, ctx.userId);
  audit(ctx, 'couple.privacy', 'user', ctx.userId, { share_personal_total: !!req.body.share_personal_total }, 'couple');
  return { couple: coupleSummary(ctx) };
});

post('/api/couple/leave', (req) => {
  const ctx = req.ctx;
  if (!ctx.coupleId) throw bad('Você não faz parte de um casal.');
  if (req.body.confirm !== true) throw bad('Confirme para sair do casal.');
  tx(() => { audit(ctx, 'couple.leave', 'couple', ctx.coupleId, null, 'couple'); leaveCouple(ctx); });
  return { couple: null };
});

// Visão do casal: contribuição de cada um e total pessoal compartilhado (se autorizado).
get('/api/couple/overview', (req) => {
  const ctx = req.ctx;
  if (!ctx.coupleId) throw bad('Você ainda não faz parte de um casal.');
  const month = (req.query.month || new Date().toISOString().slice(0, 7));
  if (!/^\d{4}-\d{2}$/.test(month)) throw bad('Mês inválido.', 'month');
  const from = month + '-01', to = month + '-31';
  const members = q.all('SELECT u.id, u.name, u.avatar, m.share_personal_total FROM couple_members m JOIN users u ON u.id=m.user_id WHERE m.couple_id=?', ctx.coupleId);
  const rows = q.all(
    `SELECT user_id, type, SUM(amount_cents) AS total FROM transactions
     WHERE scope='couple' AND couple_id=? AND status='paid' AND type IN ('income','expense') AND date BETWEEN ? AND ? GROUP BY user_id, type`,
    ctx.coupleId, from, to,
  );
  return {
    month,
    members: members.map((m) => {
      const own = m.id === ctx.userId;
      let personal_total_cents = null;
      if (own || m.share_personal_total) {
        const ids = q.all("SELECT id FROM accounts WHERE scope='personal' AND user_id=? AND archived=0 AND type<>'card'", m.id).map((a) => a.id);
        personal_total_cents = [...accountBalances(ids).values()].reduce((x, y) => x + y, 0);
      }
      return {
        id: m.id, name: m.name, avatar: m.avatar, me: own,
        income_cents: rows.filter((r) => r.user_id === m.id && r.type === 'income').reduce((x, r) => x + r.total, 0),
        expense_cents: rows.filter((r) => r.user_id === m.id && r.type === 'expense').reduce((x, r) => x + r.total, 0),
        personal_total_cents, shares_personal_total: !!m.share_personal_total,
      };
    }),
  };
});
