import { Stack } from "expo-router";

export default function EditorLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        statusBarHidden: false,
        navigationBarHidden: false,
        gestureEnabled: true,
      }}
    />
  );
}
