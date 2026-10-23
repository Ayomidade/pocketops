import { AppError } from "../../errors/app-error.js";

const githubApiBaseUrl = "https://api.github.com";
const githubTokenUrl = "https://github.com/login/oauth/access_token";

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    throw new Error("Invalid provider response");
  }
}

export function createGitHubOAuthClient({
  clientId,
  clientSecret,
  callbackUrl,
  fetchImplementation = fetch,
  timeoutMs = 8000,
}) {
  return {
    async getIdentity(code) {
      let tokenResponse;
      try {
        const response = await fetchImplementation(githubTokenUrl, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            redirect_uri: callbackUrl,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        tokenResponse = await readJson(response);
        if (!response.ok || typeof tokenResponse.access_token !== "string") {
          throw new Error("Token exchange failed");
        }
      } catch {
        throw new AppError(
          502,
          "GITHUB_AUTH_UNAVAILABLE",
          "GitHub sign-in could not be completed",
        );
      }

      try {
        const response = await fetchImplementation(`${githubApiBaseUrl}/user`, {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${tokenResponse.access_token}`,
            "X-GitHub-Api-Version": "2022-11-28",
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
        const profile = await readJson(response);
        if (
          !response.ok ||
          !Number.isSafeInteger(profile.id) ||
          profile.id <= 0 ||
          typeof profile.login !== "string" ||
          profile.login.length < 1 ||
          profile.login.length > 100
        ) {
          throw new Error("Invalid identity response");
        }

        return {
          id: String(profile.id),
          login: profile.login,
          email:
            typeof profile.email === "string" && profile.email.length <= 255
              ? profile.email
              : null,
          avatarUrl:
            typeof profile.avatar_url === "string" &&
            profile.avatar_url.startsWith("https://")
              ? profile.avatar_url
              : null,
        };
      } catch {
        throw new AppError(
          502,
          "GITHUB_AUTH_UNAVAILABLE",
          "GitHub sign-in could not be completed",
        );
      }
    },
  };
}
