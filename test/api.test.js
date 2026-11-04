// Testes de integração da API (servidor real em porta efêmera, banco temporário).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-test-'));
process.env.DATA_DIR = tmp;
process.env.NODE_ENV = 'test';
delete process.env.ANTHROPIC_API_KEY; delete process.env.OPENAI_API_KEY; delete process.env.GEMINI_API_KEY;

const { createServer } = await import('../server/index.js');
const { materializeRecurring } = await import('../server/jobs.js');
const { q } = await import('../server/db.js');
const server = createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); setTimeout(() => process.exit(0), 100).unref(); });

class Client {
  constructor(name) { this.name = name; this.cookie = ''; }
  async req(method, url, body, headers = {}) {
    const r = await fetch(base + url, {
      method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual',
    });
    const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0].startsWith('nexo_sid=;') ? '' : sc.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json() : await r.text();
    return { status: r.status, data, headers: r.headers };
  }
  get(u) { return this.req('GET', u); } post(u, b = {}) { return this.req('POST', u, b); }
  patch(u, b = {}) { return this.req('PATCH', u, b); } del(u) { return this.req('DELETE', u); }
}
const A = new Client('A'), B = new Client('B'), C = new Client('C');
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const ok = (r, s = 200) => assert.equal(r.status, s, `esperava ${s}, veio ${r.status}: ${JSON.stringify(r.data)}`);
const ids = {};

test('autenticação: cadastro, validação, login, sessão e logout', async () => {
  ok(await A.post('/api/auth/register', { name: 'Ana', email: 'ana@teste.com', password: 'senha1234' }), 201);
  assert.equal((await A.post('/api/auth/register', { name: 'Ana', email: 'ana@teste.com', password: 'senha1234' })).status, 409);
  assert.equal((await C.post('/api/auth/register', { name: 'X', email: 'x@teste.com', password: '123' })).status, 400);
  assert.equal((await C.post('/api/auth/register', { name: 'Xis', email: 'invalido', password: 'senha1234' })).status, 400);
  const me = await A.get('/api/auth/me'); ok(me); assert.equal(me.data.user.email, 'ana@teste.com'); assert.equal(me.data.couple, null);
  assert.equal(me.data.user.password_hash, undefined);
  assert.equal((await new Client('anon').get('/api/auth/me')).status, 401);
  assert.equal((await new Client('anon').get('/api/transactions')).status, 401);
  ok(await A.post('/api/auth/logout')); assert.equal((await A.get('/api/auth/me')).status, 401);
  assert.equal((await A.post('/api/auth/login', { email: 'ana@teste.com', password: 'errada123' })).status, 401);
  ok(await A.post('/api/auth/login', { email: 'ana@teste.com', password: 'senha1234' }));
  ok(await B.post('/api/auth/register', { name: 'Beto', email: 'beto@teste.com', password: 'senha1234' }), 201);
  ok(await C.post('/api/auth/register', { name: 'Caio', email: 'caio@teste.com', password: 'senha1234' }), 201);
});

test('recuperação de senha encerra sessões', async () => {
  const D = new Client('D'); ok(await D.post('/api/auth/register', { name: 'Dani', email: 'dani@teste.com', password: 'senha1234' }), 201);
  const f = await new Client('anon').post('/api/auth/forgot', { email: 'dani@teste.com' }); ok(f);
  const token = f.data.dev_link.split('/redefinir/')[1];
  const ghost = await new Client('anon').post('/api/auth/forgot', { email: 'ninguem@teste.com' }); ok(ghost);
  assert.equal(ghost.data.dev_link, undefined); // não vaza existência
  ok(await new Client('anon').post('/api/auth/reset', { token, password: 'novasenha99' }));
  assert.equal((await D.get('/api/auth/me')).status, 401);
  assert.equal((await new Client('anon').post('/api/auth/reset', { token, password: 'outrasenha9' })).status, 400); // token de uso único
  ok(await D.post('/api/auth/login', { email: 'dani@teste.com', password: 'novasenha99' }));
});

test('proteção CSRF: origem divergente é bloqueada', async () => {
  const r = await A.req('POST', '/api/accounts', { scope: 'personal', name: 'X', type: 'wallet' }, { origin: 'https://evil.example' });
  assert.equal(r.status, 403);
});

