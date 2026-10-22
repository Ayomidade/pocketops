export function createGitHubApi(request) {
  return {
    startInstallation() {
      return request("/github/installations/start", {
        method: "POST",
        body: {},
      });
    },
    listInstallations() {
      return request("/github/installations");
    },
    listInstallationRepositories(installationId) {
      return request(
        `/github/installations/${encodeURIComponent(installationId)}/repositories`,
      );
    },
    syncInstallation(installationId, githubRepositoryIds) {
      return request("/github/installations/sync", {
        method: "POST",
        body: { installationId, githubRepositoryIds },
      });
    },
    listRepositories(options = {}) {
      const query = new URLSearchParams();
      if (options.cursor) query.set("cursor", options.cursor);
      if (options.limit) query.set("limit", String(options.limit));
      if (options.search) query.set("search", options.search);
      const suffix = query.size ? `?${query.toString()}` : "";
      return request(`/github/repositories${suffix}`);
    },
    getRepository(repositoryId) {
      return request(`/github/repositories/${encodeURIComponent(repositoryId)}`);
    },
    listTree(repositoryId, options = {}) {
      const query = new URLSearchParams();
      if (options.path !== undefined) query.set("path", options.path);
      if (options.ref) query.set("ref", options.ref);
      if (options.cursor) query.set("cursor", options.cursor);
      return request(
        `/github/repositories/${encodeURIComponent(repositoryId)}/tree?${query.toString()}`,
      );
    },
    getFile(repositoryId, path, ref) {
      const query = new URLSearchParams({ path });
      if (ref) query.set("ref", ref);
      return request(
        `/github/repositories/${encodeURIComponent(repositoryId)}/file?${query.toString()}`,
      );
    },
    listBranches(repositoryId, cursor) {
      const query = new URLSearchParams();
      if (cursor) query.set("cursor", cursor);
      const suffix = query.size ? `?${query.toString()}` : "";
      return request(
        `/github/repositories/${encodeURIComponent(repositoryId)}/branches${suffix}`,
      );
    },
  };
}
