// Assistente financeiro: arquitetura multi-provedor (chaves apenas em variáveis de ambiente, nunca no frontend).
//
// Variáveis de ambiente:
//   AI_PROVIDER            ordem de preferência, separada por vírgula (padrão: anthropic,openai,gemini,groq,openrouter)
//   ANTHROPIC_API_KEY / ANTHROPIC_MODEL (padrão claude-sonnet-4-5)
//   OPENAI_API_KEY    / OPENAI_MODEL    (padrão gpt-4o-mini)         — OPENAI_BASE_URL opcional
//   GEMINI_API_KEY    / GEMINI_MODEL    (padrão gemini-2.0-flash)
//   GROQ_API_KEY      / GROQ_MODEL      (padrão llama-3.3-70b-versatile)
//   OPENROUTER_API_KEY/ OPENROUTER_MODEL(padrão openai/gpt-4o-mini)
// Sem nenhuma chave, o assistente responde em "modo local" usando apenas cálculos determinísticos sobre os dados reais.
import { q } from './db.js';
import { scopeSql } from './core.js';
import { todayISO, addMonths, monthStart, monthEnd } from './lib.js';
import { brl, balanceSummary, sums, byCategory, monthlySeries, vaultsSummary, investmentsSummary, goalsWithProgress, budgetStatus, pendingBills, recentTransactions } from './calc.js';
import { computeInsights } from './insights.js';

const T = Number(process.env.AI_TIMEOUT_MS) || 8_000; // funções da Netlify têm limite de ~10s no plano gratuito
const T_VISION = Number(process.env.VISION_TIMEOUT_MS) || 9_000;
const env = (k) => process.env[k] || '';

