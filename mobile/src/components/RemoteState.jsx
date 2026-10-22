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
        <ActivityIndicator color="#38D9B3" />
        <Text className="text-slate-300 mt-3">{title || "Loading..."}</Text>
      </View>
    );
  }

  return (
    <View
      className="items-center rounded-2xl bg-panel p-5"
      accessibilityRole="summary"
      accessibilityLiveRegion="polite"
    >
      <Text className="text-white text-lg font-semibold text-center">
        {title || (kind === "error" ? "Something went wrong" : "Nothing here yet")}
      </Text>
      {message ? (
        <Text className="text-slate-300 mt-2 text-center">{message}</Text>
      ) : null}
      {kind === "error" && onRetry ? (
        <Pressable
          className="mt-4 min-h-12 min-w-32 items-center justify-center rounded-xl bg-accent px-5"
          accessibilityRole="button"
          accessibilityLabel={retryLabel}
          onPress={onRetry}
        >
          <Text className="text-white font-semibold">{retryLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
