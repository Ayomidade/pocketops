import { successResponse } from "../../lib/responses.js";

export function createEditorController(service) {
  return {
    async createBranch(request, response) {
      const data = await service.createBranch({
        userId: request.auth.user.id,
        repositoryId: request.validated.params.repositoryId,
        ...request.validated.body,
        idempotencyKey: request.validated.headers["idempotency-key"],
        requestId: request.id,
      });
      return response.status(201).json(successResponse(data, request.id));
    },

    async commitFile(request, response) {
      const data = await service.commitFile({
        userId: request.auth.user.id,
        repositoryId: request.validated.params.repositoryId,
        ...request.validated.body,
        idempotencyKey: request.validated.headers["idempotency-key"],
        requestId: request.id,
      });
      return response.json(successResponse(data, request.id));
    },

    async listPullRequests(request, response) {
      const data = await service.listPullRequests({
        userId: request.auth.user.id,
        repositoryId: request.validated.params.repositoryId,
        ...request.validated.query,
        requestId: request.id,
      });
      return response.json(successResponse(data, request.id));
    },

    async createPullRequest(request, response) {
      const data = await service.createPullRequest({
        userId: request.auth.user.id,
        repositoryId: request.validated.params.repositoryId,
        ...request.validated.body,
        idempotencyKey: request.validated.headers["idempotency-key"],
        requestId: request.id,
      });
      return response.status(201).json(successResponse(data, request.id));
    },
  };
}
