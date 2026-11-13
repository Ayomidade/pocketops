import { fireEvent, render, waitFor } from "@testing-library/react-native";
import Callback from "../app/github/callback";
import Connections from "../app/connections";
let mockParams = {};
const mockRequest = jest.fn(),
  mockOpen = jest.fn();
jest.mock("expo-router", () => {
  const { useEffect } = jest.requireActual("react");
  const { Text } = jest.requireActual("react-native");
  return {
    useRouter: () => ({ push: jest.fn() }),
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (fn) => useEffect(fn, [fn]),
    Redirect: ({ href }) => (
      <Text testID="redirect">{JSON.stringify(href)}</Text>
    ),
    Link: ({ children }) => <Text>{children}</Text>,
  };
});
jest.mock("expo-network", () => ({
  useNetworkState: () => ({ isConnected: true, isInternetReachable: true }),
}));
jest.mock("expo-linking", () => ({
  createURL: (path) => `pocketops://${path}`,
}));
jest.mock("expo-web-browser", () => ({
  openAuthSessionAsync: (...args) => mockOpen(...args),
}));
jest.mock("../src/features/auth/AuthProvider", () => ({
  useAuth: () => ({
    status: "authenticated",
    authenticatedRequest: mockRequest,
  }),
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockRequest.mockImplementation(async (path) => ({
    data: path.endsWith("/start")
      ? { authorizationUrl: "https://github.com/login/oauth/authorize" }
      : [],
  }));
});
it.each(["connected", "cancelled", "failed"])(
  "routes a %s native callback to connections even without a browser promise",
  (status) => {
    mockParams = { status };
    const screen = render(<Callback />);
    expect(JSON.parse(screen.getByTestId("redirect").props.children)).toEqual({
      pathname: "/connections",
      params: { githubStatus: status },
    });
  },
);
it.each([
  { status: ["connected", "failed"] },
  { status: "connected", code: "private-value" },
  {},
])(
  "rejects unexpected callback parameters without propagating them",
  (params) => {
    mockParams = params;
    const screen = render(<Callback />);
    expect(JSON.parse(screen.getByTestId("redirect").props.children)).toEqual({
      pathname: "/connections",
      params: { githubStatus: "failed" },
    });
  },
);
it("refreshes accounts on callback navigation and never trusts status as membership", async () => {
  mockParams = { githubStatus: "connected" };
  const screen = render(<Connections />);
  await waitFor(() =>
    expect(screen.getByText("No GitHub App connections")).toBeTruthy(),
  );
  expect(mockRequest).toHaveBeenCalledWith("/github/installations", {});
  expect(screen.queryByText("Connected accounts")).toBeNull();
});
it("reconciles accounts after browser dismissal rather than assuming cancellation", async () => {
  mockOpen.mockResolvedValue({ type: "dismiss" });
  const screen = render(<Connections />);
  await waitFor(() =>
    expect(screen.getByText("No GitHub App connections")).toBeTruthy(),
  );
  fireEvent.press(screen.getByLabelText("Connect GitHub App"));
  await waitFor(() =>
    expect(
      mockRequest.mock.calls.filter(
        ([path]) => path === "/github/installations",
      ),
    ).toHaveLength(2),
  );
});
it("renders the returned connection notice with native-safe accessibility and exposes repositories", async () => {
  mockParams = { githubStatus: "connected" };
  mockRequest.mockImplementation(async (path) => ({
    data:
      path === "/github/installations"
        ? [
            {
              id: "installation",
              accountLogin: "fixture-owner",
              accountType: "User",
              selectedRepositoryCount: 0,
              repositoryCount: 1,
            },
          ]
        : [
            {
              githubRepositoryId: "repo-1",
              fullName: "fixture-owner/test-repository",
              selected: false,
            },
          ],
  }));
  const screen = render(<Connections />);
  const notice = await screen.findByText(
    "GitHub connection verified. Select the repositories PocketOps may access.",
  );
  expect(notice.props.accessibilityRole).toBe("text");
  expect(notice.props.accessibilityLiveRegion).toBe("polite");
  await waitFor(() =>
    expect(
      screen.getByLabelText("Select fixture-owner/test-repository"),
    ).toBeTruthy(),
  );
  fireEvent.press(
    screen.getByLabelText("Select fixture-owner/test-repository"),
  );
  fireEvent.press(screen.getByLabelText("Save selected repositories"));
  await waitFor(() =>
    expect(mockRequest).toHaveBeenCalledWith(
      "/github/installations/sync",
      expect.objectContaining({
        body: {
          installationId: "installation",
          githubRepositoryIds: ["repo-1"],
        },
      }),
    ),
  );
});
