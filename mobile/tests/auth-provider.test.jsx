import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";
import LoginPage from "../app/(auth)/login";
import { AuthProvider, useAuth } from "../src/features/auth/AuthProvider";
import { sessionStorageKey, pendingSessionStorageKey } from "../src/features/auth/session.js";
const mockRequest = jest.fn(); const mockOpen = jest.fn(); const mockDismiss = jest.fn(); const mockValues = new Map();
let mockUrlListener;
jest.mock("expo-network", () => ({ useNetworkState: () => ({ isConnected: true, isInternetReachable: true }) }));
jest.mock("expo-crypto", () => ({ getRandomBytesAsync: async () => new Uint8Array(32).fill(4) }));
jest.mock("expo-linking", () => ({ createURL: (path) => `pocketops://${path}`, addEventListener: (_type, listener) => { mockUrlListener = listener; return { remove: jest.fn() }; } }));
jest.mock("expo-secure-store", () => ({ getItemAsync: async (key) => mockValues.get(key) || null, setItemAsync: async (key, value) => { mockValues.set(key, value); }, deleteItemAsync: async (key) => { mockValues.delete(key); } }));
jest.mock("expo-web-browser", () => ({ openAuthSessionAsync: (...args) => mockOpen(...args), dismissBrowser: (...args) => mockDismiss(...args) }));
jest.mock("../src/services/api.js", () => ({ ...jest.requireActual("../src/services/api.js"), apiRequest: (...args) => mockRequest(...args) }));
jest.mock("../src/features/editor/draft-storage.js", () => ({ editorDraftStore: { clearUser: jest.fn(async () => {}) } }));
function SessionProbe() { const { status } = useAuth(); return <Text testID="session-status">{status}</Text>; }
const url = `pocketops://auth/callback?handoff=${"h".repeat(43)}`;
function setup() { return render(<AuthProvider><LoginPage /><SessionProbe /></AuthProvider>); }
beforeEach(() => {
  jest.clearAllMocks(); mockValues.clear(); mockUrlListener = null;
  mockRequest.mockImplementation(async (path) => {
    if (path === "/auth/mobile/start") return { data: { authorizationUrl: "https://api.example.test/auth/github?state=fixture" } };
    if (path === "/auth/mobile/exchange") return { data: { token: "native-session-token", user: { id: "user-native" }, session: { id: "session-native", expiresAt: "2099-01-01T00:00:00Z" } } };
    return { data: {} };
  });
});
it("signs in from the native system browser and stores only the PocketOps session", async () => {
  mockOpen.mockResolvedValue({ type: "success", url });
  const screen = setup(); fireEvent.press(await screen.findByLabelText("Continue with GitHub"));
  await waitFor(() => expect(screen.getByTestId("session-status")).toHaveTextContent("authenticated"));
  expect(mockOpen).toHaveBeenCalledWith("https://api.example.test/auth/github?state=fixture", "pocketops://auth/callback");
  expect(mockValues.get(sessionStorageKey)).toBe("native-session-token"); expect(mockValues.has(pendingSessionStorageKey)).toBe(false);
  expect(mockRequest).toHaveBeenCalledWith("/auth/mobile/start", expect.objectContaining({ body: { redirectUri: "pocketops://auth/callback", completionSecret: expect.stringMatching(/^[a-f0-9]{64}$/) } }));
});
it("handles native URL delivery followed by browser dismissal without reversing completed sign-in", async () => {
  let finishBrowser; mockOpen.mockImplementation(() => new Promise((resolve) => { finishBrowser = resolve; }));
  const screen = setup(); fireEvent.press(await screen.findByLabelText("Continue with GitHub"));
  await waitFor(() => expect(mockOpen).toHaveBeenCalled());
  await act(async () => { mockUrlListener({ url }); });
  await waitFor(() => expect(screen.getByTestId("session-status")).toHaveTextContent("authenticated"));
  await act(async () => { finishBrowser({ type: "dismiss" }); });
  expect(screen.getByTestId("session-status")).toHaveTextContent("authenticated"); expect(mockRequest.mock.calls.filter(([path]) => path === "/auth/mobile/exchange")).toHaveLength(1);
});
it("shows a denied sign-in as cancellation and permits another attempt", async () => {
  mockOpen.mockResolvedValue({ type: "success", url: "pocketops://auth/callback?error=access_denied" });
  const screen = setup(); fireEvent.press(await screen.findByLabelText("Continue with GitHub"));
  await screen.findByText("GitHub sign-in was cancelled.");
  fireEvent.press(screen.getByLabelText("Continue with GitHub")); await waitFor(() => expect(mockOpen).toHaveBeenCalledTimes(2));
  expect(mockRequest.mock.calls.filter(([path]) => path === "/auth/mobile/exchange")).toHaveLength(0);
});
