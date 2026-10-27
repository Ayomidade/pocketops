import { useMemo } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthProvider";
import { createDeploymentApi } from "./api.js";
export function useDeploymentApi() {
  const { authenticatedRequest } = useAuth();
  return useMemo(() => createDeploymentApi(authenticatedRequest), [authenticatedRequest]);
}
export function useDeploymentList(kind, id = "", extra = {}, enabled = true) {
  const api = useDeploymentApi(); const { status } = useAuth();
  const serialized = JSON.stringify(extra);
  return useInfiniteQuery({ queryKey: ["deployments", kind, id, serialized], initialPageParam: undefined,
    enabled: status === "authenticated" && enabled,
    gcTime: kind === "logs" ? 0 : 120000,
    queryFn: ({ pageParam, signal }) => id ? api[kind](id, { ...JSON.parse(serialized), cursor: pageParam, signal }) : api[kind]({ ...JSON.parse(serialized), cursor: pageParam, signal }),
    getNextPageParam: (last) => last.data.nextCursor || undefined });
}
export function useDeploymentDetail(kind, id, enabled = true) {
  const api = useDeploymentApi(); const { status } = useAuth();
  return useQuery({ queryKey: ["deployments", kind, id], enabled: !!id && enabled && status === "authenticated",
    queryFn: ({ signal }) => api[kind](id, { signal }),
    refetchInterval: kind === "operation" ? (query) => ["queued", "validating", "requesting", "accepted"].includes(query.state.data?.data?.status) ? 5000 : false : false });
}
export function listItems(query) { return query.data?.pages.flatMap((p) => p.data.items) || []; }
