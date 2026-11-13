import { useBreakpoint } from "../../src/hooks/useBreakpoint";
import Icon from "../../src/components/Icon";
import { useTheme } from "../../src/theme/ThemeProvider";
import { Link, Redirect, Tabs } from "expo-router";
import { View } from "react-native";
import RemoteState from "../../src/components/RemoteState";
import { useAuth } from "../../src/features/auth/AuthProvider";
import { protectedRouteAction } from "../../src/features/auth/session";
const tabs = [
  { name: "index", title: "Overview", icon: "home", label: "Overview tab" },
  { name: "repositories", title: "Repositories", icon: "repo", label: "Repositories tab" },
  { name: "deployments", title: "Projects", icon: "deploy", label: "Projects tab" },
  { name: "incidents", title: "Incidents", icon: "incident", label: "Incidents tab" },
];
export default function TabLayout() {
  const { colors } = useTheme();
  const { compact } = useBreakpoint();
  const { status, message, restoreSession } = useAuth();
  const routeAction = protectedRouteAction(status);
  if (routeAction === "loading") {
    return (
      <View className="flex-1 justify-center bg-bg px-6">
        <RemoteState kind="loading" title="Restoring secure session..." />
      </View>
    );
  }
  if (routeAction === "retry") {
    return (
      <View className="flex-1 justify-center bg-bg px-6">
        <RemoteState
          kind="error"
          title="Unable to restore session"
          message={message}
          onRetry={() => void restoreSession()}
          retryLabel="Retry"
        />
        <Link
          className="mt-4 text-center text-accentHi"
          href="/(auth)/login"
          accessibilityRole="link"
        >
          Sign in instead
        </Link>
      </View>
    );
  }
  if (routeAction === "sign_in") return <Redirect href="/(auth)/login" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarPosition: compact ? "bottom" : "left",
        tabBarLabelPosition: compact ? "below-icon" : "beside-icon",
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,

        },
        tabBarItemStyle: {
          minHeight: 56,
        },
        tabBarActiveTintColor: colors.accentHi,
        tabBarInactiveTintColor: colors.textSecondary,
      }}
    >
      {tabs.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: t.title,
            tabBarAccessibilityLabel: t.label,
            tabBarIcon: ({ color }) => (
              <Icon name={t.icon} color={color} />
            ),
          }}
        />
      ))}
      <Tabs.Screen name="settings" options={{ href: null }} />
    </Tabs>
  );
}
