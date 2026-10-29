import { SafeAreaView, ScrollView, Text, View } from "react-native";
import ConnectivityBanner from "./ConnectivityBanner";

export default function Screen({ title, subtitle, children }) {
  return (
    <SafeAreaView className="flex-1 bg-bg">
      <ConnectivityBanner />
      <ScrollView
        contentContainerStyle={{
          padding: 22,
          paddingTop: 54,
          paddingBottom: 40,
        }}
      >
        <Text className="text-textPrimary text-3xl font-bold">{title}</Text>
        {subtitle ? (
          <Text className="text-textSecondary mt-2 mb-6">{subtitle}</Text>
        ) : (
          <View className="h-6" />
        )}
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}
