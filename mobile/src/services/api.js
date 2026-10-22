const API_URL = (
  process.env.EXPO_PUBLIC_API_URL || "http://localhost:4000/api/v1"
).replace(/\/+$/, "");

export class ApiError extends Error {
  constructor(message, { code, status, requestId } = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code || "API_ERROR";
    this.status = status || 0;
    this.requestId = requestId || null;
  }
}

export async function apiRequest(path, options = {}) {
  const {
    timeoutMs = 15000,
    signal: externalSignal,
    headers = {},
    token,
    body,
    ...fetchOptions
  } = options;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortFromCaller = () => controller.abort(externalSignal.reason);

  if (externalSignal?.aborted) abortFromCaller();
  else externalSignal?.addEventListener("abort", abortFromCaller, { once: true });

  const requestHeaders = { Accept: "application/json", ...headers };
  if (token) requestHeaders.Authorization = `Bearer ${token}`;
  let requestBody = body;
  if (body !== undefined && typeof body !== "string") {
    requestHeaders["Content-Type"] ||= "application/json";
    requestBody = JSON.stringify(body);
  }

  try {
    const response = await fetch(`${API_URL}${path}`, {
      ...fetchOptions,
      headers: requestHeaders,
      body: requestBody,
      signal: controller.signal,
    });
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new ApiError("The API returned an invalid response", {
        code: "INVALID_RESPONSE",
        status: response.status,
      });
    }

    if (!response.ok || payload?.success !== true) {
      throw new ApiError(
        payload?.error?.message || "The API request failed",
        {
          code: payload?.error?.code || "API_ERROR",
          status: response.status,
          requestId: payload?.meta?.requestId,
        },
      );
    }
    return payload;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (timedOut) {
      throw new ApiError("The request timed out. Try again.", {
        code: "REQUEST_TIMEOUT",
      });
    }
    if (externalSignal?.aborted) {
      throw new ApiError("The request was cancelled.", {
        code: "REQUEST_CANCELLED",
      });
    }
    throw new ApiError("Unable to reach the API. Check your connection.", {
      code: "NETWORK_ERROR",
    });
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromCaller);
  }
}

export function getApiHealth(options) {
  return apiRequest("/health", options);
}
