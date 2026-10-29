import { createCompletionSecret, parseAuthCallback, pendingSessionStorageKey, sessionStorageKey, shouldRotateSession } from "./session.js";

const unauthenticated = (error) => error?.status === 401 && error?.code === "UNAUTHENTICATED";
export function authErrorMessage(error) {
  if (["NETWORK_ERROR", "REQUEST_TIMEOUT"].includes(error?.code)) return "Unable to reach PocketOps. Check your connection and try again.";
  if (["AUTH_NOT_CONFIGURED", "AUTH_UNAVAILABLE"].includes(error?.code)) return "GitHub sign-in is not configured or the PocketOps database is unavailable. Check the server setup.";
  if (error?.code === "INVALID_REDIRECT_URI") return "The app callback does not match the server. Use a PocketOps development build and check MOBILE_AUTH_REDIRECT_URI.";
  if (error?.code === "AUTH_RATE_LIMITED") return "Too many sign-in attempts. Wait before trying again.";
  return "Sign-in could not be completed. Please try again.";
}

// One controller per mounted AuthProvider. Epochs fence stale async work; the
// storage queue prevents old expiry/logout handlers deleting a newer login.
export function createAuthLifecycle({ storage, request, randomBytes, createRedirect, openSession, dismissBrowser, onChange }) {
  let epoch = 0;
  let status = "starting";
  let attempt = null;
  let restoring = null;
  let storageTail = Promise.resolve();
  const completed = new Set();
  const write = (task) => {
    const pending = storageTail.then(task, task);
    storageTail = pending.catch(() => {});
    return pending;
  };
  const publish = (state) => { status = state.status; onChange(state); };
  const signedOut = (message = null) => publish({ status: "signed_out", user: null, session: null, message });
  const clear = async () => { await storage.deleteItemAsync(sessionStorageKey); await storage.deleteItemAsync(pendingSessionStorageKey); };
  const revoke = async (token) => { try { await request("/auth/logout", { method: "POST", token }); } catch { /* A late canceled exchange must never become the active local session. */ } };
  const discardIssuedToken = async (token) => {
    try { await write(async () => { if ((await storage.getItemAsync(sessionStorageKey)) === token) await storage.deleteItemAsync(sessionStorageKey); }); } catch { /* Remote revocation is still attempted if local storage fails. */ }
    await revoke(token);
  };
  const current = (candidate) => attempt === candidate && epoch === candidate.epoch;

  function restoreSession() {
    if (attempt) return Promise.resolve();
    if (restoring?.epoch === epoch) return restoring.promise;
    const generation = ++epoch;
    publish({ status: "starting", user: null, session: null, message: null });
    const promise = (async () => {
      try {
        let [token, pendingToken] = await write(() => Promise.all([storage.getItemAsync(sessionStorageKey), storage.getItemAsync(pendingSessionStorageKey)]));
        if (generation !== epoch) return;
        let response;
        if (pendingToken) {
          try { response = await request("/auth/me", { token: pendingToken }); token = pendingToken; }
          catch (error) {
            if (!unauthenticated(error)) throw error;
            await write(async () => { if (generation === epoch) await storage.deleteItemAsync(pendingSessionStorageKey); });
            pendingToken = null;
          }
        }
        if (!token) { if (generation === epoch) signedOut(); return; }
        if (!response) response = await request("/auth/me", { token });
        if (generation !== epoch) return;
        if (!pendingToken && shouldRotateSession(response.data.session.expiresAt)) {
          const replacementToken = createCompletionSecret(await randomBytes(32));
          await write(async () => { if (generation === epoch) await storage.setItemAsync(pendingSessionStorageKey, replacementToken); });
          if (generation !== epoch) return;
          response = await request("/auth/session/rotate", { method: "POST", token, body: { replacementToken } });
          token = replacementToken;
        }
        await write(async () => {
          if (generation !== epoch) return;
          await storage.setItemAsync(sessionStorageKey, token);
          await storage.deleteItemAsync(pendingSessionStorageKey);
          if (generation === epoch) publish({ status: "authenticated", user: response.data.user, session: response.data.session, message: null });
        });
      } catch (error) {
        if (generation !== epoch) return;
        if (unauthenticated(error)) {
          await write(async () => { if (generation === epoch) { await clear().catch(() => {}); if (generation === epoch) publish({ status: "expired", user: null, session: null, message: "Your session expired. Sign in again." }); } });
        } else publish({ status: "failed", user: null, session: null, message: "Unable to restore your session. Check your connection and retry." });
      }
    })();
    restoring = { epoch: generation, promise };
    void promise.finally(() => { if (restoring?.promise === promise) restoring = null; }).catch(() => {});
    return promise;
  }

  function completeCallbackUrl(url) {
    let callback;
    try { callback = parseAuthCallback(url, createRedirect()); } catch (error) { return Promise.reject(error); }
    if (callback.handoffCode && completed.has(callback.handoffCode)) return Promise.resolve();
    const candidate = attempt;
    if (!candidate || !candidate.secret) return Promise.reject(new Error("This sign-in attempt is no longer active. Start again."));
    if (candidate.exchange) {
      return candidate.handoff === callback.handoffCode ? candidate.exchange : Promise.reject(new Error("A different sign-in callback is already processing."));
    }
    if (callback.error) {
      attempt = null;
      signedOut(callback.error === "access_denied" ? "GitHub sign-in was cancelled." : "GitHub sign-in is temporarily unavailable. Please retry.");
      return Promise.resolve();
    }
    candidate.handoff = callback.handoffCode;
    publish({ status: "exchanging", user: null, session: null, message: null });
    candidate.exchange = (async () => {
      let issuedToken;
      try {
        const response = await request("/auth/mobile/exchange", { method: "POST", body: { handoffCode: callback.handoffCode, completionSecret: candidate.secret, deviceLabel: "PocketOps mobile" } });
        issuedToken = response.data.token;
        if (!current(candidate)) { await discardIssuedToken(issuedToken); return; }
        await write(async () => {
          if (!current(candidate)) return;
          // Clear a prior account's recovery journal before committing this login.
          // A process death after storing the new token must not revive that journal.
          await storage.deleteItemAsync(pendingSessionStorageKey);
          if (!current(candidate)) return;
          await storage.setItemAsync(sessionStorageKey, issuedToken);
          if (!current(candidate)) return;
          attempt = null;
          completed.add(callback.handoffCode);
          if (completed.size > 16) completed.delete(completed.values().next().value);
          publish({ status: "authenticated", user: response.data.user, session: response.data.session, message: null });
        });
        if (!completed.has(callback.handoffCode)) await discardIssuedToken(issuedToken);
      } catch (error) {
        if (issuedToken) await discardIssuedToken(issuedToken);
        if (current(candidate)) {
          attempt = null;
          publish({ status: "failed", user: null, session: null, message: authErrorMessage(error) });
        }
        throw error;
      } finally { candidate.secret = null; }
    })();
    return candidate.exchange;
  }

  async function beginGithubLogin() {
    if (attempt || status === "starting" || status === "authenticated") return;
    const candidate = { epoch: ++epoch, secret: null, exchange: null, handoff: null };
    attempt = candidate;
    publish({ status: "starting", user: null, session: null, message: null });
    try {
      const redirectUri = createRedirect();
      if (redirectUri !== "pocketops://auth/callback") {
        throw Object.assign(new Error("Native callback unavailable"), { code: "INVALID_REDIRECT_URI" });
      }
      candidate.secret = createCompletionSecret(await randomBytes(32));
      if (!current(candidate)) return;
      const start = await request("/auth/mobile/start", { method: "POST", body: { redirectUri, completionSecret: candidate.secret } });
      if (!current(candidate)) return;
      publish({ status: "awaiting_callback", user: null, session: null, message: null });
      const result = await openSession(start.data.authorizationUrl, redirectUri);
      if (!current(candidate)) return;
      if (candidate.exchange) { await candidate.exchange; return; }
      if (result.type === "success" && result.url) await completeCallbackUrl(result.url);
      else { attempt = null; candidate.secret = null; signedOut("Sign-in was cancelled. You can try again."); }
    } catch (error) {
      if (current(candidate)) { attempt = null; candidate.secret = null; publish({ status: "failed", user: null, session: null, message: authErrorMessage(error) }); }
    }
  }

  async function cancelGithubLogin() {
    if (!attempt) return;
    // An exchange already in flight is allowed to return, then its token is revoked.
    ++epoch; if (attempt) attempt.secret = null; attempt = null;
    signedOut("Sign-in was cancelled. You can try again.");
    try { await dismissBrowser(); } catch { /* Cancellation is still effective when no browser is open. */ }
  }
  async function onExpired(token) {
    await write(async () => {
      const generation = epoch;
      if (attempt || (status !== "authenticated" && !token)) return;
      const stored = await storage.getItemAsync(sessionStorageKey);
      if (generation !== epoch || stored !== (token || null)) return;
      const expiredGeneration = ++epoch; attempt = null;
      await clear().catch(() => {}); if (expiredGeneration === epoch) publish({ status: "expired", user: null, session: null, message: "Your session expired. Sign in again." });
    });
  }
  async function logout() {
    const generation = ++epoch; if (attempt) attempt.secret = null; attempt = null;
    try {
      const tokens = await write(async () => [...new Set((await Promise.all([storage.getItemAsync(sessionStorageKey), storage.getItemAsync(pendingSessionStorageKey)])).filter(Boolean))]);
      for (const token of tokens) {
        try { await request("/auth/logout", { method: "POST", token }); }
        catch (error) { if (!unauthenticated(error)) throw error; }
      }
      await write(async () => { if (generation === epoch) { await clear(); if (generation === epoch) signedOut(); } });
    } catch (error) {
      // Keep the current identity and stored credentials when remote revocation
      // cannot be verified, allowing an explicit retry instead of silent logout.
      if (generation === epoch) onChange((state) => ({ ...state, message: "Could not securely sign out. Check your connection and retry." }));
      throw error;
    }
  }
  return { restoreSession, beginGithubLogin, completeCallbackUrl, cancelGithubLogin, onExpired, logout, hasPendingLogin: () => !!attempt };
}
