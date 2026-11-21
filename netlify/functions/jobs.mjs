// Rotina agendada (a cada 10 min): atualiza os bancos conectados e, uma vez por hora, recorrências, alertas e limpeza.
import { q } from '../../server/db.js';
import { runGlobalJobs } from '../../server/jobs.js';
import { rateCleanup } from '../../server/lib.js';
import { eventsCleanup } from '../../server/core.js';

export default async () => {
  const { syncAllBanks } = await import('../../server/bank.js');
  try { await syncAllBanks(); } catch (e) { console.error('sync bancário falhou', e.message); }
  if (new Date().getUTCMinutes() < 10) { // uma execução por hora
    await runGlobalJobs();
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    await q.run('DELETE FROM sessions WHERE expires_at<?', now);
    await q.run('DELETE FROM password_resets WHERE expires_at<?', now);
    await rateCleanup(); await eventsCleanup();
  }
  return new Response('ok');
};

export const config = { schedule: '*/10 * * * *' };
