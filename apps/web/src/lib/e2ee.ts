/**
 * Client-side E2EE module for SAVA Messenger.
 *
 * Uses X25519 + XSalsa20-Poly1305 (tweetnacl).
 * Keys are stored in IndexedDB for persistence.
 */

import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';

const E2EE_PREFIX = 'e2ee:v1:';
const DB_NAME = 'sava-e2ee';
const DB_VERSION = 1;
const STORE_NAME = 'keys';

// Global cache for public keys to avoid repeated API calls
const publicKeyCache = new Map<string, Uint8Array>();

// ─── API client interface ─────────────────────────────────────────────

export interface E2EEApiClient {
  registerE2eeKey(publicKey: string): Promise<{ ok: boolean }>;
  fetchE2eeKeys(userIds: string[]): Promise<Record<string, string | null>>;
}

/** Get public key from cache or fetch from server */
export async function getPublicKey(userId: string, apiClient: E2EEApiClient): Promise<Uint8Array | null> {
  // Check cache first
  if (publicKeyCache.has(userId)) {
    return publicKeyCache.get(userId)!;
  }

  // Fetch from server
  try {
    const keys = await fetchPublicKeys(apiClient, [userId]);
    const pubKey = keys.get(userId);
    if (pubKey) {
      const decoded = decodeBase64(pubKey);
      publicKeyCache.set(userId, decoded);
      return decoded;
    }
  } catch (e) {
    console.error(`Failed to fetch public key for user ${userId}:`, e);
  }

  return null;
}

/** Cache a public key manually (e.g., from message sender) */
export function cachePublicKey(userId: string, publicKeyBase64: string): void {
  try {
    const decoded = decodeBase64(publicKeyBase64);
    publicKeyCache.set(userId, decoded);
  } catch (e) {
    console.error(`Failed to cache public key for user ${userId}:`, e);
  }
}

/** Clear the public key cache */
export function clearPublicKeyCache(): void {
  publicKeyCache.clear();
}

// ─── IndexedDB key storage ───────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getStoredKey(keyName: string): Promise<string | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(keyName);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function storeKey(keyName: string, value: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, keyName);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Key management ──────────────────────────────────────────────────

// In-memory cache — avoids repeated IndexedDB reads on every message render
let _cachedKeyPair: nacl.BoxKeyPair | null = null;
let _cachedPublicKeyBase64: string | null = null;

/** Get or generate user's persistent keypair. Returns { keyPair, publicKeyBase64 } */
export async function getKeyPair(): Promise<{
  keyPair: nacl.BoxKeyPair;
  publicKeyBase64: string;
}> {
  // Return from memory cache immediately if available
  if (_cachedKeyPair && _cachedPublicKeyBase64) {
    return { keyPair: _cachedKeyPair, publicKeyBase64: _cachedPublicKeyBase64 };
  }

  const storedSecret = await getStoredKey('secretKey');
  const storedPublic = await getStoredKey('publicKey');

  if (storedSecret && storedPublic) {
    const keyPair = {
      secretKey: decodeBase64(storedSecret),
      publicKey: decodeBase64(storedPublic),
    } as nacl.BoxKeyPair;
    _cachedKeyPair = keyPair;
    _cachedPublicKeyBase64 = storedPublic;
    return { keyPair, publicKeyBase64: storedPublic };
  }

  // Generate new keypair
  const keyPair = nacl.box.keyPair();
  const publicKeyBase64 = encodeBase64(keyPair.publicKey);
  const secretKeyBase64 = encodeBase64(keyPair.secretKey);

  await storeKey('secretKey', secretKeyBase64);
  await storeKey('publicKey', publicKeyBase64);

  _cachedKeyPair = keyPair;
  _cachedPublicKeyBase64 = publicKeyBase64;

  return { keyPair, publicKeyBase64 };
}

/** Synchronously get keypair from cache (null if not yet loaded) */
export function getKeyPairSync(): nacl.BoxKeyPair | null {
  return _cachedKeyPair;
}

/** Register public key with server */
export async function registerPublicKey(apiClient: E2EEApiClient, publicKeyBase64: string): Promise<boolean> {
  try {
    await apiClient.registerE2eeKey(publicKeyBase64);
    return true;
  } catch (e) {
    console.error('Failed to register E2EE public key:', e);
    return false;
  }
}

/** Fetch public keys for given user IDs */
export async function fetchPublicKeys(apiClient: E2EEApiClient, userIds: string[]): Promise<Map<string, string>> {
  try {
    const result = await apiClient.fetchE2eeKeys(userIds);
    const map = new Map<string, string>();
    for (const [id, key] of Object.entries(result)) {
      if (key) map.set(id, key as string);
    }
    return map;
  } catch (e) {
    console.error('Failed to fetch E2EE public keys:', e);
    return new Map();
  }
}

