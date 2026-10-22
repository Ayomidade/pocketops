import {
  createContext,
  useCallback,
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
import { ApiError, apiRequest } from "../../services/api.js";
import {
  createCompletionSecret,
  parseAuthCallback,
  pendingSessionStorageKey,
  sessionStorageKey,
  shouldRotateSession,
} from "./session.js";

const AuthContext = createContext(null);

function errorMessage(error) {
  if (error instanceof ApiError) {
    if (error.code === "NETWORK_ERROR" || error.code === "REQUEST_TIMEOUT") {
      return "Unable to reach PocketOps. Check your connection and try again.";
    }
    if (error.code === "AUTH_NOT_CONFIGURED") {
      return "GitHub sign-in is not configured on this PocketOps server.";
    }
  }
  return "Sign-in could not be completed. Please try again.";
}

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState({
    status: "starting",
    user: null,
    session: null,
    message: null,
  });
  const pendingCompletionSecret = useRef(null);
  const callbackCodes = useRef(new Set());

  const restoreSession = useCallback(async () => {
    setAuth((current) => ({
      ...current,
      status: "starting",
      message: null,
    }));
    let token;
    let pendingToken;
    try {
      pendingToken = await SecureStore.getItemAsync(
        pendingSessionStorageKey,
      );
      token =
        pendingToken || (await SecureStore.getItemAsync(sessionStorageKey));
      if (!token) {
        setAuth({ status: "signed_out", user: null, session: null, message: null });
        return;
      }

      let response;
      try {
        response = await apiRequest("/auth/me", { token });
      } catch (error) {
        if (!(pendingToken && error instanceof ApiError && error.status === 401)) {
          throw error;
        }
        await SecureStore.deleteItemAsync(pendingSessionStorageKey);
        pendingToken = null;
        token = await SecureStore.getItemAsync(sessionStorageKey);
        if (!token) throw error;
        response = await apiRequest("/auth/me", { token });
      }
      let user = response.data.user;
      let session = response.data.session;
      if (pendingToken) {
        await SecureStore.setItemAsync(sessionStorageKey, pendingToken);
        await SecureStore.deleteItemAsync(pendingSessionStorageKey);
      } else if (shouldRotateSession(session.expiresAt)) {
        const replacementToken = createCompletionSecret(
          await Crypto.getRandomBytesAsync(32),
        );
        await SecureStore.setItemAsync(
          pendingSessionStorageKey,
          replacementToken,
        );
        const rotated = await apiRequest("/auth/session/rotate", {
          method: "POST",
          token,
          body: { replacementToken },
        });
        await SecureStore.setItemAsync(sessionStorageKey, replacementToken);
        await SecureStore.deleteItemAsync(pendingSessionStorageKey);
        user = rotated.data.user;
        session = rotated.data.session;
      }
      setAuth({ status: "authenticated", user, session, message: null });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await SecureStore.deleteItemAsync(sessionStorageKey);
        setAuth({
          status: "expired",
          user: null,
          session: null,
          message: "Your session expired. Sign in again.",
        });
        return;
      }
      setAuth({
        status: "failed",
        user: null,
        session: null,
        message: "Unable to restore your session. Check your connection and retry.",
      });
    }
  }, []);

  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  const completeCallbackUrl = useCallback(async (callbackUrl) => {
    const callback = parseAuthCallback(
      callbackUrl,
      Linking.createURL("auth/callback"),
    );
    const callbackKey = callback.handoffCode
      ? `handoff:${callback.handoffCode}`
      : `error:${callback.error}`;
    if (
      callbackCodes.current.has(callbackKey)
    ) {
      return;
    }
    const completionSecret = pendingCompletionSecret.current;
    if (!completionSecret) {
      throw new Error("This sign-in attempt is no longer active. Start again.");
    }
    if (callback.error) {
      callbackCodes.current.add(callbackKey);
      pendingCompletionSecret.current = null;
      const message =
        callback.error === "access_denied"
          ? "GitHub sign-in was cancelled."
          : "GitHub sign-in is temporarily unavailable. Please retry.";
      setAuth({ status: "signed_out", user: null, session: null, message });
      return;
    }
    callbackCodes.current.add(callbackKey);
    setAuth((current) => ({ ...current, status: "exchanging", message: null }));

    try {
      const response = await apiRequest("/auth/mobile/exchange", {
        method: "POST",
        body: {
          handoffCode: callback.handoffCode,
          completionSecret,
          deviceLabel: "PocketOps mobile",
        },
      });
      await SecureStore.setItemAsync(sessionStorageKey, response.data.token);
      pendingCompletionSecret.current = null;
      setAuth({
        status: "authenticated",
        user: response.data.user,
        session: response.data.session,
        message: null,
      });
    } catch (error) {
      pendingCompletionSecret.current = null;
      callbackCodes.current.delete(callbackKey);
      setAuth({
        status: "failed",
        user: null,
        session: null,
        message: errorMessage(error),
      });
      throw error;
    }
  }, []);

  useEffect(() => {
    const subscription = Linking.addEventListener("url", ({ url }) => {
      if (pendingCompletionSecret.current) {
        void completeCallbackUrl(url).catch(() => {});
      }
    });
    return () => subscription.remove();
  }, [completeCallbackUrl]);

  const beginGithubLogin = useCallback(async () => {
    if (auth.status === "starting" || auth.status === "awaiting_callback" || auth.status === "exchanging") {
      return;
    }
    setAuth({ status: "starting", user: null, session: null, message: null });
    try {
      const completionSecret = createCompletionSecret(
        await Crypto.getRandomBytesAsync(32),
      );
      pendingCompletionSecret.current = completionSecret;
      const redirectUri = Linking.createURL("auth/callback");
      const start = await apiRequest("/auth/mobile/start", {
        method: "POST",
        body: { redirectUri, completionSecret },
      });
      setAuth({
        status: "awaiting_callback",
        user: null,
        session: null,
        message: null,
      });
      const result = await WebBrowser.openAuthSessionAsync(
        start.data.authorizationUrl,
        redirectUri,
      );
      if (result.type === "success" && result.url) {
        await completeCallbackUrl(result.url);
      } else if (pendingCompletionSecret.current) {
        pendingCompletionSecret.current = null;
        setAuth({
          status: "signed_out",
          user: null,
          session: null,
          message: "Sign-in was cancelled. You can try again.",
        });
      }
    } catch (error) {
      pendingCompletionSecret.current = null;
      setAuth({
        status: "failed",
        user: null,
        session: null,
        message: errorMessage(error),
      });
    }
  }, [auth.status, completeCallbackUrl]);

  const cancelGithubLogin = useCallback(async () => {
    pendingCompletionSecret.current = null;
    await WebBrowser.dismissBrowser();
    setAuth({
      status: "signed_out",
      user: null,
      session: null,
      message: "Sign-in was cancelled. You can try again.",
    });
  }, []);

  const authenticatedRequest = useCallback(async (path, options = {}) => {
    const token = await SecureStore.getItemAsync(sessionStorageKey);
    if (!token) {
      throw new ApiError("Sign in to continue.", {
        code: "UNAUTHENTICATED",
        status: 401,
      });
    }
    return apiRequest(path, { ...options, token });
  }, []);

  const logout = useCallback(async () => {
    const token = await SecureStore.getItemAsync(sessionStorageKey);
    if (!token) {
      setAuth({ status: "signed_out", user: null, session: null, message: null });
      return;
    }
    try {
      await apiRequest("/auth/logout", { method: "POST", token });
      await SecureStore.deleteItemAsync(sessionStorageKey);
      await SecureStore.deleteItemAsync(pendingSessionStorageKey);
      setAuth({ status: "signed_out", user: null, session: null, message: null });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await SecureStore.deleteItemAsync(sessionStorageKey);
        await SecureStore.deleteItemAsync(pendingSessionStorageKey);
        setAuth({
          status: "expired",
          user: null,
          session: null,
          message: "Your session has expired.",
        });
        return;
      }
      setAuth((current) => ({
        ...current,
        message: "Could not securely sign out. Check your connection and retry.",
      }));
      throw error;
    }
  }, []);

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
