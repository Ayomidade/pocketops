import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import { QueryClient, QueryClientProvider, notifyManager, onlineManager } from "@tanstack/react-query";
import { DeploymentsScreen, RenderConnectionsScreen, NewProjectScreen, ProjectScreen, RedeployScreen, OperationScreen, DeploymentDetailScreen, LogRow } from "../src/features/deployments/screens";

const mockRequest = jest.fn(); const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn() };
let mockOffline = false; let mockParams = { id: "project-id" };
jest.mock("expo-router", () => ({ Redirect: () => null, useRouter: () => mockRouter, useLocalSearchParams: () => mockParams }));
jest.mock("../src/features/auth/AuthProvider", () => ({ useAuth: () => ({ status: "authenticated", authenticatedRequest: mockRequest }) }));
jest.mock("../src/hooks/useConnectivity", () => ({ useConnectivity: () => ({ isOffline: mockOffline }) }));
jest.mock("../src/features/repositories/RepositoryProvider", () => ({ useSourceVisible: () => true }));
jest.mock("expo-crypto", () => ({ randomUUID: () => "test-idempotency-key-12345" }));
const service = { id: "srv-staging", name: "Staging API", type: "web_service", repositoryFullName: "org/repo", capabilities: { canRedeploy: true, supportsLogs: true, canRollback: false, canPromote: false } };
const project = { id: "project-id", name: "Staging API", connectionId: "connection-id", repositoryId: "repo-id", providerServiceId: service.id, status: "active", service, capabilities: service.capabilities, redeployTarget: { providerDeploymentId: "dep-current", commitSha: "a".repeat(40) }, pendingOperation: null };
const connection = { id: "connection-id", displayName: "Staging", status: "active" };
const deployment = { id: "deployment-id", providerDeploymentId: "dep-build", status: "building", providerStatus: "build_in_progress", commitSha: "a".repeat(40), startedAt: "2026-10-28T09:00:00Z" };
const ok = (data) => ({ success: true, data, meta: {} });
function error(code, status) { return Object.assign(new Error(code), { code, status }); }
let clients;
function setup(element) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); clients.push(client);
  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
}
function confirm(label) { const buttons = Alert.alert.mock.calls.at(-1)[2]; return act(async () => buttons.find((b) => b.text === label).onPress()); }
beforeEach(() => {
  jest.useFakeTimers();
  notifyManager.setNotifyFunction((callback) => act(callback)); onlineManager.setOnline(true);
  jest.clearAllMocks(); clients = []; mockOffline = false; mockParams = { id: "project-id" };
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
  mockRequest.mockImplementation(async (path, options = {}) => {
    if (path.startsWith("/provider-connections/connection-id/services")) return ok({ items: [service], nextCursor: null });
    if (path === "/provider-connections/render") return ok(connection);
    if (path.startsWith("/provider-connections")) return ok({ items: [connection], nextCursor: null });
    if (path.startsWith("/github/repositories")) return { ...ok([{ id: "repo-id", fullName: "org/repo" }]), meta: { nextCursor: null } };
    if (path === "/projects" && options.method === "POST") return ok(project);
    if (path.startsWith("/projects/project-id/logs")) return ok({ items: [{ id: "log1", timestamp: "2026-10-28T09:00:00Z", level: "error", message: "Safe fixture log" }], nextCursor: null, truncated: false });
    if (path.startsWith("/projects/project-id/deployments")) return options.method === "POST" ? ok({ operationId: "operation-id", status: "queued", healthStatus: "not_checked" }) : ok({ items: [deployment], nextCursor: null });
    if (path === "/projects/project-id") return ok(project);
    if (path.startsWith("/projects")) return ok({ items: [project], nextCursor: null });
    if (path.startsWith("/operations")) return ok({ operationId: "operation-id", projectId: project.id, status: "accepted", commitSha: "a".repeat(40), healthStatus: "not_checked", reconciliationRequired: false, deploymentId: deployment.id });
    if (path.startsWith("/deployments")) return ok(deployment);
    throw new Error(`Unexpected API path ${path}`);
  });
});
afterEach(async () => { cleanup(); await act(async () => { for (const client of clients) { await client.cancelQueries(); client.clear(); } jest.runOnlyPendingTimers(); }); jest.useRealTimers(); jest.restoreAllMocks(); });

