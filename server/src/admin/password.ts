import { randomBytes, scrypt as derive, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(derive);
export async function hashPassword(password: string) {
  const salt = randomBytes(32).toString('hex');
  const key = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password: string, hash: string) {
  const [salt, expected] = hash.split(':');
  const key = await scrypt(password, salt, 64) as Buffer;
  const stored = Buffer.from(expected, 'hex');
  return stored.length === key.length && timingSafeEqual(key, stored);
}
