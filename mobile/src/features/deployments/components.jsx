import { FlatList, Text, TextInput, View } from "react-native";
import { Action, RepositoryFrame, RepositorySkeleton, RetryState } from "../repositories/components";
import { useConnectivity } from "../../hooks/useConnectivity";
export { Action, RepositoryFrame as Frame };
export function Copy({ children, alert = false }) {
  return <Text accessibilityRole={alert ? "alert" : "text"} accessibilityLiveRegion={alert ? "polite" : "none"} className="my-2 text-slate-200 leading-6">{children}</Text>;
}
export function Input({ label, ...props }) {
  return <View className="my-2"><Copy>{label}</Copy><TextInput accessibilityLabel={label} placeholderTextColor="#94a3b8" className="min-h-12 rounded-xl border border-slate-600 px-3 py-3 text-white" autoCapitalize="none" autoCorrect={false} maxLength={100} {...props} /></View>;
}
export function QueryState({ query, empty = "Nothing here yet." }) {
  const { isOffline } = useConnectivity();
  if (query.isError) return <RetryState error={query.error} onRetry={query.refetch} />;
  if (isOffline) return <Copy alert>Offline. Cached metadata may be stale. Connect to refresh or request an operation.</Copy>;
  if (query.isPending) return <RepositorySkeleton label="Loading deployment data" />;
  return <Copy>{empty}</Copy>;
}
export function Rows({ query, items, renderItem, header, empty }) {
  const { isOffline } = useConnectivity();
  const safeItems = [401, 403, 404, 409].includes(query.error?.status) ? [] : items;
  return <FlatList data={safeItems} keyExtractor={(item) => item.id || item.operationId} renderItem={renderItem}
    contentContainerStyle={{ padding: 20, gap: 12 }} keyboardShouldPersistTaps="handled" initialNumToRender={12} maxToRenderPerBatch={12} windowSize={5}
    refreshing={query.isRefetching && !query.isFetchingNextPage} onRefresh={query.refetch}
    ListHeaderComponent={<View>{header}{isOffline || query.isError ? <QueryState query={query} /> : null}</View>}
    ListEmptyComponent={<QueryState query={query} empty={empty} />}
    ListFooterComponent={query.hasNextPage ? <Action label={query.isFetchingNextPage ? "Loading more" : "Load more"} disabled={isOffline || query.isFetchingNextPage} onPress={() => query.fetchNextPage()} /> : null} />;
}
export function Status({ value, health = "not_checked" }) {
  return <View className="rounded-xl bg-panel p-4"><Copy>Deployment: {value}</Copy><Copy>Application health: {health === "not_checked" ? "Not checked" : health}</Copy><Copy>A live deployment is not verified service recovery.</Copy></View>;
}
