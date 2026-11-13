import { useConfirmation } from "../../components/ui/ConfirmationProvider";
import MasterDetail, { usePaneRouter as useRouter, usePaneParams as useLocalSearchParams } from "../../components/ui/MasterDetail";
import { ListRow, StatusPill } from "../../components/ui";
import { Text } from "../../components/ui";
import { useEffect, useRef, useState } from "react";
import { AppState, KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { Redirect } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { useAuth } from "../auth/AuthProvider";
import { useConnectivity } from "../../hooks/useConnectivity";
import { useSourceVisible } from "../repositories/RepositoryProvider";
import { useRepositoryList } from "../repositories/queries";
import {
  useDeploymentApi,
  useDeploymentDetail,
  useDeploymentList,
  listItems,
} from "./queries";
import {
  Button,
  Copy,
  Frame,
  Input,
  QueryState,
  Rows,
  DeploymentStatus,
} from "./components";
import { createLogWindow } from "./log-window.js";

function usePage() {
  const router = useRouter();
  const { status } = useAuth();
  const { isOffline } = useConnectivity();
  return { router, isOffline, authenticated: status === "authenticated" };
}
function SignedOut() {
  const { status } = useAuth();
  return status === "starting" ? (
    <Frame title="Restoring session">
      <QueryState query={{ isPending: true }} />
    </Frame>
  ) : (
    <Redirect href="/(auth)/login" />
  );
}
function ErrorNotice({ error }) {
  return error ? (
    <Copy alert>
      {error.message ||
        "Unable to complete the request. Retry after checking access."}
    </Copy>
  ) : null;
}
function Card({ children }) {
  return (
    <View className="rounded-2xl border border-border bg-surface p-4">
      {children}
    </View>
  );
}
function routeId(value) {
  return typeof value === "string" ? value : "";
}

export function DeploymentsScreen() { return <MasterDetail route="/project/[id]" master={<DeploymentsScreenList />} renderDetail={() => <ProjectScreen />} />; }
function DeploymentsScreenList() {
  const { router, authenticated, isOffline } = usePage();
  const query = useDeploymentList("projects");
  if (!authenticated) return <SignedOut />;
  return (
    <Frame
      title="Projects"
      subtitle="Services, deployment history and runtime logs."
    >
      <Rows
        query={query}
        items={listItems(query)}
        empty="No projects mapped. Connect Render and choose a GitHub-backed service."
        header={
          <View className="gap-3 mb-4">
            <Button
              label="Manage Render connections"
              onPress={() => router.push("/project/connections")}
            />
            <Button
              label="Map a service"
              disabled={isOffline}
              onPress={() => router.push("/project/new")}
            />
          </View>
        }
        renderItem={({ item }) => (
          <ListRow icon="deploy" title={item.name} meta="Render service" badge={<StatusPill value={item.status} />} label={`Open project ${item.name}`} disabled={isOffline || item.status !== "active"} onPress={() => router.push({ pathname: "/project/[id]", params: { id: item.id } })} />
        )}
      />
    </Frame>
  );
}

export function RenderConnectionsScreen() {
  const requestConfirmation = useConfirmation();
  const { router, authenticated, isOffline } = usePage();
  const api = useDeploymentApi();
  const client = useQueryClient();
  const query = useDeploymentList("connections");
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") setKey("");
    });
    return () => sub.remove();
  }, []);
  async function connect() {
    const apiKey = key;
    setKey("");
    setBusy(true);
    setError(null);
    try {
      await api.connect({ apiKey, displayName: name.trim() });
      setName("");
      await client.invalidateQueries({ queryKey: ["deployments"] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  function disconnect(item) {
    requestConfirmation(
      "Disconnect Render?",
      `${item.displayName}: linked projects become disconnected. An already dispatched deployment may still proceed. Revoke the API key in Render Account Settings to revoke it globally.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            setError(null);
            try {
              await api.disconnect(item.id);
              await client.cancelQueries({ queryKey: ["deployments"] });
              client.removeQueries({ queryKey: ["deployments"] });
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }
  if (!authenticated) return <SignedOut />;
  return (
    <Frame
      title="Render connections"
      onBack={() => router.back()}
      subtitle="Create an API key in Render Account Settings. Keys can have broad account access; use a separate test account."
    >
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Rows
          query={query}
          items={listItems(query)}
          empty="No Render connections. Your GitHub browsing remains available."
          header={
            <View>
              <Input
                label="Connection name"
                value={name}
                onChangeText={setName}
              />
              <Input
                label="Render API key"
                value={key}
                onChangeText={setKey}
                secureTextEntry
                maxLength={512}
                autoComplete="off"
                textContentType="none"
                importantForAutofill="no"
              />
              <Copy>
                The key is sent to PocketOps for encrypted server storage. It is
                cleared from this form and is never returned by the API or
                persisted on this phone.
              </Copy>
              <ErrorNotice error={error} />
              <Button
                label={busy ? "Connecting" : "Connect Render"}
                disabled={busy || isOffline || !key.trim() || !name.trim()}
                onPress={connect}
              />
            </View>
          }
          renderItem={({ item }) => (
            <Card>
              <Copy>
                {item.displayName} · {item.status}
              </Copy>
              <Button
                label={`Disconnect ${item.displayName}`}
                disabled={busy || isOffline || item.status !== "active"}
                onPress={() => disconnect(item)}
              />
            </Card>
          )}
        />
      </KeyboardAvoidingView>
    </Frame>
  );
}

function ServiceSelection({ connection, onSelect }) {
  const query = useDeploymentList("services", connection.id);
  const { isOffline } = useConnectivity();
  return (
    <Rows
      query={query}
      items={listItems(query)}
      empty="No accessible Render services. Select services in Render, then refresh."
      header={
        <Copy>
          {connection.displayName}: choose the exact GitHub-backed service.
        </Copy>
      }
      renderItem={({ item }) => (
        <Card>
          <Copy>
            {item.name} · {item.type}
          </Copy>
          <Copy>
            {item.repositoryFullName || "No supported GitHub repository"}
          </Copy>
          <Copy>{item.id}</Copy>
          <Button
            label={`Select service ${item.name}`}
            disabled={isOffline || !item.repositoryFullName}
            onPress={() => onSelect(item)}
          />
        </Card>
      )}
    />
  );
}
function RepositorySelection({ service, onSelect }) {
  const query = useRepositoryList(service.repositoryFullName);
  const { isOffline } = useConnectivity();
  const repos = query.data?.pages.flatMap((p) => p.data || []) || [];
  return (
    <Rows
      query={query}
      items={repos}
      empty="Select the service's repository in GitHub connections first, then refresh."
      header={
        <Copy>
          Map {service.name} to its currently authorized GitHub repository:{" "}
          {service.repositoryFullName}
        </Copy>
      }
      renderItem={({ item }) => (
        <Card>
          <Copy>{item.fullName}</Copy>
          <Button
            label={`Map repository ${item.fullName}`}
            disabled={
              isOffline ||
              item.fullName.toLowerCase() !==
                service.repositoryFullName.toLowerCase()
            }
            onPress={() => onSelect(item)}
          />
        </Card>
      )}
    />
  );
}
export function NewProjectScreen() {
  const { router, authenticated, isOffline } = usePage();
  const api = useDeploymentApi();
  const query = useDeploymentList("connections");
  const client = useQueryClient();
  const [connection, setConnection] = useState(null);
  const [service, setService] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function map(repo) {
    setBusy(true);
    setError(null);
    try {
      const result = await api.createProject({
        name: service.name,
        repositoryId: repo.id,
        connectionId: connection.id,
        providerServiceId: service.id,
      });
      await client.invalidateQueries({ queryKey: ["deployments", "projects"] });
      router.replace({
        pathname: "/project/[id]",
        params: { id: result.data.id },
      });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  if (!authenticated) return <SignedOut />;
  return (
    <Frame
      title="Map a service"
      onBack={() =>
        service
          ? setService(null)
          : connection
            ? setConnection(null)
            : router.back()
      }
    >
      <View className="px-5">
        <ErrorNotice error={error} />
        {busy ? <Copy>Creating project…</Copy> : null}
      </View>
      {busy ? null : service ? (
        <RepositorySelection service={service} onSelect={map} />
      ) : connection ? (
        <ServiceSelection connection={connection} onSelect={setService} />
      ) : (
        <Rows
          query={query}
          items={listItems(query).filter((c) => c.status === "active")}
          empty="Connect Render before mapping a service."
          header={<Copy>Choose a Render connection.</Copy>}
          renderItem={({ item }) => (
            <Button
              label={`Choose connection ${item.displayName}`}
              disabled={isOffline}
              onPress={() => setConnection(item)}
            />
          )}
        />
      )}
    </Frame>
  );
}

export function LogRow({ item, fontSize = 14 }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View>
      <Copy>
        {item.timestamp} · {item.level}
      </Copy>
      <Text
        selectable
        className="font-mono text-textPrimary"
        style={{ fontSize, lineHeight: fontSize * 1.6 }}
        numberOfLines={expanded ? undefined : 20}
      >
        {item.message}
      </Text>
      <Button
        label={`${expanded ? "Collapse" : "Expand"} log ${item.id}`}
        onPress={() => setExpanded(!expanded)}
      />
    </View>
  );
}
function Logs({ projectId, enabled, header }) {
  const [fontSize, setFontSize] = useState(14);
  const [window, setWindow] = useState(() => createLogWindow());
  const [level, setLevel] = useState("");
  const { isOffline } = useConnectivity();
  const query = useDeploymentList(
    "logs",
    projectId,
    { ...window, ...(level ? { level } : {}), limit: 50 },
    enabled && !isOffline,
  );
  const items = listItems(query);
  return (
    <Rows
      query={query}
      items={isOffline || !enabled ? [] : items}
      empty="No logs in this bounded time window."
      header={
        <View>
          {header}
          <View className="flex-row gap-2">
            <Button
              label="Smaller log text"
              disabled={fontSize <= 12}
              onPress={() => setFontSize((size) => size - 2)}
            />
            <Button
              label="Larger log text"
              disabled={fontSize >= 24}
              onPress={() => setFontSize((size) => size + 2)}
            />
          </View>
          <Copy>
            Runtime logs · {window.from} → {window.to}
          </Copy>
          <Text className="text-xs text-textSecondary">Redacted, bounded runtime logs. Not saved on this phone.</Text>
          {query.data?.pages.some((p) => p.data.truncated) ? (
            <Copy alert>
              The page was truncated at the byte limit. Narrow the time window
              or filter by level.
            </Copy>
          ) : null}
          <Button
            label="Refresh log window"
            disabled={isOffline}
            onPress={() => setWindow(createLogWindow())}
          />
          <Button
            label={level ? "Show all log levels" : "Show error logs"}
            onPress={() => setLevel(level ? "" : "error")}
          />
        </View>
      }
      renderItem={({ item }) => <LogRow item={item} fontSize={fontSize} />}
    />
  );
}

export function ProjectScreen() {
  const { router, authenticated, isOffline } = usePage();
  const { id: rawId, tab: initialTab } = useLocalSearchParams();
  const id = routeId(rawId);
  const query = useDeploymentDetail("project", id);
  const history = useDeploymentList("deployments", id);
  const visible = useSourceVisible();
  const [tab, setTab] = useState(initialTab === "logs" ? "logs" : "timeline");
  const project = query.data?.data;
  if (!authenticated) return <SignedOut />;
  if (!project || query.isError)
    return (
      <Frame title="Project" onBack={() => router.back()}>
        <QueryState query={query} />
      </Frame>
    );
  const header = (
    <View className="gap-2 mb-4">
      <Button
        label="Refresh project"
        disabled={isOffline || query.isFetching}
        onPress={() => {
          void query.refetch();
          void history.refetch();
        }}
      />
      <Copy>Project mapping: {project.status}</Copy>
      <DeploymentStatus value={listItems(history)[0]?.status || "unknown"} />
      <Button
        caution
        label="Review redeployment"
        disabled={
          isOffline || query.isFetching || !project.capabilities.canRedeploy
        }
        onPress={() =>
          router.push({ pathname: "/project/redeploy", params: { id } })
        }
      />
      {!project.capabilities.canRedeploy ? (
        <Copy>
          Redeploy unavailable: disabled by operator, unsupported service, no
          known live commit, or a pending operation.
        </Copy>
      ) : null}
      {project.pendingOperation ? (
        <Button
          label="View current operation"
          onPress={() =>
            router.push({
              pathname: "/operation/[id]",
              params: { id: project.pendingOperation.operationId },
            })
          }
        />
      ) : null}
      <View className="gap-3">
        <Button
          label="Configure incident monitoring"
          onPress={() =>
            router.push({
              pathname: "/incident/monitor",
              params: { projectId: id },
            })
          }
        />
        <Button
          label="Deployment timeline"
          onPress={() => setTab("timeline")}
        />
        <Button
          label="Runtime logs"
          disabled={!project.capabilities.supportsLogs}
          onPress={() => setTab("logs")}
        />
      </View>
    </View>
  );
  return (
    <Frame
      title={project.name}
      subtitle={`${project.service.name} · ${project.providerServiceId}`}
      onBack={() => router.back()}
    >
      {tab === "logs" ? (
        <Logs
          projectId={id}
          enabled={visible && !query.isError}
          header={<View className="flex-row items-center gap-2"><StatusPill value={listItems(history)[0]?.status || "unknown"} /><Button label="Deployment timeline" size="sm" onPress={() => setTab("timeline")} /></View>}
        />
      ) : (
        <Rows
          query={history}
          items={listItems(history)}
          header={header}
          empty="No deployments found."
          renderItem={({ item }) => (
            <Card>
              <Copy>
                {item.status} · {item.startedAt || "Start time unavailable"}
              </Copy>
              <Copy>{item.commitSha || "Commit unavailable"}</Copy>
              <Button
                label={`Open deployment ${item.providerDeploymentId}`}
                disabled={isOffline}
                onPress={() =>
                  router.push({
                    pathname: "/deployment/[id]",
                    params: { id: item.id },
                  })
                }
              />
            </Card>
          )}
        />
      )}
    </Frame>
  );
}

export function RedeployScreen() {
  const requestConfirmation = useConfirmation();
  const { router, authenticated, isOffline } = usePage();
  const { id: rawId } = useLocalSearchParams();
  const id = routeId(rawId);
  const query = useDeploymentDetail("project", id);
  const api = useDeploymentApi();
  const [stage, setStage] = useState("review");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const pending = useRef(null);
  const project = query.data?.data;
  const allowed =
    project?.capabilities.canRedeploy &&
    !isOffline &&
    !query.isError &&
    !query.isFetching;
  async function submit(body) {
    const fingerprint = JSON.stringify(body);
    if (!pending.current || pending.current.fingerprint !== fingerprint)
      pending.current = { fingerprint, key: Crypto.randomUUID() };
    setBusy(true);
    setError(null);
    try {
      const result = await api.redeploy(id, body, pending.current.key);
      router.replace({
        pathname: "/operation/[id]",
        params: { id: result.data.operationId },
      });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  function confirm() {
    const body = {
      action: "redeploy",
      confirmation: "DEPLOY",
      target: {
        serviceId: project.providerServiceId,
        deploymentId: project.redeployTarget.providerDeploymentId,
        commitSha: project.redeployTarget.commitSha,
      },
    };
    requestConfirmation(
      "Confirm deployment request",
      `Redeploy ${project.name}\nRender service: ${project.service.name}\n${project.providerServiceId}\nCommit: ${body.target.commitSha}\nThis rebuilds the selected live commit. It may affect production. Acceptance does not prove success or recovery.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Request redeploy", onPress: () => submit(body) },
      ],
    );
  }
  if (!authenticated) return <SignedOut />;
  return (
    <Frame title="Review redeployment" onBack={() => router.back()}>
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        {isOffline ? (
          <Copy alert>
            Offline. Reconnect and refresh the target before confirming.
          </Copy>
        ) : null}
        {!project || query.isError ? (
          <QueryState query={query} />
        ) : (
          <View className="gap-3">
            <Copy>Project: {project.name}</Copy>
            <Copy>
              Exact service: {project.service.name} ·{" "}
              {project.providerServiceId}
            </Copy>
            <Copy>
              Rebuild and deploy live revision:{" "}
              {project.redeployTarget?.commitSha || "Unavailable"}
            </Copy>
            <Copy>
              Source deployment:{" "}
              {project.redeployTarget?.providerDeploymentId || "Unavailable"}
            </Copy>
            <Copy>
              No branch update, rollback, promotion or health check is included.
              A queued request may later fail or have an unknown outcome.
            </Copy>
            <ErrorNotice error={error} />
            {error ? (
              <Copy>
                Retry reuses the same request key for this target. If the
                outcome is unknown, inspect the current project operation before
                submitting another request.
              </Copy>
            ) : null}
            <Button
              caution
              label={
                stage === "review"
                  ? "Continue to confirmation"
                  : busy
                    ? "Requesting deployment"
                    : "Confirm exact redeployment"
              }
              disabled={!allowed || busy}
              onPress={() =>
                stage === "review" ? setStage("confirm") : confirm()
              }
            />
            <Button
              label="Refresh target"
              disabled={busy || isOffline}
              onPress={() => {
                setStage("review");
                void query.refetch();
              }}
            />
          </View>
        )}
      </ScrollView>
    </Frame>
  );
}

export function DeploymentDetailScreen() {
  const { router, authenticated, isOffline } = usePage();
  const { id } = useLocalSearchParams();
  const query = useDeploymentDetail("deployment", routeId(id));
  if (!authenticated) return <SignedOut />;
  const d = query.data?.data;
  return (
    <Frame title="Deployment detail" onBack={() => router.back()}>
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        {isOffline ? (
          <Copy alert>
            Offline. Displayed deployment metadata may be stale.
          </Copy>
        ) : null}
        {!d || query.isError ? (
          <QueryState query={query} />
        ) : (
          <View className="gap-3">
            <DeploymentStatus value={d.status} />
            <Copy>Provider status: {d.providerStatus}</Copy>
            <Copy>{d.providerDeploymentId}</Copy>
            <Copy>Commit: {d.commitSha || "Unavailable"}</Copy>
            <Copy>Started: {d.startedAt || "Unavailable"}</Copy>
            <Copy>Finished: {d.finishedAt || "Unavailable"}</Copy>
            <Button label="Refresh deployment" onPress={query.refetch} />
            {d.projectId ? (
              <Button
                label="View service runtime logs"
                onPress={() =>
                  router.push({
                    pathname: "/project/[id]",
                    params: { id: d.projectId, tab: "logs" },
                  })
                }
              />
            ) : null}
            <Copy>
              Runtime logs cover the service. Build output is not provided by
              this view.
            </Copy>
          </View>
        )}
      </ScrollView>
    </Frame>
  );
}
export function OperationScreen() {
  const { router, authenticated, isOffline } = usePage();
  const { id } = useLocalSearchParams();
  const query = useDeploymentDetail("operation", routeId(id));
  if (!authenticated) return <SignedOut />;
  const op = query.data?.data;
  return (
    <Frame title="Deployment operation" onBack={() => router.back()}>
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        {isOffline ? (
          <Copy alert>
            Offline. Displayed operation status may be stale; reconnect to
            verify.
          </Copy>
        ) : null}
        {!op || query.isError ? (
          <QueryState query={query} />
        ) : (
          <View className="gap-3">
            <Copy>Request status: {op.status}</Copy>
            <Copy>Operation: {op.operationId}</Copy>
            <Copy>Commit: {op.commitSha}</Copy>
            <Copy>Application health: Not checked</Copy>
            {op.status === "succeeded" ? (
              <Copy>
                Render reports the deployment live. Application recovery has not
                been verified.
              </Copy>
            ) : (
              <Copy>
                Queued, requested and provider-accepted states do not mean
                deployment success.
              </Copy>
            )}
            {op.reconciliationRequired ? (
              <Copy alert>
                Outcome unknown. This request will not be automatically
                retriggered. Inspect Render and contact your operator to
                reconcile it.
              </Copy>
            ) : null}
            {op.errorCode ? <Copy alert>{op.errorCode}</Copy> : null}
            <Button
              label="Refresh operation status"
              disabled={isOffline}
              onPress={query.refetch}
            />
            {op.deploymentId ? (
              <Button
                label="View provider deployment"
                disabled={isOffline}
                onPress={() =>
                  router.push({
                    pathname: "/deployment/[id]",
                    params: { id: op.deploymentId },
                  })
                }
              />
            ) : null}
          </View>
        )}
      </ScrollView>
    </Frame>
  );
}
