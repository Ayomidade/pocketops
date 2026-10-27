import { useCallback, useEffect, useState } from "react";
import { BackHandler, FlatList, Text, TextInput, View } from "react-native";
import {
  Redirect,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from "expo-router";
import { useAuth } from "../auth/AuthProvider";
import { useSourceVisible } from "./RepositoryProvider";
import { useConnectivity } from "../../hooks/useConnectivity";
import { denied, flattenPages, repositoryRoute, singleParam } from "./model.js";
import {
  useBranches,
  useDirectory,
  useInstallations,
  useRepository,
  useRepositoryFile,
  useRepositoryList,
} from "./queries.js";
import {
  Action,
  BranchSelector,
  Breadcrumbs,
  CacheNotice,
  ConnectionEmptyState,
  FilePreview,
  FileTreeRow,
  MeasuredList,
  RepositoryFrame,
  RepositoryList,
  RepositorySkeleton,
  RetryState,
} from "./components.jsx";

function useAccess() {
  const { status } = useAuth();
  return status === "authenticated";
}

function useBack() {
  const router = useRouter();
  return () =>
    router.canGoBack() ? router.back() : router.replace("/(tabs)/repositories");
}

export function RepositoriesScreen() {
  const authenticated = useAccess();
  const router = useRouter();
  const { isOffline } = useConnectivity();
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(input.trim().slice(0, 100)), 350);
    return () => clearTimeout(timer);
  }, [input]);
  const repositories = useRepositoryList(search);
  const installations = useInstallations();
  useFocusEffect(
    useCallback(() => {
      void repositories.refetch();
      void installations.refetch();
    }, [repositories.refetch, installations.refetch]),
  );
  const rows =
    denied(repositories.error) || denied(installations.error)
      ? []
      : flattenPages(repositories.data);
  if (!authenticated) return <Redirect href="/(auth)/login" />;
  const connectionError = installations.error || repositories.error;
  return (
    <RepositoryFrame
      title="Repositories"
      subtitle="Your selected codebases. Read-only access, checked by PocketOps."
    >
      <View className="gap-3 p-5">
        <View className="flex-row justify-between">
          <Text className="font-semibold text-mint">GITHUB WORKSPACE</Text>
          <Action
            label="Connections"
            onPress={() => router.push("/connections")}
          />
        </View>
        <TextInput
          value={input}
          onChangeText={setInput}
          maxLength={100}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Search owner or repository"
          placeholderTextColor="#94A3B8"
          accessibilityLabel="Search repositories"
          className="min-h-12 rounded-xl border border-slate-600 bg-panel px-4 text-white"
        />
        {installations.data && !denied(installations.error) ? (
          <Text className="text-sm text-slate-300">
            Connected accounts:{" "}
            {installations.data.data
              .map((item) => item.accountLogin)
              .join(", ") || "None"}
          </Text>
        ) : null}
      </View>
      <CacheNotice
        offline={isOffline}
        checking={
          repositories.isFetching ||
          installations.isFetching ||
          Boolean(connectionError)
        }
        updatedAt={repositories.dataUpdatedAt}
      />
      {repositories.isPending && !repositories.data ? (
        isOffline ? (
          <RetryState
            error={{ code: "NETWORK_ERROR" }}
            onRetry={() => repositories.refetch()}
          />
        ) : (
          <RepositorySkeleton />
        )
      ) : (
        <MeasuredList>
          <RepositoryList
            repositories={rows}
            disabled={
              isOffline || repositories.isFetching || Boolean(connectionError)
            }
            onOpen={(repo) => router.push(repositoryRoute(repo.id))}
            refreshing={repositories.isRefetching}
            onRefresh={() => {
              void repositories.refetch();
              void installations.refetch();
            }}
            header={
              connectionError ? (
                <RetryState
                  error={connectionError}
                  onRetry={() => {
                    void repositories.refetch();
                    void installations.refetch();
                  }}
                />
              ) : null
            }
            empty={
              !connectionError && installations.isPending ? (
                <RepositorySkeleton label="Checking GitHub connections" />
              ) : !connectionError ? (
                <ConnectionEmptyState
                  connected={Boolean(installations.data?.data.length)}
                  searching={Boolean(search)}
                  onConnect={() => router.push("/connections")}
                />
              ) : null
            }
            footer={
              repositories.hasNextPage ? (
                <View className="p-5">
                  <Action
                    label={
                      repositories.isFetchingNextPage
                        ? "Loading more…"
                        : "Load more repositories"
                    }
                    disabled={repositories.isFetching || isOffline}
                    onPress={() => repositories.fetchNextPage()}
                  />
                </View>
              ) : repositories.data?.pages.length === 10 &&
                repositories.data.pages[9].meta.nextCursor ? (
                <Text className="p-5 text-amber-300">
                  Showing the first 300 repositories. Narrow your search for
                  more.
                </Text>
              ) : null
            }
          />
        </MeasuredList>
      )}
    </RepositoryFrame>
  );
}

