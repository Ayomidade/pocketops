export function createGitHubApi(request) {
  return {
    startInstallation() {
      return request("/github/installations/start", {
        method: "POST",
        body: {},
      });
    },
    listInstallations(options = {}) {
      return request("/github/installations", options);
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
      const serialized = query.toString();
      const suffix = serialized ? `?${serialized}` : "";
      return request(`/github/repositories${suffix}`, {
        signal: options.signal,
      });
    },
    getRepository(repositoryId, options = {}) {
      return request(
        `/github/repositories/${encodeURIComponent(repositoryId)}`,
        options,
      );
    },
    listTree(repositoryId, options = {}) {
      const query = new URLSearchParams();
      if (options.path !== undefined) query.set("path", options.path);
      if (options.ref) query.set("ref", options.ref);
      if (options.cursor) query.set("cursor", options.cursor);
      return request(
        `/github/repositories/${encodeURIComponent(repositoryId)}/tree?${query.toString()}`,
        { signal: options.signal },
      );
    },
    getFile(repositoryId, path, ref, options = {}) {
      const query = new URLSearchParams({ path });
      if (ref) query.set("ref", ref);
      return request(
        `/github/repositories/${encodeURIComponent(repositoryId)}/file?${query.toString()}`,
        options,
      );
    },
    listBranches(repositoryId, cursor, options = {}) {
      const query = new URLSearchParams();
      if (cursor) query.set("cursor", cursor);
      const serialized = query.toString();
      const suffix = serialized ? `?${serialized}` : "";
      return request(
        `/github/repositories/${encodeURIComponent(repositoryId)}/branches${suffix}`,
        options,
      );
    },
  };
}
