import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useFocusEffect } from "expo-router";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Pressable, Text, View } from "react-native";
import InfoCard from "../src/components/InfoCard";
import RemoteState from "../src/components/RemoteState";
import Screen from "../src/components/Screen";
import { useAuth } from "../src/features/auth/AuthProvider";
import { createGitHubApi } from "../src/features/github/api.js";
import { parseGitHubAppCallback } from "../src/features/github/callback.js";

function messageFor(error) {
  if (error?.code === "GITHUB_APP_NOT_CONFIGURED") {
    return "GitHub App connection is not configured on this PocketOps server.";
  }
  if (error?.code === "GITHUB_AUTH_REVOKED") {
    return "GitHub authorization expired or was revoked. Reconnect the GitHub App.";
  }
  if (error?.code === "GITHUB_RATE_LIMITED") {
    return "GitHub is rate limiting requests. Wait a little and retry.";
  }
  if (error?.code === "NETWORK_ERROR" || error?.code === "REQUEST_TIMEOUT") {
    return "Unable to reach PocketOps or GitHub. Check your connection and retry.";
  }
  return "GitHub connection could not be loaded. Please retry.";
}

export default function ConnectionsPage() {
  const { authenticatedRequest } = useAuth();
  const githubApi = useMemo(
    () => createGitHubApi(authenticatedRequest),
    [authenticatedRequest],
  );
  const [installations, setInstallations] = useState([]);
  const [installationId, setInstallationId] = useState(null);
  const [repositories, setRepositories] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingRepositories, setLoadingRepositories] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const loadInstallations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await githubApi.listInstallations();
      setInstallations(response.data);
      setInstallationId((current) =>
        response.data.some((item) => item.id === current)
          ? current
          : response.data[0]?.id || null,
      );
    } catch (loadError) {
      setError(messageFor(loadError));
    } finally {
      setLoading(false);
    }
  }, [githubApi]);

  useFocusEffect(
    useCallback(() => {
      void loadInstallations();
    }, [loadInstallations]),
  );

  const loadRepositories = useCallback(async () => {
    if (!installationId) {
      setRepositories([]);
      setSelectedIds([]);
      return;
    }
    setLoadingRepositories(true);
    setError(null);
    try {
      const response =
        await githubApi.listInstallationRepositories(installationId);
      setRepositories(response.data);
      setSelectedIds(
        response.data
          .filter((repository) => repository.selected)
          .map((repository) => repository.githubRepositoryId),
      );
    } catch (loadError) {
      setError(messageFor(loadError));
    } finally {
      setLoadingRepositories(false);
    }
  }, [githubApi, installationId]);

  useEffect(() => {
    void loadRepositories();
  }, [loadRepositories]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    setNotice(null);
    try {
      const started = await githubApi.startInstallation();
      const redirectUri = Linking.createURL("github/callback");
      const result = await WebBrowser.openAuthSessionAsync(
        started.data.authorizationUrl,
        redirectUri,
      );
      if (result.type !== "success" || !result.url) {
        setNotice("GitHub connection was cancelled. You can try again.");
        return;
      }
      const status = parseGitHubAppCallback(result.url, redirectUri);
      if (status === "connected") {
        setNotice(
          "GitHub App connected. Select the repositories PocketOps may access.",
        );
        await loadInstallations();
      } else if (status === "cancelled") {
        setNotice("GitHub connection was cancelled. You can try again.");
      } else {
        setError(
          "GitHub connection did not complete. Retry or check the server setup.",
        );
      }
    } catch (connectError) {
      setError(messageFor(connectError));
    } finally {
      setConnecting(false);
    }
  }, [githubApi, loadInstallations]);

  const toggleRepository = (githubRepositoryId) => {
    setSelectedIds((current) =>
      current.includes(githubRepositoryId)
        ? current.filter((id) => id !== githubRepositoryId)
        : [...current, githubRepositoryId],
    );
  };

  const saveSelection = useCallback(async () => {
    if (!installationId) return;
    setSaving(true);
    setError(null);
    try {
      await githubApi.syncInstallation(installationId, selectedIds);
      setNotice("Repository access selection saved.");
      await loadRepositories();
    } catch (saveError) {
      setError(messageFor(saveError));
    } finally {
      setSaving(false);
    }
  }, [githubApi, installationId, loadRepositories, selectedIds]);

  const currentInstallation = installations.find(
    (item) => item.id === installationId,
  );

  return (
    <Screen
      title="GitHub connections"
      subtitle="Identity sign-in and repository permissions are separate. Only repositories you select here are exposed to PocketOps."
    >
      <InfoCard
        title="Read-only access"
        description="PocketOps requests repository contents and metadata read access only. Branch, commit, pull-request and deployment writes are not available in this milestone."
        badge="GitHub App"
      />

      {error ? (
        <View className="mt-4">
          <RemoteState
            kind="error"
            title="Connection issue"
            message={error}
            onRetry={() =>
              currentInstallation
                ? void loadRepositories()
                : void loadInstallations()
            }
          />
        </View>
      ) : null}
      {notice ? (
        <Text className="mt-4 text-mint" accessibilityRole="status">
          {notice}
        </Text>
      ) : null}

      <Pressable
        className="mt-5 min-h-14 items-center justify-center rounded-xl bg-accent px-5"
        accessibilityRole="button"
        accessibilityLabel="Connect GitHub App"
        accessibilityState={{ disabled: connecting }}
        disabled={connecting}
        onPress={() => void connect()}
      >
        <Text className="font-semibold text-white">
          {connecting ? "Waiting for GitHub..." : "Connect GitHub App"}
        </Text>
      </Pressable>
      <Text className="mt-3 text-sm leading-5 text-slate-400">
        GitHub will ask which account and repositories to grant. PocketOps
        checks both the app installation and your signed-in GitHub account
        before showing repository data.
      </Text>

      {loading ? (
        <RemoteState kind="loading" title="Checking GitHub connections..." />
      ) : installations.length === 0 ? (
        <View className="mt-5">
          <RemoteState
            kind="empty"
            title="No GitHub App connections"
            message="Connect a GitHub App installation to choose repositories. This does not change your PocketOps sign-in."
          />
        </View>
      ) : (
        <View className="mt-6">
          <Text className="mb-2 text-lg font-semibold text-white">
            Connected accounts
          </Text>
          {installations.map((installation) => (
            <Pressable
              key={installation.id}
              className={`mb-2 min-h-14 justify-center rounded-xl border px-4 ${
                installation.id === installationId
                  ? "border-mint bg-panel"
                  : "border-slate-700 bg-panel"
              }`}
              accessibilityRole="button"
              accessibilityLabel={`Manage GitHub installation for ${installation.accountLogin}`}
              accessibilityState={{
                selected: installation.id === installationId,
              }}
              onPress={() => setInstallationId(installation.id)}
            >
              <Text className="font-semibold text-white">
                {installation.accountLogin} ({installation.accountType})
              </Text>
              <Text className="text-sm text-slate-400">
                {installation.selectedRepositoryCount} selected of{" "}
                {installation.repositoryCount} currently authorized
              </Text>
            </Pressable>
          ))}

          {currentInstallation ? (
            <>
              <Text className="mb-2 mt-4 text-lg font-semibold text-white">
                Select repositories
              </Text>
              {loadingRepositories ? (
                <RemoteState
                  kind="loading"
                  title="Verifying current access..."
                />
              ) : repositories.length === 0 ? (
                <RemoteState
                  kind="empty"
                  title="No repositories available"
                  message="This account has no repositories currently authorized by both the installation and your GitHub account."
                />
              ) : (
                repositories.map((repository) => {
                  const checked = selectedIds.includes(
                    repository.githubRepositoryId,
                  );
                  return (
                    <Pressable
                      key={repository.githubRepositoryId}
                      className="mb-2 min-h-14 flex-row items-center rounded-xl border border-slate-700 bg-panel px-4"
                      accessibilityRole="checkbox"
                      accessibilityLabel={`Select ${repository.fullName}`}
                      accessibilityState={{ checked }}
                      onPress={() =>
                        toggleRepository(repository.githubRepositoryId)
                      }
                    >
                      <Text className="mr-3 text-lg text-mint">
                        {checked ? "[x]" : "[ ]"}
                      </Text>
                      <View className="flex-1">
                        <Text className="font-semibold text-white">
                          {repository.fullName}
                        </Text>
                        <Text className="text-sm text-slate-400">
                          {repository.private ? "Private" : "Public"}
                          {repository.archived ? " · Archived" : ""}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })
              )}
              <Pressable
                className="mt-2 min-h-14 items-center justify-center rounded-xl border border-mint px-5"
                accessibilityRole="button"
                accessibilityLabel="Save selected repositories"
                accessibilityState={{ disabled: saving || loadingRepositories }}
                disabled={saving || loadingRepositories}
                onPress={() => void saveSelection()}
              >
                <Text className="font-semibold text-mint">
                  {saving
                    ? "Verifying and saving..."
                    : "Save repository selection"}
                </Text>
              </Pressable>
            </>
          ) : null}
        </View>
      )}
      <Link
        className="mt-6 text-center text-mint"
        href="/(tabs)/repositories"
        accessibilityRole="link"
      >
        Go to repositories
      </Link>
    </Screen>
  );
}
