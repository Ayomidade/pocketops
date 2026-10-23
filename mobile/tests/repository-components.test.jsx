import { fireEvent, render } from "@testing-library/react-native";
import {
  BranchSelector,
  Breadcrumbs,
  ConnectionEmptyState,
  FilePreview,
  RepositoryList,
  RetryState,
} from "../src/features/repositories/components";

describe("native repository components", () => {
  it("navigates breadcrumbs without rendering a recursive tree", () => {
    const navigate = jest.fn();
    const screen = render(
      <Breadcrumbs path="src/nested" onNavigate={navigate} />,
    );
    fireEvent.press(screen.getByLabelText("Navigate to src"));
    expect(navigate).toHaveBeenCalledWith("src");
    fireEvent.press(screen.getByLabelText("Navigate to Root"));
    expect(navigate).toHaveBeenLastCalledWith("");
  });

  it("warns before branch selection, selects a slash branch and closes the picker", () => {
    const select = jest.fn();
    const visibility = jest.fn();
    const screen = render(
      <BranchSelector
        current="main"
        branches={[{ name: "feature/fix" }]}
        onSelect={select}
        onVisibility={visibility}
      />,
    );
    fireEvent.press(screen.getByLabelText("Branch: main"));
    expect(screen.getByText(/File contents may differ/)).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Select branch feature/fix"));
    expect(select).toHaveBeenCalledWith("feature/fix");
    expect(visibility).toHaveBeenLastCalledWith(false);
  });

  it("previews source as inert selectable monospace text and handles an empty file", () => {
    const screen = render(
      <FilePreview
        file={{
          content: "<script>alert('x')</script>",
          encoding: "utf-8",
          size: 27,
          editable: true,
        }}
      />,
    );
    expect(
      screen.getByText("<script>alert('x')</script>").props.selectable,
    ).toBe(true);
    screen.rerender(
      <FilePreview
        file={{ content: "", encoding: "utf-8", size: 0, editable: true }}
      />,
    );
    expect(screen.getByText(/Read-only/)).toBeTruthy();
  });

  it.each([
    [{ content: null, encoding: "binary", size: 20 }, /Binary or unsupported/],
    [{ content: "", encoding: "utf-8", size: 524289 }, /larger than 512 KiB/],
  ])("explains unsupported file metadata %j", (file, message) => {
    expect(render(<FilePreview file={file} />).getByText(message)).toBeTruthy();
  });

  it.each([
    [false, "Connect your GitHub App"],
    [true, "No repositories selected"],
  ])("distinguishes connection empty state %s", (connected, title) => {
    const connect = jest.fn();
    const screen = render(
      <ConnectionEmptyState connected={connected} onConnect={connect} />,
    );
    expect(screen.getByText(title)).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Manage GitHub connections"));
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 404, 429, 502])("offers retry for HTTP %i", (status) => {
    const retry = jest.fn();
    const screen = render(<RetryState error={{ status }} onRetry={retry} />);
    fireEvent.press(screen.getByLabelText("Retry"));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("virtualizes a 1000-row fixture and records host render cost without promising device FPS", () => {
    const rows = Array.from({ length: 1000 }, (_, id) => ({
      id: String(id),
      fullName: `org/repo-${id}`,
      defaultBranch: "main",
    }));
    const start = Date.now();
    const screen = render(
      <RepositoryList repositories={rows} onOpen={() => {}} />,
    );
    console.info(
      `RepositoryList host test render: ${Date.now() - start}ms; 1000 records`,
    );
    expect(screen.getAllByRole("button").length).toBeLessThanOrEqual(12);
    expect(screen.queryByLabelText("Open repository org/repo-999")).toBeNull();
  });
});
