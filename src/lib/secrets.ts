/**
 * Secret encryption module for StateSet Response CLI
 *
 * Provides AES-256-GCM encryption for sensitive credentials stored in config.
 * Key is usually derived from machine-specific data and an optional
 * user-provided passphrase to avoid plain-text exposure on disk.
 *
 * Encrypted values are prefixed with "enc:" for backward compatibility
 * with existing plaintext configs.
 */

import crypto from 'node:crypto';
import os from 'node:os';
import { readTextFile as readSafeTextFile } from '../utils/file-read.js';

const ENCRYPTION_PREFIX = 'enc:';
const ENCRYPTION_PREFIX_V2 = 'enc:v2:';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT = 'stateset-response-cli-v1';
const SCRYPT_COST = 2 ** 15;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;

function getSecretPassphrase(): string | null {
  const configured = process.env.STATESET_SECRET_PASSPHRASE?.trim();
  return configured && configured.length > 0 ? configured : null;
}

/**
 * Get a machine-specific identifier for key derivation
 */
function getMachineId(): string {
  try {
    const platform = os.platform();
    const linuxCandidates = ['/etc/machine-id', '/var/lib/dbus/machine-id'];
    for (const candidate of linuxCandidates) {
      const value = readTextFile(candidate);
      if (value) return value;
    }

    // Fall back to a deterministic local hardware identifier where possible.
    const mac = getPrimaryMacAddress();
    if (mac) {
      return `mac:${mac}`;
    }

    if (platform === 'darwin') {
      const hostId = readTextFile('/etc/hostid');
      if (hostId) return `darwin-hostid:${hostId}`;
    }

    if (platform === 'win32') {
      const machineGuid = process.env.COMPUTERNAME || process.env.HOSTNAME;
      if (machineGuid) return `win-host:${machineGuid}`;
    }
  } catch {
    // Continue to fallback.
  }

  // Fallback: combine hostname and username
  // Less secure but better than nothing
  return `${os.hostname()}-${os.userInfo().username}`;
}

function readTextFile(filePath: string): string | null {
  try {
    const raw = readSafeTextFile(filePath, { label: 'machine identifier', maxBytes: 1_024 });
    const value = raw.split(/\r?\n/)[0]?.trim();
    if (value) return value;
  } catch {
    return null;
  }
  return null;
}

function getPrimaryMacAddress(): string | null {
  try {
    const networkInterfaces = os.networkInterfaces();
    const candidates: string[] = [];
    for (const iface of Object.values(networkInterfaces)) {
      if (!iface) continue;
      for (const item of iface) {
        if (!item || item.internal) continue;
        if (!item.mac || item.mac === '00:00:00:00:00:00') continue;
        candidates.push(item.mac.toLowerCase());
      }
    }
    candidates.sort();
    return candidates[0] || null;
  } catch {
    return null;
  }
}

function getKeyMaterial(): { material: string; userSalt: string } {
  const machineId = getMachineId();
  const passphrase = getSecretPassphrase();
  const userSalt = `${SALT}-${os.userInfo().username}`;
  const material = passphrase ? `${SALT}:pass:${passphrase}` : machineId;
  return { material, userSalt };
}

/**
 * Derive encryption key using legacy (default) scrypt parameters.
 * Used only for decrypting values encrypted with the original v1 format.
 */
function deriveKeyLegacy(): Buffer {
  const { material, userSalt } = getKeyMaterial();
  return crypto.scryptSync(material, userSalt, 32);
}

/**
 * Derive encryption key using hardened scrypt parameters (v2).
 */
function deriveKeyV2(): Buffer {
  const { material, userSalt } = getKeyMaterial();
  return crypto.scryptSync(material, userSalt, 32, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
    maxmem: 128 * SCRYPT_BLOCK_SIZE * SCRYPT_COST * 2,
  });
}

/**
 * Check if a value is encrypted (v1 or v2)
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith(ENCRYPTION_PREFIX);
}

function isV2(value: string): boolean {
  return value.startsWith(ENCRYPTION_PREFIX_V2);
}

/**
 * Encrypt a plaintext secret using v2 (hardened scrypt) parameters.
 * Returns a string in format: enc:v2:<base64(iv + authTag + ciphertext)>
 */
