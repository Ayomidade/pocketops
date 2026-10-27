/* global require */
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import EditorScreen from "../src/features/editor/EditorScreen.jsx";

const mockApi = {
  getFile: jest.fn(),
  getBranch: jest.fn(),
  createFixBranch: jest.fn(),
  commitFixFile: jest.fn(),
  createPullRequest: jest.fn(),
  listPullRequests: jest.fn(),
};
const mockRouter = { back: jest.fn(), replace: jest.fn(), dispatch: jest.fn() };
let mockAlert;

jest.mock("expo-router", () => ({
  Redirect: () => null,
  useLocalSearchParams: () => ({ id: "repo-id", path: "src/index.js", ref: "main" }),
  useRouter: () => mockRouter,
}));
jest.mock("@react-navigation/native", () => ({ usePreventRemove: jest.fn() }));
jest.mock("../src/features/auth/AuthProvider", () => ({
  useAuth: () => ({ status: "authenticated", user: { id: "user-id" } }),
}));
jest.mock("../src/hooks/useConnectivity", () => ({ useConnectivity: () => ({ isOffline: false }) }));
jest.mock("../src/features/repositories/queries.js", () => ({
  useRepository: () => ({ isPending: false, isSuccess: true, data: { data: { id: "repo-id", fullName: "org/repo", defaultBranch: "main" } }, refetch: jest.fn() }),
  useRepositoryApi: () => ({ api: mockApi }),
}));
jest.mock("../src/features/editor/draft-storage.js", () => ({
  editorDraftStore: { load: jest.fn(async () => null), find: jest.fn(async () => null), save: jest.fn(async () => ({})), delete: jest.fn(async () => {}), clearUser: jest.fn(async () => {}) },
}));
jest.mock("react-native-webview", () => {
  const ReactValue = require("react");
  const Native = require("react-native");
  return {
    WebView: ReactValue.forwardRef((props, ref) => {
      const sessionId = props.source.html.match(/sessionId":"([^"]+)/)?.[1];
      const bootRequestId = props.source.html.match(/bootRequestId":"([^"]+)/)?.[1];
      ReactValue.useImperativeHandle(ref, () => ({
        postMessage(raw) {
          const message = JSON.parse(raw);
          if (message.type === "LOAD_DOCUMENT") {
            props.onMessage({ nativeEvent: { data: JSON.stringify({ version: 1, type: "DOCUMENT_READY", sessionId, requestId: message.requestId, payload: { readOnly: message.payload.readOnly } }) } });
          }
          if (message.type === "REQUEST_CONTENT") {
            props.onMessage({ nativeEvent: { data: JSON.stringify({ version: 1, type: "CONTENT_RESULT", sessionId, requestId: message.requestId, payload: { content: "const changed = true;\\n" } }) } });
          }
        },
      }));
      ReactValue.useEffect(() => {
        props.onMessage({ nativeEvent: { data: JSON.stringify({ version: 1, type: "EDITOR_READY", sessionId, requestId: bootRequestId, payload: {} }) } });
      }, []);
      return <Native.View><Native.Text accessibilityLabel="Mock WebView">Local CodeMirror</Native.Text><Native.Pressable accessibilityRole="button" accessibilityLabel="Mock edit" onPress={() => props.onMessage({ nativeEvent: { data: JSON.stringify({ version: 1, type: "DOCUMENT_CHANGED", sessionId, requestId: "change-test", payload: { content: "const changed = true;\\n", line: 1, column: 1 } }) } })}><Native.Text>Mock edit</Native.Text></Native.Pressable><Native.Pressable accessibilityRole="button" accessibilityLabel="Mock crash" onPress={() => props.onError?.()}><Native.Text>Mock crash</Native.Text></Native.Pressable></Native.View>;
    }),
  };
});

function confirmAlert(buttonLabel) {
  const buttons = mockAlert.mock.calls.at(-1)[2];
  const button = buttons.find((item) => item.text === buttonLabel);
  if (!button) throw new Error(`Alert button not found: ${buttonLabel}`);
  return act(async () => button.onPress?.());
}

describe("native editor workflow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAlert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    mockApi.getFile.mockResolvedValue({ data: { path: "src/index.js", ref: "main", size: 19, sha: "a".repeat(40), content: "const old = true;\\n", encoding: "utf-8", editable: true } });
    mockApi.getBranch.mockResolvedValue({ data: { name: "main", commitSha: "b".repeat(40), protected: true } });
    mockApi.createFixBranch.mockResolvedValue({ data: { branch: "fix/incident-1" } });
    mockApi.commitFixFile.mockResolvedValue({ data: { contentSha: "c".repeat(40), commitSha: "d".repeat(40) } });
    mockApi.createPullRequest.mockResolvedValue({ data: { number: 9, url: "https://github.com/org/repo/pull/9", state: "open" } });
  });

  afterEach(() => mockAlert.mockRestore());

  it("opens a new fix branch, edits, reviews a native diff, confirms commit and opens a PR", async () => {
    const screen = render(<EditorScreen />);
    await screen.findByLabelText("Choose fix branch");
    await waitFor(() => expect(screen.getByLabelText("Mock WebView")).toBeTruthy());
    fireEvent.press(screen.getByLabelText("Choose fix branch"));
    fireEvent.changeText(screen.getByLabelText("New fix branch name"), "fix/incident-1");
    fireEvent.press(screen.getByLabelText("Create fix branch"));
    await confirmAlert("Create branch");
    await waitFor(() => expect(mockApi.createFixBranch).toHaveBeenCalled());
    fireEvent.press(screen.getByLabelText("Mock edit"));
    fireEvent.press(await screen.findByLabelText("Review native diff"));
    await screen.findByLabelText("Native file diff");
    expect(mockApi.commitFixFile).not.toHaveBeenCalled();
    fireEvent.press(screen.getByLabelText("Confirm and commit"));
    await confirmAlert("Commit changes");
    await waitFor(() => expect(mockApi.commitFixFile).toHaveBeenCalled());
    await screen.findByText(/Commit created on fix\/incident-1/);
    fireEvent.press(screen.getByLabelText("Review and open pull request"));
    await confirmAlert("Open pull request");
    await waitFor(() => expect(mockApi.createPullRequest).toHaveBeenCalled());
    expect(await screen.findByText("Pull request #9 is open.")).toBeTruthy();
    expect(mockApi.commitFixFile.mock.calls[0][1]).toMatchObject({ branch: "fix/incident-1", path: "src/index.js", expectedSha: "a".repeat(40) });
  });

  it("recovers from a local WebView process failure by reloading the current source", async () => {
    const screen = render(<EditorScreen />);
    await screen.findByLabelText("Mock WebView");
    await screen.findByLabelText("Choose fix branch");
    fireEvent.press(screen.getByLabelText("Mock crash"));
    expect(await screen.findByText(/local editor crashed/)).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Reload editor and current file"));
    await waitFor(() => expect(mockApi.getFile).toHaveBeenCalledTimes(2));
    await screen.findByLabelText("Choose fix branch");
    expect(screen.queryByText(/local editor crashed/)).toBeNull();
  });

  it("dismiss recovers a transient branch-metadata error back to the editable stage", async () => {
    mockApi.getBranch.mockRejectedValueOnce(new Error("temporary network error"));
    const screen = render(<EditorScreen />);
    expect(await screen.findByText("temporary network error")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Dismiss"));
    await screen.findByLabelText("Choose fix branch");
    expect(screen.queryByText("temporary network error")).toBeNull();
  });

  it("dismiss retries the initial file load after it fails", async () => {
    mockApi.getFile.mockRejectedValueOnce(new Error("offline blip"));
    const screen = render(<EditorScreen />);
    expect(await screen.findByText("offline blip")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Dismiss"));
    await waitFor(() => expect(mockApi.getFile).toHaveBeenCalledTimes(2));
    await screen.findByLabelText("Choose fix branch");
  });
});
