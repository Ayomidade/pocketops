import { useEffect } from "react";
import { AppState, Text } from "react-native";
import { act, render, waitFor } from "@testing-library/react-native";
import { useQueryClient } from "@tanstack/react-query";
import {
  RepositoryProvider,
  useSourceVisible,
} from "../src/features/repositories/RepositoryProvider";
import { repositoryKey } from "../src/features/repositories/cache.js";

let mockSession = "first-session";
jest.mock("../src/features/auth/AuthProvider", () => ({
  useAuth: () => ({
    session: { id: mockSession },
    status: mockSession ? "authenticated" : "signed_out",
  }),
}));
jest.mock("expo-network", () => ({
  useNetworkState: () => ({ isConnected: true, isInternetReachable: true }),
}));

it("isolates session caches, clears logout data, and hides source on background", async () => {
  let onState;
  const spy = jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation((_event, callback) => {
      onState = callback;
      return { remove() {} };
    });
  const clients = [];
  const key = repositoryKey("repo", "file", "main", "secret.txt");
  function Probe() {
    const client = useQueryClient();
    const visible = useSourceVisible();
    useEffect(() => {
      clients.push(client);
      client.setQueryData(key, { content: "private" });
    }, [client]);
    return <Text>{visible ? "Source visible" : "Source hidden"}</Text>;
  }
  try {
    const screen = render(
      <RepositoryProvider>
        <Probe />
      </RepositoryProvider>,
    );
    expect(clients[0].getQueryData(key)).toBeDefined();
    act(() => onState("background"));
    expect(screen.getByText("Source hidden")).toBeTruthy();
    expect(clients[0].getQueryData(key)).toBeUndefined();
    act(() => onState("active"));
    expect(screen.getByText("Source visible")).toBeTruthy();
    mockSession = "second-session";
    screen.rerender(
      <RepositoryProvider>
        <Probe />
      </RepositoryProvider>,
    );
    await waitFor(() =>
      expect(clients[0].getQueryCache().getAll()).toHaveLength(0),
    );
    expect(clients[1]).not.toBe(clients[0]);
    mockSession = null;
    screen.rerender(
      <RepositoryProvider>
        <Probe />
      </RepositoryProvider>,
    );
    await waitFor(() =>
      expect(clients[1].getQueryCache().getAll()).toHaveLength(0),
    );
    screen.unmount();
  } finally {
    spy.mockRestore();
    mockSession = "first-session";
    clients.forEach((client) => client.clear());
  }
});
