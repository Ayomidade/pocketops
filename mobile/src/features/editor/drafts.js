import { gcm } from "@noble/ciphers/aes.js";
import { decodeBase64, decodeUtf8, encodeBase64, encodeUtf8 } from "./encoding.js";

const maxDraftBytes = 512 * 1024;
const maxDraftsPerUser = 5;
export const editorDraftTtlMs = 24 * 60 * 60 * 1000;

export function createEditorDraftStore({
  secureStore,
  fileStore,
  randomBytes,
  hash,
  now = () => Date.now(),
  directoryUri,
}) {
  const indexKey = (userHash) => `pocketops.editor.drafts.${userHash}`;
  const encryptionKey = (userHash) => `pocketops.editor.key.${userHash}`;
  const fileUri = (userHash, draftId) => `${directoryUri}${userHash}/${draftId}.enc`;

  async function userHash(userId) {
    if (typeof userId !== "string" || !userId) {
      throw new Error("A signed-in user is required to store a draft");
    }
    return hash(userId);
  }

  async function readIndex(hashValue) {
    const raw = await secureStore.getItemAsync(indexKey(hashValue));
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter(
            (item) =>
              item &&
              /^[a-f0-9]{64}$/.test(item.id) &&
              Number.isFinite(item.savedAt),
          )
        : [];
    } catch {
      return [];
    }
  }

  async function getKey(hashValue, create = false) {
    let encoded = await secureStore.getItemAsync(encryptionKey(hashValue));
    if (!encoded && create) {
      encoded = encodeBase64(await randomBytes(32));
      await secureStore.setItemAsync(encryptionKey(hashValue), encoded);
    }
    return encoded ? decodeBase64(encoded) : null;
  }

  async function deleteByHash(hashValue, draftId) {
    await fileStore.deleteAsync(fileUri(hashValue, draftId), { idempotent: true });
  }

  async function decryptDraft(hashValue, draftId) {
    const key = await getKey(hashValue);
    if (!key) throw new Error("Draft key is unavailable");
    const raw = await fileStore.readAsStringAsync(fileUri(hashValue, draftId));
    const bytes = decodeBase64(raw);
    if (bytes.length < 12 + 16) throw new Error("Draft is incomplete");
    const nonce = bytes.slice(0, 12);
    const ciphertext = bytes.slice(12);
    const plaintext = gcm(key, nonce, encodeUtf8(draftId)).decrypt(ciphertext);
    const draft = JSON.parse(decodeUtf8(plaintext));
    if (
      typeof draft.content !== "string" ||
      encodeUtf8(draft.content).length > maxDraftBytes ||
      !Number.isFinite(draft.expiresAt) ||
      draft.expiresAt <= now()
    ) throw new Error("Draft expired or is invalid");
    return draft;
  }

  async function removeIndexEntry(hashValue, draftId) {
    const index = (await readIndex(hashValue)).filter((item) => item.id !== draftId);
    if (index.length) await secureStore.setItemAsync(indexKey(hashValue), JSON.stringify(index));
    else {
      await secureStore.deleteItemAsync(indexKey(hashValue));
      await secureStore.deleteItemAsync(encryptionKey(hashValue));
    }
  }

  return {
    async save(draft) {
      const contentBytes = encodeUtf8(draft.content);
      if (contentBytes.length > maxDraftBytes) {
        throw new Error("Drafts are limited to 512 KiB");
      }
      const hashValue = await userHash(draft.userId);
      const draftId = await hash(
        `${draft.repositoryId}\n${draft.branch}\n${draft.path}`,
      );
      const key = await getKey(hashValue, true);
      const nonce = await randomBytes(12);
      const savedAt = now();
      const payload = encodeUtf8(
        JSON.stringify({
          repositoryId: draft.repositoryId,
          branch: draft.branch,
          path: draft.path,
          baseSha: draft.baseSha,
          expectedSha: draft.expectedSha,
          content: draft.content,
          savedAt,
          expiresAt: savedAt + editorDraftTtlMs,
        }),
      );
      const ciphertext = gcm(key, nonce, encodeUtf8(draftId)).encrypt(payload);
      const destination = fileUri(hashValue, draftId);
      await fileStore.makeDirectoryAsync(`${directoryUri}${hashValue}/`, {
        intermediates: true,
      });
      await fileStore.writeAsStringAsync(
        destination,
        encodeBase64(new Uint8Array([...nonce, ...ciphertext])),
      );

      const index = await readIndex(hashValue);
      const next = [
        { id: draftId, savedAt },
        ...index.filter((item) => item.id !== draftId),
      ].slice(0, maxDraftsPerUser);
      await Promise.all(
        index
          .filter((item) => !next.some((retained) => retained.id === item.id))
          .map((item) => deleteByHash(hashValue, item.id)),
      );
      await secureStore.setItemAsync(indexKey(hashValue), JSON.stringify(next));
      return { savedAt, expiresAt: savedAt + editorDraftTtlMs };
    },

    async load({ userId, repositoryId, branch, path }) {
      const hashValue = await userHash(userId);
      const draftId = await hash(`${repositoryId}\n${branch}\n${path}`);
      const index = await readIndex(hashValue);
      if (!index.some((item) => item.id === draftId)) return null;
      try {
        const draft = await decryptDraft(hashValue, draftId);
        if (
          draft.repositoryId !== repositoryId ||
          draft.branch !== branch ||
          draft.path !== path ||
          typeof draft.content !== "string" ||
          encodeUtf8(draft.content).length > maxDraftBytes ||
          !Number.isFinite(draft.expiresAt) ||
          draft.expiresAt <= now()
        ) {
          throw new Error("Draft expired or does not match this file");
        }
        return draft;
      } catch {
        await this.delete({ userId, repositoryId, branch, path });
        return null;
      }
    },

    async find({ userId, repositoryId, path }) {
      const hashValue = await userHash(userId);
      const index = await readIndex(hashValue);
      for (const entry of index) {
        try {
          const draft = await decryptDraft(hashValue, entry.id);
          if (draft.repositoryId === repositoryId && draft.path === path) return draft;
        } catch {
          await deleteByHash(hashValue, entry.id);
          await removeIndexEntry(hashValue, entry.id);
        }
      }
      return null;
    },

    async delete({ userId, repositoryId, branch, path }) {
      const hashValue = await userHash(userId);
      const draftId = await hash(`${repositoryId}\n${branch}\n${path}`);
      await deleteByHash(hashValue, draftId);
      await removeIndexEntry(hashValue, draftId);
    },

    async clearUser(userId) {
      const hashValue = await userHash(userId);
      await fileStore.deleteAsync(`${directoryUri}${hashValue}/`, {
        idempotent: true,
      });
      await secureStore.deleteItemAsync(indexKey(hashValue));
      await secureStore.deleteItemAsync(encryptionKey(hashValue));
    },
  };
}
