import { Link } from "expo-router";
import { Text, View } from "react-native";
import Screen from "../../src/components/Screen";

export default function GitHubCallbackPage() {
  return (
    <Screen
      title="GitHub connection"
      subtitle="The browser callback contains no access token or repository data."
    >
      <View className="rounded-2xl bg-panel p-5">
        <Text className="text-white">
          Return to PocketOps to refresh your GitHub connection status.
        </Text>
        <Link
          className="mt-4 text-mint"
          href="/connections"
          accessibilityRole="link"
        >
          Continue to connections
        </Link>
      </View>
    </Screen>
  );
}
