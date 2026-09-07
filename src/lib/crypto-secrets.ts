import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

/**
 * Encrypt tool connector secrets at rest (Feature 1.9).
 * Uses AES-256-GCM with TOOL_AUTH_ENCRYPTION_KEY (or a derived local-dev key).
 * Production should set a strong 32-byte key (base64 or hex) from KMS/Vault.
 */

export type EncryptedEnvelope = {
  v: 1;
  alg: "aes-256-gcm";
  iv: string;
  tag: string;
  ciphertext: string;
};

function resolveKey(): Buffer {
  const raw = process.env.TOOL_AUTH_ENCRYPTION_KEY?.trim();
  if (raw) {
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      return Buffer.from(raw, "hex");
    }
    try {
      const b64 = Buffer.from(raw, "base64");
      if (b64.length === 32) return b64;
    } catch {
      /* fall through */
    }
    // Passphrase → stable 32-byte key (dev convenience; prefer raw 32-byte key).
    return scryptSync(raw, "multiplayer-ai-tool-auth", 32);
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "TOOL_AUTH_ENCRYPTION_KEY is required in production to encrypt tool credentials"
    );
  }

  // Deterministic local-dev fallback so reconnects survive restarts without .env.
  return scryptSync(
    "multiplayer-ai-local-dev-tool-auth",
    "multiplayer-ai-tool-auth",
    32
  );
}

export function encryptJson(value: Record<string, unknown>): EncryptedEnvelope {
  const key = resolveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptJson(envelope: unknown): Record<string, unknown> {
  if (
    !envelope ||
    typeof envelope !== "object" ||
    Array.isArray(envelope) ||
    (envelope as EncryptedEnvelope).v !== 1 ||
    (envelope as EncryptedEnvelope).alg !== "aes-256-gcm"
  ) {
    throw new Error("Invalid encrypted auth_config envelope");
  }

  const env = envelope as EncryptedEnvelope;
  const key = resolveKey();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(env.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(env.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(env.ciphertext, "base64")),
    decipher.final(),
  ]);
  const parsed = JSON.parse(plaintext.toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Decrypted auth_config is not an object");
  }
  return parsed as Record<string, unknown>;
}

export function isEncryptedEnvelope(value: unknown): value is EncryptedEnvelope {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as EncryptedEnvelope).v === 1 &&
    (value as EncryptedEnvelope).alg === "aes-256-gcm"
  );
}
