import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import type { ProviderId } from '../s3/providers';

export interface ExportAccount {
  label: string;
  provider: ProviderId;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  forcePathStyle?: boolean;
}

export type TransferErrorCode = 'PasswordRequired' | 'IncorrectPassword' | 'InvalidData';

export class TransferError extends Error {
  constructor(public readonly code: TransferErrorCode, message: string) {
    super(message);
    this.name = 'TransferError';
  }
}

const FORMAT = 's3manager-accounts';
const VERSION = 1;
const SCRYPT = { N: 32768, r: 8, p: 1 };
const KEYLEN = 32;

function deriveKey(password: string, salt: Buffer): Buffer {
  // maxmem must be set explicitly: Node.js defaults to 32 MB, which is exactly
  // the lower bound for N=32768, r=8. 64 MB gives comfortable headroom.
  return scryptSync(password, salt, KEYLEN, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 67108864 });
}

export function exportAccounts(accounts: ExportAccount[], password?: string): string {
  const payload = JSON.stringify({ accounts });
  let envelope: Record<string, unknown>;
  if (password && password.length > 0) {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', deriveKey(password, salt), iv);
    const ciphertext = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
    envelope = {
      format: FORMAT,
      version: VERSION,
      encrypted: true,
      kdf: { name: 'scrypt', N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, salt: salt.toString('base64') },
      cipher: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: ciphertext.toString('base64'),
    };
  } else {
    envelope = { format: FORMAT, version: VERSION, encrypted: false, data: payload };
  }
  return Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64');
}

export function importAccounts(blob: string, password?: string): ExportAccount[] {
  let env: Record<string, unknown>;
  try {
    const json = Buffer.from(blob.trim(), 'base64').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
    env = parsed as Record<string, unknown>;
  } catch {
    throw new TransferError('InvalidData', 'The import data is not valid.');
  }
  if (env.format !== FORMAT || env.version !== VERSION || typeof env.data !== 'string') {
    throw new TransferError('InvalidData', 'The import data is not a recognized account export.');
  }

  let payload: string;
  if (env.encrypted === true) {
    if (!password || password.length === 0) {
      throw new TransferError('PasswordRequired', 'This export is password-protected.');
    }
    try {
      const kdf = env.kdf as { salt: string };
      const salt = Buffer.from(kdf.salt, 'base64');
      const iv = Buffer.from(env.iv as string, 'base64');
      const tag = Buffer.from(env.tag as string, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', deriveKey(password, salt), iv);
      decipher.setAuthTag(tag);
      payload = Buffer.concat([
        decipher.update(Buffer.from(env.data as string, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new TransferError('IncorrectPassword', 'Incorrect password or corrupted data.');
    }
  } else {
    payload = env.data;
  }

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(payload);
  } catch {
    throw new TransferError('InvalidData', 'The import payload is malformed.');
  }
  const accounts = (parsedPayload as { accounts?: unknown }).accounts;
  if (!Array.isArray(accounts)) {
    throw new TransferError('InvalidData', 'The import payload has no accounts.');
  }
  return accounts as ExportAccount[];
}
