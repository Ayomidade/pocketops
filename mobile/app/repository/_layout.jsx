import { Redirect, Stack } from "expo-router";
import { View } from "react-native";
import { useAuth } from "../../src/features/auth/AuthProvider";
import { protectedRouteAction } from "../../src/features/auth/session.js";
import RemoteState from "../../src/components/RemoteState";

export default function RepositoryLayout() {
  const { status, restoreSession } = useAuth();
  const action = protectedRouteAction(status);
  if (action === "sign_in") return <Redirect href="/(auth)/login" />;
  if (action !== "render")
    return (
      <View className="flex-1 justify-center bg-ink p-5">
        <RemoteState
          kind={action === "loading" ? "loading" : "error"}
          title="Checking secure session"
          onRetry={restoreSession}
        />
      </View>
    );
  return <Stack screenOptions={{ headerShown: false }} />;
}
