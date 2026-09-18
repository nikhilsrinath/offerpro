import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM for the Gmail app password in org_secrets.
 *
 * The key lives only in the server environment, so a database dump on its own
 * does not yield anyone's SMTP credentials. Ciphertext, IV and auth tag are
 * three bytea columns; the schema's gmail_cipher_complete constraint keeps
 * them consistent.
 *
 * Generate a key with:  openssl rand -hex 32
 */

const IV_BYTES = 12; // GCM standard
const BYTEA_PREFIX = '\\x';

function key() {
  const raw = process.env.SECRETS_ENCRYPTION_KEY;
  if (!raw) throw new Error('Server is missing SECRETS_ENCRYPTION_KEY');
  const buf = /^[0-9a-fA-F]{64}$/.test(raw.trim())
    ? Buffer.from(raw.trim(), 'hex')
    : Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error('SECRETS_ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64)');
  }
  return buf;
}

/** Postgres bytea literal for a Buffer, as PostgREST wants it on write. */
export function toBytea(buf) {
  return BYTEA_PREFIX + buf.toString('hex');
}

/** Parses the `\x…` hex string PostgREST returns for a bytea column. */
export function fromBytea(value) {
  if (value == null) return null;
  if (Buffer.isBuffer(value)) return value;
  const s = String(value);
  return Buffer.from(s.startsWith(BYTEA_PREFIX) ? s.slice(2) : s, 'hex');
}

export function encryptSecret(plaintext) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return { cipher: ciphertext, iv, tag: cipher.getAuthTag() };
}

export function decryptSecret({ cipher, iv, tag }) {
  const decipher = createDecipheriv('aes-256-gcm', key(), fromBytea(iv));
  decipher.setAuthTag(fromBytea(tag));
  return Buffer.concat([
    decipher.update(fromBytea(cipher)),
    decipher.final(),
  ]).toString('utf8');
}
