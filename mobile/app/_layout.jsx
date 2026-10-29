import "../global.css";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "../src/features/auth/AuthProvider";
import { RepositoryProvider } from "../src/features/repositories/RepositoryProvider";

export default function RootLayout() {
  return (
    <AuthProvider>
      <RepositoryProvider>
        <StatusBar style="light" hidden />
        <Stack
          initialRouteName="(tabs)"
          screenOptions={{ headerShown: false, statusBarHidden: true, navigationBarHidden: true }}
        />
      </RepositoryProvider>
    </AuthProvider>
  );
}
