import { successResponse } from "../../lib/responses.js";

export function createAuthController(service) {
  return {
    async mobileStart(request, response) {
      const result = await service.createMobileStart(
        request.validated.body,
      );
      return response
        .status(201)
        .json(successResponse(result, request.id));
    },

    async authorizationStart(request, response) {
      const authorizationUrl = await service.getAuthorizationUrl(
        request.validated.query.state,
      );
      return response.redirect(302, authorizationUrl);
    },

    async callback(request, response) {
      const result = await service.handleCallback({
        ...request.validated.query,
        requestId: request.id,
      });
      return response.redirect(302, result.redirectUrl);
    },

    async exchange(request, response) {
      const result = await service.exchangeHandoff({
        ...request.validated.body,
        requestId: request.id,
      });
      return response.json(successResponse(result, request.id));
    },

    me(request, response) {
      return response.json(
        successResponse(
          {
            user: request.auth.user,
            session: request.auth.session,
          },
          request.id,
        ),
      );
    },

    async rotate(request, response) {
      const result = await service.rotateSession({
        sessionId: request.auth.session.id,
        replacementToken: request.validated.body.replacementToken,
        requestId: request.id,
      });
      return response.json(successResponse(result, request.id));
    },

    async logout(request, response) {
      const result = await service.logout({
        sessionId: request.auth.session.id,
        userId: request.auth.user.id,
        requestId: request.id,
      });
      return response.json(successResponse(result, request.id));
    },
  };
}
