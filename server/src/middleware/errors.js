export function notFound(_req, res) {
  return res
    .status(404)
    .json({
      success: false,
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
}
export function errorHandler(error, _req, res, _next) {
  console.error(error);
  return res
    .status(500)
    .json({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
      },
    });
}
