import editorFont from "../assets/fonts/JetBrainsMono-Regular.ttf";
import { useFonts } from "expo-font";
import { NotificationBridge } from "../src/features/incidents/NotificationBridge";
import "../global.css";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "../src/features/auth/AuthProvider";
import { RepositoryProvider } from "../src/features/repositories/RepositoryProvider";

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ JetBrainsMono: editorFont });
  if (!fontsLoaded && !fontError) return null;
  return (
    <AuthProvider>
      <RepositoryProvider>
        <NotificationBridge />
        <StatusBar style="light" hidden />
        <Stack
          initialRouteName="(tabs)"
          screenOptions={{
            headerShown: false,
            statusBarHidden: true,
            navigationBarHidden: true,
          }}
        />
      </RepositoryProvider>
    </AuthProvider>
  );
}
