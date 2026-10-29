import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { apiRequest } from "../../services/api.js";
import { createAuthenticatedRequest } from "./request.js";
import { sessionStorageKey } from "./session.js";
import { createAuthLifecycle } from "./lifecycle.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState({
    status: "starting",
    user: null,
    session: null,
    message: null,
  });
  const previousUserId = useRef(null);
  const lifecycle = useRef(null);
  if (!lifecycle.current) lifecycle.current = createAuthLifecycle({
    storage: SecureStore,
    request: apiRequest,
    randomBytes: Crypto.getRandomBytesAsync,
    createRedirect: () => Linking.createURL("auth/callback"),
    openSession: WebBrowser.openAuthSessionAsync,
    dismissBrowser: WebBrowser.dismissBrowser,
    onChange: setAuth,
  });
  const { restoreSession, beginGithubLogin, cancelGithubLogin, completeCallbackUrl, logout } = lifecycle.current;
  useEffect(() => { void restoreSession(); }, [restoreSession]);

  useEffect(() => {
    if (auth.status === "authenticated" && auth.user?.id) {
      if (previousUserId.current && previousUserId.current !== auth.user.id) {
        const previous = previousUserId.current;
        void import("../editor/draft-storage.js").then(({ editorDraftStore }) =>
          editorDraftStore.clearUser(previous),
        ).catch(() => {});
      }
      previousUserId.current = auth.user.id;
      return;
    }
    if (["signed_out", "expired"].includes(auth.status) && previousUserId.current) {
      const previous = previousUserId.current;
      previousUserId.current = null;
      void import("../editor/draft-storage.js").then(({ editorDraftStore }) =>
        editorDraftStore.clearUser(previous),
      ).catch(() => {});
    }
  }, [auth.status, auth.user?.id]);

  useEffect(() => {
    const subscription = Linking.addEventListener("url", ({ url }) => {
      if (lifecycle.current.hasPendingLogin()) void completeCallbackUrl(url).catch(() => {});
    });
    return () => subscription.remove();
  }, [completeCallbackUrl]);

  const authenticatedRequest = useMemo(
    () =>
      createAuthenticatedRequest({
        getToken: () => SecureStore.getItemAsync(sessionStorageKey),
        request: apiRequest,
        onExpired: lifecycle.current.onExpired,
      }),
    [],
  );

  const value = useMemo(
    () => ({
      ...auth,
      beginGithubLogin,
      cancelGithubLogin,
      completeCallbackUrl,
      authenticatedRequest,
      logout,
      restoreSession,
    }),
    [
      auth,
      beginGithubLogin,
      cancelGithubLogin,
      completeCallbackUrl,
      authenticatedRequest,
      logout,
      restoreSession,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
