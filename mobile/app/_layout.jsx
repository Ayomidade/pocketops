import { ConfirmationProvider } from "../src/components/ui/ConfirmationProvider";
import interFont from "../assets/fonts/Inter.ttf";
import { ThemeProvider, useTheme } from "../src/theme/ThemeProvider";
import editorFont from "../assets/fonts/JetBrainsMono-Regular.ttf";
import { useFonts } from "expo-font";
import { NotificationBridge } from "../src/features/incidents/NotificationBridge";
import "../global.css";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "../src/features/auth/AuthProvider";
import { RepositoryProvider } from "../src/features/repositories/RepositoryProvider";

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ Inter: interFont, JetBrainsMono: editorFont });
  if (!fontsLoaded && !fontError) return null;
  return (
    <ThemeProvider><ConfirmationProvider><AppContent /></ConfirmationProvider></ThemeProvider>
  );
}
function AppContent() {
  const { scheme } = useTheme();
  return (<AuthProvider>
      <RepositoryProvider>
        <NotificationBridge />
        <StatusBar style={scheme === "dark" ? "light" : "dark"} />
        <Stack
          initialRouteName="(tabs)"
          screenOptions={{
            headerShown: false,
            statusBarHidden: false,
            navigationBarHidden: false,
          }}
        />
      </RepositoryProvider>
    </AuthProvider>
  );
}
