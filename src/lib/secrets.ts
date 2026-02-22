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
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT = 'stateset-response-cli-v1';

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

/**
 * Derive encryption key from machine ID and user salt
 */
function deriveKey(): Buffer {
  const machineId = getMachineId();
  const passphrase = getSecretPassphrase();
  const userSalt = `${SALT}-${os.userInfo().username}`;
  const keyMaterial = passphrase ? `${SALT}:pass:${passphrase}` : machineId;
  return crypto.scryptSync(keyMaterial, userSalt, 32);
}

/**
 * Check if a value is encrypted
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith(ENCRYPTION_PREFIX);
}

/**
 * Encrypt a plaintext secret
 * Returns a string in format: enc:<base64(iv + authTag + ciphertext)>
 */
export function encryptSecret(plaintext: string): string {
  if (!plaintext || plaintext.length === 0) {
    return plaintext;
  }

  // Don't double-encrypt
  if (isEncrypted(plaintext)) {
    return plaintext;
  }

  const key = deriveKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Combine: IV (16) + authTag (16) + ciphertext
  const combined = Buffer.concat([iv, authTag, encrypted]);

  return ENCRYPTION_PREFIX + combined.toString('base64');
}

/**
 * Decrypt an encrypted secret
 * Handles both encrypted (enc:...) and plaintext values for backward compatibility
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
    const key = deriveKey();
    const combined = Buffer.from(ciphertext.slice(ENCRYPTION_PREFIX.length), 'base64');

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