export function DirectoryScreen() {
  const params = useLocalSearchParams();
  const id = singleParam(params.id);
  const path = singleParam(params.path);
  const selectedRef = singleParam(params.ref);
  const authenticated = useAccess();
  const router = useRouter();
  const back = useBack();
  const { isOffline } = useConnectivity();
  const repo = useRepository(id);
  const ref = selectedRef || repo.data?.data.defaultBranch || "";
  const [branchOpen, setBranchOpen] = useState(false);
  const [branchNotice, setBranchNotice] = useState(false);
  const tree = useDirectory(id, ref, path, repo.isSuccess && !repo.isFetching);
  const branches = useBranches(id, branchOpen && repo.isSuccess);
  useEffect(() => {
    if (!selectedRef && ref) router.setParams({ ref });
  }, [selectedRef, ref, router]);
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener(
        "hardwareBackPress",
        () => {
          if (!path) return false;
          router.setParams({ path: path.split("/").slice(0, -1).join("/") });
          return true;
        },
      );
      return () => subscription.remove();
    }, [path, router]),
  );
  if (!authenticated) return <Redirect href="/(auth)/login" />;
  const error = repo.error || tree.error;
  const hidden = denied(error);
  const checking = repo.isFetching || tree.isFetching;
  const disabled = isOffline || checking || Boolean(error);
  const navigate = (nextPath) => router.setParams({ ref, path: nextPath });
  return (
    <RepositoryFrame
      title={
        hidden
          ? "Repository unavailable"
          : repo.data?.data.fullName || "Repository"
      }
      subtitle={
        hidden
          ? undefined
          : repo.data?.data.description || "Browse one directory at a time."
      }
      onBack={() =>
        path ? navigate(path.split("/").slice(0, -1).join("/")) : back()
      }
    >
      <CacheNotice
        offline={isOffline}
        checking={checking || Boolean(error)}
        updatedAt={tree.dataUpdatedAt}
      />
      {!hidden && repo.data ? (
        <View className="px-5 pt-3">
          <Text className="text-sm text-slate-300">
            {repo.data.data.private ? "Private" : "Public"} ·{" "}
            {repo.data.data.archived ? "Archived" : "Active"} · Default:{" "}
            {repo.data.data.defaultBranch || "None"}
          </Text>
        </View>
      ) : null}
      <BranchSelector
        current={ref}
        branches={
          denied(branches.error) ? [] : flattenPages(branches.data, "name")
        }
        loading={branches.isPending || branches.isFetchingNextPage}
        error={branches.error}
        onRetry={() => branches.refetch()}
        hasMore={branches.hasNextPage}
        onMore={() => branches.fetchNextPage()}
        disabled={disabled || !ref}
        onVisibility={setBranchOpen}
        onSelect={(nextRef) => {
          setBranchNotice(true);
          router.setParams({ ref: nextRef, path: "" });
        }}
      />
      {branchNotice ? (
        <Text accessibilityLiveRegion="polite" className="px-5 pb-3 text-mint">
          Branch changed. Contents may differ; returned to root.
        </Text>
      ) : null}
      {!hidden ? (
        <Breadcrumbs path={path} disabled={disabled} onNavigate={navigate} />
      ) : null}
      {error ? (
        <RetryState
          error={error}
          onRetry={() => {
            void repo.refetch();
            void tree.refetch();
          }}
        />
      ) : null}
      {!error && (repo.isPending || (ref && tree.isPending)) ? (
        isOffline ? (
          <RetryState
            error={{ code: "NETWORK_ERROR" }}
            onRetry={() => repo.refetch()}
          />
        ) : (
          <RepositorySkeleton label="Loading directory" />
        )
      ) : null}
      {!hidden && tree.data ? (
        <FlatList
          key={`${id}:${ref}:${path}`}
          data={tree.data.data}
          keyExtractor={(entry) => entry.path}
          initialNumToRender={16}
          maxToRenderPerBatch={16}
          windowSize={7}
          refreshing={tree.isRefetching}
          onRefresh={() => {
            void repo.refetch();
            void tree.refetch();
          }}
          renderItem={({ item }) => (
            <FileTreeRow
              entry={item}
              disabled={disabled}
              onOpen={(entry) =>
                entry.type === "dir"
                  ? navigate(entry.path)
                  : router.push(repositoryRoute(id, ref, entry.path, true))
              }
            />
          )}
          ListEmptyComponent={
            <Text className="p-5 text-slate-300">This directory is empty.</Text>
          }
          ListFooterComponent={
            tree.data.meta?.directoryLimitReached ? (
              <Text className="p-5 text-amber-300">
                Directory limit reached: GitHub returns at most 1,000 entries.
                This listing may be incomplete.
              </Text>
            ) : null
          }
          contentContainerStyle={{ paddingBottom: 24 }}
        />
      ) : null}
      {!ref && repo.isSuccess ? (
        <Text className="p-5 text-slate-300">
          This repository has no default branch or files yet.
        </Text>
      ) : null}
    </RepositoryFrame>
  );
}

