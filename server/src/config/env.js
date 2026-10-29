import "dotenv/config";
import { z } from "zod";

const optionalEnvString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    TRUST_PROXY: z.enum(["false", "loopback"]).default("false"),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    DATABASE_URL: z.string().trim().optional(),
    DATABASE_SSL: z.enum(["true", "false"]).default("false"),
    CORS_ORIGINS: z.string().default(""),
    GITHUB_OAUTH_CLIENT_ID: optionalEnvString,
    GITHUB_OAUTH_CLIENT_SECRET: optionalEnvString,
    GITHUB_OAUTH_CALLBACK_URL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().url().optional(),
    ),
    MOBILE_AUTH_REDIRECT_URI: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().url().optional(),
    ),
    API_PUBLIC_URL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().url().optional(),
    ),
    GITHUB_APP_ID: optionalEnvString,
    GITHUB_APP_CLIENT_ID: optionalEnvString,
    GITHUB_APP_CLIENT_SECRET: optionalEnvString,
    GITHUB_APP_PRIVATE_KEY: optionalEnvString.refine(
      (value) => !value || /-----BEGIN [A-Z ]+PRIVATE KEY-----/.test(value),
      "must be a valid PEM private key",
    ),
    GITHUB_APP_SLUG: optionalEnvString,
    GITHUB_APP_WEBHOOK_SECRET: optionalEnvString,
    GITHUB_APP_OAUTH_CALLBACK_URL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().url().optional(),
    ),
    GITHUB_APP_SETUP_CALLBACK_URL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().url().optional(),
    ),
    GITHUB_APP_MOBILE_REDIRECT_URI: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().url().optional(),
    ),
    GITHUB_TOKEN_ENCRYPTION_KEY: optionalEnvString,
    PROVIDER_ENCRYPTION_KEYS: optionalEnvString,
    PROVIDER_ACTIVE_KEY_VERSION: optionalEnvString,
    DEPLOYMENTS_ENABLED: z.enum(["true", "false"]).default("false"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .optional(),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV === "production" && !value.DATABASE_URL) {
      context.addIssue({
        code: "custom",
        path: ["DATABASE_URL"],
        message: "is required in production",
      });
    }

    if (value.DATABASE_URL) {
      try {
        const databaseUrl = new URL(value.DATABASE_URL);
        if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol)) {
          throw new Error("unsupported protocol");
        }
        if (!databaseUrl.hostname || !databaseUrl.pathname.slice(1)) {
          throw new Error("host and database name are required");
        }
      } catch {
        context.addIssue({
          code: "custom",
          path: ["DATABASE_URL"],
          message: "must be a valid PostgreSQL connection URL",
        });
      }
    }

    if (
      !!value.PROVIDER_ENCRYPTION_KEYS !== !!value.PROVIDER_ACTIVE_KEY_VERSION
    ) {
      context.addIssue({
        code: "custom",
        path: ["PROVIDER_ENCRYPTION_KEYS"],
        message: "key ring and active version must be configured together",
      });
    }
    if (value.DEPLOYMENTS_ENABLED === "true" && !value.PROVIDER_ENCRYPTION_KEYS)
      context.addIssue({
        code: "custom",
        path: ["DEPLOYMENTS_ENABLED"],
        message: "requires a provider key ring",
      });
    if (value.PROVIDER_ENCRYPTION_KEYS) {
      try {
        const keys = JSON.parse(value.PROVIDER_ENCRYPTION_KEYS);
        if (
          !keys ||
          Array.isArray(keys) ||
          typeof keys !== "object" ||
          !keys[value.PROVIDER_ACTIVE_KEY_VERSION] ||
          Object.keys(keys).length > 5 ||
          Object.entries(keys).some(
            ([version, key]) =>
              !/^[a-zA-Z0-9_-]{1,32}$/.test(version) ||
              typeof key !== "string" ||
              Buffer.from(key, "base64").length !== 32 ||
              Buffer.from(key, "base64").toString("base64") !== key,
          )
        )
          throw new Error();
      } catch {
        context.addIssue({
          code: "custom",
          path: ["PROVIDER_ENCRYPTION_KEYS"],
          message:
            "must be a JSON key ring of up to five versioned base64 32-byte keys including the active key",
        });
      }
    }
    const oauthValues = [
      value.GITHUB_OAUTH_CLIENT_ID,
      value.GITHUB_OAUTH_CLIENT_SECRET,
      value.GITHUB_OAUTH_CALLBACK_URL,
      value.MOBILE_AUTH_REDIRECT_URI,
      value.API_PUBLIC_URL,
    ];
    if (oauthValues.some(Boolean) && oauthValues.some((item) => !item)) {
      context.addIssue({
        code: "custom",
        path: ["GITHUB_OAUTH_CLIENT_ID"],
        message:
          "GitHub OAuth client ID, client secret, callback URL, and mobile redirect URI must be configured together",
      });
    }

    if (value.GITHUB_OAUTH_CALLBACK_URL) {
      const callback = new URL(value.GITHUB_OAUTH_CALLBACK_URL);
      if (
        !["http:", "https:"].includes(callback.protocol) ||
        callback.username ||
        callback.password ||
        callback.search ||
        callback.hash ||
        (value.NODE_ENV === "production" && callback.protocol !== "https:")
      ) {
        context.addIssue({
          code: "custom",
          path: ["GITHUB_OAUTH_CALLBACK_URL"],
          message: "must use HTTPS in production",
        });
      }
    }

    if (value.API_PUBLIC_URL) {
      const publicApiUrl = new URL(value.API_PUBLIC_URL);
      if (
        !["http:", "https:"].includes(publicApiUrl.protocol) ||
        publicApiUrl.pathname !== "/" ||
        publicApiUrl.username ||
        publicApiUrl.password ||
        publicApiUrl.search ||
        publicApiUrl.hash ||
        (value.NODE_ENV === "production" && publicApiUrl.protocol !== "https:")
      ) {
        context.addIssue({
          code: "custom",
          path: ["API_PUBLIC_URL"],
          message: "must use HTTPS in production",
        });
      }
    }

    if (value.GITHUB_OAUTH_CALLBACK_URL && value.API_PUBLIC_URL) {
      const expectedCallback = new URL(
        "/api/v1/auth/github/callback",
        value.API_PUBLIC_URL,
      ).toString();
      if (value.GITHUB_OAUTH_CALLBACK_URL !== expectedCallback) {
        context.addIssue({
          code: "custom",
          path: ["GITHUB_OAUTH_CALLBACK_URL"],
          message: "must match API_PUBLIC_URL and the canonical callback path",
        });
      }
    }

    if (value.MOBILE_AUTH_REDIRECT_URI) {
      const redirect = new URL(value.MOBILE_AUTH_REDIRECT_URI);
      if (
        !/^[a-z][a-z\d+.-]*:$/.test(redirect.protocol) ||
        ["http:", "https:", "javascript:", "data:", "file:", "ftp:"].includes(
          redirect.protocol,
        ) ||
        !redirect.hostname ||
        redirect.username ||
        redirect.password ||
        redirect.search ||
        redirect.hash
      ) {
        context.addIssue({
          code: "custom",
          path: ["MOBILE_AUTH_REDIRECT_URI"],
          message:
            "must be an allowlisted native app URI without credentials, query, or fragment",
        });
      }
    }

    // Partial GitHub App setup must not prevent unrelated API features from starting.
    // Supplied values are validated below; loadConfig enables the integration only
    // when its complete credential/callback set is available.
    if (value.GITHUB_APP_ID && !/^\d+$/.test(value.GITHUB_APP_ID)) {
      context.addIssue({
        code: "custom",
        path: ["GITHUB_APP_ID"],
        message: "must be a numeric GitHub App ID",
      });
    }
    if (value.GITHUB_APP_SLUG && !/^[a-z\d-]+$/.test(value.GITHUB_APP_SLUG)) {
      context.addIssue({
        code: "custom",
        path: ["GITHUB_APP_SLUG"],
        message: "must be a valid GitHub App slug",
      });
    }
    if (value.GITHUB_TOKEN_ENCRYPTION_KEY) {
      const key = Buffer.from(value.GITHUB_TOKEN_ENCRYPTION_KEY, "base64");
      if (
        key.length !== 32 ||
        key.toString("base64") !== value.GITHUB_TOKEN_ENCRYPTION_KEY
      ) {
        context.addIssue({
          code: "custom",
          path: ["GITHUB_TOKEN_ENCRYPTION_KEY"],
          message: "must be a base64-encoded 32-byte key",
        });
      }
    }
    for (const key of [
      "GITHUB_APP_OAUTH_CALLBACK_URL",
      "GITHUB_APP_SETUP_CALLBACK_URL",
    ]) {
      const callbackValue = value[key];
      if (callbackValue) {
        const callback = new URL(callbackValue);
        if (
          !["http:", "https:"].includes(callback.protocol) ||
          callback.username ||
          callback.password ||
          callback.search ||
          callback.hash ||
          (value.NODE_ENV === "production" && callback.protocol !== "https:")
        ) {
          context.addIssue({
            code: "custom",
            path: [key],
            message: "must be an HTTPS callback URL in production",
          });
        }
      }
    }
    for (const key of [
      "GITHUB_APP_OAUTH_CALLBACK_URL",
      "GITHUB_APP_SETUP_CALLBACK_URL",
    ]) {
      if (value[key] && value.API_PUBLIC_URL) {
        const expectedPath =
          key === "GITHUB_APP_OAUTH_CALLBACK_URL"
            ? "/api/v1/github/oauth/callback"
            : "/api/v1/github/installations/callback";
        const expectedUrl = new URL(
          expectedPath,
          value.API_PUBLIC_URL,
        ).toString();
        if (value[key] !== expectedUrl) {
          context.addIssue({
            code: "custom",
            path: [key],
            message: `must match API_PUBLIC_URL and ${expectedPath}`,
          });
        }
      }
    }
    if (value.GITHUB_APP_MOBILE_REDIRECT_URI) {
      const redirect = new URL(value.GITHUB_APP_MOBILE_REDIRECT_URI);
      if (
        redirect.protocol !== "pocketops:" ||
        redirect.hostname !== "github" ||
        redirect.pathname !== "/callback" ||
        redirect.username ||
        redirect.password ||
        redirect.search ||
        redirect.hash
      ) {
        context.addIssue({
          code: "custom",
          path: ["GITHUB_APP_MOBILE_REDIRECT_URI"],
          message: "must be exactly pocketops://github/callback",
        });
      }
    }

    for (const origin of value.CORS_ORIGINS.split(",")
      .map((item) => item.trim())
      .filter(Boolean)) {
      try {
        const parsedOrigin = new URL(origin);
        if (
          !["http:", "https:"].includes(parsedOrigin.protocol) ||
          parsedOrigin.origin !== origin ||
          parsedOrigin.username ||
          parsedOrigin.password
        ) {
          throw new Error("origin must not contain a path or credentials");
        }
      } catch {
        context.addIssue({
          code: "custom",
          path: ["CORS_ORIGINS"],
          message:
            "must contain only HTTP(S) origins without paths or credentials",
        });
      }
    }
  });

