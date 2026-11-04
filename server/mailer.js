// Envio de e-mail via Resend (RESEND_API_KEY + MAIL_FROM). Sem configuração, registra no console (somente dev).
export const mailConfigured = () => !!process.env.RESEND_API_KEY && !!process.env.MAIL_FROM;
export async function sendMail({ to, subject, text }) {
  if (!mailConfigured()) {
    console.log(`[mail:simulado] para=${to} assunto="${subject}"\n${text}\n`);
    return { sent: false };
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, text }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error('Falha ao enviar e-mail: ' + r.status);
  return { sent: true };
}
