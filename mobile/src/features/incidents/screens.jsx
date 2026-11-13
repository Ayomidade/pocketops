import { useConfirmation } from "../../components/ui/ConfirmationProvider";
import MasterDetail, { usePaneRouter as useRouter, usePaneParams as useLocalSearchParams } from "../../components/ui/MasterDetail";
import { FilterChips, ListRow, StatusPill } from "../../components/ui";
import { useRef, useState } from "react";
import { FlatList, View } from "react-native";
import { Redirect } from "expo-router";
import * as Crypto from "expo-crypto";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthProvider";
import { useConnectivity } from "../../hooks/useConnectivity";
import {
  Button,
  Copy,
  Frame,
  Input,
  QueryState,
  Rows,
} from "../deployments/components";
import { useDeploymentList, listItems } from "../deployments/queries";
import { useIncidentApi, useIncidentPages, useIncidentQuery } from "./queries";
import { registerNotifications } from "./notifications";
const states = [
  "open",
  "investigating",
  "mitigating",
  "monitoring",
  "resolved",
];
const severities = ["low", "medium", "high", "critical"];
const next = {
  open: ["investigating"],
  investigating: ["mitigating", "monitoring"],
  mitigating: ["investigating", "monitoring"],
  monitoring: ["investigating"],
  resolved: ["open"],
};
function Guard({ children }) {
  const { status } = useAuth();
  return status === "authenticated" ? (
    children
  ) : status === "starting" ? (
    <Frame title="Restoring session" />
  ) : (
    <Redirect href="/(auth)/login" />
  );
}
function Choices(props) { return <FilterChips {...props} />; }
function Failure({ error }) {
  return error ? (
    <Copy alert>{error.message || "Request failed. Refresh and retry."}</Copy>
  ) : null;
}
function LoadState({ query }) {
  const { isOffline } = useConnectivity();
  return query.isPending || query.isError || isOffline ? (
    <QueryState query={query} />
  ) : null;
}
export function IncidentsScreen() { return <MasterDetail route="/incident/[id]" master={<IncidentsScreenList />} renderDetail={() => <IncidentDetailScreen />} />; }
function IncidentsScreenList() {
  const router = useRouter();
  const [status, setStatus] = useState(""),
    [severity, setSeverity] = useState("");
  const query = useIncidentPages("list", "", { status, severity });
  return (
    <Guard>
      <Frame title="Incidents" subtitle="Investigate, mitigate and verify recovery.">
      <Rows
        query={query}
        items={
          query.isError || (query.isStale && query.isFetching)
            ? []
            : listItems(query)
        }
        empty="No incidents match these filters."
        header={
          <View>
            <Button
              variant="primary" label="Report incident"
              onPress={() => router.push("/incident/create")}
            />
            <Button
              label="Notification preferences"
              onPress={() => router.push("/incident/notifications")}
            />
            <Choices
              label="Status"
              values={["", ...states]}
              value={status}
              onChange={setStatus}
            />
            <Choices
              label="Severity"
              values={["", ...severities]}
              value={severity}
              onChange={setSeverity}
            />
          </View>
        }
        renderItem={({ item }) => (
          <ListRow icon="incident" title={item.title} meta={`${item.status}${item.createdAt ? " · " + new Date(item.createdAt).toLocaleString() : ""}`} badge={<StatusPill value={item.severity} />} label={`Open incident ${item.title}`} onPress={() => router.push({ pathname: "/incident/[id]", params: { id: item.id } })} />
        )}
      />
    </Frame>
    </Guard>
  );
}
export function CreateIncidentScreen() {
  const api = useIncidentApi(),
    router = useRouter();
  const client = useQueryClient();
  const projects = useDeploymentList("projects");
  const [projectId, setProjectId] = useState(""),
    [title, setTitle] = useState(""),
    [severity, setSeverity] = useState("medium"),
    [error, setError] = useState(null),
    [busy, setBusy] = useState(false);
  const { isOffline } = useConnectivity();
  const pending = useRef(null);
  async function create() {
    setBusy(true);
    setError(null);
    const body = { projectId, title: title.trim(), severity };
    const hash = JSON.stringify(body);
    if (pending.current?.hash !== hash)
      pending.current = { hash, key: Crypto.randomUUID() };
    try {
      const result = await api.create(body, pending.current.key);
      await client.invalidateQueries({ queryKey: ["incidents"] });
      router.replace({
        pathname: "/incident/[id]",
        params: { id: result.data.id },
      });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Guard>
      <Frame title="Report incident">
        <Copy>
          Select an authorized project. Do not include secrets or raw logs.
        </Copy>
        <Input
          label="Incident title"
          value={title}
          onChangeText={setTitle}
          maxLength={160}
        />
        <Choices
          label="Severity"
          values={severities}
          value={severity}
          onChange={setSeverity}
        />
        <LoadState query={projects} />
        {!projects.isPending &&
        !projects.isError &&
        listItems(projects).length === 0 ? (
          <Copy>
            No projects available. Connect Render and map an authorized
            repository first.
          </Copy>
        ) : null}
        {!projects.isError &&
          listItems(projects).map((p) => (
            <Button
              key={p.id}
              label={`Project: ${p.name}${projectId === p.id ? " (selected)" : ""}`}
              onPress={() => setProjectId(p.id)}
            />
          ))}
        {projects.hasNextPage ? (
          <Button
            label="More projects"
            onPress={() => projects.fetchNextPage()}
          />
        ) : null}
        <Failure error={error} />
        <Button
          label={busy ? "Creating incident" : "Create incident"}
          disabled={busy || isOffline || !title.trim() || !projectId}
          onPress={create}
        />
      </Frame>
    </Guard>
  );
}
export function IncidentDetailScreen() {
  const requestConfirmation = useConfirmation();
  const { id } = useLocalSearchParams();
  const api = useIncidentApi(),
    router = useRouter(),
    client = useQueryClient();
  const query = useIncidentQuery("detail", id),
    timeline = useIncidentPages("timeline", id);
  const { isOffline } = useConnectivity();
  const [error, setError] = useState(null),
    [busy, setBusy] = useState(false);
  const incident = !query.isError && !isOffline ? query.data?.data : null;
  async function update(values) {
    setBusy(true);
    setError(null);
    try {
      if (values === "resolve") await api.resolve(id, incident.version);
      else await api.update(id, { version: incident.version, ...values });
      await client.invalidateQueries({ queryKey: ["incidents"] });
    } catch (e) {
      setError(e);
      void query.refetch();
    } finally {
      setBusy(false);
    }
  }
  const header = (
    <View>
      <Copy>Incident timeline</Copy>
      <LoadState query={query} />
      {incident ? (
        <>
          <Copy>{incident.title}</Copy>
          <Copy>
            {incident.severity} · {incident.status}
          </Copy>
          <Copy>Application health: {incident.health.status}</Copy>
          <Copy>{incident.health.policy}</Copy>
          <Copy>{incident.correlation}</Copy>
          <Copy>
            Deployment completion is separate from application health
            verification.
          </Copy>
          <Button
            label="Inspect deployment history and runtime logs"
            onPress={() =>
              router.push({
                pathname: "/project/[id]",
                params: { id: incident.projectId },
              })
            }
          />
          <Button
            label="Browse repository and create a fix PR"
            onPress={() =>
              router.push({
                pathname: "/repository/[id]",
                params: { id: incident.repositoryId },
              })
            }
          />
          <Button
            label="Configure automated health checks"
            onPress={() =>
              router.push({
                pathname: "/incident/monitor",
                params: { projectId: incident.projectId },
              })
            }
          />
          {next[incident.status]?.map((s) => (
            <Button
              key={s}
              label={`Move to ${s}`}
              disabled={busy}
              onPress={() => update({ status: s })}
            />
          ))}
          <Choices
            label="Severity"
            values={severities}
            value={incident.severity}
            onChange={(severity) => {
              if (!busy) void update({ severity });
            }}
          />
          {incident.status === "monitoring" ? (
            <Button
              label="Resolve verified incident"
              disabled={busy || incident.health.status !== "verified"}
              onPress={() =>
                requestConfirmation(
                  "Resolve incident?",
                  "Confirm application recovery after reviewing the health observations.",
                  [
                    { text: "Cancel", style: "cancel" },
                    { text: "Resolve", onPress: () => update("resolve") },
                  ],
                )
              }
            />
          ) : null}
        </>
      ) : null}
      <Failure error={error} />
    </View>
  );
  return (
    <Guard>
      <Rows
        query={timeline}
        items={
          isOffline || query.isError || timeline.isError
            ? []
            : listItems(timeline)
        }
        header={header}
        empty="No timeline events available."
        renderItem={({ item }) => (
          <View className="m-3 bg-surface p-4">
            <Copy>
              {item.type} · {new Date(item.createdAt).toLocaleString()}
            </Copy>
            <Copy>
              {item.actorId ? "Developer action" : "System observation"}
            </Copy>
            {item.metadata?.deploymentReference ? (
              <Copy>
                Suggested deployment: {item.metadata.deploymentReference}
              </Copy>
            ) : null}
            {item.metadata?.status ? (
              <Copy>DeploymentStatus: {item.metadata.status}</Copy>
            ) : null}
          </View>
        )}
      />
    </Guard>
  );
}
export function MonitorScreen() {
  const requestConfirmation = useConfirmation();
  const { projectId } = useLocalSearchParams();
  const api = useIncidentApi(),
    client = useQueryClient();
  const query = useIncidentQuery("health", projectId);
  const [path, setPath] = useState("/health"),
    [error, setError] = useState(null),
    [busy, setBusy] = useState(false);
  const { isOffline } = useConnectivity();
  async function configure(enabled) {
    setBusy(true);
    setError(null);
    try {
      await api.configure(projectId, { enabled, healthPath: path });
      await client.invalidateQueries({ queryKey: ["incidents"] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Guard>
      <Frame title="Automated monitoring">
        <Copy>
          Only the public Render web-service origin is allowed. Use a
          lightweight read-only endpoint. Three healthy checks across at least
          two minutes verify recovery. Unknown never means healthy.
        </Copy>
        <LoadState query={query} />
        {!isOffline && !query.isError && query.data ? (
          <Copy>
            Monitoring: {query.data.data.enabled ? "enabled" : "disabled"} ·
            health: {query.data.data.status} · configured path:{" "}
            {query.data.data.healthPath}
          </Copy>
        ) : null}
        <Input
          label="Health-check path"
          value={path}
          onChangeText={setPath}
          maxLength={256}
        />
        <Failure error={error} />
        <Button
          label="Enable monitoring and incident detection"
          disabled={isOffline || busy}
          onPress={() =>
            requestConfirmation(
              "Enable monitoring?",
              "PocketOps will periodically read this project’s deployment status and approved health endpoint. It will never deploy or resolve incidents automatically.",
              [
                { text: "Cancel", style: "cancel" },
                { text: "Enable", onPress: () => configure(true) },
              ],
            )
          }
        />
        <Button
          label="Disable monitoring"
          disabled={isOffline || busy}
          onPress={() => configure(false)}
        />
      </Frame>
    </Guard>
  );
}
export function NotificationSettingsScreen() {
  const api = useIncidentApi(),
    client = useQueryClient();
  const query = useIncidentQuery("preferences");
  const devices = useIncidentQuery("devices");
  const { isOffline } = useConnectivity();
  const [error, setError] = useState(null),
    [busy, setBusy] = useState(false);
  async function change(enabled) {
    setBusy(true);
    setError(null);
    try {
      if (enabled) await registerNotifications(api);
      await api.setPreferences(enabled);
      await client.invalidateQueries({ queryKey: ["incidents"] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id) {
    try {
      await api.revoke(id);
      await devices.refetch();
    } catch (e) {
      setError(e);
    }
  }
  return (
    <Guard>
      <Frame title="Incident notifications">
        <Copy>
          Push is best-effort. Open or refresh Incidents for authoritative
          status. Alerts contain no titles, source code or logs. After signing
          in again, enable notifications to bind this device to the new session.
        </Copy>
        <LoadState query={query} />
        <Failure error={error} />
        <Button
          label="Enable notifications on this device"
          disabled={busy || isOffline}
          onPress={() => change(true)}
        />
        <Button
          label="Disable all incident notifications"
          disabled={busy || isOffline}
          onPress={() => change(false)}
        />
        {!query.isError && query.data ? (
          <Copy>
            Account preference:{" "}
            {query.data.data.enabled ? "enabled" : "disabled"}
          </Copy>
        ) : null}
        <FlatList
          data={devices.isError ? [] : devices.data?.data?.items || []}
          scrollEnabled={false}
          keyExtractor={(i) => i.id}
          renderItem={({ item }) => (
            <Button
              label={`Revoke ${item.platform} device ${item.id.slice(0, 8)}`}
              disabled={busy || isOffline}
              onPress={() => revoke(item.id)}
            />
          )}
        />
      </Frame>
    </Guard>
  );
}
