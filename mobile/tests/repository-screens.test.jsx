import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react-native";
import {
  QueryClientProvider,
  onlineManager,
  notifyManager,
} from "@tanstack/react-query";
import {
  createRepositoryClient,
  repositoryKey,
} from "../src/features/repositories/cache.js";
import {
  DirectoryScreen,
  FileScreen,
  RepositoriesScreen,
} from "../src/features/repositories/screens";

let mockParams = { id: "repo-a", path: "", ref: "main" };
let mockOffline = false;
let mockVisible = true;
const mockRequest = jest.fn();
const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: () => true,
  setParams: jest.fn((params) => {
    mockParams = { ...mockParams, ...params };
  }),
};
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  useFocusEffect: jest.fn(),
  Redirect: () => null,
}));
jest.mock("../src/features/auth/AuthProvider", () => ({
  useAuth: () => ({
    status: "authenticated",
    authenticatedRequest: mockRequest,
  }),
}));
jest.mock("../src/hooks/useConnectivity", () => ({
  useConnectivity: () => ({ isOffline: mockOffline }),
}));
jest.mock("../src/features/repositories/RepositoryProvider", () => ({
  useSourceVisible: () => mockVisible,
}));

const repo = {
  id: "repo-a",
  fullName: "org/api",
  defaultBranch: "main",
  private: true,
};
const directory = {
  name: "src",
  path: "src",
  type: "dir",
  sha: "dir-sha",
  size: 0,
};
const source = {
  name: "app.js",
  path: "src/app.js",
  type: "file",
  sha: "blob-sha",
  size: 5,
};
const response = (data, meta = {}) => ({
  success: true,
  data,
  meta: { requestId: "test", nextCursor: null, ...meta },
});
let clients = [];

function setup(element, seed) {
  const client = createRepositoryClient();
  client.setDefaultOptions({ queries: { retry: false, gcTime: Infinity } });
  clients.push(client);
  seed?.(client);
  const wrapper = ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { ...render(element, { wrapper }), client };
}

beforeEach(() => {
  notifyManager.setNotifyFunction((callback) => act(callback));
  mockParams = { id: "repo-a", path: "", ref: "main" };
  mockOffline = false;
  mockVisible = true;
  jest.clearAllMocks();
  mockRequest.mockImplementation(async (path) => {
    if (path === "/github/installations")
      return response([{ id: "install", accountLogin: "org" }]);
    if (path.includes("/branches"))
      return response([{ name: "main" }, { name: "feature/fix" }]);
    if (path.includes("/tree?"))
      return response(
        new URL(path, "https://example.test").searchParams.get("path")
          ? [source]
          : [directory],
      );
    if (path.includes("/file?"))
      return response({
        path: "src/app.js",
        ref: "main",
        size: 5,
        sha: "blob-sha",
        content: "hello",
        encoding: "utf-8",
        editable: true,
      });
    if (path === "/github/repositories/repo-a") return response(repo);
    return response([repo]);
  });
});

afterEach(async () => {
  jest.useRealTimers();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  cleanup();
  clients.forEach((client) => client.clear());
  clients = [];
  onlineManager.setOnline(true);
});

