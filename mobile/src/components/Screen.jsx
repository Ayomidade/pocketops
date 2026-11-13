import { ScrollView, View, KeyboardAvoidingView, Platform } from "react-native";
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
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}><ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, paddingBottom: 32, flexGrow: 1 }}
      >
        <View style={{ width: "100%", maxWidth: 720, alignSelf: "center", gap: 12 }}>{children}</View>
      </ScrollView></KeyboardAvoidingView>
    </SafeAreaView>
  );
}
