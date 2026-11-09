import { useMemo } from "react";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthProvider";
import { useConnectivity } from "../../hooks/useConnectivity";
import { useSourceVisible } from "../repositories/RepositoryProvider";
import { createIncidentApi } from "./api";
export function useIncidentApi() {
  const { authenticatedRequest } = useAuth();
  return useMemo(
    () => createIncidentApi(authenticatedRequest),
    [authenticatedRequest],
  );
}
export function useIncidentQuery(kind, id) {
  const api = useIncidentApi();
  const { status } = useAuth();
  const { isOffline } = useConnectivity();
  const visible = useSourceVisible();
  return useQuery({
    queryKey: ["incidents", kind, id],
    enabled: status === "authenticated" && !isOffline && visible,
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: "always",
    refetchInterval: 30000,
    queryFn: ({ signal }) => api[kind](id, { signal }),
  });
}
export function useIncidentPages(kind, id, filters = {}) {
  const api = useIncidentApi();
  const { status } = useAuth();
  const { isOffline } = useConnectivity();
  const visible = useSourceVisible();
  return useInfiniteQuery({
    queryKey: ["incidents", kind, id, filters],
    enabled: status === "authenticated" && !isOffline && visible,
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: "always",
    initialPageParam: undefined,
    maxPages: 10,
    queryFn: ({ pageParam, signal }) =>
      kind === "list"
        ? api.list({ ...filters, limit: 10, cursor: pageParam, signal })
        : api.timeline(id, { limit: 20, cursor: pageParam, signal }),
    getNextPageParam: (p) => p.data.nextCursor || undefined,
  });
}
