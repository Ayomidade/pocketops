import { QueryCache, QueryClient } from "@tanstack/react-query";
import { denied } from "./model.js";

export function createRepositoryClient() {
  let client;
  client = new QueryClient({
    queryCache: new QueryCache({
      onError(error, failed) {
        if (!denied(error)) return;
        // Never retain a known-denied response as usable cached content.
        failed.setState({ data: undefined, dataUpdatedAt: 0 });
        const id = failed.queryKey[1] === "repo" ? failed.queryKey[2] : null;
        const related = (query) =>
          query !== failed &&
          query.queryKey[0] === "repositories" &&
          (!id || query.queryKey[1] === "list" || query.queryKey[2] === id);
        void client.cancelQueries({ predicate: related });
        client.removeQueries({ predicate: related });
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 0,
        gcTime: 2 * 60_000,
        retry: (count, error) =>
          count < 1 && ![401, 403, 404, 413, 422, 429].includes(error?.status),
        retryDelay: 1000,
        refetchOnMount: "always",
        refetchOnWindowFocus: "always",
      },
    },
  });
  return client;
}

export const repositoryKey = (id, kind, ref = "", path = "") => [
  "repositories",
  "repo",
  id,
  kind,
  ref,
  path,
];

export async function disposeRepositoryClient(client) {
  await client.cancelQueries();
  client.clear();
}