describe("repository screen integration with mocked API", () => {
  it("debounces a bounded search and explains an empty directory", async () => {
    const list = setup(<RepositoriesScreen />);
    jest.useFakeTimers();
    fireEvent.changeText(list.getByLabelText("Search repositories"), "worker");
    expect(
      mockRequest.mock.calls.some(([path]) => path.includes("search=worker")),
    ).toBe(false);
    act(() => {
      jest.advanceTimersByTime(350);
    });
    jest.useRealTimers();
    await waitFor(() =>
      expect(
        mockRequest.mock.calls.some(([path]) => path.includes("search=worker")),
      ).toBe(true),
      { timeout: 10000 },
    );
    list.unmount();
    mockRequest.mockImplementation(async (path) =>
      path.includes("/tree?") ? response([]) : response(repo),
    );
    const directoryView = setup(<DirectoryScreen />);
    expect(
      await directoryView.findByText("This directory is empty."),
    ).toBeTruthy();
  }, 15000);

  it("keeps source hidden after a transient provider failure and offers retry", async () => {
    mockParams.path = "src/app.js";
    mockRequest.mockRejectedValue({ status: 502 });
    const screen = setup(<FileScreen />, (client) =>
      client.setQueryData(
        repositoryKey("repo-a", "file", "main", "src/app.js"),
        response({ content: "old private source" }),
      ),
    );
    expect(await screen.findByLabelText("Retry")).toBeTruthy();
    expect(screen.queryByText("old private source")).toBeNull();
  });

  it.each(["binary", "oversized"])(
    "handles %s file responses without text decoding",
    async (kind) => {
      mockParams.path = "src/app.js";
      mockRequest.mockImplementation(async (path) => {
        if (path.includes("/file?")) {
          if (kind === "oversized")
            throw { status: 413, code: "FILE_TOO_LARGE" };
          return response({
            path: "src/app.js",
            ref: "main",
            sha: "binary-sha",
            size: 4,
            encoding: "binary",
            content: null,
            editable: false,
          });
        }
        return response(repo);
      });
      const screen = setup(<FileScreen />);
      expect(
        await screen.findByText(
          kind === "binary" ? /Binary or unsupported/ : /larger than 512 KiB/,
        ),
      ).toBeTruthy();
    },
  );

  it("loads selected repositories and pages using the returned cursor", async () => {
    mockRequest.mockImplementation(async (path) => {
      if (path.includes("installations"))
        return response([{ accountLogin: "org" }]);
      return path.includes("cursor=")
        ? response([{ ...repo, id: "repo-b", fullName: "org/worker" }])
        : response([repo], { nextCursor: "signed-cursor" });
    });
    const screen = setup(<RepositoriesScreen />);
    await screen.findByLabelText("Load more repositories");
    await waitFor(() =>
      expect(
        screen.getByLabelText("Load more repositories").props.accessibilityState
          .disabled,
      ).toBe(false),
    );
    fireEvent.press(screen.getByLabelText("Load more repositories"));
    await screen.findByLabelText("Open repository org/worker");
    expect(
      mockRequest.mock.calls.some(([path]) =>
        path.includes("cursor=signed-cursor"),
      ),
    ).toBe(true);
    fireEvent.press(screen.getByLabelText("Open repository org/worker"));
    expect(mockRouter.push).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ id: "repo-b" }),
      }),
    );
  });

  it("navigates root → directory → file and changes the requested branch at root", async () => {
    const screen = setup(<DirectoryScreen />);
    fireEvent.press(await screen.findByLabelText("Open directory src"));
    expect(mockRouter.setParams).toHaveBeenLastCalledWith({
      ref: "main",
      path: "src",
    });
    screen.rerender(<DirectoryScreen />);
    fireEvent.press(await screen.findByLabelText("Preview file app.js"));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: "/repository/[id]/file",
      params: { id: "repo-a", ref: "main", path: "src/app.js" },
    });
    fireEvent.press(screen.getByLabelText("Branch: main"));
    fireEvent.press(await screen.findByLabelText("Select branch feature/fix"));
    expect(mockRouter.setParams).toHaveBeenLastCalledWith({
      ref: "feature/fix",
      path: "",
    });
    screen.rerender(<DirectoryScreen />);
    await waitFor(() =>
      expect(
        mockRequest.mock.calls.some(([path]) =>
          path.includes("ref=feature%2Ffix"),
        ),
      ).toBe(true),
    );
    expect(screen.getByText(/Branch changed/)).toBeTruthy();
  });

  it("shows a file revision and drops source on background/unmount", async () => {
    mockParams.path = "src/app.js";
    const screen = setup(<FileScreen />);
    expect(await screen.findByText("hello")).toBeTruthy();
    expect(screen.getByText(/Blob SHA: blob-sha/)).toBeTruthy();
    mockVisible = false;
    screen.rerender(<FileScreen />);
    expect(screen.queryByText("hello")).toBeNull();
    await waitFor(() =>
      expect(
        screen.client.getQueryData(
          repositoryKey("repo-a", "file", "main", "src/app.js"),
        ),
      ).toBeUndefined(),
    );
  });

  it.each([401, 403, 404])(
    "hides stale repository data after HTTP %i",
    async (status) => {
      mockRequest.mockRejectedValue({
        status,
        code: status === 401 ? "UNAUTHENTICATED" : "RESOURCE_NOT_FOUND",
      });
      const screen = setup(<DirectoryScreen />, (client) =>
        client.setQueryData(repositoryKey("repo-a", "detail"), response(repo)),
      );
      await screen.findByText(
        /no longer available|missing, or access|session expired/,
      );
      expect(screen.queryByText("org/api")).toBeNull();
      expect(screen.queryByLabelText("Open directory src")).toBeNull();
    },
  );

  it("keeps a pending file in a loading state and never displays another repository's source", async () => {
    mockParams = { id: "repo-b", path: "src/app.js", ref: "next" };
    let resolve;
    mockRequest.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const screen = setup(<FileScreen />, (client) =>
      client.setQueryData(
        repositoryKey("repo-a", "file", "main", "src/app.js"),
        response({ content: "private old source" }),
      ),
    );
    expect(screen.getByLabelText("Loading file preview")).toBeTruthy();
    expect(screen.queryByText("private old source")).toBeNull();
    await act(async () => {
      resolve(response({ ...repo, id: "repo-b" }));
    });
    expect(screen.queryByText("private old source")).toBeNull();
  });

  it("shows rate limiting with explicit retry", async () => {
    mockRequest.mockRejectedValue({ status: 429 });
    const screen = setup(<DirectoryScreen />);
    expect(await screen.findByText(/Wait a minute/)).toBeTruthy();
    mockRequest.mockImplementation(async (path) =>
      path.includes("/tree?") ? response([]) : response(repo),
    );
    fireEvent.press(screen.getByLabelText("Retry"));
    expect(await screen.findByText("This directory is empty.")).toBeTruthy();
  });

  it("labels offline cached metadata as stale and disables repository opening", async () => {
    mockOffline = true;
    onlineManager.setOnline(false);
    const screen = setup(<RepositoriesScreen />, (client) =>
      client.setQueryData(["repositories", "list", ""], {
        pages: [response([repo])],
        pageParams: [undefined],
      }),
    );
    expect(screen.getByText(/cached metadata may be stale/)).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Open repository org/api"));
    expect(mockRouter.push).not.toHaveBeenCalled();
  });
});