test('contas e lançamentos pessoais: saldos calculados corretamente', async () => {
  const acc = await A.post('/api/accounts', { scope: 'personal', name: 'Nubank', type: 'checking', initial_cents: 100000 }); ok(acc, 201); ids.accA = acc.data.account.id;
  const card = await A.post('/api/accounts', { scope: 'personal', name: 'Cartão', type: 'card', credit_limit_cents: 500000, due_day: 10 }); ok(card, 201); ids.cardA = card.data.account.id;
  const lk = await A.get('/api/lookups?scope=personal'); ok(lk);
  const catSalario = lk.data.categories.find((c) => c.name === 'Salário' && c.kind === 'income');
  const catMercado = lk.data.categories.find((c) => c.name === 'Mercado');
  ids.catAlimA = lk.data.categories.find((c) => c.name === 'Alimentação').id;
  ids.catMercadoA = catMercado.id;
  ok(await A.post('/api/transactions', { scope: 'personal', type: 'income', account_id: ids.accA, amount_cents: 500000, date: today, description: 'Salário', category_id: catSalario.id }), 201);
  const exp = await A.post('/api/transactions', { scope: 'personal', type: 'expense', account_id: ids.accA, amount_cents: 25050, date: today, description: 'Mercado', category_id: catMercado.id }); ok(exp, 201);
  ids.txA = exp.data.transaction.id;
  ok(await A.post('/api/transactions', { scope: 'personal', type: 'expense', account_id: ids.cardA, amount_cents: 10000, date: today, description: 'Compra no cartão', category_id: catMercado.id }), 201);
  const accs = await A.get('/api/accounts?scope=personal'); ok(accs);
  assert.equal(accs.data.total_cents, 100000 + 500000 - 25050); // cartão não entra no saldo
  assert.equal(accs.data.card_debt_cents, 10000);
  const card1 = accs.data.accounts.find((a) => a.id === ids.cardA); assert.equal(card1.available_cents, 490000);
  // transferência (pagar fatura) não afeta receitas/despesas
  ok(await A.post('/api/transactions', { scope: 'personal', type: 'transfer', account_id: ids.accA, to_account_id: ids.cardA, amount_cents: 10000, date: today, description: 'Pagamento da fatura' }), 201);
  const after = await A.get('/api/accounts?scope=personal');
  assert.equal(after.data.total_cents, 100000 + 500000 - 25050 - 10000); assert.equal(after.data.card_debt_cents, 0);
  const dash = await A.get('/api/dashboard?scope=personal'); ok(dash);
  assert.equal(dash.data.month_summary.income_cents, 500000); assert.equal(dash.data.month_summary.expense_cents, 35050);
  assert.equal(dash.data.recent.length >= 3, true);
});

test('validação no servidor e idempotência', async () => {
  const bad = (b) => A.post('/api/transactions', { scope: 'personal', type: 'expense', account_id: ids.accA, amount_cents: 100, date: today, description: 'x', ...b });
  assert.equal((await bad({ amount_cents: -5 })).status, 400);
  assert.equal((await bad({ amount_cents: 1.5 })).status, 400);
  assert.equal((await bad({ amount_cents: 0 })).status, 400);
  assert.equal((await bad({ date: '2026-02-31' })).status, 400);
  assert.equal((await bad({ description: '' })).status, 400);
  assert.equal((await bad({ type: 'invalid' })).status, 400);
  assert.equal((await bad({ account_id: 99999 })).status, 400);
  const k = { idempotency_key: 'abc-123', description: 'Café' };
  const r1 = await bad(k), r2 = await bad(k); ok(r1, 201); ok(r2, 200);
  assert.equal(r2.data.duplicate, true); assert.equal(r2.data.transaction.id, r1.data.transaction.id);
  const list = await A.get('/api/transactions?scope=personal&q=Caf'); assert.equal(list.data.count, 1);
});

