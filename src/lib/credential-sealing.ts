/**
 * Browser-side credential sealing primitive for Zeus Knight Cloud.
 *
 * Wire contract interoperable with Zeus Agent (`knight_build/tool/crates/zeus-agent/src/crypto.rs`):
 * - Ephemeral P-256 ECDH key pair generated per seal operation
 * - Recipient device public key: 65-byte SEC1 uncompressed (starts with 0x04)
 * - ECDH shared secret derived via crypto.subtle.deriveBits (256 bits)
 * - HKDF-SHA256: salt = empty byte array, info = "zeus-v1" (7 ASCII bytes, no trailing NUL)
 * - AES-256-GCM: 12-byte random nonce, 128-bit tag appended inside ct
 * - Plaintext: UTF-8 JSON `{"username":"<username>","password":"<password>"}`
 * - All byte fields encoded as standard RFC 4648 base64 with padding
 */

import type { SealedCredentials } from "./types";

export type { SealedCredentials };

export const SEALING_ALGORITHM = "ecdh-p256-hkdf-sha256-aes256gcm" as const;
export const HKDF_INFO_STRING = "zeus-v1" as const;
export const NONCE_BYTES_LENGTH = 12;
export const SEC1_UNCOMPRESSED_KEY_LENGTH = 65;
export const SEC1_UNCOMPRESSED_PREFIX = 0x04;

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const STANDARD_B64_REGEX = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * Encodes a Uint8Array into a standard RFC 4648 base64 string with '=' padding.
 * Pure browser/JS implementation without Node Buffer or external dependencies.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let result = "";
  const len = bytes.length;
  let i = 0;
  for (; i + 2 < len; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    result += B64_CHARS[b0 >> 2];
    result += B64_CHARS[((b0 & 3) << 4) | (b1 >> 4)];
    result += B64_CHARS[((b1 & 15) << 2) | (b2 >> 6)];
    result += B64_CHARS[b2 & 63];
  }
  if (i < len) {
    const b0 = bytes[i];
    result += B64_CHARS[b0 >> 2];
    if (i + 1 < len) {
      const b1 = bytes[i + 1];
      result += B64_CHARS[((b0 & 3) << 4) | (b1 >> 4)];
      result += B64_CHARS[(b1 & 15) << 2];
      result += "=";
    } else {
      result += B64_CHARS[(b0 & 3) << 4];
      result += "==";
    }
  }
  return result;
}

/**
 * Decodes a standard RFC 4648 base64 string into a Uint8Array.
 * Rejects base64url characters (- and _), invalid padding, or non-base64 characters.
 */
