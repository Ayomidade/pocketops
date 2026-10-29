import { ApiError } from "../../services/api.js";

export function createAuthenticatedRequest({ getToken, request, onExpired }) {
  return async (path, options = {}) => {
    const token = await getToken();
    if (!token) {
      await onExpired(token);
      throw new ApiError("Sign in to continue.", {
        code: "UNAUTHENTICATED",
        status: 401,
      });
    }
    try {
      return await request(path, { ...options, token });
    } catch (error) {
      if (
        error.status === 401 &&
        error.code === "UNAUTHENTICATED" &&
        (await getToken()) === token
      )
        await onExpired(token);
      throw error;
    }
  };
}
