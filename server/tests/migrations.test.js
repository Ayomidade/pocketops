import { describe, expect, it } from "vitest";
import { Sequelize } from "sequelize";
import { runMigrations } from "../src/db/migrate.js";
import { defineModels } from "../src/db/models/index.js";
import { createAuthRepository } from "../src/modules/auth/repository.js";
import { createAuthService, hashCredential } from "../src/modules/auth/service.js";
import { createGitHubRepository } from "../src/modules/github/repository.js";

const testDatabaseUrl = process.env.DATABASE_URL_TEST;

describe("users and sessions migrations", () => {
  it.skipIf(!testDatabaseUrl)(
    "applies and reverses migrations in a dedicated disposable test database",
    async () => {
      const databaseName = new URL(testDatabaseUrl).pathname.slice(1);
      expect(databaseName).toMatch(/_test$/);

      const sequelize = new Sequelize(testDatabaseUrl, {
        dialect: "postgres",
        logging: false,
      });
      try {
        await sequelize.authenticate();
        const existingTables = await sequelize
          .getQueryInterface()
          .showAllTables();
        expect(existingTables).toEqual([]);

        expect(await runMigrations({ sequelize, direction: "up" })).toEqual([
          "001-create-users.js",
          "002-create-sessions.js",
          "003-create-auth-workflows.js",
          "004-create-github-integration.js",
        ]);
        expect(await runMigrations({ sequelize, direction: "up" })).toEqual([]);

        const userIndexes = await sequelize
          .getQueryInterface()
          .showIndex("users");
        const sessionIndexes = await sequelize
          .getQueryInterface()
          .showIndex("sessions");
        expect(userIndexes.some((index) => index.unique)).toBe(true);
        expect(sessionIndexes.some((index) => index.unique)).toBe(true);
        expect(
          sessionIndexes.some((index) => index.name === "sessions_user_expiry_index"),
        ).toBe(true);
        const oauthIndexes = await sequelize
          .getQueryInterface()
          .showIndex("oauth_transactions");
        const auditIndexes = await sequelize
          .getQueryInterface()
          .showIndex("auth_audit_events");
        expect(oauthIndexes.some((index) => index.unique)).toBe(true);
        expect(
          oauthIndexes.some(
            (index) => index.name === "oauth_transactions_handoff_expiry_index",
          ),
        ).toBe(true);
        expect(
          auditIndexes.some(
            (index) => index.name === "auth_audit_actor_time_index",
          ),
        ).toBe(true);
        const installationIndexes = await sequelize
          .getQueryInterface()
          .showIndex("github_installations");
        const membershipIndexes = await sequelize
          .getQueryInterface()
          .showIndex("installation_memberships");
        const repositoryIndexes = await sequelize
          .getQueryInterface()
          .showIndex("repositories");
        const deliveryIndexes = await sequelize
          .getQueryInterface()
          .showIndex("webhook_deliveries");
        expect(installationIndexes.some((index) => index.unique)).toBe(true);
        expect(membershipIndexes.some((index) => index.unique)).toBe(true);
        expect(repositoryIndexes.some((index) => index.unique)).toBe(true);
        expect(deliveryIndexes.some((index) => index.unique)).toBe(true);
        expect(
          deliveryIndexes.some((index) => index.name === "webhook_deliveries_queue_index"),
        ).toBe(true);

        const models = defineModels(sequelize);
        const repository = createAuthRepository({ sequelize, models });
        const state = "s".repeat(43);
        const handoff = "h".repeat(43);
        const sessionToken = "t".repeat(43);
        const credentials = [state, handoff, "w".repeat(43), sessionToken];
        const mobileRedirectUri = "pocketops://auth/callback";
        let now = new Date("2026-10-22T08:00:00Z");
        const service = createAuthService({
          repository,
          githubOAuthClient: {
            getIdentity: async () => ({
              id: "78901",
              login: "auth-test-user",
              email: null,
              avatarUrl: null,
            }),
          },
          config: {
            githubOAuthEnabled: true,
            githubOAuthClientId: "client-id",
            githubOAuthClientSecret: "server-only-secret",
            githubOAuthCallbackUrl:
              "https://api.example.test/api/v1/auth/github/callback",
            mobileAuthRedirectUri: mobileRedirectUri,
            publicApiUrl: "https://api.example.test",
          },
          clock: () => new Date(now),
          credentialGenerator: () => credentials.shift() || "n".repeat(43),
        });

        const started = await service.createMobileStart({
          redirectUri: mobileRedirectUri,
          completionSecret: "c".repeat(64),
        });
        const authorization = new URL(
          await service.getAuthorizationUrl(state),
        );
        expect(authorization.searchParams.get("state")).toBe(state);
        const callback = await service.handleCallback({
          state,
          code: "test-code",
          requestId: "migration-auth-callback",
        });
        expect(new URL(callback.redirectUrl).searchParams.get("handoff")).toBe(
          handoff,
        );
        await expect(
          service.exchangeHandoff({
            handoffCode: handoff,
            completionSecret: "x".repeat(64),
            requestId: "migration-auth-wrong-completion-secret",
          }),
        ).rejects.toMatchObject({ code: "INVALID_HANDOFF", status: 401 });
        const exchanged = await service.exchangeHandoff({
          handoffCode: handoff,
          completionSecret: "c".repeat(64),
          deviceLabel: "test mobile",
          requestId: "migration-auth-exchange",
        });
        expect(exchanged.token).toBe(sessionToken);
        expect(exchanged.user.email).toBeNull();
        expect(await service.authenticateToken(sessionToken)).toMatchObject({
          user: { username: "auth-test-user" },
        });
        expect(
          (await models.Session.findOne()).tokenHash,
        ).toBe(hashCredential(sessionToken));
        await expect(
          service.exchangeHandoff({
            handoffCode: handoff,
            completionSecret: "c".repeat(64),
            requestId: "migration-auth-replay",
          }),
        ).rejects.toMatchObject({ code: "INVALID_HANDOFF", status: 401 });

        const replacementToken = "r".repeat(43);
        await service.rotateSession({
          sessionId: exchanged.session.id,
          userId: exchanged.user.id,
          replacementToken,
          requestId: "migration-auth-rotate",
        });
        await expect(
          service.authenticateToken(sessionToken),
        ).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
        expect(await service.authenticateToken(replacementToken)).toMatchObject({
          user: { id: exchanged.user.id },
        });
        now = new Date("2026-12-02T08:00:00Z");
        await expect(
          service.authenticateToken(replacementToken),
        ).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
        await service.logout({
          sessionId: (
            await models.Session.findOne({
              where: { tokenHash: hashCredential(replacementToken) },
            })
          ).id,
          userId: exchanged.user.id,
          requestId: "migration-auth-logout",
        });
        await expect(
          service.authenticateToken(replacementToken),
        ).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
        expect(
          (await models.AuthAuditEvent.findAll()).map((event) => event.action),
        ).toEqual(
          expect.arrayContaining([
            "oauth_callback_accepted",
            "oauth_identity_verified",
            "session_created",
            "session_rotated",
            "session_revoked",
          ]),
        );
        expect(started.authorizationUrl).not.toContain("server-only-secret");

        const user = await models.User.findOne({
          where: { githubUserId: "78901" },
        });
        const installation = await models.GitHubInstallation.create({
          githubInstallationId: "98765",
          githubAccountId: "12345",
          accountLogin: "test-org",
          accountType: "Organization",
          repositorySelection: "selected",
          permissions: { contents: "read" },
          suspendedAt: null,
          removedAt: null,
          createdAt: now,
          updatedAt: now,
        });
        const membership = await models.InstallationMembership.create({
          installationId: installation.id,
          userId: user.id,
          githubUserId: user.githubUserId,
          githubUserTokenEncrypted: "v1.encrypted",
          githubRefreshTokenEncrypted: "v1.refresh",
          accessTokenExpiresAt: new Date(now.getTime() + 60_000),
          refreshTokenExpiresAt: new Date(now.getTime() + 60_000),
          status: "active",
          lastVerifiedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        expect(membership.installationId).toBe(installation.id);
        const githubRepository = await models.GitHubRepository.create({
          installationId: installation.id,
          githubRepositoryId: "54321",
          ownerLogin: "test-org",
          ownerGithubId: "12345",
          name: "sample",
          fullName: "test-org/sample",
          defaultBranch: "main",
          isPrivate: true,
          isArchived: false,
          removedAt: null,
          lastSyncedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        await models.RepositorySelection.create({
          repositoryId: githubRepository.id,
          userId: user.id,
          selectedAt: now,
        });
        expect(
          await models.RepositorySelection.count({
            where: { repositoryId: githubRepository.id, userId: user.id },
          }),
        ).toBe(1);

        const githubRepositoryStore = createGitHubRepository({ sequelize, models });
        const githubStateHash = "a".repeat(64);
        const installStateHash = "b".repeat(64);
        const installationLink = await githubRepositoryStore.createLink({
          stateHash: githubStateHash,
          userId: user.id,
          githubUserId: user.githubUserId,
          expiresAt: new Date(now.getTime() + 15 * 60_000),
        });
        expect(
          await githubRepositoryStore.authorizeLink({
            linkId: installationLink.id,
            installStateHash,
            accessTokenEncrypted: "v1.access",
            refreshTokenEncrypted: "v1.refresh",
            accessTokenExpiresAt: new Date(now.getTime() + 60 * 60_000),
            refreshTokenExpiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
            now,
          }),
        ).toBe(true);
        expect(
          await githubRepositoryStore.claimInstallationCallback(installStateHash, now),
        ).toMatchObject({ id: installationLink.id });
        expect(
          await githubRepositoryStore.claimInstallationCallback(installStateHash, now),
        ).toBeNull();

        const delivery = {
          deliveryId: "test-delivery-removal",
          eventType: "installation_repositories",
          payload: {
            action: "removed",
            installationId: "98765",
            repositoryIds: ["54321"],
          },
          now,
        };
        expect(await githubRepositoryStore.upsertWebhookDelivery(delivery)).toBe(true);
        expect(await githubRepositoryStore.upsertWebhookDelivery(delivery)).toBe(false);
        await githubRepositoryStore.processWebhookEvent({
          eventType: delivery.eventType,
          payload: delivery.payload,
          requestId: "test-webhook-removal",
          now,
        });
        await githubRepository.reload();
        expect(githubRepository.removedAt).toEqual(now);
        expect(
          await models.RepositorySelection.count({
            where: { repositoryId: githubRepository.id, userId: user.id },
          }),
        ).toBe(0);
        await githubRepositoryStore.processWebhookEvent({
          eventType: "installation",
          payload: { action: "deleted", installationId: "98765" },
          requestId: "test-webhook-uninstall",
          now,
        });
        await membership.reload();
        expect(membership.status).toBe("revoked");
        await models.WebhookDelivery.create({
          deliveryId: "test-delivery-ignored-old",
          eventType: "deployment_status",
          payload: {},
          status: "ignored",
          attemptCount: 0,
          receivedAt: new Date(now.getTime() - 31 * 24 * 60 * 60_000),
          nextAttemptAt: now,
        });
        await githubRepositoryStore.cleanup(now);
        expect(
          await models.WebhookDelivery.count({
            where: { deliveryId: "test-delivery-ignored-old" },
          }),
        ).toBe(0);

        const expiredState = "n".repeat(43);
        now = new Date("2026-10-22T08:00:00Z");
        await service.createMobileStart({
          redirectUri: mobileRedirectUri,
          completionSecret: "d".repeat(64),
        });
        now = new Date("2026-10-22T08:11:00Z");
        await expect(
          service.handleCallback({
            state: expiredState,
            code: "expired-code",
            requestId: "migration-auth-expired-state",
          }),
        ).rejects.toMatchObject({ code: "INVALID_OAUTH_STATE", status: 400 });

        expect(
          await runMigrations({ sequelize, direction: "down", all: true }),
        ).toEqual([
          "004-create-github-integration.js",
          "003-create-auth-workflows.js",
          "002-create-sessions.js",
          "001-create-users.js",
        ]);
        await sequelize.getQueryInterface().dropTable("SequelizeMeta");
        expect(await sequelize.getQueryInterface().showAllTables()).toEqual([]);
      } finally {
        await sequelize.close();
      }
    },
    15000,
  );
});