test('parcelamento, recorrência, conta a pagar e baixa', async () => {
  const p = await A.post('/api/transactions', { scope: 'personal', type: 'expense', account_id: ids.cardA, amount_cents: 100001, date: today, description: 'Geladeira', installments: 3, category_id: ids.catMercadoA }); ok(p, 201);
  const parc = (await A.get('/api/transactions?scope=personal&q=Geladeira')).data.transactions;
  assert.equal(parc.length, 3); assert.equal(parc.reduce((x, t) => x + t.amount_cents, 0), 100001);
  assert.equal(parc.filter((t) => t.status === 'pending').length, 2);
  const pend = parc.find((t) => t.installment_no === 2);
  ok(await A.post(`/api/transactions/${pend.id}/pay`, {}));
  assert.equal((await A.post(`/api/transactions/${pend.id}/pay`, {})).status, 400);
  const d = await A.del(`/api/transactions/${parc[0].id}?group=all`); ok(d); assert.equal(d.data.removed, 3);

  // recorrência: lançada hoje; ao simular passagem de tempo, gera os meses pendentes sem duplicar
  const r = await A.post('/api/transactions', { scope: 'personal', type: 'expense', account_id: ids.accA, amount_cents: 5000, date: today, description: 'Internet', recurrence: { frequency: 'monthly' } }); ok(r, 201);
  const rec = (await A.get('/api/recurring?scope=personal')).data.recurring; assert.equal(rec.length, 1);
  q.run("UPDATE recurring SET next_date=date('now','-2 month') WHERE id=?", rec[0].id);
  const n = materializeRecurring(today); assert.ok(n >= 2, 'deve gerar ocorrências atrasadas');
  assert.equal(materializeRecurring(today), 0, 'não duplica');
  const bills = (await A.get('/api/bills?scope=personal')).data; assert.ok(bills.overdue.length >= 1);
});

test('orçamentos e alertas', async () => {
  ok(await A.post('/api/budgets', { scope: 'personal', category_id: ids.catAlimA, limit_cents: 20000 }), 201);
  ok(await A.post('/api/transactions', { scope: 'personal', type: 'expense', account_id: ids.accA, amount_cents: 1000, date: today, description: 'Gatilho', category_id: ids.catMercadoA }), 201);
  const b = (await A.get('/api/budgets?scope=personal')).data.budgets.find((x) => x.category_id === ids.catAlimA);
  assert.ok(b.pct >= 1); assert.equal(b.limit_cents, 20000);
  const notes = (await A.get('/api/notifications')).data;
  assert.ok(notes.notifications.some((n) => n.type === 'budget'));
});

test('isolamento: usuário B não enxerga nem altera dados pessoais de A', async () => {
  assert.equal((await B.get(`/api/transactions/${ids.txA}`)).status, 404);
  assert.equal((await B.patch(`/api/transactions/${ids.txA}`, { description: 'hack' })).status, 404);
  assert.equal((await B.del(`/api/transactions/${ids.txA}`)).status, 404);
  assert.equal((await B.patch(`/api/accounts/${ids.accA}`, { name: 'hack' })).status, 404);
  assert.equal((await B.get('/api/transactions?scope=personal')).data.count, 0);
  assert.equal((await B.get('/api/accounts?scope=personal')).data.accounts.length, 0);
  assert.equal((await B.get('/api/transactions?scope=couple')).status, 400);
  // B tenta usar a conta de A em um lançamento
  const r = await B.post('/api/transactions', { scope: 'personal', type: 'expense', account_id: ids.accA, amount_cents: 100, date: today, description: 'x' });
  assert.equal(r.status, 400);
  // categoria de A não pode ser usada por B
  const bacc = (await B.post('/api/accounts', { scope: 'personal', name: 'Carteira B', type: 'wallet' })).data.account;
  const r2 = await B.post('/api/transactions', { scope: 'personal', type: 'expense', account_id: bacc.id, amount_cents: 100, date: today, description: 'x', category_id: ids.catMercadoA });
  assert.equal(r2.status, 400);
  assert.equal((await B.get('/api/vaults?scope=personal')).data.vaults.length, 0);
});

test('casal: criar, convidar, entrar, limites e revogação', async () => {
  ok(await A.post('/api/couple', { name: 'Ana & Beto' }), 201);
  assert.equal((await A.post('/api/couple', { name: 'Outro' })).status, 400);
  const inv = await A.post('/api/couple/invites'); ok(inv, 201); const code = inv.data.invite.code;
  assert.equal((await A.get(`/api/invites/${code}`)).status, 200);
  assert.equal((await A.post('/api/couple/join', { code })).status, 400); // não aceita o próprio convite
  assert.equal((await B.post('/api/couple/join', { code: 'ZZZZZZZZ' })).status, 404);
  const j = await B.post('/api/couple/join', { code }); ok(j); assert.equal(j.data.couple.members.length, 2);
  assert.equal((await C.post('/api/couple/join', { code })).status, 404); // convite já usado
  const inv2 = await A.post('/api/couple/invites'); assert.equal(inv2.status, 400); // casal completo
  assert.equal((await C.get('/api/couple')).data.couple, null);
});

