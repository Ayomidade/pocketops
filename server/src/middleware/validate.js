import { AppError } from "../errors/app-error.js";

export function validate(schema, source = "body") {
  return function validateRequest(request, _response, next) {
    const result = schema.safeParse(request[source]);
    if (!result.success) {
      return next(
        new AppError(422, "VALIDATION_ERROR", "Request validation failed"),
      );
    }

    request.validated ??= {};
    request.validated[source] = result.data;
    return next();
  };
}
