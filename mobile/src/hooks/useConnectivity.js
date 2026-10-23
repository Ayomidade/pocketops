import { useNetworkState } from "expo-network";

export function useConnectivity() {
  const networkState = useNetworkState();
  return {
    isOffline:
      networkState.isConnected === false ||
      networkState.isInternetReachable === false,
    networkState,
  };
}
