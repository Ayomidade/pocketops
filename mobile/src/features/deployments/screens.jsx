import { useEffect, useRef, useState } from "react";
import { Alert, AppState, KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { useAuth } from "../auth/AuthProvider";
import { useConnectivity } from "../../hooks/useConnectivity";
import { useSourceVisible } from "../repositories/RepositoryProvider";
import { useRepositoryList } from "../repositories/queries";
import { useDeploymentApi, useDeploymentDetail, useDeploymentList, listItems } from "./queries";
import { Action, Copy, Frame, Input, QueryState, Rows, Status } from "./components";

function usePage() {
  const router = useRouter(); const { status } = useAuth(); const { isOffline } = useConnectivity();
  return { router, isOffline, authenticated: status === "authenticated" };
}
function SignedOut() { return <Redirect href="/(auth)/login" />; }
function ErrorNotice({ error }) { return error ? <Copy alert>{error.message || "Unable to complete the request. Retry after checking access."}</Copy> : null; }
function Card({ children }) { return <View className="rounded-2xl border border-slate-700 bg-panel p-4">{children}</View>; }
function routeId(value) { return typeof value === "string" ? value : ""; }

export function DeploymentsScreen() {
  const { router, authenticated, isOffline } = usePage();
  const query = useDeploymentList("projects");
  if (!authenticated) return <SignedOut />;
  return <Frame title="Deployments" subtitle="Manual releases. Provider status and application health are tracked separately.">
    <Rows query={query} items={listItems(query)} empty="No projects mapped. Connect Render and choose a GitHub-backed service."
      header={<View className="gap-3 mb-4"><Action label="Manage Render connections" onPress={() => router.push("/project/connections")} /><Action label="Map a service" disabled={isOffline} onPress={() => router.push("/project/new")} /></View>}
      renderItem={({ item }) => <Card><Copy>{item.name}</Copy><Copy>{item.providerServiceId} · {item.status}</Copy><Action label={`Open project ${item.name}`} disabled={isOffline || item.status !== "active"} onPress={() => router.push({ pathname: "/project/[id]", params: { id: item.id } })} /></Card>} />
  </Frame>;
}

export function RenderConnectionsScreen() {
  const { router, authenticated, isOffline } = usePage(); const api = useDeploymentApi(); const client = useQueryClient();
  const query = useDeploymentList("connections"); const [key, setKey] = useState(""); const [name, setName] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(null);
  useEffect(() => { const sub = AppState.addEventListener("change", (state) => { if (state !== "active") setKey(""); }); return () => sub.remove(); }, []);
  async function connect() {
    const apiKey = key; setKey(""); setBusy(true); setError(null);
    try { await api.connect({ apiKey, displayName: name.trim() }); setName(""); await client.invalidateQueries({ queryKey: ["deployments"] }); }
    catch (e) { setError(e); } finally { setBusy(false); }
  }
  function disconnect(item) {
    Alert.alert("Disconnect Render?", `${item.displayName}: linked projects become disconnected. An already dispatched deployment may still proceed. Revoke the API key in Render Account Settings to revoke it globally.`, [
      { text: "Cancel", style: "cancel" }, { text: "Disconnect", style: "destructive", onPress: async () => {
        setBusy(true); setError(null); try { await api.disconnect(item.id); await client.cancelQueries({ queryKey: ["deployments"] }); client.removeQueries({ queryKey: ["deployments"] }); }
        catch (e) { setError(e); } finally { setBusy(false); }
      } },
    ]);
  }
  if (!authenticated) return <SignedOut />;
  return <Frame title="Render connections" onBack={() => router.back()} subtitle="Create an API key in Render Account Settings. Keys can have broad account access; use a separate test account.">
    <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Rows query={query} items={listItems(query)} empty="No Render connections. Your GitHub browsing remains available."
        header={<View><Input label="Connection name" value={name} onChangeText={setName} /><Input label="Render API key" value={key} onChangeText={setKey} secureTextEntry maxLength={512} autoComplete="off" textContentType="none" importantForAutofill="no" />
          <Copy>The key is sent to PocketOps for encrypted server storage. It is cleared from this form and is never returned by the API or persisted on this phone.</Copy>
          <ErrorNotice error={error} /><Action label={busy ? "Connecting" : "Connect Render"} disabled={busy || isOffline || !key.trim() || !name.trim()} onPress={connect} /></View>}
        renderItem={({ item }) => <Card><Copy>{item.displayName} · {item.status}</Copy><Action label={`Disconnect ${item.displayName}`} disabled={busy || isOffline || item.status !== "active"} onPress={() => disconnect(item)} /></Card>} />
    </KeyboardAvoidingView>
  </Frame>;
}

function ServiceSelection({ connection, onSelect }) {
  const query = useDeploymentList("services", connection.id);
  const { isOffline } = useConnectivity();
  return <Rows query={query} items={listItems(query)} empty="No accessible Render services. Select services in Render, then refresh."
    header={<Copy>{connection.displayName}: choose the exact GitHub-backed service.</Copy>}
    renderItem={({ item }) => <Card><Copy>{item.name} · {item.type}</Copy><Copy>{item.repositoryFullName || "No supported GitHub repository"}</Copy><Copy>{item.id}</Copy>
      <Action label={`Select service ${item.name}`} disabled={isOffline || !item.repositoryFullName} onPress={() => onSelect(item)} /></Card>} />;
}
function RepositorySelection({ service, onSelect }) {
  const query = useRepositoryList(service.repositoryFullName); const { isOffline } = useConnectivity();
  const repos = query.data?.pages.flatMap((p) => p.data || []) || [];
  return <Rows query={query} items={repos} empty="Select the service's repository in GitHub connections first, then refresh."
    header={<Copy>Map {service.name} to its currently authorized GitHub repository: {service.repositoryFullName}</Copy>}
    renderItem={({ item }) => <Card><Copy>{item.fullName}</Copy><Action label={`Map repository ${item.fullName}`} disabled={isOffline || item.fullName.toLowerCase() !== service.repositoryFullName.toLowerCase()} onPress={() => onSelect(item)} /></Card>} />;
}
export function NewProjectScreen() {
  const { router, authenticated, isOffline } = usePage(); const api = useDeploymentApi(); const query = useDeploymentList("connections"); const client = useQueryClient();
  const [connection, setConnection] = useState(null); const [service, setService] = useState(null); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  async function map(repo) {
    setBusy(true); setError(null);
    try { const result = await api.createProject({ name: service.name, repositoryId: repo.id, connectionId: connection.id, providerServiceId: service.id }); await client.invalidateQueries({ queryKey: ["deployments", "projects"] }); router.replace({ pathname: "/project/[id]", params: { id: result.data.id } }); }
    catch (e) { setError(e); } finally { setBusy(false); }
  }
  if (!authenticated) return <SignedOut />;
  return <Frame title="Map a service" onBack={() => service ? setService(null) : connection ? setConnection(null) : router.back()}>
    <View className="px-5"><ErrorNotice error={error} />{busy ? <Copy>Creating project…</Copy> : null}</View>
    {busy ? null : service ? <RepositorySelection service={service} onSelect={map} /> : connection ? <ServiceSelection connection={connection} onSelect={setService} /> :
      <Rows query={query} items={listItems(query).filter((c) => c.status === "active")} empty="Connect Render before mapping a service." header={<Copy>Choose a Render connection.</Copy>}
        renderItem={({ item }) => <Action label={`Choose connection ${item.displayName}`} disabled={isOffline} onPress={() => setConnection(item)} />} />}
  </Frame>;
}

function Logs({ projectId, enabled }) {
  const [window, setWindow] = useState(() => ({ from: new Date(Date.now() - 3600000).toISOString(), to: new Date().toISOString() }));
  const [level, setLevel] = useState(""); const { isOffline } = useConnectivity();
  const query = useDeploymentList("logs", projectId, { ...window, ...(level ? { level } : {}), limit: 50 }, enabled && !isOffline);
  const items = listItems(query);
  return <Rows query={query} items={isOffline || !enabled ? [] : items} empty="No logs in this bounded time window."
    header={<View><Copy>Runtime logs · {window.from} → {window.to}</Copy><Copy>Common secrets are redacted; application logs may still contain sensitive information. Lines are capped at 4 KiB, pages at 128 KiB. Logs are not stored on this phone.</Copy>
      <Action label="Refresh log window" disabled={isOffline} onPress={() => setWindow({ from: new Date(Date.now() - 3600000).toISOString(), to: new Date().toISOString() })} />
      <Action label={level ? "Show all log levels" : "Show error logs"} onPress={() => setLevel(level ? "" : "error")} /></View>}
    renderItem={({ item }) => <View><Copy>{item.timestamp} · {item.level}</Copy><Text selectable className="font-mono text-slate-100" numberOfLines={20}>{item.message}</Text></View>} />;
}

export function ProjectScreen() {
  const { router, authenticated, isOffline } = usePage(); const { id: rawId } = useLocalSearchParams(); const id = routeId(rawId);
  const query = useDeploymentDetail("project", id); const history = useDeploymentList("deployments", id); const visible = useSourceVisible();
  const [tab, setTab] = useState("timeline");
  const project = query.data?.data;
  if (!authenticated) return <SignedOut />;
  if (!project || query.isError) return <Frame title="Project" onBack={() => router.back()}><QueryState query={query} /></Frame>;
  return <Frame title={project.name} subtitle={`${project.service.name} · ${project.providerServiceId}`} onBack={() => router.back()}>
    <View className="px-5 gap-2"><Status value={project.status} /><Copy>Health verification is unavailable in this milestone.</Copy>
      <Action label="Review redeployment" disabled={isOffline || query.isFetching || !project.capabilities.canRedeploy} onPress={() => router.push({ pathname: "/project/redeploy", params: { id } })} />
      {!project.capabilities.canRedeploy ? <Copy>Redeploy unavailable: disabled by operator, unsupported service, or no known live commit.</Copy> : null}
      <Copy>Rollback and promotion are unavailable.</Copy>
      {project.pendingOperation ? <Action label="View current operation" onPress={() => router.push({ pathname: "/operation/[id]", params: { id: project.pendingOperation.operationId } })} /> : null}
      <View className="flex-row gap-3"><Action label="Deployment timeline" onPress={() => setTab("timeline")} /><Action label="Runtime logs" disabled={!project.capabilities.supportsLogs} onPress={() => setTab("logs")} /></View>
    </View>
    {tab === "logs" ? <Logs projectId={id} enabled={visible && !query.isError} /> : <Rows query={history} items={listItems(history)} empty="No deployments found."
      renderItem={({ item }) => <Card><Copy>{item.status} · {item.startedAt || "Start time unavailable"}</Copy><Copy>{item.commitSha || "Commit unavailable"}</Copy><Action label={`Open deployment ${item.providerDeploymentId}`} disabled={isOffline} onPress={() => router.push({ pathname: "/deployment/[id]", params: { id: item.id } })} /></Card>} />}
  </Frame>;
}

export function RedeployScreen() {
  const { router, authenticated, isOffline } = usePage(); const { id: rawId } = useLocalSearchParams(); const id = routeId(rawId);
  const query = useDeploymentDetail("project", id); const api = useDeploymentApi(); const [stage, setStage] = useState("review");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(null); const pending = useRef(null);
  const project = query.data?.data;
  const allowed = project?.capabilities.canRedeploy && !isOffline && !query.isError && !query.isFetching;
  async function submit(body) {
    const fingerprint = JSON.stringify(body);
    if (!pending.current || pending.current.fingerprint !== fingerprint) pending.current = { fingerprint, key: Crypto.randomUUID() };
    setBusy(true); setError(null);
    try { const result = await api.redeploy(id, body, pending.current.key); router.replace({ pathname: "/operation/[id]", params: { id: result.data.operationId } }); }
    catch (e) { setError(e); } finally { setBusy(false); }
  }
  function confirm() {
    const body = { action: "redeploy", confirmation: "DEPLOY", target: { serviceId: project.providerServiceId, deploymentId: project.redeployTarget.providerDeploymentId, commitSha: project.redeployTarget.commitSha } };
    Alert.alert("Confirm deployment request", `Redeploy ${project.name}\nRender service: ${project.service.name}\n${project.providerServiceId}\nCommit: ${body.target.commitSha}\nThis rebuilds the selected live commit. It may affect production. Acceptance does not prove success or recovery.`, [
      { text: "Cancel", style: "cancel" }, { text: "Request redeploy", onPress: () => submit(body) },
    ]);
  }
  if (!authenticated) return <SignedOut />;
  return <Frame title="Review redeployment" onBack={() => router.back()}>
    <ScrollView contentContainerStyle={{ padding: 20 }}>
      {!project || query.isError ? <QueryState query={query} /> : <View className="gap-3"><Copy>Project: {project.name}</Copy><Copy>Exact service: {project.service.name} · {project.providerServiceId}</Copy>
        <Copy>Rebuild and deploy live revision: {project.redeployTarget?.commitSha || "Unavailable"}</Copy><Copy>Source deployment: {project.redeployTarget?.providerDeploymentId || "Unavailable"}</Copy>
        <Copy>No branch update, rollback, promotion or health check is included. A queued request may later fail or have an unknown outcome.</Copy>
        <ErrorNotice error={error} />{error ? <Copy>Retry reuses the same request key for this target. If the outcome is unknown, inspect the current project operation before submitting another request.</Copy> : null}
        <Action label={stage === "review" ? "Continue to confirmation" : busy ? "Requesting deployment" : "Confirm exact redeployment"} disabled={!allowed || busy} onPress={() => stage === "review" ? setStage("confirm") : confirm()} />
        <Action label="Refresh target" disabled={busy || isOffline} onPress={() => { setStage("review"); void query.refetch(); }} />
      </View>}
    </ScrollView>
  </Frame>;
}

export function DeploymentDetailScreen() {
  const { router, authenticated } = usePage(); const { id } = useLocalSearchParams(); const query = useDeploymentDetail("deployment", routeId(id));
  if (!authenticated) return <SignedOut />;
  const d = query.data?.data;
  return <Frame title="Deployment detail" onBack={() => router.back()}><ScrollView contentContainerStyle={{ padding: 20 }}>
    {!d || query.isError ? <QueryState query={query} /> : <View className="gap-3"><Status value={d.status} /><Copy>Provider status: {d.providerStatus}</Copy><Copy>{d.providerDeploymentId}</Copy><Copy>Commit: {d.commitSha || "Unavailable"}</Copy><Copy>Started: {d.startedAt || "Unavailable"}</Copy><Copy>Finished: {d.finishedAt || "Unavailable"}</Copy><Action label="Refresh deployment" onPress={query.refetch} /></View>}
  </ScrollView></Frame>;
}
export function OperationScreen() {
  const { router, authenticated, isOffline } = usePage(); const { id } = useLocalSearchParams(); const query = useDeploymentDetail("operation", routeId(id));
  if (!authenticated) return <SignedOut />;
  const op = query.data?.data;
  return <Frame title="Deployment operation" onBack={() => router.back()}><ScrollView contentContainerStyle={{ padding: 20 }}>
    {!op || query.isError ? <QueryState query={query} /> : <View className="gap-3"><Copy>Request status: {op.status}</Copy><Copy>Operation: {op.operationId}</Copy><Copy>Commit: {op.commitSha}</Copy>
      <Copy>Application health: Not checked</Copy>
      {op.status === "succeeded" ? <Copy>Render reports the deployment live. Application recovery has not been verified.</Copy> : <Copy>Queued, requested and provider-accepted states do not mean deployment success.</Copy>}
      {op.reconciliationRequired ? <Copy alert>Outcome unknown. This request will not be automatically retriggered. Inspect Render and contact your operator to reconcile it.</Copy> : null}
      {op.errorCode ? <Copy alert>{op.errorCode}</Copy> : null}
      <Action label="Refresh operation status" disabled={isOffline} onPress={query.refetch} />
      {op.deploymentId ? <Action label="View provider deployment" disabled={isOffline} onPress={() => router.push({ pathname: "/deployment/[id]", params: { id: op.deploymentId } })} /> : null}
    </View>}
  </ScrollView></Frame>;
}
