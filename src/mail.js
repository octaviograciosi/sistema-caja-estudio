import nodemailer from 'nodemailer';

// Envío por SMTP desde una casilla genérica (SMTP_*). Sin configuración devuelve null.
export function crearMailer(env = process.env) {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) return null;
  const port = Number(env.SMTP_PORT) || 465;
  const t = nodemailer.createTransport({ host: env.SMTP_HOST, port, secure: port === 465, auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } });
  return { send: (msg) => t.sendMail({ from: env.MAIL_FROM || env.SMTP_USER, ...msg }) };
}

const lista = (s) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);
export const destinatariosDeEnv = (env = process.env) => ({ to: lista(env.RENDICION_TO), cc: lista(env.RENDICION_CC) });
