import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import Icon from "./Icon";
export default function AppHeader({ title, subtitle, onBack }) {
  const router = useRouter();
  return (
    <View className="border-b border-border px-5 py-3">
      <View className="flex-row items-center gap-2">
        {onBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={onBack}
            className="min-h-12 min-w-12 items-center justify-center"
          >
            <Icon name="back" />
          </Pressable>
        ) : null}
        <Text
          accessibilityRole="header"
          className="flex-1 text-2xl font-semibold text-textPrimary"
        >
          {title}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Account and settings"
          onPress={() => router.push("/(tabs)/settings")}
          className="min-h-12 min-w-12 items-center justify-center rounded-full border border-border bg-surface"
        >
          <Icon name="profile" />
        </Pressable>
      </View>
      {subtitle ? (
        <Text className="mt-2 text-sm leading-5 text-textSecondary">
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}
