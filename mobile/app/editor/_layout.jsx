import { Stack } from "expo-router";

export default function EditorLayout() {
  return <Stack screenOptions={{ headerShown: false, statusBarHidden: true, navigationBarHidden: true, gestureEnabled: true }} />;
}
