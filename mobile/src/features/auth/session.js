export const sessionStorageKey = "pocketops.session.v1";
export const pendingSessionStorageKey = "pocketops.session.pending.v1";

export function createCompletionSecret(randomBytes) {
  if (!(randomBytes instanceof Uint8Array) || randomBytes.length !== 32) {
    throw new Error("Secure random source must return 32 bytes");
  }
  return Array.from(randomBytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function parseAuthCallback(callbackUrl, redirectUri) {
  let callback;
  let expected;
  try {
    callback = new URL(callbackUrl);
    expected = new URL(redirectUri);
  } catch {
    throw new Error("The sign-in callback is invalid.");
  }

  if (
    callback.protocol !== expected.protocol ||
    callback.host !== expected.host ||
    callback.pathname !== expected.pathname ||
    callback.username ||
    callback.password ||
    callback.hash ||
    [...callback.searchParams.keys()].some((key) => !["handoff", "error"].includes(key)) ||
    callback.searchParams.getAll("handoff").length > 1 ||
    callback.searchParams.getAll("error").length > 1
  ) {
    throw new Error("The sign-in callback did not match this app.");
  }

  const handoffCode = callback.searchParams.get("handoff");
  const error = callback.searchParams.get("error");
  if (handoffCode && /^[A-Za-z0-9_-]{43}$/.test(handoffCode) && !callback.searchParams.has("error")) {
    return { handoffCode, error: null };
  }
  if (
    !callback.searchParams.has("handoff") &&
    ["access_denied", "oauth_failed", "github_unavailable"].includes(error)
  ) {
    return { handoffCode: null, error };
  }
  throw new Error("The sign-in callback is invalid.");
}

export function shouldRotateSession(expiresAt, now = Date.now()) {
  const expiry = new Date(expiresAt).getTime();
  return Number.isFinite(expiry) && expiry - now <= 7 * 24 * 60 * 60 * 1000;
}

export function protectedRouteAction(status) {
  if (status === "starting") return "loading";
  if (status === "authenticated") return "render";
  if (status === "failed") return "retry";
  return "sign_in";
}
