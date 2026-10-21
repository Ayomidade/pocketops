import { Tabs } from "expo-router";
import { Text } from "react-native";
const tabs = [
  { name: "index", title: "Home", icon: "⌂" },
  { name: "repositories", title: "Code", icon: "⌘" },
  { name: "incidents", title: "Incidents", icon: "!" },
  { name: "deployments", title: "Deploys", icon: "↑" },
  { name: "settings", title: "Settings", icon: "⚙" },
];
export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: "#142033",
          borderTopColor: "#29384F",
          height: 65,
        },
        tabBarActiveTintColor: "#38D9B3",
        tabBarInactiveTintColor: "#94A3B8",
      }}
    >
      {tabs.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: t.title,
            tabBarIcon: ({ color }) => (
              <Text style={{ color, fontSize: 20 }}>{t.icon}</Text>
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
