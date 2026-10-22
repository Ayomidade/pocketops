import { AppError } from "../errors/app-error.js";
import { errorResponse } from "../lib/responses.js";

export function notFound(request, response) {
  return response
    .status(404)
    .json(errorResponse("NOT_FOUND", "Route not found", request.id));
}

export function errorHandler(error, request, response, next) {
  if (response.headersSent) return next(error);

  let status = 500;
  let code = "INTERNAL_ERROR";
  let message = "An unexpected error occurred";

  if (error instanceof AppError) {
    ({ status, code, message } = error);
  } else if (error?.type === "entity.parse.failed") {
    status = 400;
    code = "INVALID_JSON";
    message = "Request body contains malformed JSON";
  } else if (error?.type === "entity.too.large") {
    status = 413;
    code = "PAYLOAD_TOO_LARGE";
    message = "Request body exceeds the allowed size";
  }

  request.log?.[status >= 500 ? "error" : "warn"](
    { errorName: error?.name, status, code },
    "Request failed",
  );

  return response.status(status).json(errorResponse(code, message, request.id));
}
