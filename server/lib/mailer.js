// Sending email, in one place.
//
// The app sends nothing until a mail account is set up - either by the
// superadmin in Settings -> Email (kept in the database, the password
// encrypted; see features/notify.js) or on the server itself, which wins:
//
//   SMTP_HOST   the mail server (smtp.gmail.com, smtp.office365.com, ...)
//   SMTP_PORT   587 unless told otherwise (465 for SSL)
//   SMTP_USER   the login
//   SMTP_PASS   its password - for Gmail, an "app password", not the real one
//   MAIL_FROM   the address the mail is sent from, e.g. "Infusion <accounts@infusion.ph>"
//
// With those unset, mailConfigured() is false and every feature that would
// send says "email is not set up" instead of failing or pretending. Nothing
// here ever logs the password or the body of a message.
import nodemailer from 'nodemailer';

let transport = null;
let testTransport = null;   // tests hand one in, so nothing leaves the machine
let stored = null;          // { host, port, user, pass, from } from Settings, or null

// Where the account comes from: the server's own settings first, else the one
// the superadmin saved in the app.
const envConfig = () => (process.env.SMTP_HOST && process.env.MAIL_FROM ? {
  source: 'server', host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT) || 587,
  user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASS || '', from: process.env.MAIL_FROM,
  secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : undefined,
} : null);
const activeConfig = () => envConfig() || (stored?.host && stored?.from ? { source: 'settings', ...stored } : null);

export const mailConfigured = () => !!testTransport || !!activeConfig();
export const mailFrom = () => activeConfig()?.from || 'no-reply@localhost';
/** 'server' | 'settings' | 'test' | null - who set the account up. */
export const mailSource = () => (testTransport ? 'test' : activeConfig()?.source || null);

export function setMailTransportForTests(t) { testTransport = t; transport = null; }
/** The account saved in Settings (password already decrypted), or null to forget it. */
export function setStoredMailConfig(cfg) { stored = cfg ? { ...cfg } : null; transport = null; }

function getTransport() {
  if (testTransport) return testTransport;
  if (transport) return transport;
  const c = activeConfig();
  const port = Number(c.port) || 587;
  transport = nodemailer.createTransport({
    host: c.host, port,
    secure: c.secure ?? port === 465,
    ...(c.user ? { auth: { user: c.user, pass: c.pass || '' } } : {}),
    // A mail server that does not answer must not hold a request open.
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
  });
  return transport;
}

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
export const isEmail = (v) => EMAIL.test(String(v || '').trim());

// -> { ok: true } or { ok: false, error } - it never throws, so a mail server
// that is down cannot take a request or a nightly job down with it.
export async function sendMail({ to, subject, text }) {
  if (!mailConfigured()) return { ok: false, error: 'Email is not set up yet.' };
  const address = String(to || '').trim();
  if (!isEmail(address)) return { ok: false, error: 'That is not an email address.' };
  try {
    await getTransport().sendMail({
      from: mailFrom(), to: address,
      // One line, no line breaks: a subject is a header, and a header with a
      // line break in it is how extra recipients get smuggled in.
      subject: String(subject || '').replace(/[\r\n]+/g, ' ').slice(0, 200),
      text: String(text || '').slice(0, 50000),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `The mail server refused it: ${String(err?.message || err).slice(0, 200)}` };
  }
}
