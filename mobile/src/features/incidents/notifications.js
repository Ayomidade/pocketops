import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";
export async function registerNotifications(api) {
  if (Platform.OS === "android")
    await Notifications.setNotificationChannelAsync("incidents", {
      name: "Incident updates",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  let permission = await Notifications.getPermissionsAsync();
  if (permission.status !== "granted")
    permission = await Notifications.requestPermissionsAsync();
  if (permission.status !== "granted")
    throw new Error(
      "Notification permission denied. Incidents remain available in the app.",
    );
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId)
    throw new Error("This build is not configured for push notifications.");
  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  await api.register({ token: token.data, platform: Platform.OS });
}
export function notificationIncident(response) {
  const id = response?.notification?.request?.content?.data?.incidentId;
  return typeof id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    )
    ? id
    : null;
}