const PROVIDERS = {
  anthropic: {
    configured: () => !!env('ANTHROPIC_API_KEY'),
    model: () => env('ANTHROPIC_MODEL') || 'claude-sonnet-4-5',
    vision: true,
    async call({ system, messages, image, timeout = T, maxTokens = 1200 }) {
      const msgs = image ? withImage(messages, (m) => [{ type: 'image', source: { type: 'base64', media_type: image.mime, data: image.b64 } }, { type: 'text', text: m.content }]) : messages;
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: AbortSignal.timeout(timeout),
        headers: { 'x-api-key': env('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.model(), max_tokens: maxTokens, system, messages: msgs }),
      });
      if (!r.ok) throw new Error(`anthropic ${r.status}`);
      const j = await r.json();
      return (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
    },
  },
  openai: openaiLike('OPENAI', 'gpt-4o-mini', () => env('OPENAI_BASE_URL') || 'https://api.openai.com/v1'),
  groq: openaiLike('GROQ', 'llama-3.3-70b-versatile', () => 'https://api.groq.com/openai/v1', 'meta-llama/llama-4-scout-17b-16e-instruct'),
  openrouter: openaiLike('OPENROUTER', 'openai/gpt-4o-mini', () => 'https://openrouter.ai/api/v1'),
  gemini: {
    configured: () => !!env('GEMINI_API_KEY'),
    model: () => env('GEMINI_MODEL') || 'gemini-2.5-flash',
    vision: true,
    async call({ system, messages, image, timeout = T, maxTokens = 1200, json = false }) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model())}:generateContent`, {
        method: 'POST', signal: AbortSignal.timeout(timeout),
        headers: { 'x-goog-api-key': env('GEMINI_API_KEY'), 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map((m, i) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: image && i === messages.length - 1 ? [{ text: m.content }, { inline_data: { mime_type: image.mime, data: image.b64 } }] : [{ text: m.content }] })),
          generationConfig: { maxOutputTokens: maxTokens, ...(json ? { responseMimeType: 'application/json' } : {}) },
        }),
      });
      if (!r.ok) throw new Error(`gemini ${r.status}`);
      const j = await r.json();
      return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
    },
  },
};

function withImage(messages, build) {
  return messages.map((m, i) => (i === messages.length - 1 ? { ...m, content: build(m) } : m));
}

function openaiLike(prefix, defModel, base, visionModel) {
  return {
    configured: () => !!env(prefix + '_API_KEY'),
    model: () => env(prefix + '_MODEL') || defModel,
    vision: true,
    async call({ system, messages, image, timeout = T, maxTokens = 1200 }) {
      const model = image && visionModel ? (env(prefix + '_VISION_MODEL') || visionModel) : this.model();
      const msgs = image ? withImage(messages, (m) => [{ type: 'text', text: m.content }, { type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.b64}` } }]) : messages;
      const r = await fetch(base() + '/chat/completions', {
        method: 'POST', signal: AbortSignal.timeout(timeout),
        headers: { Authorization: `Bearer ${env(prefix + '_API_KEY')}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, ...msgs] }),
      });
      if (!r.ok) throw new Error(`${prefix.toLowerCase()} ${r.status}`);
      const j = await r.json();
      return (j.choices?.[0]?.message?.content || '').trim();
    },
  };
}

export function providerOrder() {
  const wanted = (env('AI_PROVIDER') || 'anthropic,openai,gemini,groq,openrouter').split(',').map((s) => s.trim().toLowerCase()).filter((s) => PROVIDERS[s]);
  return wanted.filter((p) => PROVIDERS[p].configured());
}
export function aiStatus() {
  const order = providerOrder();
  return { configured: order.length > 0, providers: order, active: order[0] || 'local', mode: order.length ? 'external' : 'local' };
}

// ---------- contexto com dados autorizados ----------
export async function buildContext(ctx, scope, today = todayISO()) {
  const from = monthStart(today), to = monthEnd(today), pFrom = monthStart(addMonths(today, -1)), pTo = monthEnd(addMonths(today, -1));
  const bal = await balanceSummary(ctx, scope);
  const names = new Map((await q.all('SELECT id, name FROM users WHERE id IN (SELECT user_id FROM couple_members WHERE couple_id=? UNION SELECT ?)', ctx.coupleId ?? 0, ctx.userId)).map((u) => [u.id, u.name]));
  const label = (s) => (s === 'couple' ? 'casal' : 'pessoal');
  const goals = await goalsWithProgress(ctx, scope, today);
  const inv = await investmentsSummary(ctx, scope);
  const catSql = scopeSql(ctx, scope);
  const cats = await q.all(`SELECT DISTINCT name, kind FROM categories WHERE ${catSql.sql} ORDER BY name`, ...catSql.params);
  const vlt = await vaultsSummary(ctx, scope);
  return {
    categorias_despesa: cats.filter((c) => c.kind === 'expense').map((c) => c.name), categorias_receita: cats.filter((c) => c.kind === 'income').map((c) => c.name),
    hoje: today, ambiente_consultado: scope === 'all' ? 'pessoal + casal (cada item identificado)' : label(scope), usuario: ctx.user.name,
    parceiro: ctx.coupleId ? [...names.values()].filter((n) => n !== ctx.user.name) : null,
    contas: bal.accounts.map((a) => ({ nome: a.name, tipo: a.type, ambiente: label(a.scope), saldo: brl(a.balance_cents) })),
    saldo_total_sem_cartoes: brl(bal.total_cents), faturas_abertas_cartoes: brl(bal.card_debt_cents),
    mes_atual: { receitas: brl((await sums(ctx, scope, from, to)).income), despesas: brl((await sums(ctx, scope, from, to)).expense), gastos_por_categoria: (await byCategory(ctx, scope, from, to)).slice(0, 10).map((c) => ({ categoria: c.name, total: brl(c.total) })) },
    mes_anterior: { receitas: brl((await sums(ctx, scope, pFrom, pTo)).income), despesas: brl((await sums(ctx, scope, pFrom, pTo)).expense), gastos_por_categoria: (await byCategory(ctx, scope, pFrom, pTo)).slice(0, 10).map((c) => ({ categoria: c.name, total: brl(c.total) })) },
    ultimos_6_meses: (await monthlySeries(ctx, scope, today, 6)).map((m) => ({ mes: m.month, receitas: brl(m.income), despesas: brl(m.expense) })),
    orcamentos: (await budgetStatus(ctx, scope, today)).map((b) => ({ categoria: b.category_name, limite: brl(b.limit_cents), gasto: brl(b.spent_cents), ambiente: label(b.scope) })),
    cofres: vlt.items.map((c) => ({ nome: c.name, ambiente: label(c.scope), saldo: brl(c.balance_cents), objetivo: c.target_cents ? brl(c.target_cents) : null })),
    metas: goals.map((g) => ({ nome: g.name, ambiente: label(g.scope), atual: brl(g.current_cents), alvo: brl(g.target_cents), prazo: g.deadline, necessario_por_mes: g.per_month_cents ? brl(g.per_month_cents) : null })),
    investimentos: { investido: brl(inv.invested_cents), valor_atual: brl(inv.value_cents), apenas_planejado: brl(inv.planned_cents),
      itens: inv.items.map((i) => ({ nome: i.name, ambiente: label(i.scope), situacao: i.status === 'planned' ? 'planejado' : 'realizado', tipo: i.asset_type, valor_atual: brl(i.value_cents), planejado: i.planned_cents ? brl(i.planned_cents) : null })) },
    contas_a_pagar: (async () => { const b = await pendingBills(ctx, scope, today, 30); return { vencidas: b.overdue.slice(0, 10).map((x) => ({ desc: x.description, valor: brl(x.amount_cents), data: x.date })), proximos_30_dias: b.upcoming.slice(0, 10).map((x) => ({ desc: x.description, valor: brl(x.amount_cents), data: x.date })) }; })(),
    ultimas_movimentacoes: (await recentTransactions(ctx, scope, 25)).map((t) => ({ data: t.date, descricao: t.description, tipo: t.type, valor: brl(t.amount_cents), categoria: t.category_name, conta: t.account_name, ambiente: label(t.scope), quem: names.get(t.user_id) })),
    analises_calculadas: (await computeInsights(ctx, scope, today)).map((i) => `${i.title}: ${i.text}`),
  };
}

export const SYSTEM_PROMPT = `Você é o assistente financeiro do NEXO, um app de finanças pessoais e em casal. Responda sempre em português do Brasil, de forma clara, acolhedora e objetiva.
REGRAS OBRIGATÓRIAS:
- Use SOMENTE os dados do bloco DADOS abaixo. Nunca invente movimentações, saldos, categorias, valores ou resultados. Se um dado não estiver em DADOS, diga que não há essa informação registrada.
- Valores já estão formatados em R$. Faça contas com cuidado e mostre o cálculo quando útil.
- Diferencie claramente o que é "pessoal" do que é do "casal". Nunca revele dados pessoais do parceiro: os DADOS contêm apenas o que o usuário pode ver.
- Dê sugestões práticas e específicas (onde cortar, quanto guardar por mês, prioridade das metas), sem prometer rentabilidade nem recomendar ativos específicos. Você não substitui um profissional certificado.
- Seja conciso: no máximo ~180 palavras, listas curtas quando ajudarem.
REGISTRAR MOVIMENTAÇÕES:
- Quando o usuário pedir para registrar/lançar/anotar uma despesa ou receita (ex.: "registre 50 reais de mercado", "recebi 3000 de salário"), responda SOMENTE com um JSON puro, sem texto fora dele e sem crases:
{"acao":"registrar","itens":[{"tipo":"despesa","descricao":"Mercado","valor":50.00,"categoria":"nome exato de uma categoria da lista, ou null","conta":"nome de uma conta de DADOS, ou null","data":"YYYY-MM-DD ou null","situacao":"pago"}],"mensagem":"Entendi: despesa de R$ 50,00 em Mercado."}
- "tipo" é "despesa" ou "receita"; "valor" é número em reais (ponto decimal); "situacao" é "pago" ou "pendente" (pendente se o usuário disser que ainda vai pagar/receber). Use a data de hoje se o usuário não disser outra ("ontem" = hoje menos 1 dia). Escolha "categoria" apenas dentre categorias_despesa/categorias_receita; se nenhuma servir, use null.
- Se faltar o valor, pergunte o valor em texto normal. NUNCA diga que já registrou: o app mostra ao usuário um botão para confirmar e escolher Pessoal ou Casal. Você não edita nem apaga movimentações existentes.`;

// ---------- resposta local (sem provedor externo) ----------
async function localAnswer(ctx, scope, question) {
  const ins = await computeInsights(ctx, scope);
  const t = question.toLowerCase();
  const pick = (re) => ins.filter((i) => re.test(i.id));
  let chosen = ins;
  if (/meta|objetiv|sonho|viagem/.test(t)) chosen = pick(/^goal-|^reserve/);
  else if (/econom|cort|gast|desperd|categoria/.test(t)) chosen = pick(/^top-cat|^cat-up|^exp-vs-prev|^recurring|^budget/);
  else if (/poup|guard|sobr/.test(t)) chosen = pick(/^savings-rate|^idle|^reserve|^goal-/);
  else if (/vence|pagar|conta/.test(t)) chosen = pick(/^overdue|^upcoming/);
  if (!chosen.length) chosen = ins;
  const lines = chosen.slice(0, 5).map((i) => `• **${i.title}** — ${i.text}`);
  return `Estou no **modo local** (nenhum provedor de IA foi configurado no servidor), então respondo apenas com cálculos sobre os seus dados reais:\n\n${lines.join('\n')}\n\nPara conversar livremente com a IA, configure uma chave de API no servidor (ex.: ANTHROPIC_API_KEY).`;
}

// ---------- interpretar pedidos de registro ----------
const CENTS_MAX = 1_000_000_000_00;
function cleanItem(it, today) {
  if (!it || typeof it !== 'object') return null;
  const type = /receit|income|entrada/i.test(String(it.tipo ?? it.type)) ? 'income' : 'expense';
  const val = typeof it.valor === 'number' ? it.valor : parseBRL(it.valor ?? it.value);
  const cents = Math.round(val * 100);
  if (!Number.isFinite(cents) || cents <= 0 || cents > CENTS_MAX) return null;
  const description = String(it.descricao ?? it.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) || (type === 'income' ? 'Receita' : 'Despesa');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(it.data ?? it.date ?? '')) && !Number.isNaN(Date.parse(it.data ?? it.date)) ? String(it.data ?? it.date) : today;
  const status = /pend/i.test(String(it.situacao ?? it.status ?? '')) ? 'pending' : 'paid';
  const hint = (x) => (x == null || String(x).trim() === '' || /^null$/i.test(String(x)) ? null : String(x).trim().slice(0, 60));
  return { type, description, amount_cents: cents, date, status, category: hint(it.categoria ?? it.category), account: hint(it.conta ?? it.account) };
}
export function extractProposal(text, today = todayISO()) {
  if (!text || !text.includes('{')) return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j; try { j = JSON.parse(m[0]); } catch { return null; }
  if (!j || !/regist/i.test(String(j.acao ?? j.action ?? ''))) return null;
  const items = (Array.isArray(j.itens ?? j.items) ? (j.itens ?? j.items) : []).slice(0, 20).map((it) => cleanItem(it, today)).filter(Boolean);
  if (!items.length) return null;
  return { items, message: String(j.mensagem ?? j.message ?? '').slice(0, 300) };
}
export function parseBRL(x) {
  if (typeof x === 'number') return x;
  let t = String(x ?? '').replace(/[^\d.,-]/g, '');
  if (!t) return NaN;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  return parseFloat(t);
}
// Modo local: entende frases simples como "gastei 50 no mercado" ou "registre uma receita de 3.000 de salário".
export function parseLocalCommand(text, today = todayISO()) {
  const t = text.trim();
  if (/\?\s*$/.test(t) || /\b(quanto|qual|quais|como|onde|quando|por que|porque)\b/i.test(t)) return null;
  const verb = /\b(registr\w*|lan[cç]\w*|anot\w*|adicion\w*|cadastr\w*|gastei|paguei|comprei|recebi|ganhei)\b/i;
  if (!verb.test(t)) return null;
  const am = /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?:\s*(?:reais|real|conto|pila))?/i.exec(t);
  if (!am) return null;
  const val = parseBRL(am[1]);
  if (!Number.isFinite(val) || val <= 0) return null;
  const income = /\b(receita|recebi|ganhei|sal[aá]rio|renda|entrada|entrou)\b/i.test(t);
  let date = today;
  if (/\bontem\b/i.test(t)) date = addDaysISO(today, -1);
  let desc = t.replace(am[0], ' ').replace(verb, ' ').replace(/\b(uma?|nova|novo|despesa|receita|gasto|compra|pagamento|de|do|da|reais|real|r\$|hoje|ontem|por favor|pra|para|favor)\b/gi, ' ')
    .replace(/\b(no|na|em|com|num|numa)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  desc = desc ? desc.charAt(0).toUpperCase() + desc.slice(1) : (income ? 'Receita' : 'Despesa');
  const item = cleanItem({ tipo: income ? 'receita' : 'despesa', descricao: desc.slice(0, 120), valor: val, data: date, categoria: desc }, today);
  if (!item) return null;
  return { items: [item], message: `Entendi: ${income ? 'receita' : 'despesa'} de ${brl(item.amount_cents)} — ${item.description}.` };
}
function addDaysISO(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

export async function answer(ctx, scope, question, history) {
  const order = providerOrder();
  if (!order.length) {
    const p = parseLocalCommand(question);
    if (p) return { text: `${p.message}\n\nConfirme abaixo e escolha onde registrar.`, provider: 'local', proposal: p };
    return { text: await localAnswer(ctx, scope, question), provider: 'local' };
  }
  const data = await buildContext(ctx, scope);
  const system = `${SYSTEM_PROMPT}\n\nDADOS (JSON, ambiente: ${data.ambiente_consultado}):\n${JSON.stringify(data)}`;
  const messages = [...history.slice(-8).map((h) => ({ role: h.role, content: h.content })), { role: 'user', content: question }];
  let lastErr;
  for (const name of order) {
    try {
      const text = await PROVIDERS[name].call({ system, messages });
      if (text) {
        const proposal = extractProposal(text);
        if (proposal) return { text: `${proposal.message || 'Entendi o que você quer registrar.'}\n\nConfirme abaixo e escolha onde registrar.`, provider: name, proposal };
        return { text, provider: name };
      }
    } catch (e) { lastErr = e; console.error('[ia] provedor falhou:', e.message); }
  }
  return { text: await localAnswer(ctx, scope, question) + `\n\n_(Os provedores de IA configurados não responderam agora${lastErr ? '' : ''}.)_`, provider: 'local' };
}

// ---------- leitura de nota fiscal (visão) ----------
const RECEIPT_SYSTEM = `Você lê fotos ou PDFs de notas fiscais, cupons fiscais, recibos e comprovantes de pagamento brasileiros (Pix, transferência, TED, boleto, cartão). Extraia SOMENTE o que está legível na imagem; nunca invente itens ou valores.
Responda apenas com JSON puro (sem crases, sem texto fora do JSON) neste formato:
{"legivel":true,"loja":"nome do estabelecimento ou null","data":"YYYY-MM-DD ou null","total":valor total pago em reais (número) ou null,"itens":[{"descricao":"nome curto do item","valor":valor total da linha em reais (quantidade x preço unitário),"categoria":"uma das categorias informadas ou null"}]}
Regras: em comprovante de pagamento/Pix/transferência/boleto, use "loja" = quem recebeu (nome do recebedor/beneficiário), "data" = data do pagamento, "total" = valor pago e UM único item com descricao curta (ex.: "Pix para Fulano" ou "Boleto Energia") e esse mesmo valor; valores com ponto decimal (12.5); descontos não viram item (use o valor já com desconto da linha, se houver); ignore subtotal, troco, impostos e formas de pagamento; se a imagem não for uma nota/cupom ou estiver ilegível, responda {"legivel":false,"itens":[]}. Junte itens repetidos idênticos em uma linha somando o valor. Máximo 40 itens.`;

export function visionProviders() { return providerOrder().filter((p) => PROVIDERS[p].vision); }

export async function readReceipt(ctx, image, today = todayISO()) {
  // PDF só é aceito por provedores que leem PDF direto (Gemini)
  const order = visionProviders().filter((p) => image.mime !== 'application/pdf' || p === 'gemini');
  if (!order.length) return { unavailable: true };
  const cs = scopeSql(ctx, 'all');
  const cats = (await q.all(`SELECT DISTINCT name FROM categories WHERE ${cs.sql} AND kind='expense' ORDER BY name`, ...cs.params)).map((c) => c.name);
  const messages = [{ role: 'user', content: `Categorias de despesa disponíveis: ${JSON.stringify(cats)}\nHoje é ${today}. Leia a nota fiscal da imagem.` }];
  let lastErr;
  for (const name of order) {
    try {
      const raw = await PROVIDERS[name].call({ system: RECEIPT_SYSTEM, messages, image, timeout: T_VISION, maxTokens: 2500, json: true });
      const m = raw && raw.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('resposta sem JSON');
      const j = JSON.parse(m[0]);
      return { ...normalizeReceipt(j, today), provider: name };
    } catch (e) { lastErr = e; console.error('[ia/nota] provedor falhou:', name, e.message); }
  }
  return { failed: true, error: lastErr?.message };
}

export function normalizeReceipt(j, today = todayISO()) {
  if (!j || j.legivel === false) return { readable: false, items: [] };
  const items = (Array.isArray(j.itens) ? j.itens : []).slice(0, 40).map((it) => {
    const val = typeof it.valor === 'number' ? it.valor : parseBRL(it.valor);
    const cents = Math.round(val * 100);
    if (!Number.isFinite(cents) || cents <= 0 || cents > CENTS_MAX) return null;
    const description = String(it.descricao ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!description) return null;
    const cat = it.categoria == null || /^null$/i.test(String(it.categoria)) ? null : String(it.categoria).slice(0, 60);
    return { description, amount_cents: cents, category: cat };
  }).filter(Boolean);
  const sum = items.reduce((a, b) => a + b.amount_cents, 0);
  const totalNum = j.total == null ? NaN : (typeof j.total === 'number' ? j.total : parseBRL(j.total));
  const total = Number.isFinite(totalNum) && totalNum > 0 ? Math.round(totalNum * 100) : null;
  const d = String(j.data ?? '');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) && d <= addDaysISO(today, 1) && d >= addDaysISO(today, -400) ? d : today;
  return {
    readable: items.length > 0, store: j.loja ? String(j.loja).slice(0, 80) : null, date,
    total_cents: total ?? (sum || null), items_sum_cents: sum, items,
  };
}
