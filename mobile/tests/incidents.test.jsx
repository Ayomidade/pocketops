jest.mock("../src/hooks/useBreakpoint", () => ({ useBreakpoint: () => ({ compact: true, size: "compact", width: 390, height: 844 }) }));
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import {
  IncidentsScreen,
  CreateIncidentScreen,
  IncidentDetailScreen,
  MonitorScreen,
  NotificationSettingsScreen,
} from "../src/features/incidents/screens";
let mockOffline = false;
const mockRouter = { push: jest.fn(), replace: jest.fn() };
const mockApi = {
  create: jest.fn(),
  update: jest.fn(),
  resolve: jest.fn(),
  configure: jest.fn(),
  setPreferences: jest.fn(),
  revoke: jest.fn(),
};
const mockRegister = jest.fn();
const mockQuery = {
  isPending: false,
  isError: false,
  isFetching: false,
  isRefetching: false,
  isFetchingNextPage: false,
  data: undefined,
  refetch: jest.fn(),
  fetchNextPage: jest.fn(),
};
let mockDetail = {},
  mockPages = {};
const mockInvalidate = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ id: "incident-1", projectId: "project-1" }),
  Redirect: () => null,
}));
jest.mock("expo-crypto", () => ({ randomUUID: () => "fixture-request-key" }));
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
}));
jest.mock("../src/features/auth/AuthProvider", () => ({
  useAuth: () => ({ status: "authenticated" }),
}));
jest.mock("../src/hooks/useConnectivity", () => ({
  useConnectivity: () => ({ isOffline: mockOffline }),
}));
jest.mock("../src/features/incidents/queries", () => ({
  useIncidentApi: () => mockApi,
  useIncidentQuery: (kind) => mockDetail[kind] || mockQuery,
  useIncidentPages: (kind) => mockPages[kind] || mockQuery,
}));
jest.mock("../src/features/incidents/notifications", () => ({
  registerNotifications: (...a) => mockRegister(...a),
}));
jest.mock("../src/features/deployments/queries", () => ({
  useDeploymentList: () => ({
    ...mockQuery,
    data: {
      pages: [{ data: { items: [{ id: "project-1", name: "Test service" }] } }],
    },
  }),
  listItems: (q) => q.data?.pages?.flatMap((p) => p.data.items) || [],
}));
const incident = {
  id: "incident-1",
  projectId: "project-1",
  repositoryId: "repo-1",
  title: "Test incident",
  status: "monitoring",
  severity: "high",
  version: 3,
  health: { status: "unknown", policy: "Three observations required" },
  correlation: "Suggested deployment",
};
beforeEach(() => {
  jest.clearAllMocks();
  mockOffline = false;
  mockDetail = {};
  mockPages = {};
  mockApi.create.mockResolvedValue({ data: { id: "incident-1" } });
  mockRegister.mockResolvedValue();
});
it("renders empty state and native incident navigation", () => {
  const screen = render(<IncidentsScreen />);
  expect(screen.getByText("No incidents match these filters.")).toBeTruthy();
  fireEvent.press(screen.getByLabelText("Report incident"));
  expect(mockRouter.push).toHaveBeenCalledWith("/incident/create");
});
it("creates an incident only after selection and explicit action", async () => {
  const screen = render(<CreateIncidentScreen />);
  expect(mockApi.create).not.toHaveBeenCalled();
  fireEvent.changeText(
    screen.getByLabelText("Incident title"),
    "Synthetic failure",
  );
  fireEvent.press(screen.getByLabelText("Project: Test service"));
  fireEvent.press(screen.getByLabelText("Create incident"));
  await waitFor(() =>
    expect(mockApi.create).toHaveBeenCalledWith(
      {
        projectId: "project-1",
        title: "Synthetic failure",
        severity: "medium",
      },
      "fixture-request-key",
    ),
  );
});
it("does not resolve unknown health and routes logs/repository natively", () => {
  mockDetail.detail = { ...mockQuery, data: { data: incident } };
  const screen = render(<IncidentDetailScreen />);
  expect(
    screen.getByLabelText("Resolve verified incident").props.accessibilityState
      .disabled,
  ).toBe(true);
  fireEvent.press(
    screen.getByLabelText("Inspect deployment history and runtime logs"),
  );
  expect(mockRouter.push).toHaveBeenCalledWith({
    pathname: "/project/[id]",
    params: { id: "project-1" },
  });
  expect(mockApi.resolve).not.toHaveBeenCalled();
});
it("requires explicit confirmation even after automated verification", async () => {
  mockDetail.detail = {
    ...mockQuery,
    data: {
      data: {
        ...incident,
        health: { status: "verified", policy: "Verified observations" },
      },
    },
  };
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  const screen = render(<IncidentDetailScreen />);
  fireEvent.press(screen.getByLabelText("Resolve verified incident"));
  expect(mockApi.resolve).not.toHaveBeenCalled();
  await act(async () =>
    alert.mock.calls[0][2].find((b) => b.text === "Resolve").onPress(),
  );
  expect(mockApi.resolve).toHaveBeenCalledWith("incident-1", 3);
  alert.mockRestore();
});
it("hides revoked incident content and displays retry", () => {
  mockDetail.detail = {
    ...mockQuery,
    isError: true,
    error: { status: 403, message: "Access revoked" },
    data: { data: incident },
  };
  const screen = render(<IncidentDetailScreen />);
  expect(screen.queryByText("Test incident")).toBeNull();
  expect(screen.getByLabelText("Retry")).toBeTruthy();
});
it("disables monitoring offline and never displays cached verification as current", () => {
  mockOffline = true;
  mockDetail.health = {
    ...mockQuery,
    data: {
      data: { status: "verified", enabled: true, healthPath: "/health" },
    },
  };
  const screen = render(<MonitorScreen />);
  expect(
    screen.getByLabelText("Enable monitoring and incident detection").props
      .accessibilityState.disabled,
  ).toBe(true);
  expect(screen.queryByText(/health: verified/)).toBeNull();
});
it("handles device permission denial without enabling account notifications", async () => {
  mockRegister.mockRejectedValue(new Error("Notification permission denied"));
  const screen = render(<NotificationSettingsScreen />);
  fireEvent.press(screen.getByLabelText("Enable notifications on this device"));
  await waitFor(() =>
    expect(screen.getByText("Notification permission denied")).toBeTruthy(),
  );
  expect(mockApi.setPreferences).not.toHaveBeenCalled();
});
