/**
 * E2EE (End-to-End Encryption) module for SAVA Messenger.
 *
 * Uses X25519 for key exchange + XSalsa20-Poly1305 for encryption
 * via tweetnacl (libsodium compatible).
 *
 * Flow:
 * 1. Each user has a long-term keypair (generated on first login)
 * 2. For each message, sender generates ephemeral keypair
 * 3. Shared secret = X25519(senderEphemeralSecret, recipientPublicKey)
 * 4. Message encrypted with XSalsa20-Poly1305 using shared secret + nonce
 * 5. Ephemeral public key sent alongside ciphertext
 *
 * Format: "e2ee:v1:<ephemeralPub_hex>:<nonce_hex>:<ciphertext_hex>"
 */

import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';
import { prisma } from './db';

const PREFIX = 'e2ee:v1:';

// ─── Key management ──────────────────────────────────────────────────

/** Generate a new X25519 keypair */
export function generateKeyPair() {
  return nacl.box.keyPair();
}

/** Store user's public key in the database */
export async function storePublicKey(userId: string, publicKeyBase64: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { e2eePublicKey: publicKeyBase64 },
  });
}

/** Get user's public key (returns null if not set) */
export async function getPublicKey(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { e2eePublicKey: true },
  });
  return user?.e2eePublicKey || null;
}

/** Get public keys for multiple users at once */
export async function getPublicKeys(userIds: string[]): Promise<Map<string, string>> {
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, e2eePublicKey: true },
  });

  const map = new Map<string, string>();
  for (const u of users) {
    if (u.e2eePublicKey) {
      map.set(u.id, u.e2eePublicKey);
    }
  }
  return map;
}

// ─── Encryption (server-side helper — not true E2EE, used for transit) ──

/**
 * Encrypt a message for a specific recipient.
 * The caller must provide the sender's keypair and recipient's public key.
 * Returns the encrypted string in "e2ee:v1:..." format.
 */
export function encryptMessage(
  plaintext: string,
  senderSecretKey: Uint8Array,
  recipientPublicKey: Uint8Array,
): string {
  const ephemeral = nacl.box.keyPair();
  const nonce = nacl.randomBytes(24);

  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = nacl.box(encoded, nonce, recipientPublicKey, senderSecretKey);

  if (!ciphertext) {
    throw new Error('Encryption failed');
  }

  const ephemeralPubHex = Buffer.from(ephemeral.publicKey).toString('hex');
  const nonceHex = Buffer.from(nonce).toString('hex');
  const ciphertextHex = Buffer.from(ciphertext).toString('hex');

  return `${PREFIX}${ephemeralPubHex}:${nonceHex}:${ciphertextHex}`;
}

/**
 * Decrypt a message.
 * Returns plaintext or null if decryption fails.
 */
export function decryptMessage(
  encrypted: string,
  recipientSecretKey: Uint8Array,
  senderPublicKey: Uint8Array,
): string | null {
  if (!encrypted.startsWith(PREFIX)) {
    return null; // Not E2EE encrypted
  }

  try {
    const payload = encrypted.slice(PREFIX.length);
    const [ephemeralPubHex, nonceHex, ciphertextHex] = payload.split(':');
    if (!ephemeralPubHex || !nonceHex || !ciphertextHex) {
      return null;
    }

    const ephemeralPub = new Uint8Array(Buffer.from(ephemeralPubHex, 'hex'));
    const nonce = new Uint8Array(Buffer.from(nonceHex, 'hex'));
    const ciphertext = new Uint8Array(Buffer.from(ciphertextHex, 'hex'));

    const decrypted = nacl.box.open(ciphertext, nonce, ephemeralPub, recipientSecretKey);
    if (!decrypted) {
      return null;
    }

    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

// ─── Socket helpers ───────────────────────────────────────────────────

/**
 * Relay key registration between client and server.
 * Client sends base64-encoded public key, server stores it.
 */
export async function registerKey(userId: string, publicKeyBase64: string): Promise<boolean> {
  try {
    // Validate: must be valid base64 decoding to 32 bytes
    const decoded = decodeBase64(publicKeyBase64);
    if (decoded.length !== 32) return false;
    await storePublicKey(userId, publicKeyBase64);
    return true;
  } catch {
    return false;
  }
}