test('ambiente do casal: dados compartilhados e dados pessoais isolados', async () => {
  const shared = await A.post('/api/accounts', { scope: 'couple', name: 'Conta conjunta', type: 'checking', initial_cents: 200000 }); ok(shared, 201); ids.joint = shared.data.account.id;
  const lk = await B.get('/api/lookups?scope=couple'); ok(lk);
  assert.ok(lk.data.accounts.some((a) => a.id === ids.joint)); assert.ok(!lk.data.accounts.some((a) => a.id === ids.accA));
  const cat = lk.data.categories.find((c) => c.name === 'Mercado');
  const catRoot = lk.data.categories.find((c) => c.name === 'Alimentação');
  const t = await B.post('/api/transactions', { scope: 'couple', type: 'expense', account_id: ids.joint, amount_cents: 30000, date: today, description: 'Compras do casal', category_id: cat.id }); ok(t, 201);
  const fromA = await A.get('/api/transactions?scope=couple'); assert.equal(fromA.data.count, 1); assert.equal(fromA.data.transactions[0].user_name, 'Beto');
  // personal de A continua invisível para B, mesmo com casal
  assert.equal((await B.get(`/api/transactions/${ids.txA}`)).status, 404);
  assert.equal((await B.get('/api/transactions?scope=personal')).data.count, 0);
  // escopo 'all' mistura somente o que pertence a quem consulta
  const allB = await B.get('/api/transactions?scope=all'); assert.equal(allB.data.count, 1);
  const allA = await A.get('/api/transactions?scope=all'); assert.ok(allA.data.count > 5);
  // conta pessoal não pode ser usada em lançamento do casal
  assert.equal((await A.post('/api/transactions', { scope: 'couple', type: 'expense', account_id: ids.accA, amount_cents: 1, date: today, description: 'x' })).status, 400);
  // C (sem casal) não enxerga nada
  assert.equal((await C.get(`/api/accounts?scope=personal`)).data.accounts.length, 0);
  assert.equal((await C.patch(`/api/accounts/${ids.joint}`, { name: 'x' })).status, 404);
  // notificações em tempo de escrita: parceiro é avisado? (orçamento do casal)
  ok(await A.post('/api/budgets', { scope: 'couple', category_id: catRoot.id, limit_cents: 20000 }), 201);
  const ov = await A.get('/api/couple/overview'); ok(ov);
  assert.equal(ov.data.members.find((m) => m.name === 'Beto').personal_total_cents, null); // privacidade padrão
  ok(await B.patch('/api/couple/me', { share_personal_total: true }));
  assert.equal(typeof (await A.get('/api/couple/overview')).data.members.find((m) => m.name === 'Beto').personal_total_cents, 'number');
});

test('permissão somente leitura para membro do casal', async () => {
  const bId = (await A.get('/api/couple')).data.couple.members.find((m) => m.name === 'Beto').id;
  assert.equal((await B.patch(`/api/couple/members/${bId}`, { can_edit: false })).status, 403);
  ok(await A.patch(`/api/couple/members/${bId}`, { can_edit: false }));
  const r = await B.post('/api/transactions', { scope: 'couple', type: 'expense', account_id: ids.joint, amount_cents: 100, date: today, description: 'x' });
  assert.equal(r.status, 403);
  assert.equal((await B.get('/api/transactions?scope=couple')).status, 200); // leitura permitida
  assert.equal((await B.post('/api/transactions', { scope: 'personal', type: 'expense', account_id: (await B.get('/api/accounts?scope=personal')).data.accounts[0].id, amount_cents: 100, date: today, description: 'pessoal ok' })).status, 201);
  ok(await A.patch(`/api/couple/members/${bId}`, { can_edit: true }));
});

