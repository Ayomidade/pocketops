import { ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { cssInterop } from "nativewind";
import ConnectivityBanner from "./ConnectivityBanner";
import AppHeader from "./AppHeader";
cssInterop(SafeAreaView, { className: "style" });
export default function Screen({ title, subtitle, children, onBack }) {
  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "left", "right"]}>
      <ConnectivityBanner />
      <AppHeader title={title} subtitle={subtitle} onBack={onBack} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}
