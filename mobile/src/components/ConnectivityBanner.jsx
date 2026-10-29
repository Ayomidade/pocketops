import { Text, View } from "react-native";
import { useConnectivity } from "../hooks/useConnectivity";

export default function ConnectivityBanner() {
  const { isOffline } = useConnectivity();
  if (!isOffline) return null;

  return (
    <View
      className="bg-amber-700 px-4 py-3"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Text className="text-textPrimary text-center font-medium">
        Offline — check your connection before retrying.
      </Text>
    </View>
  );
}
