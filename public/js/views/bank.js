// Bancos conectados (Pluggy / Open Finance, somente leitura) e ajuste de saldo.
import {
  h, icon, GET, POST, DEL, bus, toast, errMsg, busy, formError, field, textInput, select, moneyInput, openSheet, confirmDialog, brl, timeAgo, iconBadge, S,
} from '../ui.js';

const KIND = { checking: 'Conta corrente', savings: 'Poupança', card: 'Cartão' };

const diffNote = (a) => {
  if (a.kind === 'card' || a.diff_cents == null) return null;
  if (a.diff_cents === 0) return h('span', { class: 'small pos' }, '✓ Saldo confere com o banco');
  return h('span', { class: 'small neg' }, `Diferença: o banco mostra ${brl(a.bank_balance_cents)} e o NEXO ${brl(a.nexo_balance_cents)}`);
};

async function syncOne(id) { return POST('/bank/accounts/' + id + '/sync'); }

export function bankSheet() {
  openSheet('Bancos conectados', (close) => {
    const box = h('div', { class: 'stack' }, h('div', { class: 'muted small' }, 'Carregando…'));

    async function load() {
      let r;
      try { r = await GET('/bank'); } catch (e) { box.replaceChildren(h('div', { class: 'alert bad' }, errMsg(e))); return; }
      const kids = [];
      kids.push(h('div', { class: 'alert info' }, icon('lock', 18), 'Somente leitura: o NEXO consulta saldos e extratos, mas nunca movimenta dinheiro.'));
      if (!r.configured) kids.push(h('div', { class: 'alert bad' }, 'O servidor ainda não tem as chaves do Pluggy (PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET).'));
      for (const l of r.links) {
        kids.push(h('div', { class: 'card flat pad-sm stack' },
          h('div', { class: 'row' }, iconBadge('bank', '#4cc9f0'), h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, l.connector || 'Banco'),
            h('div', { class: 'small muted' }, l.last_sync_at ? 'Atualizado ' + timeAgo(l.last_sync_at) : 'Ainda não sincronizado'))),
          l.last_error ? h('div', { class: 'small neg' }, l.last_error) : null,
          ...l.accounts.map((a) => h('div', { class: 'stack', style: { gap: '4px' } },
            h('div', { class: 'row' }, h('span', { class: 'grow' }, `${a.name} · ${KIND[a.kind]}`), a.bank_balance_cents != null && a.kind !== 'card' ? h('b', null, brl(a.bank_balance_cents)) : null),
            h('div', { class: 'small muted' }, 'Importando para: ' + (a.account_name || '—') + (a.account_name ? (a.account_scope === 'couple' ? ' (Casal)' : ' (Pessoal)') : '')),
            diffNote(a),
            a.diff_cents ? h('button', { class: 'btn sm', type: 'button', onclick: async (e) => {
              if (!(await confirmDialog({ title: 'Ajustar ao saldo do banco?', text: `O saldo inicial de "${a.account_name}" será corrigido em ${brl(a.diff_cents)} para o NEXO mostrar ${brl(a.bank_balance_cents)}. Nenhum lançamento é criado ou apagado.`, confirm: 'Ajustar' }))) return;
              await busy(e.currentTarget, async () => { await POST('/bank/accounts/' + a.id + '/calibrate'); toast('Saldo ajustado'); bus.emit('change'); await load(); });
            } }, 'Ajustar ao saldo do banco') : null)),
          h('div', { class: 'row' },
            h('button', { class: 'btn grow', type: 'button', onclick: async (e) => {
              await busy(e.currentTarget, async () => {
                let n = 0, st = null;
                try { st = await POST('/bank/links/' + l.id + '/refresh'); } catch {}
                for (const a of l.accounts) { const s = await syncOne(a.id); n += s.imported; }
                toast(n ? `${n} nova(s) movimentação(ões) importada(s)` : st && st.status === 'UPDATING' ? 'O banco ainda está atualizando. Tente de novo em 1 minuto.' : st && st.ok === false ? 'Nada novo. O banco não aceitou atualizar agora; ele atualiza sozinho de tempos em tempos.' : 'Tudo em dia, nada novo'); bus.emit('change'); await load();
              });
            } }, icon('repeat', 16), 'Atualizar agora'),
            h('button', { class: 'btn danger-ghost', type: 'button', onclick: async () => {
              if (!(await confirmDialog({ title: 'Desconectar banco?', text: 'Param de chegar novos lançamentos deste banco.', confirm: 'Continuar', danger: true }))) return;
              const purge = await confirmDialog({ title: 'Apagar também o que foi importado?', text: 'Apaga os lançamentos que vieram deste banco e as contas que ficarem vazias. Lançamentos feitos por você manualmente são mantidos.', confirm: 'Apagar tudo do banco', cancel: 'Manter lançamentos', danger: true });
              try { const r = await DEL('/bank/links/' + l.id + (purge ? '?purge=1' : '')); toast(purge ? `Banco desconectado (${r.removed} lançamentos apagados)` : 'Banco desconectado'); bus.emit('change'); await load(); } catch (e2) { toast(errMsg(e2), 'err'); }
            } }, icon('trash', 16)))));
      }
      if (S.couple && r.links.some((l) => l.accounts.some((a) => a.account_scope === 'personal'))) {
        kids.push(h('button', { class: 'btn block', type: 'button', onclick: async (e) => {
          await busy(e.currentTarget, async () => {
            try { const x = await POST('/bank/share-all'); toast(x.failed.length ? `${x.moved} compartilhada(s). Falhou: ${x.failed[0]}` : `${x.moved} conta(s) compartilhada(s) com o casal`, x.failed.length ? 'err' : 'ok'); bus.emit('change'); await load(); } catch (e2) { toast(errMsg(e2), 'err'); }
          });
        } }, icon('heart', 16), 'Compartilhar todas as contas do banco com o casal'));
      }
      if (r.links.length) {
        let url = null; try { url = (await GET('/bank/webhook-url')).url; } catch { /* ignora */ }
        if (url) kids.push(h('div', { class: 'card flat pad-sm stack' },
          h('div', { style: { fontWeight: 600 } }, 'Aviso instantâneo (recomendado)'),
          h('div', { class: 'small muted' }, 'No site do Pluggy: sua Aplicação → Webhooks → adicione esta URL, marcando os eventos "item/updated" e "transactions/created". Assim cada movimentação chega em segundos.'),
          h('button', { class: 'btn sm', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(url); toast('URL copiada'); } catch { toast('Não consegui copiar', 'err'); } } }, icon('download', 16), 'Copiar URL do webhook')));
      }
      if (r.configured) kids.push(connectForm());
      box.replaceChildren(...kids);
    }

    function connectForm() {
      const input = textInput({ placeholder: 'Cole aqui o Item ID', autocapitalize: 'off', spellcheck: false });
      const err = formError();
      const btn = h('button', { class: 'btn primary block', type: 'button' }, 'Continuar');
      const wrap = h('div', { class: 'stack' },
        h('div', { style: { fontWeight: 600 } }, 'Conectar um banco'),
        h('ol', { class: 'small muted', style: { paddingLeft: '18px', margin: 0, display: 'grid', gap: '4px' } },
          h('li', null, 'Conecte o banco no meu.pluggy.ai.'),
          h('li', null, 'No dashboard.pluggy.ai, abra a aplicação e toque em Iniciar Demo; autorize o MeuPluggy daquele banco.'),
          h('li', null, 'No menu ⋮ do demo, toque em "Copiar Item ID" e cole abaixo. Um Item ID por banco.')),
        field('Item ID', input), err, btn);
      btn.onclick = () => busy(btn, async () => {
        const p = await POST('/bank/preview', { item_id: input.value });
        wrap.replaceChildren(mapForm(input.value.trim(), p));
      }, err);
      return wrap;
    }

    function mapForm(itemId, p) {
      const err = formError();
      const btn = h('button', { class: 'btn primary block', type: 'button' }, 'Conectar e importar');
      const selects = p.accounts.map((a) => {
        const opts = [{ v: '', l: 'Criar conta nova no NEXO' }, ...p.my_accounts.filter((m) => (m.type === 'card') === (a.kind === 'card')).map((m) => ({ v: m.id, l: 'Usar: ' + m.name })), { v: 'skip', l: 'Não importar' }];
        return [a, select(opts, '')];
      });
      const wrap = h('div', { class: 'stack' },
        h('div', { style: { fontWeight: 600 } }, `${p.connector}: ${p.accounts.length} conta(s) encontrada(s)`),
        h('div', { class: 'small muted' }, 'Se você já cadastrou essa conta no NEXO, escolha "Usar" para não duplicar. O saldo será ajustado para ficar igual ao do banco; os últimos 90 dias de lançamentos são importados.'),
        ...selects.map(([a, sel]) => field(`${a.name} · ${KIND[a.kind]}${a.kind !== 'card' && a.balance_cents != null ? ' · ' + brl(a.balance_cents) : ''}`, sel)),
        err, btn);
      btn.onclick = () => busy(btn, async () => {
        const mappings = {}; selects.forEach(([a, sel]) => { mappings[a.pluggy_id] = sel.value === '' ? null : sel.value === 'skip' ? 'skip' : Number(sel.value); });
        const r = await POST('/bank/links', { item_id: itemId, mappings });
        let total = 0;
        for (const a of r.accounts) { btn.textContent = `Importando… (${a.name})`; const s = await syncOne(a.id); total += s.imported; }
        toast(`Banco conectado: ${total} movimentação(ões) importada(s)`); bus.emit('change'); await load();
      }, err);
      return wrap;
    }

    load();
    return box;
  });
}

// Ajuste manual do saldo de uma conta (para contas sem banco conectado).
export function adjustBalanceSheet(a) {
  openSheet('Ajustar saldo', (close) => {
    const cur = a.balance_cents || 0;
    const m = moneyInput({ cents: Math.abs(cur), label: 'Saldo real' });
    const neg = h('input', { type: 'checkbox', checked: cur < 0, id: 'adjneg' });
    const err = formError(); const btn = h('button', { class: 'btn primary block', type: 'button' }, 'Ajustar');
    btn.onclick = () => busy(btn, async () => {
      const target = neg.checked ? -m.get() : m.get();
      const r = await POST('/accounts/' + a.id + '/adjust-balance', { balance_cents: target });
      toast(r.delta_cents ? 'Saldo ajustado' : 'O saldo já estava certo'); bus.emit('change'); close();
    }, err);
    return h('div', { class: 'stack' },
      h('div', { class: 'small muted' }, `Informe quanto há de verdade em "${a.name}" agora. O NEXO corrige o saldo inicial para bater com esse valor; seus lançamentos não mudam.`),
      field('Saldo real hoje', m.el), h('label', { class: 'row small muted', for: 'adjneg' }, neg, 'Saldo negativo'), err, btn);
  });
}
