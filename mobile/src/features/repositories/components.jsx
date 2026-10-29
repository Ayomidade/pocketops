import { colors } from "../../theme/tokens";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { cssInterop } from "nativewind";
import { breadcrumbs, previewReason, readError } from "./model.js";

cssInterop(SafeAreaView, { className: "style" });

export function Action({ label, onPress, disabled = false, caution = false }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-12 justify-center rounded-xl border px-4 py-3 ${caution ? "border-warning bg-warning/10" : "border-border"}`}
    >
      <Text className={disabled ? "text-textMutedReadable" : caution ? "font-semibold text-warning" : "font-semibold text-accentHi"}>
        {label}
      </Text>
    </Pressable>
  );
}

export function RepositoryFrame({ title, subtitle, onBack, children }) {
  return (
    <SafeAreaView
      className="flex-1 bg-bg"
      edges={["top", "left", "right", "bottom"]}
    >
      <View className="border-b border-border px-5 pb-4 pt-2">
        {onBack ? <Action label="Back" onPress={onBack} /> : null}
        <Text
          accessibilityRole="header"
          className="mt-3 text-3xl font-bold text-textPrimary"
        >
          {title}
        </Text>
        {subtitle ? (
          <Text className="mt-2 text-sm leading-5 text-textSecondary">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {children}
    </SafeAreaView>
  );
}

export function RepositorySkeleton({ label = "Loading repository data" }) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      className="gap-3 p-5"
    >
      <ActivityIndicator color={colors.accentHi} />
      <Text className="text-center text-textSecondary">{label}</Text>
      {[0, 1, 2].map((key) => (
        <View key={key} className="h-16 rounded-xl bg-surface" />
      ))}
    </View>
  );
}

export function RetryState({ error, onRetry }) {
  return (
    <View
      className="gap-3 p-5"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Text className="text-lg font-semibold text-textPrimary">Unable to load</Text>
      <Text className="leading-6 text-textSecondary">{readError(error)}</Text>
      <Action label="Retry" onPress={onRetry} />
    </View>
  );
}

export function ConnectionEmptyState({ connected, searching, onConnect }) {
  return (
    <View className="gap-3 p-5">
      <Text className="text-xl font-semibold text-textPrimary">
        {searching
          ? "No matching repositories"
          : connected
            ? "No repositories selected"
            : "Connect your GitHub App"}
      </Text>
      <Text className="leading-6 text-textSecondary">
        {searching
          ? "Try a different repository name."
          : connected
            ? "Choose repositories in GitHub connections to start browsing."
            : "Sign-in identifies you. A GitHub App connection separately grants read-only repository access."}
      </Text>
      <Action label="Manage GitHub connections" onPress={onConnect} />
    </View>
  );
}

export function CacheNotice({ offline, checking, updatedAt }) {
  if (!offline && !checking && !updatedAt) return null;
  return (
    <View
      className="border-b border-border bg-surface px-5 py-3"
      accessibilityLiveRegion="polite"
    >
      <Text className="text-sm leading-5 text-textSecondary">
        {offline
          ? "Offline · cached metadata may be stale. Reconnect to verify access."
          : checking
            ? "Checking current GitHub access… Cached metadata may be stale."
            : `Last checked ${new Date(updatedAt).toLocaleTimeString()}. Access is checked again when opened.`}
      </Text>
    </View>
  );
}

export function RepositoryCard({ repository, onOpen, disabled }) {
  return (
    <Pressable
      onPress={() => onOpen(repository)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`Open repository ${repository.fullName}`}
      accessibilityState={{ disabled }}
      className="mx-5 my-2 min-h-24 rounded-2xl border border-border bg-surface p-4"
    >
      <View className="flex-row items-start justify-between gap-3">
        <Text className="flex-1 text-lg font-semibold text-textPrimary">
          {repository.fullName}
        </Text>
        <Text className="text-xs text-accentHi">
          {repository.private ? "PRIVATE" : "PUBLIC"}
        </Text>
      </View>
      <Text className="mt-2 text-sm text-textSecondary">
        {repository.defaultBranch || "No default branch"}
        {repository.archived ? " · Archived" : ""}
      </Text>
    </Pressable>
  );
}

export function RepositoryList({
  repositories,
  onOpen,
  disabled,
  refreshing,
  onRefresh,
  header,
  footer,
  empty,
}) {
  return (
    <FlatList
      data={repositories}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <RepositoryCard repository={item} onOpen={onOpen} disabled={disabled} />
      )}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      ListEmptyComponent={empty}
      refreshing={refreshing}
      onRefresh={onRefresh}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      initialNumToRender={12}
      maxToRenderPerBatch={12}
      windowSize={7}
      contentContainerStyle={{ paddingBottom: 24 }}
    />
  );
}

export function Breadcrumbs({ path, onNavigate, disabled }) {
  return (
    <View
      className="flex-row flex-wrap gap-1 px-4 py-2"
      accessibilityLabel="Directory breadcrumbs"
    >
      {breadcrumbs(path).map((crumb) => (
        <Pressable
          key={crumb.path}
          onPress={() => onNavigate(crumb.path)}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={`Navigate to ${crumb.label}`}
          className="min-h-12 justify-center px-2"
        >
          <Text className="text-accentHi">{crumb.label} /</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function FileTreeRow({ entry, onOpen, disabled }) {
  const directory = entry.type === "dir";
  const supported = directory || entry.type === "file";
  return (
    <Pressable
      className="mx-5 min-h-16 flex-row items-center gap-3 border-b border-border py-3"
      onPress={() => onOpen(entry)}
      disabled={disabled || !supported}
      accessibilityRole="button"
      accessibilityLabel={`${directory ? "Open directory" : "Preview file"} ${entry.name}`}
      accessibilityState={{ disabled: disabled || !supported }}
    >
      <Text className="w-10 text-xs font-bold text-accentHi">
        {directory ? "DIR" : "FILE"}
      </Text>
      <View className="flex-1">
        <Text className="text-base text-textPrimary">{entry.name}</Text>
        <Text className="mt-1 text-xs text-textSecondary">
          {entry.type} · {entry.size ?? 0} bytes
          {!supported ? " · Unsupported link or submodule" : ""}
        </Text>
      </View>
      <Text className="text-accentHi">›</Text>
    </Pressable>
  );
}

export function BranchSelector({
  current,
  branches,
  loading,
  error,
  onRetry,
  onMore,
  hasMore,
  onSelect,
  onVisibility,
  disabled,
}) {
  const [open, setOpen] = useState(false);
  const close = () => {
    setOpen(false);
    onVisibility(false);
  };
  return (
    <View className="px-5 py-3">
      <Action
        label={`Branch: ${current || "No branch"}`}
        disabled={disabled}
        onPress={() => {
          setOpen(true);
          onVisibility(true);
        }}
      />
      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={close}
      >
        <SafeAreaView className="flex-1 bg-bg">
          <View className="gap-3 p-5">
            <Text
              accessibilityRole="header"
              className="text-2xl font-bold text-textPrimary"
            >
              Choose a branch
            </Text>
            <Text className="leading-6 text-textSecondary">
              Changing branches returns to the repository root. File contents
              may differ.
            </Text>
            <Action label="Close branches" onPress={close} />
          </View>
          {loading ? (
            <RepositorySkeleton label="Loading branches" />
          ) : error ? (
            <RetryState error={error} onRetry={onRetry} />
          ) : (
            <FlatList
              data={branches}
              keyExtractor={(item) => item.name}
              initialNumToRender={12}
              renderItem={({ item }) => (
                <Pressable
                  className="mx-5 min-h-14 justify-center border-b border-border py-3"
                  accessibilityRole="radio"
                  accessibilityLabel={`Select branch ${item.name}`}
                  accessibilityState={{ selected: item.name === current }}
                  onPress={() => {
                    onSelect(item.name);
                    close();
                  }}
                >
                  <Text className="text-textPrimary">
                    {item.name}
                    {item.protected ? " · Protected" : ""}
                  </Text>
                </Pressable>
              )}
              ListEmptyComponent={
                <Text className="p-5 text-textSecondary">
                  No branches available.
                </Text>
              }
              ListFooterComponent={
                hasMore ? (
                  <Action label="Load more branches" onPress={onMore} />
                ) : null
              }
            />
          )}
        </SafeAreaView>
      </Modal>
    </View>
  );
}

export function FilePreview({ file }) {
  const reason = previewReason(file);
  if (reason)
    return (
      <View className="p-5">
        <Text className="leading-6 text-textSecondary">{reason}</Text>
      </View>
    );
  const allLines = file.content.split("\n", 5001);
  const lines = allLines.slice(0, 5000);
  return (
    <FlatList
      data={lines}
      keyExtractor={(_line, index) => String(index)}
      initialNumToRender={24}
      maxToRenderPerBatch={24}
      windowSize={5}
      ListHeaderComponent={
        <View className="p-5">
          <Text className="text-accentHi">
            Read-only · {file.encoding} ·{" "}
            {file.editable ? "Text supported" : "Not editable"}
          </Text>
          <Text className="mt-2 text-textSecondary">
            Preview limited to 5,000 lines and 2,000 characters per line. No
            edits are saved.
          </Text>
        </View>
      }
      renderItem={({ item, index }) => (
        <View className="flex-row px-3 py-1">
          <Text accessible={false} className="w-12 text-right text-textMutedReadable">
            {index + 1}{" "}
          </Text>
          <Text
            selectable
            style={{
              fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
              flex: 1,
              color: "#E2E8F0",
              fontSize: 13,
              lineHeight: 21,
            }}
          >
            {item.slice(0, 2000) || " "}
            {item.length > 2000 ? " … [line truncated]" : ""}
          </Text>
        </View>
      )}
      ListFooterComponent={
        allLines.length > 5000 ? (
          <Text className="p-5 text-warning">
            Remaining lines are not rendered in this mobile preview.
          </Text>
        ) : null
      }
    />
  );
}

export function MeasuredList({ children, onMeasured }) {
  const start = useRef(Date.now());
  const measured = useRef(false);
  return (
    <View
      className="flex-1"
      onLayout={() => {
        if (!measured.current) {
          measured.current = true;
          onMeasured?.(Date.now() - start.current);
        }
      }}
    >
      {children}
    </View>
  );
}
