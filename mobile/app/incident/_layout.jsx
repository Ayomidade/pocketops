import { Stack } from "expo-router";
export default function IncidentLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        statusBarHidden: false,
        navigationBarHidden: false,
      }}
    />
  );
}
