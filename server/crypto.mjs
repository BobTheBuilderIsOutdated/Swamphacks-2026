import { createCipheriv, createDecipheriv, randomBytes, createHash, timingSafeEqual } from 'node:crypto';

export const hash = text => createHash('sha256').update(text).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
export function equal(a, b) {
  const x = Buffer.from(a || ''), y = Buffer.from(b || '');
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}

export function vault(base64Key) {
  const key = Buffer.from(base64Key, 'base64');
  function check() { if (key.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes encoded as base64.'); }
  return {
    seal(value, owner) {
      check();
      const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(Buffer.from(owner));
      const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), data]).toString('base64');
    },
    open(value, owner) {
      if (!value) return null;
      check();
      const bytes = Buffer.from(value, 'base64'), decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAAD(Buffer.from(owner));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
    },
  };
}
