import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";
import {
  focusManager,
  onlineManager,
  QueryClientProvider,
} from "@tanstack/react-query";
import { useNetworkState } from "expo-network";
import { useAuth } from "../auth/AuthProvider";
import { createRepositoryClient, disposeRepositoryClient } from "./cache.js";

const SourceVisibleContext = createContext(true);
export const useSourceVisible = () => useContext(SourceVisibleContext);

export function RepositoryProvider({ children }) {
  const { session, status } = useAuth();
  const identity = status === "authenticated" ? session?.id : null;
  const client = useMemo(() => createRepositoryClient(), [identity]);
  const network = useNetworkState();
  const [sourceVisible, setSourceVisible] = useState(
    !["background", "inactive"].includes(AppState.currentState),
  );
  useEffect(() => {
    onlineManager.setOnline(
      network.isConnected !== false && network.isInternetReachable !== false,
    );
  }, [network.isConnected, network.isInternetReachable]);
  useEffect(() => {
    focusManager.setFocused(AppState.currentState === "active");
    const subscription = AppState.addEventListener("change", (state) => {
      focusManager.setFocused(state === "active");
      setSourceVisible(state === "active");
      // Private source does not survive app backgrounding, even in memory cache.
      if (state !== "active") {
        const files = (query) => query.queryKey[3] === "file";
        void client.cancelQueries({ predicate: files });
        client.removeQueries({ predicate: files });
      }
    });
    return () => {
      subscription.remove();
      void disposeRepositoryClient(client);
    };
  }, [client]);
  return (
    <QueryClientProvider key={identity || "signed-out"} client={client}>
      <SourceVisibleContext.Provider value={sourceVisible}>
        {children}
      </SourceVisibleContext.Provider>
    </QueryClientProvider>
  );
}
