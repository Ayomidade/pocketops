import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import {
  DeploymentsScreen,
  OperationScreen,
  ProjectScreen,
  RedeployScreen,
  RenderConnectionsScreen,
} from "../src/features/deployments/screens";

const sha = "a".repeat(40);
let mockParams = { id: "project-1" };
let mockOffline = false;
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
const mockApi = {
  connect: jest.fn(),
  disconnect: jest.fn(),
  createProject: jest.fn(),
  redeploy: jest.fn(),
  updateProject: jest.fn(),
};
const mockEmptyListQuery = {
  isPending: false,
  isError: false,
  isFetching: false,
  isRefetching: false,
  hasNextPage: false,
  error: null,
  data: undefined,
  refetch: jest.fn(),
  fetchNextPage: jest.fn(),
};
const mockEmptyDetailQuery = {
  isPending: false,
  isError: false,
  isFetching: false,
  error: null,
  data: undefined,
  refetch: jest.fn(),
};
let mockListQueries = {};
let mockDetailQueries = {};
let mockAlert;

jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  Redirect: () => null,
}));
jest.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000001",
}));
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn(), cancelQueries: jest.fn(), removeQueries: jest.fn() }),
}));
jest.mock("../src/features/auth/AuthProvider", () => ({
  useAuth: () => ({ status: "authenticated", user: { id: "user-1" }, authenticatedRequest: jest.fn() }),
}));
jest.mock("../src/hooks/useConnectivity", () => ({
  useConnectivity: () => ({ isOffline: mockOffline }),
}));
jest.mock("../src/features/repositories/RepositoryProvider", () => ({
  useSourceVisible: () => true,
}));
jest.mock("../src/features/repositories/queries", () => ({
  useRepositoryList: () => ({ isPending: false, isError: false, data: { pages: [] } }),
}));
jest.mock("../src/features/deployments/queries", () => ({
  useDeploymentApi: () => mockApi,
  useDeploymentList: (kind) => mockListQueries[kind] || mockEmptyListQuery,
  useDeploymentDetail: (kind) => mockDetailQueries[kind] || mockEmptyDetailQuery,
  listItems: (query) => query.data?.pages?.flatMap((page) => page.data.items) || [],
}));

function confirmAlert(buttonLabel) {
  const buttons = mockAlert.mock.calls.at(-1)[2];
  const button = buttons.find((item) => item.text === buttonLabel);
  if (!button) throw new Error(`Alert button not found: ${buttonLabel}`);
  return act(async () => button.onPress?.());
}

function listQuery(items) {
  return { ...mockEmptyListQuery, data: { pages: [{ data: { items, nextCursor: null } }] } };
}

const project = {
  id: "project-1",
  name: "Staging API",
  status: "active",
  providerServiceId: "srv-abc123",
  service: { name: "Staging API" },
  capabilities: {
    canRedeploy: true,
    canRollback: false,
    canPromote: false,
    supportsLogs: true,
    supportsHealthVerification: false,
  },
  redeployTarget: { providerDeploymentId: "dep-live", commitSha: sha },
  pendingOperation: null,
};

