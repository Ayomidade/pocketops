import { registerDeploymentContract } from "./deployments.js";
// The public contract covers implemented v1 endpoints only. Regenerate with npm run api:contract.
const string = { type: "string" };
const boolean = { type: "boolean" };
const nullableString = { type: "string", nullable: true };
const integer = { type: "integer", minimum: 0 };
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const array = (items) => ({ type: "array", items });
const object = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});
const user = object({
  id: string,
  githubUserId: string,
  username: string,
  email: nullableString,
  avatarUrl: nullableString,
});
const session = object({ id: string, expiresAt: string });
const repositoryFields = {
  id: nullableString,
  githubRepositoryId: string,
  owner: string,
  name: string,
  fullName: string,
  defaultBranch: nullableString,
  private: boolean,
  archived: boolean,
  selected: boolean,
  lastSyncedAt: nullableString,
};
const schemas = {
  User: user,
  Session: session,
  Authorization: object({ authorizationUrl: string }),
  Identity: object({ user: ref("User"), session: ref("Session") }),
  SessionExchange: object({
    token: string,
    user: ref("User"),
    session: ref("Session"),
  }),
  LoggedOut: object({ loggedOut: { type: "boolean", enum: [true] } }),
  Health: object({
    status: { type: "string", enum: ["ok"] },
    service: { type: "string", enum: ["pocketops-api"] },
  }),
  Ready: object({
    status: { type: "string", enum: ["ready"] },
    dependencies: object({
      postgres: { type: "string", enum: ["ready"] },
      redis: { type: "string", enum: ["not_required"] },
    }),
  }),
  Installation: object({
    id: string,
    githubInstallationId: string,
    accountLogin: string,
    accountType: string,
    repositorySelection: string,
    suspended: boolean,
    lastSyncedAt: nullableString,
    repositoryCount: integer,
    selectedRepositoryCount: integer,
  }),
  Repository: object(
    repositoryFields,
    Object.keys(repositoryFields).filter((key) => key !== "lastSyncedAt"),
  ),
  RepositoryDetail: object({
    id: string,
    githubRepositoryId: string,
    owner: string,
    name: string,
    fullName: string,
    description: nullableString,
    defaultBranch: nullableString,
    private: boolean,
    archived: boolean,
    htmlUrl: string,
  }),
  TreeEntry: object({
    name: string,
    path: string,
    type: string,
    sha: string,
    size: integer,
  }),
  File: object({
    path: string,
    ref: nullableString,
    sha: string,
    size: { type: "integer", minimum: 0, maximum: 524288 },
    encoding: { type: "string", enum: ["utf-8", "binary"] },
    content: nullableString,
    editable: boolean,
  }),
  Branch: object({ name: string, commitSha: string, protected: boolean }),
  FixBranch: object({
    branch: string,
    baseBranch: string,
    baseSha: string,
    duplicate: boolean,
  }),
  FileCommit: object({
    branch: string,
    path: string,
    contentSha: nullableString,
    commitSha: nullableString,
    duplicate: boolean,
  }),
  PullRequest: object({
    number: integer,
    url: string,
    state: string,
    head: string,
    base: string,
    title: string,
    draft: boolean,
  }),
  PullRequestResult: object({
    number: integer,
    url: string,
    state: string,
    head: string,
    base: string,
    title: string,
    draft: boolean,
    duplicate: boolean,
  }),
  WebhookAccepted: object({
    accepted: { type: "boolean", enum: [true] },
    duplicate: boolean,
    ignored: boolean,
  }),
  Error: object({
    success: { type: "boolean", enum: [false] },
    error: object({ code: string, message: string }),
    meta: object({ requestId: string }),
  }),
};
const envelope = (data, paginated = false) =>
  object({
    success: { type: "boolean", enum: [true] },
    data,
    meta: object(
      {
        requestId: string,
        ...(paginated
          ? { nextCursor: nullableString, directoryLimitReached: boolean }
          : {}),
      },
      paginated ? ["requestId", "nextCursor"] : ["requestId"],
    ),
  });
