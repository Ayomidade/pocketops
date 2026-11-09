import { act, render } from "@testing-library/react-native";
import { AppState } from "react-native";
import { NotificationBridge } from "../src/features/incidents/NotificationBridge";
import {
  notificationIncident,
  registerNotifications,
} from "../src/features/incidents/notifications";
const mockPush = jest.fn(),
  mockInvalidate = jest.fn();
let mockStatus = "authenticated";
const mockNotifications = {
  getLastNotificationResponseAsync: jest.fn(),
  clearLastNotificationResponseAsync: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(),
  addNotificationReceivedListener: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  AndroidImportance: { DEFAULT: 3 },
};
jest.mock("expo-notifications", () => ({
  getLastNotificationResponseAsync: (...args) => mockNotifications.getLastNotificationResponseAsync(...args),
  clearLastNotificationResponseAsync: (...args) => mockNotifications.clearLastNotificationResponseAsync(...args),
  addNotificationResponseReceivedListener: (...args) => mockNotifications.addNotificationResponseReceivedListener(...args),
  addNotificationReceivedListener: (...args) => mockNotifications.addNotificationReceivedListener(...args),
  getPermissionsAsync: (...args) => mockNotifications.getPermissionsAsync(...args),
  requestPermissionsAsync: (...args) => mockNotifications.requestPermissionsAsync(...args),
  setNotificationChannelAsync: (...args) => mockNotifications.setNotificationChannelAsync(...args),
  getExpoPushTokenAsync: (...args) => mockNotifications.getExpoPushTokenAsync(...args),
  AndroidImportance: { DEFAULT: 3 },
}));
jest.mock("expo-constants", () => ({
  expoConfig: { extra: { eas: { projectId: "fixture-project" } } },
}));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
}));
jest.mock("../src/features/auth/AuthProvider", () => ({
  useAuth: () => ({ status: mockStatus }),
}));
const id = "00000000-0000-4000-8000-000000000001";
const response = {
  notification: { request: { content: { data: { incidentId: id } } } },
};
beforeEach(() => {
  jest.clearAllMocks();
  mockStatus = "authenticated";
  mockNotifications.getLastNotificationResponseAsync.mockResolvedValue(
    response,
  );
  mockNotifications.addNotificationResponseReceivedListener.mockReturnValue({
    remove: jest.fn(),
  });
  mockNotifications.addNotificationReceivedListener.mockReturnValue({
    remove: jest.fn(),
  });
});
it("validates notification IDs rather than trusting arbitrary URLs", () => {
  expect(notificationIncident(response)).toBe(id);
  expect(
    notificationIncident({
      notification: {
        request: { content: { data: { incidentId: "https://evil.invalid" } } },
      },
    }),
  ).toBeNull();
});
it("recovers a notification tap after process termination and refreshes on foreground", async () => {
  const spy = jest
    .spyOn(AppState, "addEventListener")
    .mockReturnValue({ remove: jest.fn() });
  render(<NotificationBridge />);
  await act(async () => {});
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/incident/[id]",
    params: { id },
  });
  await act(async () => spy.mock.calls[0][1]("active"));
  expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ["incidents"] });
  spy.mockRestore();
});
it("does not navigate to an incident while signed out", async () => {
  mockStatus = "signed_out";
  render(<NotificationBridge />);
  await act(async () => {});
  const listener =
    mockNotifications.addNotificationResponseReceivedListener.mock.calls[0][0];
  await act(async () => listener(response));
  expect(mockPush).not.toHaveBeenCalled();
});
it("permission denial does not request or register a token", async () => {
  mockNotifications.getPermissionsAsync.mockResolvedValue({ status: "denied" });
  mockNotifications.requestPermissionsAsync.mockResolvedValue({
    status: "denied",
  });
  const api = { register: jest.fn() };
  await expect(registerNotifications(api)).rejects.toThrow("permission denied");
  expect(api.register).not.toHaveBeenCalled();
  expect(mockNotifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
});