export function base64ToBytes(b64: string): Uint8Array {
  if (typeof b64 !== "string") {
    throw new Error("Invalid base64 input: expected a string");
  }
  if (!STANDARD_B64_REGEX.test(b64)) {
    throw new Error("Invalid base64 string: malformed characters, invalid padding, or base64url encoding detected");
  }
  if (b64.length === 0) {
    return new Uint8Array(0);
  }
  if (typeof globalThis.atob !== "function") {
    throw new Error("atob is unavailable in this environment");
  }
  const binary = globalThis.atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export interface CredentialPayload {
  username: string;
  password: string;
}

/**
 * Seals credentials for a target device using WebCrypto.
 *
 * @param devicePublicKeyBase64 Standard base64 string of the 65-byte SEC1 uncompressed P-256 recipient public key
 * @param username Game username (or CredentialPayload object)
 * @param password Game password (when username is passed as first string)
 * @returns SealedCredentials matching the Zeus Agent SealedSecret wire contract
 */
export async function sealCredentials(
  devicePublicKeyBase64: string,
  username: string,
  password: string,
): Promise<SealedCredentials>;
export async function sealCredentials(
  devicePublicKeyBase64: string,
  credentials: CredentialPayload,
): Promise<SealedCredentials>;
export async function sealCredentials(
  devicePublicKeyBase64: string,
  usernameOrCredentials: string | CredentialPayload,
  maybePassword?: string,
): Promise<SealedCredentials> {
  const subtle = globalThis.crypto?.subtle;
  const getRandomValues = globalThis.crypto?.getRandomValues?.bind(globalThis.crypto);
  if (!subtle || !getRandomValues) {
    throw new Error("WebCrypto API is unavailable in this environment");
  }

  let username: string;
  let password: string;

  if (typeof usernameOrCredentials === "string") {
    username = usernameOrCredentials;
    password = maybePassword ?? "";
  } else if (usernameOrCredentials && typeof usernameOrCredentials === "object") {
    username = usernameOrCredentials.username;
    password = usernameOrCredentials.password;
  } else {
    throw new Error("Invalid credentials payload");
  }

  if (!devicePublicKeyBase64 || typeof devicePublicKeyBase64 !== "string") {
    throw new Error("Invalid device public key: must be a base64 string");
  }
  if (!username || typeof username !== "string" || username.trim().length === 0) {
    throw new Error("Username must not be empty");
  }
  if (!password || typeof password !== "string" || password.length === 0) {
    throw new Error("Password must not be empty");
  }

  let devicePubkeyBytes: Uint8Array;
  try {
    devicePubkeyBytes = base64ToBytes(devicePublicKeyBase64.trim());
  } catch {
    throw new Error("Invalid device public key: failed to decode standard base64");
  }

  if (devicePubkeyBytes.length !== SEC1_UNCOMPRESSED_KEY_LENGTH) {
    throw new Error(
      `Invalid device public key: expected ${SEC1_UNCOMPRESSED_KEY_LENGTH} bytes (SEC1 uncompressed), got ${devicePubkeyBytes.length}`,
    );
  }

  if (devicePubkeyBytes[0] !== SEC1_UNCOMPRESSED_PREFIX) {
    throw new Error(
      `Invalid device public key: expected SEC1 uncompressed prefix 0x04, got 0x${devicePubkeyBytes[0].toString(16).padStart(2, "0")}`,
    );
  }

  // 1. Import recipient public key for ECDH peer usage only (usages: [])
  let peerKey: CryptoKey;
  try {
    peerKey = await subtle.importKey(
      "raw",
      devicePubkeyBytes as unknown as BufferSource,
      {
        name: "ECDH",
        namedCurve: "P-256",
      },
      false,
      [],
    );
  } catch (err) {
    throw new Error(`Failed to import recipient device public key into WebCrypto: ${(err as Error).message}`);
  }

  // 2. Generate a fresh ephemeral P-256 key pair per operation
  let ephKeyPair: CryptoKeyPair;
  try {
    ephKeyPair = await subtle.generateKey(
      {
        name: "ECDH",
        namedCurve: "P-256",
      },
      false,
      ["deriveBits"],
    );
  } catch (err) {
    throw new Error(`Failed to generate ephemeral ECDH key pair: ${(err as Error).message}`);
  }

  // 3. Export ephemeral public key as raw SEC1 uncompressed (65 bytes starting 0x04)
  let ephPubRaw: ArrayBuffer;
  try {
    ephPubRaw = await subtle.exportKey("raw", ephKeyPair.publicKey);
  } catch (err) {
    throw new Error(`Failed to export ephemeral public key: ${(err as Error).message}`);
  }

  const ephPubBytes = new Uint8Array(ephPubRaw);
  if (
    ephPubBytes.length !== SEC1_UNCOMPRESSED_KEY_LENGTH ||
    ephPubBytes[0] !== SEC1_UNCOMPRESSED_PREFIX
  ) {
    throw new Error("Exported ephemeral public key is not a valid 65-byte SEC1 uncompressed point");
  }

  // 4. Derive ECDH raw shared secret (256 bits)
  let sharedSecretBits: ArrayBuffer;
  try {
    sharedSecretBits = await subtle.deriveBits(
      {
        name: "ECDH",
        public: peerKey,
      },
      ephKeyPair.privateKey,
      256,
    );
  } catch (err) {
    throw new Error(`Failed to derive ECDH shared secret: ${(err as Error).message}`);
  }

  // 5. Import raw shared secret as HKDF key
  let hkdfKey: CryptoKey;
  try {
    hkdfKey = await subtle.importKey(
      "raw",
      sharedSecretBits,
      { name: "HKDF" },
      false,
      ["deriveKey"],
    );
  } catch (err) {
    throw new Error(`Failed to import HKDF master key: ${(err as Error).message}`);
  } finally {
    new Uint8Array(sharedSecretBits).fill(0);
  }

  // 6. Derive 256-bit AES-GCM key via HKDF (hash: SHA-256, salt: 0 bytes, info: "zeus-v1")
  let aesKey: CryptoKey;
  try {
    aesKey = await subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new Uint8Array(0),
        info: new TextEncoder().encode(HKDF_INFO_STRING),
      },
      hkdfKey,
      {
        name: "AES-GCM",
        length: 256,
      },
      false,
      ["encrypt"],
    );
  } catch (err) {
    throw new Error(`Failed to derive AES-GCM key via HKDF: ${(err as Error).message}`);
  }

  // 7. Serialize plaintext credentials JSON
  const plaintextStr = JSON.stringify({
    username,
    password,
  });
  const plaintextBytes = new TextEncoder().encode(plaintextStr);

  // 8. Generate 12 random bytes for AES-GCM nonce
  const nonce = new Uint8Array(NONCE_BYTES_LENGTH);
  getRandomValues(nonce);

  // 9. Encrypt with AES-GCM (128-bit authentication tag appended by WebCrypto)
  let encryptedBuffer: ArrayBuffer;
  try {
    encryptedBuffer = await subtle.encrypt(
      {
        name: "AES-GCM",
        iv: nonce,
        tagLength: 128,
      },
      aesKey,
      plaintextBytes,
    );
  } catch (err) {
    throw new Error(`AES-GCM encryption failed: ${(err as Error).message}`);
  } finally {
    plaintextBytes.fill(0);
  }

  // 10. Return wire-compatible SealedCredentials object
  return {
    alg: SEALING_ALGORITHM,
    info: HKDF_INFO_STRING,
    eph_pub: bytesToBase64(ephPubBytes),
    nonce: bytesToBase64(nonce),
    ct: bytesToBase64(new Uint8Array(encryptedBuffer)),
  };
}
