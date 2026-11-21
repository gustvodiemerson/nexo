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

## IA que registra e leitura de nota fiscal
- **Pedir para registrar:** na tela da IA, escreva "gastei 35 no almoço" ou "recebi 3.000 de salário". A IA monta o lançamento, você confere e toca em **Pessoal** ou **Casal** (quem não tem casal vê um botão só). A IA nunca grava sozinha e não edita nem apaga nada.
- **Nota fiscal por foto:** em *Novo lançamento → Escanear nota fiscal* (ou no ícone de câmera da tela da IA). A IA lê loja, data, itens e valores; você revisa e registra tudo como despesas (item por item ou só o total).
- **Precisa de chave de IA com visão** nas variáveis da Netlify. A mais fácil: `GEMINI_API_KEY` (chave gratuita em aistudio.google.com). Também servem `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` ou `GROQ_API_KEY`. Sem chave, a IA registra só frases simples (modo local) e a leitura de nota fica indisponível.
- `VISION_TIMEOUT_MS` (padrão 9000) é o tempo máximo da leitura da nota; aumente se sua conta da Netlify permitir funções mais longas.

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

## Bancos conectados (Pluggy / MeuPluggy)

Somente leitura: o NEXO consulta saldos e extratos, nunca movimenta dinheiro.

1. Conecte o banco em **meu.pluggy.ai** (gratuito para uso pessoal).
2. Em **dashboard.pluggy.ai** crie/abra uma aplicação de desenvolvimento e guarde o Client ID e o Client Secret nas variáveis `PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET` (Netlify, "Contains secret values"). Refaça o deploy.
3. No dashboard, toque em **Iniciar Demo**, autorize o MeuPluggy do banco e, no menu ⋮, **Copiar Item ID** (um por banco).
4. No NEXO: **Finanças → Contas → Bancos conectados**, cole o Item ID, escolha para qual conta do NEXO cada conta do banco vai e conecte.

Como funciona: os últimos 90 dias são importados sem duplicar (cada lançamento guarda o id do banco), o saldo da conta é ajustado para igualar o do banco (muda só o saldo inicial) e uma rotina a cada hora atualiza as contas (cada uma a cada ~6 h). Lançamentos ainda pendentes no banco só entram quando efetivados. As categorias são sugeridas por palavras-chave; o que não for reconhecido fica "Sem categoria" para você revisar. Cartão: importa as compras; o saldo do cartão não é ajustado.

Também há **Ajustar saldo ao valor real** em qualquer conta sem banco conectado.