test('cofre e metas: depósitos, saques, saldo insuficiente e progresso automático', async () => {
  const g = await A.post('/api/goals', { scope: 'couple', name: 'Viagem dos sonhos', kind: 'viagem', target_cents: 1000000, deadline: '2027-12-01' }); ok(g, 201);
  ids.goal = g.data.goal.id; const vid = g.data.goal.vault_id;
  assert.equal(g.data.goal.current_cents, 0);
  const dep = await B.post(`/api/vaults/${vid}/movements`, { type: 'deposit', amount_cents: 250000, account_id: ids.joint, note: 'Primeiro aporte', idempotency_key: 'dep-1' }); ok(dep, 201);
  const dup = await B.post(`/api/vaults/${vid}/movements`, { type: 'deposit', amount_cents: 250000, account_id: ids.joint, idempotency_key: 'dep-1' }); ok(dup); assert.equal(dup.data.duplicate, true);
  const goals = (await A.get('/api/goals?scope=couple')).data; assert.equal(goals.goals[0].current_cents, 250000); assert.equal(goals.goals[0].pct, 0.25);
  assert.ok(goals.goals[0].per_month_cents > 0);
  assert.equal((await A.post(`/api/vaults/${vid}/movements`, { type: 'withdraw', amount_cents: 999999 })).status, 400);
  const acc = (await A.get('/api/accounts?scope=couple')).data; // 200000 inicial - 30000 compra - 250000 depósito
  assert.equal(acc.accounts.find((a) => a.id === ids.joint).balance_cents, 200000 - 30000 - 250000);
  ok(await A.post(`/api/vaults/${vid}/movements`, { type: 'withdraw', amount_cents: 50000, account_id: ids.joint }), 201);
  assert.equal((await A.get(`/api/vaults/${vid}`)).data.vault.balance_cents, 200000);
  assert.equal((await A.del(`/api/vaults/${vid}`)).status, 409); // com saldo
  assert.equal((await C.get(`/api/vaults/${vid}`)).status, 404);
  const notes = (await A.get('/api/notifications')).data.notifications; assert.ok(notes.some((n) => n.type === 'vault'));
});

test('investimentos: planejado x realizado, aporte, valorização e resgate', async () => {
  const plan = await A.post('/api/investments', { scope: 'personal', name: 'Tesouro Selic futuro', asset_type: 'renda_fixa', status: 'planned', planned_cents: 500000, expected_return_pct: 10, target_date: '2027-12-31' }); ok(plan, 201);
  assert.equal((await A.post(`/api/investments/${plan.data.investment.id}/entries`, { type: 'aporte', amount_cents: 1000 })).status, 400);
  const inv = await A.post('/api/investments', { scope: 'personal', name: 'Tesouro Selic', asset_type: 'renda_fixa', status: 'realized' }); ok(inv, 201); const id = inv.data.investment.id;
  ok(await A.post(`/api/investments/${id}/entries`, { type: 'aporte', amount_cents: 100000, account_id: ids.accA, date: today }), 201);
  ok(await A.post(`/api/investments/${id}/entries`, { type: 'valuation', amount_cents: 110000, date: today }), 201);
  let list = (await A.get('/api/investments?scope=personal')).data;
  assert.equal(list.invested_cents, 100000); assert.equal(list.value_cents, 110000); assert.equal(list.planned_cents, 500000);
  assert.ok(Math.abs(list.return_pct - 0.1) < 1e-9);
  assert.equal((await A.post(`/api/investments/${id}/entries`, { type: 'resgate', amount_cents: 999999 })).status, 400);
  ok(await A.post(`/api/investments/${id}/entries`, { type: 'resgate', amount_cents: 55000, account_id: ids.accA, date: today }), 201);
  list = (await A.get('/api/investments?scope=personal')).data; assert.equal(list.value_cents, 55000); assert.equal(list.invested_cents, 50000);
  assert.equal((await B.get(`/api/investments/${id}`)).status, 404);
  assert.equal((await A.del(`/api/investments/${id}`)).status, 409);
});

test('relatórios, insights, exportação CSV e planejamento', async () => {
  for (const u of ['cashflow?months=6', 'categories', 'compare', 'networth?months=6', 'insights']) ok(await A.get(`/api/reports/${u}${u.includes('?') ? '&' : '?'}scope=all`));
  ok(await A.get('/api/reports/members'));
  const cats = (await A.get('/api/reports/categories?scope=personal')).data; assert.ok(cats.categories.length >= 1);
  const csv = await A.get(`/api/reports/export.csv?scope=all&from=${today.slice(0, 7)}-01&to=${today.slice(0, 7)}-28`); ok(csv);
  assert.ok(csv.data.replace(/^\ufeff/, '').startsWith('Data;Tipo')); assert.ok(csv.headers.get('content-disposition').includes('attachment'));
  const pl = await A.get('/api/planning?scope=personal'); ok(pl); assert.equal(typeof pl.data.projected_result_cents, 'number');
  const ins = (await A.get('/api/reports/insights?scope=personal')).data.insights; assert.ok(ins.length > 0);
  assert.equal((await C.get('/api/reports/insights?scope=personal')).data.insights[0].id, 'empty'); // sem dados: não inventa nada
  assert.equal((await C.get('/api/dashboard?scope=personal')).data.balance.total_cents, 0);
});

