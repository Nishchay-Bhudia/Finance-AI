import { createHmac, randomBytes } from 'node:crypto';

const SECRET = process.env.AUTH_SECRET!;
export const SESSION_COOKIE = 'session';
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

function sign(value: string) {
  return createHmac('sha256', SECRET).update(value).digest('hex');
}

export function createSessionCookie(email: string) {
  const payload = Buffer.from(JSON.stringify({ email, exp: Date.now() + SESSION_MAX_AGE * 1000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifySessionCookie(cookie: string | undefined): string | null {
  if (!cookie) return null;
  const [payload, signature] = cookie.split('.');
  if (!payload || !signature || sign(payload) !== signature) return null;

  try {
    const { email, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof email !== 'string' || Date.now() > exp) return null;
    return email;
  } catch {
    return null;
  }
}

export function createMagicToken() {
  return randomBytes(32).toString('hex');
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }

  return cookies;
}
