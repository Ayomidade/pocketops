import { useEffect } from "react";
import { AppState } from "react-native";
import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthProvider";
import { notificationIncident } from "./notifications";
// A notification is only a navigation hint. The destination always fetches through auth.
export function NotificationBridge() {
  const { status } = useAuth();
  const client = useQueryClient();
  const router = useRouter();
  useEffect(() => {
    let active = true;
    const refresh = () => client.invalidateQueries({ queryKey: ["incidents"] });
    const open = (response) => {
      if (!active || status !== "authenticated") return;
      const id = notificationIncident(response);
      if (id) {
        void refresh();
        router.push({ pathname: "/incident/[id]", params: { id } });
        void Notifications.clearLastNotificationResponseAsync();
      }
    };
    if (status === "authenticated")
      void Notifications.getLastNotificationResponseAsync()
        .then(open)
        .catch(() => {});
    const response =
      Notifications.addNotificationResponseReceivedListener(open);
    const receive = Notifications.addNotificationReceivedListener(() => {
      void refresh();
    });
    const app = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => {
      active = false;
      response.remove();
      receive.remove();
      app?.remove();
    };
  }, [status, client, router]);
  return null;
}