export function encryptSecret(plaintext: string): string {
  if (!plaintext || plaintext.length === 0) {
    return plaintext;
  }

  // Don't double-encrypt
  if (isEncrypted(plaintext)) {
    return plaintext;
  }

  const key = deriveKeyV2();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Combine: IV (16) + authTag (16) + ciphertext
  const combined = Buffer.concat([iv, authTag, encrypted]);

  return ENCRYPTION_PREFIX_V2 + combined.toString('base64');
}

/**
 * Decrypt an encrypted secret.
 * Handles v2 (enc:v2:...), legacy v1 (enc:...), and plaintext values.
 */
export function decryptSecret(ciphertext: string): string {
  if (!ciphertext || ciphertext.length === 0) {
    return ciphertext;
  }

  // Return plaintext values as-is (backward compatibility)
  if (!isEncrypted(ciphertext)) {
    return ciphertext;
  }

  try {
    let key: Buffer;
    let payload: string;

    if (isV2(ciphertext)) {
      key = deriveKeyV2();
      payload = ciphertext.slice(ENCRYPTION_PREFIX_V2.length);
    } else {
      key = deriveKeyLegacy();
      payload = ciphertext.slice(ENCRYPTION_PREFIX.length);
    }

    const combined = Buffer.from(payload, 'base64');

    if (combined.length < IV_LENGTH + AUTH_TAG_LENGTH) {
      throw new Error('Invalid encrypted data: too short');
    }

    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

    return decrypted.toString('utf8');
  } catch (error) {
    // If decryption fails (e.g., machine changed), return a helpful error
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(
      `Failed to decrypt secret: ${message}. ` +
        'This may happen if the config was created on a different machine. ' +
        'Please run `response auth login` to re-authenticate.',
    );
  }
}

/**
 * Rotate a secret from any encryption version to v2.
 * Decrypts using the appropriate version, then re-encrypts with v2 parameters.
 */
export function rotateSecret(ciphertext: string): string {
  if (!ciphertext || !isEncrypted(ciphertext)) {
    return ciphertext;
  }
  // Already v2 — re-encrypt anyway to ensure fresh IV
  const plaintext = decryptSecret(ciphertext);
  // encryptSecret won't double-encrypt, but plaintext is decrypted so it's fine
  const key = deriveKeyV2();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const combined = Buffer.concat([iv, authTag, encrypted]);
  return ENCRYPTION_PREFIX_V2 + combined.toString('base64');
}

/**
 * Encrypt all sensitive fields in a config object
 */
export function encryptConfigSecrets<T extends Record<string, unknown>>(
  config: T,
  secretKeys: string[],
): T {
  const result = { ...config };

  for (const key of secretKeys) {
    if (key in result && typeof result[key] === 'string') {
      (result as Record<string, unknown>)[key] = encryptSecret(result[key] as string);
    }
  }

  return result;
}

/**
 * Decrypt all sensitive fields in a config object
 */
export function decryptConfigSecrets<T extends Record<string, unknown>>(
  config: T,
  secretKeys: string[],
): T {
  const result = { ...config };

  for (const key of secretKeys) {
    if (key in result && typeof result[key] === 'string') {
      (result as Record<string, unknown>)[key] = decryptSecret(result[key] as string);
    }
  }

  return result;
}

/**
 * List of config keys that should be encrypted
 */
export const SECRET_KEYS = ['cliToken', 'adminSecret', 'anthropicApiKey'];

/**
 * Redact a secret for display (show first/last few chars)
 */
export function redactSecret(value: string | undefined): string {
  if (!value) return '(not set)';

  // Decrypt if encrypted for consistent display
  let plaintext = value;
  try {
    if (isEncrypted(value)) {
      plaintext = decryptSecret(value);
    }
  } catch {
    return '(encrypted, unable to read)';
  }

  if (plaintext.length <= 8) {
    return '*'.repeat(plaintext.length);
  }

  return `${plaintext.slice(0, 4)}...${plaintext.slice(-4)}`;
}