const json = (schema) => ({ "application/json": { schema } });
const parameter = (name, location, schema = string, required = false) => ({
  name,
  in: location,
  required,
  schema,
});
const credential = { type: "string", pattern: "^[A-Za-z0-9_-]{43}$" };
const secret = { type: "string", pattern: "^[a-fA-F0-9]{64}$" };
const state = parameter("state", "query", credential, true);
const oauthQuery = [
  state,
  parameter("code", "query", { type: "string", maxLength: 2048 }),
  parameter("error", "query", { type: "string", maxLength: 100 }),
];
const paths = {};
function endpoint(path, method, operationId, data, options = {}) {
  const {
    public: isPublic = false,
    status = 200,
    body,
    parameters = [],
    paginated = false,
    redirect = false,
  } = options;
  const pathParameters = [...path.matchAll(/\{(\w+)\}/g)].map((match) =>
    parameter(match[1], "path", { type: "string", format: "uuid" }, true),
  );
  const operation = {
    operationId,
    security: isPublic ? [] : [{ PocketOpsSession: [] }],
    parameters: [...pathParameters, ...parameters],
    responses: {
      [redirect ? 302 : status]: redirect
        ? {
            description:
              "Redirect to the provider or allowlisted native callback",
            headers: { Location: { required: true, schema: string } },
          }
        : {
            description:
              status === 202
                ? "Accepted for processing; not completed"
                : "Success",
            content: json(envelope(data, paginated)),
          },
      default: {
        description:
          "Safe validation, authorization, throttling or upstream error",
        content: json(ref("Error")),
      },
    },
  };
  if (body) operation.requestBody = { required: true, content: json(body) };
  paths[path] = { ...paths[path], [method]: operation };
}
endpoint("/health", "get", "health", ref("Health"), { public: true });
endpoint("/ready", "get", "ready", ref("Ready"), { public: true });
endpoint("/auth/mobile/start", "post", "startIdentity", ref("Authorization"), {
  public: true,
  status: 201,
  body: object({
    redirectUri: { type: "string", maxLength: 500 },
    completionSecret: secret,
  }),
});
endpoint("/auth/github", "get", "authorizeIdentity", null, {
  public: true,
  redirect: true,
  parameters: [state],
});
endpoint("/auth/github/start", "get", "authorizeIdentityAlias", null, {
  public: true,
  redirect: true,
  parameters: [state],
});
endpoint("/auth/github/callback", "get", "identityCallback", null, {
  public: true,
  redirect: true,
  parameters: oauthQuery,
});
endpoint(
  "/auth/mobile/exchange",
  "post",
  "exchangeIdentity",
  ref("SessionExchange"),
  {
    public: true,
    body: object(
      {
        handoffCode: credential,
        completionSecret: secret,
        deviceLabel: { type: "string", maxLength: 100 },
      },
      ["handoffCode", "completionSecret"],
    ),
  },
);
endpoint("/auth/me", "get", "currentIdentity", ref("Identity"));
endpoint("/auth/session/rotate", "post", "rotateSession", ref("Identity"), {
  body: object({
    replacementToken: {
      type: "string",
      pattern: "^(?:[A-Za-z0-9_-]{43}|[a-fA-F0-9]{64})$",
    },
  }),
});
endpoint("/auth/logout", "post", "logout", ref("LoggedOut"));
endpoint(
  "/github/installations/start",
  "post",
  "startInstallation",
  ref("Authorization"),
  { status: 201, body: object({}) },
);
endpoint("/github/oauth/callback", "get", "githubOAuthCallback", null, {
  public: true,
  redirect: true,
  parameters: oauthQuery,
});
endpoint(
  "/github/installations/callback",
  "get",
  "installationCallback",
  null,
  {
    public: true,
    redirect: true,
    parameters: [
      state,
      parameter(
        "installation_id",
        "query",
        { type: "string", pattern: "^\\d{1,20}$" },
        true,
      ),
      parameter(
        "setup_action",
        "query",
        { type: "string", enum: ["install", "update"] },
        true,
      ),
    ],
  },
);
endpoint(
  "/github/installations",
  "get",
  "listInstallations",
  array(ref("Installation")),
);
endpoint(
  "/github/installations/{installationId}/repositories",
  "get",
  "installationRepositories",
  array(ref("Repository")),
);
endpoint(
  "/github/installations/sync",
  "post",
  "selectRepositories",
  array(ref("Repository")),
  {
    body: object({
      installationId: { type: "string", format: "uuid" },
      githubRepositoryIds: {
        type: "array",
        maxItems: 100,
        uniqueItems: true,
        items: { type: "string", pattern: "^\\d{1,20}$" },
      },
    }),
  },
);
const cursor = parameter("cursor", "query", { type: "string", maxLength: 500 });
const pathQuery = parameter("path", "query", {
  type: "string",
  maxLength: 1024,
});
const branchRef = parameter("ref", "query", {
  type: "string",
  minLength: 1,
  maxLength: 255,
  pattern: "^[^\\u0000-\\u001f\\u007f]+$",
});
endpoint(
  "/github/repositories",
  "get",
  "listRepositories",
  array(ref("Repository")),
  {
    paginated: true,
    parameters: [
      cursor,
      parameter("limit", "query", {
        type: "integer",
        minimum: 1,
        maximum: 100,
        default: 50,
      }),
      parameter("search", "query", { type: "string", maxLength: 100 }),
    ],
  },
);
endpoint(
  "/github/repositories/{repositoryId}",
  "get",
  "repositoryDetail",
  ref("RepositoryDetail"),
);
endpoint(
  "/github/repositories/{repositoryId}/tree",
  "get",
  "repositoryTree",
  array(ref("TreeEntry")),
  { paginated: true, parameters: [pathQuery, branchRef, cursor] },
);
endpoint(
  "/github/repositories/{repositoryId}/file",
  "get",
  "repositoryFile",
  ref("File"),
  { parameters: [{ ...pathQuery, required: true }, branchRef] },
);
endpoint(
  "/github/repositories/{repositoryId}/branches/metadata",
  "get",
  "repositoryBranchMetadata",
  ref("Branch"),
  { parameters: [parameter("branch", "query", { type: "string", minLength: 1, maxLength: 255 }, true)] },
);
endpoint(
  "/github/repositories/{repositoryId}/branches",
  "get",
  "repositoryBranches",
  array(ref("Branch")),
  { paginated: true, parameters: [cursor] },
);
const idempotencyKey = parameter(
  "Idempotency-Key",
  "header",
  { type: "string", minLength: 16, maxLength: 100 },
  true,
);
endpoint(
  "/github/repositories/{repositoryId}/branches",
  "post",
  "createFixBranch",
  ref("FixBranch"),
  {
    status: 201,
    parameters: [idempotencyKey],
    body: object({
      branch: { type: "string", minLength: 1, maxLength: 255 },
      baseBranch: { type: "string", minLength: 1, maxLength: 255 },
      baseSha: { type: "string", pattern: "^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$" },
    }),
  },
);
endpoint(
  "/github/repositories/{repositoryId}/file",
  "put",
  "commitFixFile",
  ref("FileCommit"),
  {
    parameters: [idempotencyKey],
    body: object({
      branch: { type: "string", minLength: 1, maxLength: 255 },
      path: { type: "string", minLength: 1, maxLength: 1024 },
      content: { type: "string", maxLength: 524288 },
      expectedSha: { type: "string", pattern: "^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$" },
      commitMessage: { type: "string", minLength: 1, maxLength: 200 },
    }),
  },
);
endpoint(
  "/github/repositories/{repositoryId}/pull-requests",
  "get",
  "listFixPullRequests",
  array(ref("PullRequest")),
  {
    parameters: [
      parameter("head", "query", { type: "string", minLength: 1, maxLength: 255 }, true),
      parameter("base", "query", { type: "string", minLength: 1, maxLength: 255 }),
      parameter("state", "query", { type: "string", enum: ["open", "closed", "all"], default: "open" }),
    ],
  },
);
endpoint(
  "/github/repositories/{repositoryId}/pull-requests",
  "post",
  "createFixPullRequest",
  ref("PullRequestResult"),
  {
    status: 201,
    parameters: [idempotencyKey],
    body: object({
      head: { type: "string", minLength: 1, maxLength: 255 },
      base: { type: "string", minLength: 1, maxLength: 255 },
      title: { type: "string", minLength: 1, maxLength: 200 },
      body: { type: "string", maxLength: 4000 },
      draft: boolean,
    }, ["head", "base", "title"]),
  },
);
endpoint("/webhooks/github", "post", "githubWebhook", ref("WebhookAccepted"), {
  public: true,
  status: 202,
  body: { type: "object", additionalProperties: true },
  parameters: [
    "X-Hub-Signature-256",
    "X-GitHub-Delivery",
    "X-GitHub-Event",
  ].map((name) => parameter(name, "header", string, true)),
});

registerDeploymentContract({ schemas, endpoint, parameter });

export const openapi = {
  openapi: "3.0.3",
  info: {
    title: "PocketOps implemented API",
    version: "0.1.0",
    description:
      "Identity, GitHub App repository APIs, guarded source editing and manual Render deployments. Unversioned health/auth aliases are legacy aliases. Provider credentials never belong in bearer authentication. Webhooks require HMAC over raw bytes, not a PocketOps session.",
  },
  servers: [{ url: "/api/v1" }],
  paths,
  components: {
    securitySchemes: {
      PocketOpsSession: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "Opaque PocketOps session",
      },
    },
    schemas,
  },
};
