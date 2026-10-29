import { Redirect, Stack } from "expo-router";
import { useAuth } from "../../src/features/auth/AuthProvider";

export default function AuthLayout() {
  const { status } = useAuth();
  if (status === "authenticated") return <Redirect href="/(tabs)" />;
  return <Stack screenOptions={{ headerShown: false, statusBarHidden: true, navigationBarHidden: true }} />;
}
