import { colors } from "../../src/theme/tokens";
import { Link, Redirect, Tabs } from "expo-router";
import { Text, View } from "react-native";
import RemoteState from "../../src/components/RemoteState";
import { useAuth } from "../../src/features/auth/AuthProvider";
import { protectedRouteAction } from "../../src/features/auth/session";
const tabs = [
  { name: "index", title: "Home", icon: "⌂", label: "Home tab" },
  { name: "repositories", title: "Code", icon: "⌘", label: "Repositories tab" },
  { name: "incidents", title: "Incidents", icon: "!", label: "Incidents tab" },
  {
    name: "deployments",
    title: "Deploys",
    icon: "↑",
    label: "Deployments tab",
  },
  { name: "settings", title: "Settings", icon: "⚙", label: "Settings tab" },
];
export default function TabLayout() {
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
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 70,
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
              <Text accessible={false} style={{ color, fontSize: 20 }}>
                {t.icon}
              </Text>
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
