# NEXO — Juntos, mais longe.

Gestão financeira pessoal e em casal. Frontend em JS puro (PWA), API em Node servida por **Netlify Functions**, banco **PostgreSQL (Supabase)**.

## Publicar na Netlify + Supabase (grátis)

**1. Supabase (banco)**
1. Em supabase.com crie um projeto (guarde a *senha do banco*).
2. Vá em **Project Settings → Database → Connection string** e escolha **Transaction pooler** (porta **6543**). Copie a URL e troque `[YOUR-PASSWORD]` pela senha.
3. Nada de SQL manual: o app cria as tabelas sozinho no primeiro acesso. (Se preferir, rode `db/schema.sql` no *SQL Editor* — só em banco vazio.)

**2. Netlify (site + API)**
1. *Add new site → Import an existing project* → escolha este repositório do GitHub. O `netlify.toml` já configura tudo (publica `public/`, API em `netlify/functions/`).
2. Em **Site configuration → Environment variables** crie:
   - `DATABASE_URL` = a URL do passo 1.2 (obrigatória)
   - `APP_URL` = `https://SEU-SITE.netlify.app` (ou seu domínio)
   - opcionais: `RESEND_API_KEY` + `MAIL_FROM` (e-mail de recuperação de senha), e uma chave de IA (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`…).
3. **Deploy**. Abra o site e crie sua conta.

A função agendada `jobs` roda a cada hora (lançamentos recorrentes, alertas de vencimento/metas e limpeza).

### Limites do plano gratuito
- **Supabase free** pausa o projeto após ~1 semana sem uso (basta clicar em *Restore*; os dados ficam).
- **Netlify free**: 125 mil chamadas de função/mês e ~10 s por chamada. O app atualiza por *polling* (a cada 15 s; 3 s no chat) só com a aba aberta.
- A resposta da IA externa tem limite de 8 s; se estourar, o assistente responde em modo local.

## Rodar local
```bash
npm install
npm start     # http://localhost:3000 — usa Postgres embutido (PGlite) em ./data/pglite
npm test      # 18 testes de API (auth, isolamento, saldos, cofre, investimentos, IA…)
TEST_DATABASE_URL=postgres://... DATABASE_SSL=0 npm test   # mesmos testes num Postgres de verdade
```
Com `DATABASE_URL` definida, o servidor local usa esse Postgres.

## Segurança
- Login/sessão próprios (cookie HttpOnly, hash scrypt); o Supabase é usado só como banco.
- Todas as tabelas têm **RLS ligado e sem políticas**: a API pública do Supabase (chave `anon`) não lê nada. Não use a `anon key` neste projeto.
- Isolamento pessoal/casal, auditoria, idempotência e limite de tentativas no servidor.

## Estrutura
`server/` regras e rotas (`handler.js` é o núcleo HTTP, `db.js` o acesso ao Postgres) · `netlify/functions/` `api.mjs` e `jobs.mjs` · `db/schema.sql` esquema · `public/` PWA.
