import Screen from "../../src/components/Screen";
import InfoCard from "../../src/components/InfoCard";
import { Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import { useAuth } from "../../src/features/auth/AuthProvider";

export default function Page() {
  const { user, session, message, logout } = useAuth();
  return (
    <Screen
      title="Settings"
      subtitle="Manage your PocketOps identity and session."
    >
      <InfoCard
        title={user?.username || "Signed in"}
        description={
          user?.email
            ? `${user.email}\nSession expires ${new Date(session.expiresAt).toLocaleDateString()}.`
            : `GitHub email is not available or public.\nSession expires ${new Date(session.expiresAt).toLocaleDateString()}.`
        }
        badge="GitHub identity"
      />
      {message ? (
        <Text className="mb-3 text-amber-200" accessibilityRole="alert">
          {message}
        </Text>
      ) : null}
      <Pressable
        className="min-h-14 items-center justify-center rounded-xl border border-red-400 px-5"
        accessibilityRole="button"
        accessibilityLabel="Sign out and revoke this session"
        onPress={() => void logout().catch(() => {})}
      >
        <Text className="text-red-200 font-semibold">Sign out</Text>
      </Pressable>
      <View className="mt-6">
        <InfoCard
          title="Repository access"
          description="GitHub App access is separate from identity sign-in. Connect an installation and select repositories explicitly."
          badge="Manage connection"
        />
        <Link
          className="mt-3 min-h-12 text-center text-mint"
          href="/connections"
          accessibilityRole="link"
        >
          Manage GitHub connections
        </Link>
      </View>
    </Screen>
  );
}