test('chat do casal: mensagens, anexo, leitura e isolamento', async () => {
  assert.equal((await C.get('/api/chat')).status, 400);
  ok(await A.post('/api/chat', { body: 'Oi, amor! 💜' }), 201);
  const tx1 = (await A.get('/api/transactions?scope=couple')).data.transactions[0];
  ok(await A.post('/api/chat', { body: 'Olha essa despesa', attachment: { kind: 'transaction', id: tx1.id } }), 201);
  assert.equal((await A.post('/api/chat', { body: 'x', attachment: { kind: 'transaction', id: ids.txA } })).status, 201); // A pode compartilhar a própria
  assert.equal((await B.post('/api/chat', { body: 'x', attachment: { kind: 'transaction', id: ids.txA } })).status, 404); // B não pode anexar o que não vê
  assert.equal((await B.get('/api/counters')).data.chat, 3);
  const msgs = await B.get('/api/chat'); ok(msgs); assert.equal(msgs.data.messages.length, 3); assert.equal(msgs.data.messages[1].attachment.amount_cents, 30000);
  ok(await B.post('/api/chat/read')); assert.equal((await B.get('/api/counters')).data.chat, 0);
  assert.equal((await B.del(`/api/chat/${msgs.data.messages[0].id}`)).status, 403);
  assert.equal((await C.post('/api/chat', { body: 'invasor' })).status, 400);
});

test('assistente de IA: modo local usa apenas dados reais e respeita escopo', async () => {
  assert.equal((await A.get('/api/ai/status')).data.mode, 'local');
  const r = await A.post('/api/ai/chat', { scope: 'personal', message: 'Onde posso economizar?' }); ok(r);
  assert.equal(r.data.provider, 'local'); assert.ok(r.data.reply.includes('modo local'));
  const empty = await C.post('/api/ai/chat', { scope: 'personal', message: 'Como estão meus gastos?' }); ok(empty);
  assert.ok(empty.data.reply.includes('registrando')); assert.ok(!/R\$ \d/.test(empty.data.reply)); // nada inventado
  assert.equal((await C.post('/api/ai/chat', { scope: 'couple', message: 'oi' })).status, 400);
  assert.equal((await A.get('/api/ai/history?scope=personal')).data.messages.length, 2);
  assert.equal((await C.get('/api/ai/history?scope=personal')).data.messages.length, 2);
  const { buildContext } = await import('../server/ai.js'); const { getCtx } = await import('../server/core.js');
  const uB = q.get("SELECT * FROM users WHERE email='beto@teste.com'");
  const ctxB = JSON.stringify(buildContext(getCtx(uB, null), 'couple'));
  assert.ok(!ctxB.includes('Nubank') && !ctxB.includes('Salário')); // dados pessoais de A não vazam para o contexto de B
});

test('perfil, sessões, auditoria e exclusão de conta preservando o casal', async () => {
  ok(await A.patch('/api/profile', { name: 'Ana Maria' }));
  const s = await A.get('/api/profile/sessions'); ok(s); assert.ok(s.data.sessions.some((x) => x.current));
  assert.equal((await A.post('/api/profile/password', { current: 'errada', password: 'novasenha123' })).status, 400);
  const audit = q.all("SELECT action FROM audit_log WHERE action LIKE 'transaction.%'"); assert.ok(audit.length >= 5);
  assert.equal((await A.post('/api/profile/delete', { password: 'errada123' })).status, 400);
  ok(await A.post('/api/profile/delete', { password: 'senha1234' }));
  assert.equal((await A.get('/api/auth/me')).status, 401);
  const couple = (await B.get('/api/couple')).data.couple; assert.ok(couple); assert.equal(couple.members.length, 1); assert.equal(couple.role, 'owner');
  assert.equal((await B.get('/api/transactions?scope=couple')).data.count, 1); // dados do casal permanecem com o parceiro
  assert.equal((await B.get('/api/goals?scope=couple')).data.goals[0].current_cents, 200000);
  assert.equal(q.get("SELECT COUNT(*) AS n FROM users WHERE email='ana@teste.com'").n, 0);
});

test('estáticos: SPA, cabeçalhos de segurança e bloqueio de path traversal', async () => {
  const r = await fetch(base + '/'); assert.ok([200, 404].includes(r.status));
  assert.ok((r.headers.get('content-security-policy') || '').includes("default-src 'self'"));
  const t = await fetch(base + '/..%2f..%2fetc%2fpasswd'); assert.notEqual(t.status, 200);
  assert.equal((await fetch(base + '/api/inexistente')).status, 404);
});