export function FileScreen() {
  const visible = useSourceVisible();
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  return visible && focused ? <VisibleFileScreen /> : null;
}

function VisibleFileScreen() {
  const params = useLocalSearchParams();
  const id = singleParam(params.id);
  const path = singleParam(params.path);
  const ref = singleParam(params.ref);
  const authenticated = useAccess();
  const back = useBack();
  const router = useRouter();
  const { isOffline } = useConnectivity();
  const repo = useRepository(id);
  const file = useRepositoryFile(
    id,
    path,
    ref,
    repo.isSuccess && !repo.isFetching,
  );
  const error = repo.error || file.error;
  if (!authenticated) return <Redirect href="/(auth)/login" />;
  if (!id || !path || !ref)
    return (
      <RepositoryFrame title="File unavailable" onBack={back}>
        <Text className="p-5 text-slate-300">
          Open a file from its repository and branch to preview it.
        </Text>
      </RepositoryFrame>
    );
  return (
    <RepositoryFrame
      title="File preview"
      subtitle={denied(error) ? undefined : path}
      onBack={back}
    >
      {error ? (
        <RetryState
          error={error}
          onRetry={() => {
            void repo.refetch();
            void file.refetch();
          }}
        />
      ) : null}
      {isOffline ? (
        <Text accessibilityRole="alert" className="p-5 text-amber-300">
          Offline. Reconnect to verify access before viewing source.
        </Text>
      ) : null}
      {!error &&
      !isOffline &&
      (repo.isPending ||
        repo.isFetching ||
        file.isPending ||
        file.isFetching) ? (
        <RepositorySkeleton label="Loading file preview" />
      ) : null}
      {!error &&
      !isOffline &&
      !repo.isFetching &&
      !file.isFetching &&
      file.data ? (
        <>
          <View className="gap-2 border-b border-slate-700 p-5">
            <Text className="text-mint">Branch / ref: {ref}</Text>
            <Text selectable className="text-sm text-slate-300">
              {file.data.data.size} bytes · Blob SHA: {file.data.data.sha}
            </Text>
            <Text className="text-xs text-slate-400">
              Blob revision, not the last commit timestamp.
            </Text>
          </View>
          <FilePreview file={file.data.data} />
          {file.data.data.editable && !file.data.data.binary ? (
            <View className="border-t border-slate-700 p-5">
              <Text className="mb-3 text-sm text-slate-300">
                Editing creates a new fix branch and requires confirmation before committing.
              </Text>
              <Action
                label="Edit on a fix branch"
                onPress={() =>
                  router.push({
                    pathname: "/editor/[id]",
                    params: { id, path, ref },
                  })
                }
              />
            </View>
          ) : null}
        </>
      ) : null}
    </RepositoryFrame>
  );
}
