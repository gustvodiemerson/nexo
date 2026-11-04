// Rotinas agendadas (a cada hora): recorrências, alertas de vencimento/metas e limpeza.
import { q } from '../../server/db.js';
import { runGlobalJobs } from '../../server/jobs.js';
import { rateCleanup } from '../../server/lib.js';
import { eventsCleanup } from '../../server/core.js';

export default async () => {
  await runGlobalJobs();
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  await q.run('DELETE FROM sessions WHERE expires_at<?', now);
  await q.run('DELETE FROM password_resets WHERE expires_at<?', now);
  await rateCleanup(); await eventsCleanup();
  return new Response('ok');
};

export const config = { schedule: '@hourly' };
