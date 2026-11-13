import { fireEvent, render } from "@testing-library/react-native";
import AppHeader from "../src/components/AppHeader";
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
it("exposes labeled account and back navigation without using the screen title as a button", () => {
  const back = jest.fn();
  const screen = render(<AppHeader title="Repositories" onBack={back} />);
  fireEvent.press(screen.getByLabelText("Back"));
  expect(back).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByLabelText("Account and settings"));
  expect(mockPush).toHaveBeenCalledWith("/(tabs)/settings");
  expect(screen.getByRole("header").props.children).toBe("Repositories");
});
