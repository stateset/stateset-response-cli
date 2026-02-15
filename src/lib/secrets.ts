/**
 * Secret encryption module for StateSet Response CLI
 *
 * Provides AES-256-GCM encryption for sensitive credentials stored in config.
 * Key is derived from machine-specific data to prevent config portability
 * (which could lead to credential theft).
 *
 * Encrypted values are prefixed with "enc:" for backward compatibility
 * with existing plaintext configs.
 */

import crypto from 'node:crypto';
import os from 'node:os';
import { execSync } from 'node:child_process';

const ENCRYPTION_PREFIX = 'enc:';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT = 'stateset-response-cli-v1';

/**
 * Get a machine-specific identifier for key derivation
 */
function getMachineId(): string {
  try {
    // Try to get a persistent machine ID
    const platform = os.platform();

    if (platform === 'linux') {
      try {
        return execSync('cat /etc/machine-id', { encoding: 'utf8' }).trim();
      } catch {
        // Fallback to dbus machine ID
        try {
          return execSync('cat /var/lib/dbus/machine-id', { encoding: 'utf8' }).trim();
        } catch {
          // Continue to fallback
        }
      }
    } else if (platform === 'darwin') {
      try {
        const output = execSync('ioreg -rd1 -c IOPlatformExpertDevice | grep IOPlatformUUID', {
          encoding: 'utf8',
        });
        const match = output.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
        if (match) return match[1];
      } catch {
        // Continue to fallback
      }
    } else if (platform === 'win32') {
      try {
        const output = execSync('wmic csproduct get uuid', { encoding: 'utf8' });
        const lines = output.split('\n').filter((line) => line.trim() && !line.includes('UUID'));
        if (lines.length > 0) return lines[0].trim();
      } catch {
        // Continue to fallback
      }
    }
  } catch {
    // Continue to fallback
  }

  // Fallback: combine hostname and username
  // Less secure but better than nothing
  return `${os.hostname()}-${os.userInfo().username}`;
}

/**
 * Derive encryption key from machine ID and user salt
 */
function deriveKey(): Buffer {
  const machineId = getMachineId();
  const userSalt = `${SALT}-${os.userInfo().username}`;
  return crypto.scryptSync(machineId, userSalt, 32);
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
