import { renderHook } from "@testing-library/react-native";
import { useConnectivity } from "../src/hooks/useConnectivity.js";

let mockNetwork = {};
jest.mock("expo-network", () => ({ useNetworkState: () => mockNetwork }));

it.each([
  [{ isConnected: false }, true],
  [{ isConnected: true, isInternetReachable: false }, true],
  [{ isConnected: true, isInternetReachable: true }, false],
])("handles network reachability %j", (state, offline) => {
  mockNetwork = state;
  expect(renderHook(() => useConnectivity()).result.current.isOffline).toBe(
    offline,
  );
});
