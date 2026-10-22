import "../global.css";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "../src/features/auth/AuthProvider";

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="light" />
      <Stack initialRouteName="(tabs)" screenOptions={{ headerShown: false }} />
    </AuthProvider>
  );
}
