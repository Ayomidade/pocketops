export function successResponse(data, requestId) {
  return { success: true, data, meta: { requestId } };
}

export function errorResponse(code, message, requestId) {
  return {
    success: false,
    error: { code, message },
    meta: { requestId },
  };
}