describe("native Render deployment workflow", () => {
  it("loads project lists, handles empty and offline states, and pages bounded results", async () => {
    let count = 0;
    mockRequest.mockImplementation(async () => ok({ items: count++ === 0 ? [project] : [{ ...project, id: "second", name: "Second service" }], nextCursor: count === 1 ? "page-2" : null }));
    const screen = setup(<DeploymentsScreen />);
    await screen.findByLabelText("Open project Staging API"); fireEvent.press(screen.getByLabelText("Load more"));
    await screen.findByLabelText("Open project Second service"); expect(mockRequest.mock.calls.some(([path]) => path.includes("cursor=page-2"))).toBe(true);
    screen.unmount(); mockRequest.mockResolvedValue(ok({ items: [], nextCursor: null })); const empty = setup(<DeploymentsScreen />);
    await empty.findByText(/No projects mapped/);
    mockOffline = true; empty.rerender(<QueryClientProvider client={clients.at(-1)}><DeploymentsScreen /></QueryClientProvider>);
    expect(empty.getAllByText(/Cached metadata may be stale/).length).toBeGreaterThan(0);
    expect(empty.getByLabelText("Map a service")).toBeDisabled();
  });
  it("validates key onboarding, clears secret input, and connects without retaining a key in query data", async () => {
    const screen = setup(<RenderConnectionsScreen />); await screen.findByText(/Staging · active/);
    fireEvent.changeText(screen.getByLabelText("Connection name"), "Test connection"); fireEvent.changeText(screen.getByLabelText("Render API key"), "rnd_fixture_key_only");
    fireEvent.press(screen.getByLabelText("Connect Render"));
    await waitFor(() => expect(mockRequest).toHaveBeenCalledWith("/provider-connections/render", expect.objectContaining({ method: "POST", body: { apiKey: "rnd_fixture_key_only", displayName: "Test connection" } })));
    expect(screen.getByLabelText("Render API key").props.value).toBe("");
    expect(JSON.stringify(clients[0].getQueryData(["deployments", "connections", "", "{}"])) || "").not.toContain("rnd_fixture_key_only");
  });
  it("selects connection, exact Render service and matching authorized GitHub repository", async () => {
    const screen = setup(<NewProjectScreen />);
    fireEvent.press(await screen.findByLabelText("Choose connection Staging"));
    fireEvent.press(await screen.findByLabelText("Select service Staging API"));
    fireEvent.press(await screen.findByLabelText("Map repository org/repo"));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: "/project/[id]", params: { id: "project-id" } }));
    expect(mockRequest).toHaveBeenCalledWith("/projects", expect.objectContaining({ method: "POST", body: { name: service.name, repositoryId: "repo-id", connectionId: "connection-id", providerServiceId: service.id } }));
  });
  it("does not request a deployment before both native confirmation stages and reuses the key on retry", async () => {
    const original = mockRequest.getMockImplementation(); let postCount = 0;
    mockRequest.mockImplementation(async (path, options) => {
      if (options?.method === "POST") { if (postCount++ === 0) throw error("REQUEST_TIMEOUT", 0); }
      return original(path, options);
    });
    const screen = setup(<RedeployScreen />); await screen.findByText(/Exact service: Staging API/);
    fireEvent.press(screen.getByLabelText("Continue to confirmation"));
    expect(mockRequest.mock.calls.filter(([, opt]) => opt?.method === "POST")).toHaveLength(0);
    fireEvent.press(screen.getByLabelText("Confirm exact redeployment"));
    expect(mockRequest.mock.calls.filter(([, opt]) => opt?.method === "POST")).toHaveLength(0);
    expect(Alert.alert.mock.calls.at(-1)[1]).toContain(service.id);
    await confirm("Request redeploy"); await screen.findByText("REQUEST_TIMEOUT");
    fireEvent.press(screen.getByLabelText("Confirm exact redeployment")); await confirm("Request redeploy");
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: "/operation/[id]", params: { id: "operation-id" } }));
    const writes = mockRequest.mock.calls.filter(([, opt]) => opt?.method === "POST"); expect(writes).toHaveLength(2);
    expect(writes[0][1].headers["Idempotency-Key"]).toBe(writes[1][1].headers["Idempotency-Key"]);
    expect(writes[0][1].body.target).toEqual({ serviceId: service.id, deploymentId: "dep-current", commitSha: "a".repeat(40) });
  });
  it.each([[401, "UNAUTHENTICATED"], [403, "RENDER_ACCESS_REVOKED"], [404, "PROJECT_NOT_FOUND"], [429, "RENDER_RATE_LIMITED"], [502, "RENDER_UNAVAILABLE"]])("explains %s failures and offers retry without showing successful deployment", async (status, code) => {
    mockRequest.mockRejectedValue(error(code, status)); const screen = setup(<ProjectScreen />);
    await screen.findByLabelText("Retry"); expect(screen.queryByLabelText("Review redeployment")).toBeNull();
    fireEvent.press(screen.getByLabelText("Retry")); await waitFor(() => expect(mockRequest.mock.calls.length).toBeGreaterThan(2));
  });
  it("shows accepted, unknown and live provider status separately from application health", async () => {
    mockParams = { id: "operation-id" }; const screen = setup(<OperationScreen />);
    await screen.findByText("Request status: accepted"); expect(screen.getByText(/do not mean deployment success/)).toBeTruthy();
    mockRequest.mockResolvedValue(ok({ operationId: "operation-id", status: "unknown", commitSha: "a".repeat(40), reconciliationRequired: true }));
    fireEvent.press(screen.getByLabelText("Refresh operation status")); await screen.findByText(/Outcome unknown/);
    expect(screen.queryByText(/Render reports the deployment live/)).toBeNull();
    mockRequest.mockResolvedValue(ok({ operationId: "operation-id", status: "succeeded", commitSha: "a".repeat(40), reconciliationRequired: false }));
    fireEvent.press(screen.getByLabelText("Refresh operation status")); await screen.findByText(/Application recovery has not been verified/);
    expect(screen.getByText("Application health: Not checked")).toBeTruthy();
  });
  it("uses native bounded log rows and filters through PocketOps only", async () => {
    const screen = setup(<ProjectScreen />); fireEvent.press(await screen.findByLabelText("Runtime logs"));
    await screen.findByText("Safe fixture log"); fireEvent.press(screen.getByLabelText("Show error logs"));
    await waitFor(() => expect(mockRequest.mock.calls.some(([path]) => path.includes("/logs?") && path.includes("level=error"))).toBe(true));
    expect(screen.getByText(/Only four pages are retained in memory/)).toBeTruthy();
    screen.unmount(); const row = setup(<LogRow item={{ id: "long", message: "x".repeat(4096), timestamp: "now", level: "info" }} />);
    fireEvent.press(row.getByLabelText("Expand log long")); expect(row.getByLabelText("Collapse log long")).toBeTruthy();
  });
  it("keeps loading visible during delayed reads and exposes unsupported actions as unavailable", async () => {
    let resolve; mockRequest.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const screen = setup(<RedeployScreen />); expect(screen.getByLabelText("Loading deployment data")).toBeTruthy();
    await act(async () => resolve(ok({ ...project, capabilities: { ...project.capabilities, canRedeploy: false }, redeployTarget: null })));
    expect(await screen.findByLabelText("Continue to confirmation")).toBeDisabled(); expect(screen.getByText(/No branch update, rollback, promotion/)).toBeTruthy();
  });
  it("renders provider deployment detail without inventing a recovery result", async () => {
    mockParams = { id: "deployment-id" }; const screen = setup(<DeploymentDetailScreen />);
    await screen.findByText("Deployment: building"); expect(screen.getByText("Application health: Not checked")).toBeTruthy();
  });
});
