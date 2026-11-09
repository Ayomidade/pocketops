import { successResponse } from "../../lib/responses.js";
export function createIncidentController(service) {
  return {
    async handle(name, status, req, res) {
      const data = await service[name]({
        userId: req.auth.user.id,
        sessionId: req.auth.session.id,
        requestId: req.id,
        ...req.validated?.params,
        ...req.validated?.query,
        ...req.validated?.body,
        idempotencyKey: req.validated?.headers?.["idempotency-key"],
      });
      res.status(status).json(successResponse(data, req.id));
    },
  };
}
