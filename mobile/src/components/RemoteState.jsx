import { colors } from "../theme/tokens";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

export default function RemoteState({
  kind,
  title,
  message,
  onRetry,
  retryLabel = "Try again",
}) {
  if (kind === "loading") {
    return (
      <View
        className="items-center justify-center py-8"
        accessibilityRole="progressbar"
        accessibilityLabel={title || "Loading"}
      >
        <ActivityIndicator color={colors.accentHi} />
        <Text className="text-textSecondary mt-3">{title || "Loading..."}</Text>
      </View>
    );
  }

  return (
    <View
      className="items-center rounded-2xl bg-surface p-5"
      accessibilityRole="summary"
      accessibilityLiveRegion="polite"
    >
      <Text className="text-textPrimary text-lg font-semibold text-center">
        {title ||
          (kind === "error" ? "Something went wrong" : "Nothing here yet")}
      </Text>
      {message ? (
        <Text className="text-textSecondary mt-2 text-center">{message}</Text>
      ) : null}
      {kind === "error" && onRetry ? (
        <Pressable
          className="mt-4 min-h-12 min-w-32 items-center justify-center rounded-xl bg-accent px-5"
          accessibilityRole="button"
          accessibilityLabel={retryLabel}
          onPress={onRetry}
        >
          <Text className="text-textOnAccent font-semibold">{retryLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
