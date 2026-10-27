import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { AppError } from "../../errors/app-error.js";

export function credentialVault({ keys, activeVersion }) {
  if (!keys?.[activeVersion] || Object.values(keys).some((key) => !Buffer.isBuffer(key) || key.length !== 32)) {
    throw new Error("Provider encryption key ring is invalid");
  }
  const aad = (userId, id, version) => Buffer.from(`pocketops:render:${userId}:${id}:${version}`);
  return {
    seal(token, userId, id) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", keys[activeVersion], iv);
      cipher.setAAD(aad(userId, id, activeVersion));
      const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
      return { keyVersion: activeVersion, encryptedCredentials: [iv, cipher.getAuthTag(), ciphertext].map((v) => v.toString("base64")).join(".") };
    },
    open(connection) {
      try {
        const key = keys[connection.keyVersion];
        const [iv, tag, ciphertext] = connection.encryptedCredentials.split(".").map((v) => Buffer.from(v, "base64"));
        const decipher = createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAAD(aad(connection.userId, connection.id, connection.keyVersion));
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
      } catch {
        throw new AppError(503, "PROVIDER_CREDENTIAL_UNAVAILABLE", "Reconnect the provider or restore its encryption key.");
      }
    },
  };
}