// ─── Utility: Uint8Array → hex ───────────────────────────────────────
function uint8ToHex(arr: Uint8Array): string {
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToUint8(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// ─── Low-level box helpers ────────────────────────────────────────────

/**
 * Encrypt plaintext with an ephemeral sender keypair for a given recipient public key.
 * Returns "<ephemeralPubHex>:<nonceHex>:<ciphertextHex>".
 * The recipient decrypts with: nacl.box.open(cipher, nonce, ephemeralPub, recipientSecretKey)
 */
function boxEncrypt(plaintext: string, recipientPublicKey: Uint8Array): string {
  const ephemeral = nacl.box.keyPair();
  const nonce = nacl.randomBytes(24);
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = nacl.box(encoded, nonce, recipientPublicKey, ephemeral.secretKey);
  if (!ciphertext) throw new Error('Encryption failed');
  return `${uint8ToHex(ephemeral.publicKey)}:${uint8ToHex(nonce)}:${uint8ToHex(ciphertext)}`;
}

/**
 * Decrypt a "<ephemeralPubHex>:<nonceHex>:<ciphertextHex>" blob.
 * mySecretKey is the recipient's secret key.
 */
function boxDecrypt(blob: string, mySecretKey: Uint8Array): string | null {
  try {
    const [ephemeralPubHex, nonceHex, ciphertextHex] = blob.split(':');
    if (!ephemeralPubHex || !nonceHex || !ciphertextHex) return null;
    const ephemeralPub = hexToUint8(ephemeralPubHex);
    const nonce = hexToUint8(nonceHex);
    const ciphertext = hexToUint8(ciphertextHex);
    const decrypted = nacl.box.open(ciphertext, nonce, ephemeralPub, mySecretKey);
    if (!decrypted) return null;
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

// ─── Encryption / Decryption ─────────────────────────────────────────

/**
 * Encrypt plaintext for both recipient AND sender (so both can read it).
 *
 * Format: "e2ee:v2:<blob_for_recipient>|<blob_for_sender>"
 *
 * Each blob is independently encrypted with a fresh ephemeral keypair,
 * so neither party's secret key is ever shared.
 */
export function encryptMessage(
  plaintext: string,
  _mySecretKey: Uint8Array,   // kept for API compatibility, not used directly
  recipientPublicKey: Uint8Array,
  senderPublicKey: Uint8Array,
): string {
  const forRecipient = boxEncrypt(plaintext, recipientPublicKey);
  const forSender   = boxEncrypt(plaintext, senderPublicKey);
  return `e2ee:v2:${forRecipient}|${forSender}`;
}

/**
 * Encrypt plaintext for a group: one blob per recipient + one for sender.
 *
 * Format: "e2ee:v3:<blob0>|<blob1>|...|<blobN>"
 *
 * Each participant decrypts their own slot with their secret key.
 */
export function encryptMessageGroup(
  plaintext: string,
  _mySecretKey: Uint8Array,
  recipientPublicKeys: Uint8Array[],
  senderPublicKey: Uint8Array,
): string {
  const blobs = [...recipientPublicKeys, senderPublicKey].map(pk => boxEncrypt(plaintext, pk));
  return `e2ee:v3:${blobs.join('|')}`;
}

/**
 * Decrypt an E2EE message.
 * Tries every slot until one succeeds.
 * Returns plaintext, or null if the message is not E2EE / decryption fails.
 */
export function decryptMessage(
  encrypted: string,
  mySecretKey: Uint8Array,
  _senderPublicKey: Uint8Array, // kept for API compatibility
): string | null {
  // ── v3 format (group multi-recipient) ───────────────────────────
  if (encrypted.startsWith('e2ee:v3:')) {
    const blobs = encrypted.slice('e2ee:v3:'.length).split('|');
    for (const blob of blobs) {
      const result = boxDecrypt(blob, mySecretKey);
      if (result !== null) return result;
    }
    return null;
  }

  // ── v2 format (dual-encrypted personal) ─────────────────────────
  if (encrypted.startsWith('e2ee:v2:')) {
    const payload = encrypted.slice('e2ee:v2:'.length);
    const sep = payload.indexOf('|');
    if (sep === -1) return null;
    const recipientBlob = payload.slice(0, sep);
    const senderBlob    = payload.slice(sep + 1);
    return boxDecrypt(recipientBlob, mySecretKey)
        ?? boxDecrypt(senderBlob,    mySecretKey);
  }

  // ── v1 legacy format (recipient-only, kept for old messages) ────
  if (encrypted.startsWith(E2EE_PREFIX)) {
    const payload = encrypted.slice(E2EE_PREFIX.length);
    return boxDecrypt(payload, mySecretKey);
  }

  return null; // not E2EE
}
