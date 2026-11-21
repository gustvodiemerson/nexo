// Testes de integração da API (servidor real em porta efêmera, banco temporário).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-test-'));
process.env.DATA_DIR = tmp;
process.env.PGLITE_DIR = 'memory'; // Postgres embutido (PGlite) em memória
if (!process.env.TEST_DATABASE_URL) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
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
  await q.run("UPDATE recurring SET next_date=to_char(current_date - interval '2 month','YYYY-MM-DD') WHERE id=?", rec[0].id);
  const n = await materializeRecurring(today); assert.ok(n >= 2, 'deve gerar ocorrências atrasadas');
  assert.equal(await materializeRecurring(today), 0, 'não duplica');
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
  const uB = await q.get("SELECT * FROM users WHERE email='beto@teste.com'");
  const ctxB = JSON.stringify(buildContext(getCtx(uB, null), 'couple'));
  assert.ok(!ctxB.includes('Nubank') && !ctxB.includes('Salário')); // dados pessoais de A não vazam para o contexto de B
});

test('IA registra movimentações (propostas), lançamentos em lote e leitura de nota fiscal', async () => {
  // modo local: entende frases simples e NÃO grava nada sozinho
  const before = (await A.get('/api/transactions?scope=personal')).data.count;
  const c1 = await A.post('/api/ai/chat', { scope: 'personal', message: 'gastei 35,50 no almoço ontem' }); ok(c1);
  assert.equal(c1.data.proposal.items.length, 1);
  const it = c1.data.proposal.items[0];
  assert.deepEqual([it.type, it.amount_cents, it.description], ['expense', 3550, 'Almoço']);
  assert.ok(it.date < today);
  assert.equal((await A.get('/api/transactions?scope=personal')).data.count, before);
  const c2 = await A.post('/api/ai/chat', { scope: 'personal', message: 'quanto gastei no mercado este mês?' }); ok(c2);
  assert.equal(c2.data.proposal, null);
  const c3 = await A.post('/api/ai/chat', { scope: 'personal', message: 'recebi 3.000,00 de salário' }); ok(c3);
  assert.deepEqual([c3.data.proposal.items[0].type, c3.data.proposal.items[0].amount_cents], ['income', 300000]);

  // lote
  const L = (await A.get('/api/lookups?scope=all')).data;
  const acc = L.accounts.find((a) => a.scope === 'personal' && a.type !== 'card');
  const cat = L.categories.find((c) => c.scope === 'personal' && c.kind === 'expense');
  const body = { scope: 'personal', batch: 'teste-lote-1', account_id: acc.id, items: [
    { type: 'expense', description: 'Leite', amount_cents: 700, date: today, category_id: cat.id },
    { type: 'expense', description: 'Pão', amount_cents: 1500, date: today } ] };
  const b1 = await A.post('/api/transactions/bulk', body); ok(b1, 201); assert.equal(b1.data.created, 2); assert.equal(b1.data.expense_cents, 2200);
  const b2 = await A.post('/api/transactions/bulk', body); ok(b2); assert.equal(b2.data.duplicate, true);
  assert.equal((await A.get('/api/transactions?scope=personal')).data.count, before + 2);
  assert.equal((await A.post('/api/transactions/bulk', { ...body, batch: 'x2', scope: 'couple' })).status, 400); // conta pessoal em lote do casal
  assert.equal((await A.post('/api/transactions/bulk', { ...body, batch: 'x3', items: [{ ...body.items[0], amount_cents: 0 }] })).status, 400);
  const bB = await B.post('/api/transactions/bulk', { ...body, batch: 'x4' }); assert.ok([400, 403, 404].includes(bB.status), 'B não pode usar a conta de A: ' + bB.status + JSON.stringify(bB.data));

  // provedor externo simulado (compatível com OpenAI): proposta e nota fiscal
  const seen = [];
  const http = await import('node:http');
  const mock = http.createServer((req, res) => {
    let raw = ''; req.on('data', (c) => (raw += c)); req.on('end', () => {
      const j = JSON.parse(raw); seen.push(j);
      const isReceipt = j.messages[0].content.includes('notas fiscais');
      const content = isReceipt
        ? JSON.stringify({ legivel: true, loja: 'Mercado Bom', data: today, total: 30.5, itens: [{ descricao: 'Arroz 5kg', valor: 22.9, categoria: cat.name }, { descricao: 'Feijão', valor: 7.6, categoria: null }, { descricao: 'Lixo', valor: -3, categoria: null }] })
        : '```json\n' + JSON.stringify({ acao: 'registrar', itens: [{ tipo: 'despesa', descricao: 'Farmácia', valor: 42.9, categoria: null, conta: null, data: today, situacao: 'pago' }], mensagem: 'Entendi: despesa de R$ 42,90 em Farmácia.' }) + '\n```';
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  Object.assign(process.env, { OPENAI_API_KEY: 'teste', OPENAI_BASE_URL: `http://127.0.0.1:${mock.address().port}`, AI_PROVIDER: 'openai' });
  try {
    assert.equal((await A.get('/api/ai/status')).data.receipts, true);
    const c4 = await A.post('/api/ai/chat', { scope: 'personal', message: 'coloca 42,90 da farmácia' }); ok(c4);
    assert.equal(c4.data.proposal.items[0].amount_cents, 4290); assert.match(c4.data.reply, /Farmácia/);
    assert.ok(!c4.data.reply.includes('{'), 'o JSON não vaza para o chat');
    const img = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBD';
    const r1 = await A.post('/api/ai/receipt', { image: img }); ok(r1);
    const rc = r1.data.receipt;
    assert.equal(rc.readable, true); assert.equal(rc.store, 'Mercado Bom'); assert.equal(rc.items.length, 2); // o item negativo é descartado
    assert.equal(rc.items[0].amount_cents, 2290); assert.equal(rc.total_cents, 3050); assert.equal(rc.items_sum_cents, 3050);
    const sent = seen.at(-1).messages.at(-1).content;
    assert.ok(Array.isArray(sent) && sent.some((p) => p.type === 'image_url' && p.image_url.url === img), 'a imagem chega ao provedor');
    assert.equal((await A.post('/api/ai/receipt', { image: 'nao-e-imagem' })).status, 400);
    assert.equal((await new Client('anon').post('/api/ai/receipt', { image: img })).status, 401);
  } finally {
    mock.close(); delete process.env.OPENAI_API_KEY; delete process.env.OPENAI_BASE_URL; delete process.env.AI_PROVIDER;
  }
  // sem provedor: nota fiscal indisponível com mensagem clara
  const r2 = await A.post('/api/ai/receipt', { image: 'data:image/jpeg;base64,/9j/4AAQ' }); assert.equal(r2.status, 503);
  assert.equal((await A.get('/api/ai/status')).data.receipts, false);
});

const pushCalls = [];
test('notificações push: inscrição, preferências, chat, atividade do casal e isolamento', async () => {
  const { default: webpush } = await import('web-push');
  webpush.sendNotification = async (sub, payload) => { pushCalls.push({ endpoint: sub.endpoint, ...JSON.parse(payload) }); return { statusCode: 201 }; };
  const subOf = (n) => ({ endpoint: `https://push.example.test/send/${n}-1234567890`, keys: { p256dh: 'BP' + 'x'.repeat(40), auth: 'auth' + n + 'secret' } });
  const cfg = await A.get('/api/push/config'); ok(cfg);
  assert.ok(cfg.data.publicKey.length > 40); assert.equal(cfg.data.devices, 0); assert.equal(cfg.data.prefs.chat, true);
  assert.equal((await new Client('anon').get('/api/push/config')).status, 401);
  assert.equal((await A.post('/api/push/subscribe', { subscription: { endpoint: 'http://inseguro', keys: {} } })).status, 400);
  ok(await A.post('/api/push/subscribe', { subscription: subOf('A') }), 201);
  ok(await B.post('/api/push/subscribe', { subscription: subOf('B') }), 201);
  assert.equal((await A.get('/api/push/config')).data.devices, 1);
  // teste direto
  ok(await A.post('/api/push/test')); assert.equal(pushCalls.at(-1).endpoint, subOf('A').endpoint); assert.equal(pushCalls.at(-1).title, 'NEXO • teste');
  // chat: A escreve, B recebe (e A não)
  pushCalls.length = 0;
  ok(await A.post('/api/chat', { body: 'Compra do mercado hoje?' }), 201);
  assert.deepEqual(pushCalls.map((c) => c.endpoint), [subOf('B').endpoint]); assert.ok(pushCalls[0].body.includes('Compra do mercado'));
  // preferência desligada: B não recebe mais mensagens de chat
  ok(await B.patch('/api/push/prefs', { chat: false })); assert.equal((await B.get('/api/push/config')).data.prefs.chat, false);
  pushCalls.length = 0;
  ok(await A.post('/api/chat', { body: 'Sem aviso' }), 201); assert.equal(pushCalls.length, 0);
  ok(await B.patch('/api/push/prefs', { chat: true }));
  // atividade do casal: lançamento no ambiente do casal avisa o parceiro, com valor
  const L = (await A.get('/api/lookups?scope=couple')).data;
  const acc = L.accounts.find((a) => a.scope === 'couple' && a.type !== 'card'), cat = L.categories.find((c) => c.scope === 'couple' && c.kind === 'expense');
  pushCalls.length = 0;
  const t = await A.post('/api/transactions', { scope: 'couple', type: 'expense', account_id: acc.id, category_id: cat.id, amount_cents: 12345, date: today, description: 'Feira do bairro' });
  if (t.status === 201) { const m = pushCalls.find((c) => c.endpoint === subOf('B').endpoint && c.title.includes('registrou')); assert.ok(m, 'B deveria ser avisado'); assert.ok(m.body.includes('123,45') && m.body.includes('Feira do bairro')); assert.ok(!pushCalls.some((c) => c.endpoint === subOf('A').endpoint && c.title.includes('registrou'))); ok(await A.del('/api/transactions/' + t.data.transaction.id)); }
  // aparelho que deixou de existir (410) é removido
  webpush.sendNotification = async () => { const e = new Error('gone'); e.statusCode = 410; throw e; };
  assert.equal((await B.post('/api/push/test')).status, 400); assert.equal((await B.get('/api/push/config')).data.devices, 0);
  webpush.sendNotification = async (sub, payload) => { pushCalls.push({ endpoint: sub.endpoint, ...JSON.parse(payload) }); return { statusCode: 201 }; };
  ok(await A.post('/api/push/unsubscribe', {})); assert.equal((await A.get('/api/push/config')).data.devices, 0);
  ok(await A.post('/api/push/subscribe', { subscription: subOf('A') }), 201); // A volta a receber no teste dos bancos
});

test('bancos (Pluggy): conectar, importar sem duplicar, categorizar, conferir/ajustar saldo e isolamento', async () => {
  const ITEM = '11111111-2222-3333-4444-555555555555';
  assert.equal((await A.get('/api/bank')).data.configured, false);
  assert.equal((await A.post('/api/bank/preview', { item_id: ITEM })).status, 503);
  // Pluggy simulado
  const state = { balance: 448.11, extra: [], v2: true };
  const http = await import('node:http');
  const calls = { auth: 0, tx: 0 };
  const mock = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); const send = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.method === 'POST' && u.pathname === '/auth') { calls.auth++; return send(200, { apiKey: 'k-teste' }); }
    if (req.headers['x-api-key'] !== 'k-teste') return send(403, { message: 'forbidden' });
    if (req.method === 'PATCH' && u.pathname === '/items/' + ITEM) { calls.refresh = (calls.refresh || 0) + 1; return send(200, { id: ITEM, status: 'UPDATING' }); }
    if (u.pathname === '/items/' + ITEM) return send(200, { id: ITEM, status: 'UPDATED', connector: { name: 'Banco do Brasil' } });
    if (u.pathname.startsWith('/items/')) return send(404, {});
    if (u.pathname === '/accounts') return send(200, { total: 2, results: [
      { id: 'acc-cc', type: 'BANK', subtype: 'CHECKING_ACCOUNT', name: 'Conta Corrente', balance: state.balance },
      { id: 'acc-cartao', type: 'CREDIT', subtype: 'CREDIT_CARD', name: 'Ourocard Elo', balance: 120.5 } ] });
    if (u.pathname === '/v2/transactions') {
      if (!state.v2) return send(500, { message: 'indisponível' });
      const acc = u.searchParams.get('accountId'), after = u.searchParams.get('after');
      const all = acc === 'acc-cc' ? [
        { id: 't1', description: 'MERCADO BOM PRECO', amount: -35.9, type: 'DEBIT', date: today + 'T00:00:00.000Z', status: 'POSTED' },
        { id: 't2', description: 'UBER *TRIP', amount: -20, type: 'DEBIT', date: today + 'T00:00:00.000Z', status: 'POSTED' },
        { id: 't3', description: 'SALARIO EMPRESA', amount: 1000, type: 'CREDIT', date: today + 'T00:00:00.000Z', status: 'POSTED' },
        { id: 't4', description: 'PENDENTE', amount: -9, type: 'DEBIT', date: today + 'T00:00:00.000Z', status: 'PENDING' },
        { id: 't5', description: 'PIX ENVIADO FULANO', amount: -50, type: 'DEBIT', date: today + 'T00:00:00.000Z', status: 'POSTED' },
        ...state.extra ] : [{ id: 'c1', description: 'NETFLIX', amount: 39.9, type: 'DEBIT', date: today + 'T00:00:00.000Z', status: 'POSTED' }];
      if (all.length > 2 && !after) return send(200, { results: all.slice(0, 2), next: `https://api.pluggy.ai/v2/transactions?accountId=${acc}&after=p2` });
      return send(200, { results: after ? all.slice(2) : all, next: null });
    }
    if (u.pathname === '/transactions') {
      calls.tx++;
      const acc = u.searchParams.get('accountId');
      const list = acc === 'acc-cc' ? [
        { id: 't1', description: 'MERCADO BOM PRECO', amount: -35.9, type: 'DEBIT', date: today + 'T00:00:00.000Z', status: 'POSTED' },
        { id: 't2', description: 'UBER *TRIP', amount: -20, type: 'DEBIT', date: today + 'T00:00:00.000Z', status: 'POSTED' },
        { id: 't3', description: 'SALARIO EMPRESA', amount: 1000, type: 'CREDIT', date: today + 'T00:00:00.000Z', status: 'POSTED' },
        { id: 't4', description: 'PENDENTE', amount: -9, type: 'DEBIT', date: today + 'T00:00:00.000Z', status: 'PENDING' },
        { id: 't5', description: 'PIX ENVIADO FULANO', amount: -50, type: 'DEBIT', date: today + 'T00:00:00.000Z', status: 'POSTED' },
        ...state.extra ] : [{ id: 'c1', description: 'NETFLIX', amount: 39.9, type: 'DEBIT', date: today + 'T00:00:00.000Z', status: 'POSTED' }];
      return send(200, { total: list.length, totalPages: 1, page: 1, results: list });
    }
    send(404, {});
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  Object.assign(process.env, { PLUGGY_CLIENT_ID: 'cid', PLUGGY_CLIENT_SECRET: 'csecret', PLUGGY_BASE_URL: `http://127.0.0.1:${mock.address().port}` });
  try {
    assert.equal((await A.get('/api/bank')).data.configured, true);
    assert.equal((await A.post('/api/bank/preview', { item_id: 'abc' })).status, 400);
    assert.equal((await A.post('/api/bank/preview', { item_id: '99999999-2222-3333-4444-555555555555' })).status, 404);
    const pv = await A.post('/api/bank/preview', { item_id: ITEM }); ok(pv);
    assert.equal(pv.data.connector, 'Banco do Brasil'); assert.equal(pv.data.accounts.length, 2);
    assert.deepEqual(pv.data.accounts.map((a) => [a.kind, a.balance_cents]), [['checking', 44811], ['card', 12050]]);
    const link = await A.post('/api/bank/links', { item_id: ITEM, mappings: {} }); ok(link, 201);
    assert.equal(link.data.accounts.length, 2);
    assert.equal((await B.post('/api/bank/links', { item_id: ITEM, mappings: {} })).status, 409); // um Item ID só pode ter um dono
    const [cc, card] = link.data.accounts;
    // 1ª sincronização: importa 4 (o pendente fica de fora) e iguala o saldo ao do banco
    const s1 = await A.post(`/api/bank/accounts/${cc.id}/sync`); ok(s1);
    assert.equal(s1.data.imported, 4); assert.equal(s1.data.diff_cents, 0); assert.equal(s1.data.nexo_cents, 44811);
    const s2 = await A.post(`/api/bank/accounts/${cc.id}/sync`); ok(s2); assert.equal(s2.data.imported, 0); // sem duplicar
    const sc = await A.post(`/api/bank/accounts/${card.id}/sync`); ok(sc); assert.equal(sc.data.imported, 1);
    const st = await A.get('/api/bank'); ok(st);
    assert.equal(st.data.links[0].accounts.find((a) => a.kind === 'checking').diff_cents, 0);
    const rf = await A.post(`/api/bank/links/${link.data.link_id}/refresh`); ok(rf); assert.equal(rf.data.ok, true); assert.equal(calls.refresh, 1);
    assert.equal((await B.post(`/api/bank/links/${link.data.link_id}/refresh`)).status, 404);
    // categorias sugeridas por palavras-chave; o resto fica sem categoria para revisão
    const txs = (await A.get('/api/transactions?scope=personal&limit=100')).data.transactions;
    const by = (d) => txs.find((t) => t.description === d);
    assert.equal(by('MERCADO BOM PRECO').category_name, 'Alimentação'); assert.equal(by('MERCADO BOM PRECO').amount_cents, 3590); assert.equal(by('MERCADO BOM PRECO').type, 'expense');
    assert.equal(by('UBER *TRIP').category_name, 'Transporte');
    assert.equal(by('SALARIO EMPRESA').type, 'income'); assert.equal(by('SALARIO EMPRESA').category_name, 'Salário');
    assert.equal(by('PIX ENVIADO FULANO').category_name, null);
    // movimentação nova no banco: importa 1; saldo do banco não bate até o usuário ajustar
    state.v2 = false; // a API nova fica fora do ar: cai para a antiga
    state.extra.push({ id: 't6', description: 'PADARIA', amount: -12.3, type: 'DEBIT', date: today + 'T00:00:00.000Z', status: 'POSTED' });
    pushCalls.length = 0;
    const s3 = await A.post(`/api/bank/accounts/${cc.id}/sync`); ok(s3); assert.equal(s3.data.imported, 1); assert.equal(s3.data.diff_cents, 1230);
    const bp = pushCalls.find((c) => c.title.includes('Banco do Brasil')); assert.ok(bp, 'aviso de movimentação nova do banco'); assert.ok(bp.body.includes('12,30') && bp.body.includes('PADARIA'));
    const cal = await A.post(`/api/bank/accounts/${cc.id}/calibrate`); ok(cal); assert.equal(cal.data.diff_cents, 0); assert.equal(cal.data.nexo_cents, 44811);
    assert.equal((await A.post(`/api/bank/accounts/${card.id}/calibrate`)).status, 400);
    // isolamento: B não enxerga nem sincroniza o banco de A
    assert.deepEqual((await B.get('/api/bank')).data.links, []);
    assert.equal((await B.post(`/api/bank/accounts/${cc.id}/sync`)).status, 404);
    assert.equal((await B.del(`/api/bank/links/${link.data.link_id}`)).status, 404);
    // ajuste manual de saldo (conta sem banco)
    const L = (await A.get('/api/lookups?scope=personal')).data;
    const manual = L.accounts.find((a) => a.type !== 'card' && a.id !== cc.account_id && !st.data.links[0].accounts.some((x) => x.account_id === a.id));
    const adj = await A.post(`/api/accounts/${manual.id}/adjust-balance`, { balance_cents: 100000 }); ok(adj);
    assert.equal((await A.get('/api/accounts?scope=personal')).data.accounts.find((a) => a.id === manual.id).balance_cents, 100000);
    assert.equal((await B.post(`/api/accounts/${manual.id}/adjust-balance`, { balance_cents: 1 })).status, 404);
    // desconectar mantém os lançamentos importados
    const n0 = (await A.get('/api/transactions?scope=personal')).data.count;
    ok(await A.del(`/api/bank/links/${link.data.link_id}`));
    assert.equal((await A.get('/api/transactions?scope=personal')).data.count, n0);
    assert.deepEqual((await A.get('/api/bank')).data.links, []);
  } finally {
    mock.close(); delete process.env.PLUGGY_CLIENT_ID; delete process.env.PLUGGY_CLIENT_SECRET; delete process.env.PLUGGY_BASE_URL;
  }
});

test('perfil, sessões, auditoria e exclusão de conta preservando o casal', async () => {
  ok(await A.patch('/api/profile', { name: 'Ana Maria' }));
  const s = await A.get('/api/profile/sessions'); ok(s); assert.ok(s.data.sessions.some((x) => x.current));
  assert.equal((await A.post('/api/profile/password', { current: 'errada', password: 'novasenha123' })).status, 400);
  const audit = await q.all("SELECT action FROM audit_log WHERE action LIKE 'transaction.%'"); assert.ok(audit.length >= 5);
  assert.equal((await A.post('/api/profile/delete', { password: 'errada123' })).status, 400);
  ok(await A.post('/api/profile/delete', { password: 'senha1234' }));
  assert.equal((await A.get('/api/auth/me')).status, 401);
  const couple = (await B.get('/api/couple')).data.couple; assert.ok(couple); assert.equal(couple.members.length, 1); assert.equal(couple.role, 'owner');
  assert.equal((await B.get('/api/transactions?scope=couple')).data.count, 1); // dados do casal permanecem com o parceiro
  assert.equal((await B.get('/api/goals?scope=couple')).data.goals[0].current_cents, 200000);
  assert.equal((await q.get("SELECT COUNT(*) AS n FROM users WHERE email='ana@teste.com'")).n, 0);
});

test('estáticos: SPA, cabeçalhos de segurança e bloqueio de path traversal', async () => {
  const r = await fetch(base + '/'); assert.ok([200, 404].includes(r.status));
  assert.ok((r.headers.get('content-security-policy') || '').includes("default-src 'self'"));
  const t = await fetch(base + '/..%2f..%2fetc%2fpasswd'); assert.notEqual(t.status, 200);
  assert.equal((await fetch(base + '/api/inexistente')).status, 404);
});
