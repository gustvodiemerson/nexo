# NEXO — Juntos, mais longe.

Gestão financeira pessoal e em casal. Node ≥ 22.5, **sem dependências externas** (SQLite nativo, servidor HTTP próprio, frontend em JS puro / PWA).

## Rodar
```bash
npm start            # http://localhost:3000
npm test             # 18 testes de API (auth, isolamento, saldos, cofre, investimentos, IA…)
```
O banco SQLite fica em `data/nexo.db` (`DATA_DIR` para mudar). Em produção use volume persistente e `NODE_ENV=production`, `TRUST_PROXY=1` atrás de HTTPS. Veja `.env.example`.

## O que depende de configuração
- **IA externa**: defina ao menos uma chave (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`). Sem chave, o assistente responde em *modo local* (cálculos sobre seus dados reais).
- **E-mail de recuperação de senha**: `RESEND_API_KEY` + `MAIL_FROM`. Sem isso, em desenvolvimento o link aparece na própria tela.
- **Instalação como app**: exige HTTPS (ou localhost). Android/Chrome oferece “Instalar”; no iPhone use Compartilhar → Adicionar à Tela de Início.

## Estrutura
`server/` API + regras (isolamento por escopo pessoal/casal, auditoria, idempotência) · `public/` PWA (`js/app.js` roteador, `js/views/*` telas, `js/charts.js` gráficos SVG).
