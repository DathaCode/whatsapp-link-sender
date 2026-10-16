import crypto from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { badRequest } from '../errors.js';

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;

// argon2id (algorithm 2) with OWASP-recommended parameters: 19 MiB, 2 iterations, 1 lane.
const OPTIONS = { algorithm: 2 as const, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export function checkPasswordPolicy(pw: unknown): string {
  if (typeof pw !== 'string' || pw.length < PASSWORD_MIN) {
    throw badRequest(`Use at least ${PASSWORD_MIN} characters for the password.`, 'weak_password');
  }
  if (pw.length > PASSWORD_MAX) throw badRequest(`Keep the password under ${PASSWORD_MAX} characters.`, 'weak_password');
  if (!pw.trim()) throw badRequest('The password cannot be only spaces.', 'weak_password');
  return pw;
}

export const hashPassword = (pw: string) => hash(pw, OPTIONS);

export async function verifyPassword(stored: string, pw: string): Promise<boolean> {
  try {
    return await verify(stored, pw);
  } catch {
    return false;
  }
}

// Verifying against this keeps the timing of "unknown user" close to "wrong password".
let dummyHash: Promise<string> | null = null;
export async function burnVerify(pw: string) {
  dummyHash ??= hashPassword(crypto.randomBytes(16).toString('hex'));
  await verifyPassword(await dummyHash, pw);
}

/** Readable temporary password for admin resets (about 80 bits). */
export function temporaryPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) out += alphabet[bytes[i]! % alphabet.length];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}`;
}
