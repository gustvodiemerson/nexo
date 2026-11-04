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
const env = (k) => process.env[k] || '';

const PROVIDERS = {
  anthropic: {
    configured: () => !!env('ANTHROPIC_API_KEY'),
    model: () => env('ANTHROPIC_MODEL') || 'claude-sonnet-4-5',
    async call({ system, messages }) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: AbortSignal.timeout(T),
        headers: { 'x-api-key': env('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.model(), max_tokens: 1200, system, messages }),
      });
      if (!r.ok) throw new Error(`anthropic ${r.status}`);
      const j = await r.json();
      return (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
    },
  },
  openai: openaiLike('OPENAI', 'gpt-4o-mini', () => env('OPENAI_BASE_URL') || 'https://api.openai.com/v1'),
  groq: openaiLike('GROQ', 'llama-3.3-70b-versatile', () => 'https://api.groq.com/openai/v1'),
  openrouter: openaiLike('OPENROUTER', 'openai/gpt-4o-mini', () => 'https://openrouter.ai/api/v1'),
  gemini: {
    configured: () => !!env('GEMINI_API_KEY'),
    model: () => env('GEMINI_MODEL') || 'gemini-2.0-flash',
    async call({ system, messages }) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model())}:generateContent`, {
        method: 'POST', signal: AbortSignal.timeout(T),
        headers: { 'x-goog-api-key': env('GEMINI_API_KEY'), 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
          generationConfig: { maxOutputTokens: 1200 },
        }),
      });
      if (!r.ok) throw new Error(`gemini ${r.status}`);
      const j = await r.json();
      return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
    },
  },
};

function openaiLike(prefix, defModel, base) {
  return {
    configured: () => !!env(prefix + '_API_KEY'),
    model: () => env(prefix + '_MODEL') || defModel,
    async call({ system, messages }) {
      const r = await fetch(base() + '/chat/completions', {
        method: 'POST', signal: AbortSignal.timeout(T),
        headers: { Authorization: `Bearer ${env(prefix + '_API_KEY')}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.model(), max_tokens: 1200, messages: [{ role: 'system', content: system }, ...messages] }),
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
  const vlt = await vaultsSummary(ctx, scope);
  return {
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
- Seja conciso: no máximo ~180 palavras, listas curtas quando ajudarem.`;

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

export async function answer(ctx, scope, question, history) {
  const order = providerOrder();
  if (!order.length) return { text: await localAnswer(ctx, scope, question), provider: 'local' };
  const data = await buildContext(ctx, scope);
  const system = `${SYSTEM_PROMPT}\n\nDADOS (JSON, ambiente: ${data.ambiente_consultado}):\n${JSON.stringify(data)}`;
  const messages = [...history.slice(-8).map((h) => ({ role: h.role, content: h.content })), { role: 'user', content: question }];
  let lastErr;
  for (const name of order) {
    try {
      const text = await PROVIDERS[name].call({ system, messages });
      if (text) return { text, provider: name };
    } catch (e) { lastErr = e; console.error('[ia] provedor falhou:', e.message); }
  }
  return { text: await localAnswer(ctx, scope, question) + `\n\n_(Os provedores de IA configurados não responderam agora${lastErr ? '' : ''}.)_`, provider: 'local' };
}
