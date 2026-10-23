import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function encryptToken(token, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error("GitHub token encryption key is unavailable");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return `v1.${iv.toString("base64url")}.${cipher
    .getAuthTag()
    .toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptToken(value, key) {
  const [version, ivValue, tagValue, ciphertextValue, extra] =
    String(value).split(".");
  if (
    version !== "v1" ||
    !ivValue ||
    !tagValue ||
    !ciphertextValue ||
    extra !== undefined ||
    !Buffer.isBuffer(key) ||
    key.length !== 32
  ) {
    throw new Error("Stored GitHub credential is invalid");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