export function loadConfig(source = process.env) {
  const result = environmentSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path[0] || "environment"} ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }

  const config = result.data;
  const githubAppValues = [
    config.GITHUB_APP_ID,
    config.GITHUB_APP_CLIENT_ID,
    config.GITHUB_APP_CLIENT_SECRET,
    config.GITHUB_APP_PRIVATE_KEY,
    config.GITHUB_APP_SLUG,
    config.GITHUB_APP_WEBHOOK_SECRET,
    config.GITHUB_APP_OAUTH_CALLBACK_URL,
    config.GITHUB_APP_SETUP_CALLBACK_URL,
    config.GITHUB_APP_MOBILE_REDIRECT_URI,
    config.GITHUB_TOKEN_ENCRYPTION_KEY,
  ];
  return {
    nodeEnv: config.NODE_ENV,
    trustProxy: config.TRUST_PROXY === "loopback" ? "loopback" : false,
    providerEncryptionKeys: config.PROVIDER_ENCRYPTION_KEYS
      ? Object.fromEntries(
          Object.entries(JSON.parse(config.PROVIDER_ENCRYPTION_KEYS)).map(
            ([version, key]) => [version, Buffer.from(key, "base64")],
          ),
        )
      : {},
    providerActiveKeyVersion: config.PROVIDER_ACTIVE_KEY_VERSION || null,
    deploymentsEnabled: config.DEPLOYMENTS_ENABLED === "true",
    port: config.PORT,
    databaseUrl: config.DATABASE_URL || null,
    databaseSsl: config.DATABASE_SSL === "true",
    corsOrigins: config.CORS_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    githubOAuthClientId: config.GITHUB_OAUTH_CLIENT_ID || null,
    githubOAuthClientSecret: config.GITHUB_OAUTH_CLIENT_SECRET || null,
    githubOAuthCallbackUrl: config.GITHUB_OAUTH_CALLBACK_URL || null,
    mobileAuthRedirectUri: config.MOBILE_AUTH_REDIRECT_URI || null,
    publicApiUrl: config.API_PUBLIC_URL || null,
    githubAppId: config.GITHUB_APP_ID || null,
    githubAppClientId: config.GITHUB_APP_CLIENT_ID || null,
    githubAppClientSecret: config.GITHUB_APP_CLIENT_SECRET || null,
    githubAppPrivateKey:
      config.GITHUB_APP_PRIVATE_KEY?.replaceAll("\\n", "\n") || null,
    githubAppSlug: config.GITHUB_APP_SLUG || null,
    githubAppWebhookSecret: config.GITHUB_APP_WEBHOOK_SECRET || null,
    githubAppOAuthCallbackUrl: config.GITHUB_APP_OAUTH_CALLBACK_URL || null,
    githubAppSetupCallbackUrl: config.GITHUB_APP_SETUP_CALLBACK_URL || null,
    githubAppMobileRedirectUri: config.GITHUB_APP_MOBILE_REDIRECT_URI || null,
    githubTokenEncryptionKey: config.GITHUB_TOKEN_ENCRYPTION_KEY
      ? Buffer.from(config.GITHUB_TOKEN_ENCRYPTION_KEY, "base64")
      : null,
    githubAppEnabled: githubAppValues.every(Boolean),
    githubOAuthEnabled: [
      config.GITHUB_OAUTH_CLIENT_ID,
      config.GITHUB_OAUTH_CLIENT_SECRET,
      config.GITHUB_OAUTH_CALLBACK_URL,
      config.MOBILE_AUTH_REDIRECT_URI,
      config.API_PUBLIC_URL,
    ].every(Boolean),
    logLevel:
      config.LOG_LEVEL ||
      (config.NODE_ENV === "development" ? "debug" : "info"),
  };
}
