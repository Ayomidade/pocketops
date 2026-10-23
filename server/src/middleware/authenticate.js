import { AppError } from "../errors/app-error.js";

export function createSessionAuthentication(authService) {
  return function authenticate(request, _response, next) {
    const parts = (request.get("authorization") || "").split(" ");
    const token = parts[1];
    const validToken =
      parts.length === 2 &&
      parts[0] === "Bearer" &&
      typeof token === "string" &&
      (/^[A-Za-z0-9_-]{43}$/.test(token) || /^[a-f0-9]{64}$/i.test(token));
    if (!validToken) {
      return next(
        new AppError(401, "UNAUTHENTICATED", "A valid session is required"),
      );
    }
    if (!authService) {
      return next(
        new AppError(
          503,
          "AUTH_UNAVAILABLE",
          "Authentication is temporarily unavailable",
        ),
      );
    }
    return authService
      .authenticateToken(token)
      .then((auth) => {
        request.auth = auth;
        return next();
      })
      .catch(next);
  };
}
