import { useMemo } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthProvider";
import { createGitHubApi } from "../github/api.js";
import { repositoryKey } from "./cache.js";

export function useRepositoryApi() {
  const { authenticatedRequest, status } = useAuth();
  const api = useMemo(
    () => createGitHubApi(authenticatedRequest),
    [authenticatedRequest],
  );
  return { api, authenticated: status === "authenticated" };
}

export function useRepositoryList(search) {
  const { api, authenticated } = useRepositoryApi();
  return useInfiniteQuery({
    queryKey: ["repositories", "list", search],
    initialPageParam: undefined,
    queryFn: ({ pageParam, signal }) =>
      api.listRepositories({ search, limit: 30, cursor: pageParam, signal }),
    getNextPageParam: (page, pages) =>
      pages.length < 10 ? page.meta.nextCursor || undefined : undefined,
    maxPages: 10,
    enabled: authenticated,
  });
}

export function useInstallations() {
  const { api, authenticated } = useRepositoryApi();
  return useQuery({
    queryKey: ["repositories", "installations"],
    queryFn: ({ signal }) => api.listInstallations({ signal }),
    enabled: authenticated,
  });
}

export function useRepository(id) {
  const { api, authenticated } = useRepositoryApi();
  return useQuery({
    queryKey: repositoryKey(id, "detail"),
    queryFn: ({ signal }) => api.getRepository(id, { signal }),
    enabled: authenticated && Boolean(id),
  });
}

export function useDirectory(id, ref, path, enabled) {
  const { api, authenticated } = useRepositoryApi();
  return useQuery({
    queryKey: repositoryKey(id, "tree", ref, path),
    queryFn: ({ signal }) => api.listTree(id, { ref, path, signal }),
    enabled: authenticated && enabled && Boolean(ref),
  });
}

export function useBranches(id, enabled) {
  const { api, authenticated } = useRepositoryApi();
  return useInfiniteQuery({
    queryKey: repositoryKey(id, "branches"),
    initialPageParam: undefined,
    queryFn: ({ pageParam, signal }) =>
      api.listBranches(id, pageParam, { signal }),
    getNextPageParam: (page, pages) =>
      pages.length < 10 ? page.meta.nextCursor || undefined : undefined,
    maxPages: 10,
    enabled: authenticated && enabled,
  });
}

export function useRepositoryFile(id, path, ref, enabled) {
  const { api, authenticated } = useRepositoryApi();
  return useQuery({
    queryKey: repositoryKey(id, "file", ref, path),
    queryFn: ({ signal }) => api.getFile(id, path, ref, { signal }),
    enabled: authenticated && enabled && Boolean(path && ref),
    gcTime: 0,
  });
}