describe("deployment screens", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOffline = false;
    mockParams = { id: "project-1" };
    mockListQueries = {};
    mockDetailQueries = {};
    mockAlert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    mockApi.connect.mockResolvedValue({ data: { id: "conn-1", displayName: "Staging", status: "active" } });
    mockApi.redeploy.mockResolvedValue({ data: { operationId: "op-1", status: "queued" } });
  });

  afterEach(() => mockAlert.mockRestore());

  it("connects Render without echoing or retaining the API key in the form", async () => {
    mockListQueries.connections = listQuery([]);
    const screen = render(<RenderConnectionsScreen />);
    expect(screen.getByLabelText("Connect Render").props.accessibilityState.disabled).toBe(true);
    fireEvent.changeText(screen.getByLabelText("Connection name"), "Staging");
    fireEvent.changeText(screen.getByLabelText("Render API key"), "rnd_secret_value");
    expect(screen.getByLabelText("Connect Render").props.accessibilityState.disabled).toBe(false);
    fireEvent.press(screen.getByLabelText("Connect Render"));
    await waitFor(() => expect(mockApi.connect).toHaveBeenCalledWith({ apiKey: "rnd_secret_value", displayName: "Staging" }));
    await waitFor(() => expect(screen.getByLabelText("Render API key").props.value).toBe(""));
    expect(screen.queryByText(/rnd_secret_value/)).toBeNull();
  });

  it("maps a project list and disables opening a disconnected project", async () => {
    mockListQueries.projects = listQuery([
      { id: "project-1", name: "Staging API", providerServiceId: "srv-abc123", status: "active" },
      { id: "project-2", name: "Old API", providerServiceId: "srv-gone", status: "disconnected" },
    ]);
    const screen = render(<DeploymentsScreen />);
    expect(screen.getByText("Staging API")).toBeTruthy();
    expect(screen.getByLabelText("Open project Staging API").props.accessibilityState.disabled).toBe(false);
    expect(screen.getByLabelText("Open project Old API").props.accessibilityState.disabled).toBe(true);
  });

  it("requires a second exact confirmation before requesting a redeploy", async () => {
    mockDetailQueries.project = { ...mockEmptyDetailQuery, data: { data: project } };
    const screen = render(<RedeployScreen />);
    fireEvent.press(screen.getByLabelText("Continue to confirmation"));
    fireEvent.press(await screen.findByLabelText("Confirm exact redeployment"));
    expect(mockApi.redeploy).not.toHaveBeenCalled();
    await confirmAlert("Request redeploy");
    await waitFor(() => expect(mockApi.redeploy).toHaveBeenCalled());
    const [projectId, body, idempotencyKey] = mockApi.redeploy.mock.calls[0];
    expect(projectId).toBe("project-1");
    expect(body).toEqual({
      action: "redeploy",
      confirmation: "DEPLOY",
      target: { serviceId: "srv-abc123", deploymentId: "dep-live", commitSha: sha },
    });
    expect(typeof idempotencyKey).toBe("string");
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: "/operation/[id]", params: { id: "op-1" } });
  });

  it("disables redeploy and does not simulate rollback when capabilities are false", async () => {
    mockDetailQueries.project = {
      ...mockEmptyDetailQuery,
      data: { data: { ...project, capabilities: { ...project.capabilities, canRedeploy: false } } },
    };
    const screen = render(<ProjectScreen />);
    expect(screen.getByText("Rollback and promotion are unavailable.")).toBeTruthy();
    expect(screen.getByText("Health verification is unavailable in this milestone.")).toBeTruthy();
    expect(screen.getByLabelText("Review redeployment").props.accessibilityState.disabled).toBe(true);
  });

  it("shows that a queued operation is not deployment success", async () => {
    mockDetailQueries.operation = {
      ...mockEmptyDetailQuery,
      data: {
        data: {
          operationId: "op-1",
          status: "queued",
          commitSha: sha,
          deploymentId: null,
          healthStatus: "not_checked",
          reconciliationRequired: false,
          errorCode: null,
        },
      },
    };
    const screen = render(<OperationScreen />);
    expect(await screen.findByText("Request status: queued")).toBeTruthy();
    expect(screen.getByText("Queued, requested and provider-accepted states do not mean deployment success.")).toBeTruthy();
    expect(screen.getByText("Application health: Not checked")).toBeTruthy();
  });

  it("marks an ambiguous outcome as requiring manual reconciliation", async () => {
    mockDetailQueries.operation = {
      ...mockEmptyDetailQuery,
      data: {
        data: {
          operationId: "op-2",
          status: "unknown",
          commitSha: sha,
          deploymentId: null,
          healthStatus: "not_checked",
          reconciliationRequired: true,
          errorCode: "PROVIDER_OUTCOME_UNKNOWN",
        },
      },
    };
    const screen = render(<OperationScreen />);
    expect(await screen.findByText(/will not be automatically retriggered/)).toBeTruthy();
    expect(screen.getByText("PROVIDER_OUTCOME_UNKNOWN")).toBeTruthy();
  });
});
