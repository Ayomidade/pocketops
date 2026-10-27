import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";
import { createEditorDraftStore } from "./drafts.js";

const draftDirectory = `${FileSystem.documentDirectory}pocketops-editor-drafts/`;

export const editorDraftStore = createEditorDraftStore({
  secureStore: {
    getItemAsync: (key) => SecureStore.getItemAsync(key),
    setItemAsync: (key, value) =>
      SecureStore.setItemAsync(key, value, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      }),
    deleteItemAsync: (key) => SecureStore.deleteItemAsync(key),
  },
  fileStore: FileSystem,
  randomBytes: (length) => Crypto.getRandomBytesAsync(length),
  hash: (value) =>
    Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value),
  directoryUri: draftDirectory,
});
