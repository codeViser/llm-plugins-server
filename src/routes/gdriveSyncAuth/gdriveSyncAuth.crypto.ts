import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm' as const;
const IV_LENGTH = 12;   // 96-bit IV — GCM standard
const TAG_LENGTH = 16;  // 128-bit auth tag — GCM standard

function parseKey(hexKey: string): Buffer {
  const buf = Buffer.from(hexKey, 'hex');
  if (buf.length !== 32) {
    throw new Error('GDRIVE_SYNC_TOKEN_KEY must be exactly 64 hex characters (32 bytes / 256 bits)');
  }
  return buf;
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Output layout: [ IV (12 bytes) ][ Auth-Tag (16 bytes) ][ Ciphertext ]
 */
export function encryptToken(plaintext: string, hexKey: string): Buffer {
  const key = parseKey(hexKey);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

/**
 * Decrypt a buffer produced by encryptToken.
 * Throws if the auth tag does not match (tampered data).
 */
export function decryptToken(data: Buffer, hexKey: string): string {
  const key = parseKey(hexKey);
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
