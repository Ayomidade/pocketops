import { successResponse } from "../../lib/responses.js";
export function createDeploymentController(service) {
  return { async handle(name, status, req, res) {
    const data = await service[name]({ userId: req.auth.user.id, requestId: req.id, ...req.validated?.params, ...req.validated?.query, ...req.validated?.body,
      ...(req.validated?.headers ? { idempotencyKey: req.validated.headers["idempotency-key"] } : {}) });
    res.status(status).json(successResponse(data, req.id));
  } };
}
