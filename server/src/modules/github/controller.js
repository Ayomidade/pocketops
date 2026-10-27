import { successResponse } from "../../lib/responses.js";
import { AppError } from "../../errors/app-error.js";

export function createGitHubController(service) {
  function paginatedResponse(response, request, result) {
    return response.json({
      success: true,
      data: result.data,
      meta: {
        requestId: request.id,
        nextCursor: result.nextCursor,
        ...(result.directoryLimitReached !== undefined
          ? { directoryLimitReached: result.directoryLimitReached }
          : {}),
      },
    });
  }

  return {
    async startInstallation(request, response) {
      const result = await service.startInstallation({
        user: request.auth.user,
        requestId: request.id,
      });
      return response.status(201).json(successResponse(result, request.id));
    },

    async oauthCallback(request, response) {
      try {
        const url = await service.handleOAuthCallback(request.validated.query);
        return response.redirect(302, url);
      } catch (error) {
        if (error instanceof AppError) {
          return response.redirect(
            302,
            await service.callbackFailureRedirect(error),
          );
        }
        throw error;
      }
    },

    async installationCallback(request, response) {
      try {
        const url = await service.handleInstallationCallback({
          ...request.validated.query,
          requestId: request.id,
        });
        return response.redirect(302, url);
      } catch (error) {
        if (error instanceof AppError) {
          return response.redirect(
            302,
            await service.callbackFailureRedirect(error),
          );
        }
        throw error;
      }
    },

    async installations(request, response) {
      const data = await service.listInstallations({
        userId: request.auth.user.id,
        requestId: request.id,
      });
      return response.json(successResponse(data, request.id));
    },

    async installationRepositories(request, response) {
      const data = await service.listInstallationRepositories({
        userId: request.auth.user.id,
        installationId: request.validated.params.installationId,
        requestId: request.id,
      });
      return response.json(successResponse(data, request.id));
    },

    async syncInstallation(request, response) {
      const data = await service.syncInstallationRepositories({
        userId: request.auth.user.id,
        ...request.validated.body,
        requestId: request.id,
      });
      return response.json(successResponse(data, request.id));
    },

    async repositories(request, response) {
      const result = await service.listRepositories({
        userId: request.auth.user.id,
        ...request.validated.query,
        requestId: request.id,
      });
      return paginatedResponse(response, request, result);
    },

    async repository(request, response) {
      const data = await service.getRepository({
        userId: request.auth.user.id,
        ...request.validated.params,
        requestId: request.id,
      });
      return response.json(successResponse(data, request.id));
    },

    async tree(request, response) {
      const result = await service.listTree({
        userId: request.auth.user.id,
        ...request.validated.params,
        ...request.validated.query,
        requestId: request.id,
      });
      return paginatedResponse(response, request, result);
    },

    async file(request, response) {
      const data = await service.getFile({
        userId: request.auth.user.id,
        ...request.validated.params,
        ...request.validated.query,
        requestId: request.id,
      });
      return response.json(successResponse(data, request.id));
    },

    async branches(request, response) {
      const result = await service.listBranches({
        userId: request.auth.user.id,
        ...request.validated.params,
        ...request.validated.query,
        requestId: request.id,
      });
      return paginatedResponse(response, request, result);
    },

    async editorBranch(request, response) {
      const data = await service.getEditorBranch({
        userId: request.auth.user.id,
        ...request.validated.params,
        ...request.validated.query,
        requestId: request.id,
      });
      return response.json(successResponse(data, request.id));
    },

    async webhook(request, response) {
      const result = await service.acceptWebhook({
        rawBody: request.body,
        signature: request.get("x-hub-signature-256"),
        deliveryId: request.get("x-github-delivery"),
        eventType: request.get("x-github-event"),
      });
      return response.status(202).json(successResponse(result, request.id));
    },
  };
}
