import { Text } from "../../components/ui";
import { FlatList, View } from "react-native";
import {
  Button,
  RepositoryFrame,
  RepositorySkeleton,
  RetryState,
} from "../repositories/components";
import { useConnectivity } from "../../hooks/useConnectivity";
export { Button, RepositoryFrame as Frame };
export function Copy({ children, alert = false }) {
  return (
    <Text
      accessibilityRole={alert ? "alert" : "text"}
      accessibilityLiveRegion={alert ? "polite" : "none"}
      className="my-2 text-textPrimary leading-6"
    >
      {children}
    </Text>
  );
}
export { Input, DeploymentStatus } from "../../components/ui";
export function QueryState({ query, empty = "Nothing here yet." }) {
  const { isOffline } = useConnectivity();
  if (query.isError)
    return <RetryState error={query.error} onRetry={query.refetch} />;
  if (isOffline)
    return (
      <Copy alert>
        Offline. Cached metadata may be stale. Connect to refresh or request an
        operation.
      </Copy>
    );
  if (query.isPending)
    return <RepositorySkeleton label="Loading deployment data" />;
  return <Copy>{empty}</Copy>;
}
export function Rows({ query, items, renderItem, header, empty }) {
  const { isOffline } = useConnectivity();
  const safeItems = [401, 403, 404, 409].includes(query.error?.status)
    ? []
    : items;
  return (
    <FlatList
      data={safeItems}
      keyExtractor={(item) => item.id || item.operationId}
      renderItem={renderItem}
      contentContainerStyle={{ padding: 20, gap: 12 }}
      keyboardShouldPersistTaps="handled"
      initialNumToRender={12}
      maxToRenderPerBatch={12}
      windowSize={5}
      refreshing={query.isRefetching && !query.isFetchingNextPage}
      onRefresh={query.refetch}
      ListHeaderComponent={
        <View>
          {header}
          {isOffline || query.isError ? <QueryState query={query} /> : null}
        </View>
      }
      ListEmptyComponent={<QueryState query={query} empty={empty} />}
      ListFooterComponent={
        query.hasNextPage ? (
          <Button
            label={query.isFetchingNextPage ? "Loading more" : "Load more"}
            disabled={isOffline || query.isFetchingNextPage}
            onPress={() => query.fetchNextPage()}
          />
        ) : null
      }
    />
  );
}
