import { SafeAreaView, ScrollView, Text, View } from "react-native";
import ConnectivityBanner from "./ConnectivityBanner";

export default function Screen({ title, subtitle, children }) {
  return (
    <SafeAreaView className="flex-1 bg-ink">
      <ConnectivityBanner />
      <ScrollView
        contentContainerStyle={{
          padding: 22,
          paddingTop: 54,
          paddingBottom: 40,
        }}
      >
        <Text className="text-white text-3xl font-bold">{title}</Text>
        {subtitle ? (
          <Text className="text-slate-400 mt-2 mb-6">{subtitle}</Text>
        ) : (
          <View className="h-6" />
        )}
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}
