import { useDeploymentList, listItems } from "../../src/features/deployments/queries";
import { useIncidentPages } from "../../src/features/incidents/queries";
import { QueryState } from "../../src/features/deployments/components";
import { useRouter } from "expo-router";
import { Text, View } from "react-native";
import Screen from "../../src/components/Screen";
import { Action } from "../../src/features/repositories/components";
export default function Page() {
  const router = useRouter();
  const projects = useDeploymentList("projects");
  const incidents = useIncidentPages("list", "", { status: "open" });
  return <Screen title="Overview" subtitle="Your workspace, wherever you are.">
    <View className="gap-4">
      <Text className="text-lg font-semibold text-textPrimary">Open incidents</Text>
      {incidents.isPending || incidents.isError || !listItems(incidents).length ? <QueryState query={incidents} empty="No open incidents." /> : listItems(incidents).slice(0, 3).map(item => <Action key={item.id} label={`${item.severity} · ${item.title}`} onPress={() => router.push({ pathname: "/incident/[id]", params: { id: item.id } })} />)}
      <Text className="mt-4 text-lg font-semibold text-textPrimary">Connected projects</Text>
      {projects.isPending || projects.isError || !listItems(projects).length ? <QueryState query={projects} empty="Connect Render and map your first service in Projects." /> : listItems(projects).slice(0, 3).map(item => <Action key={item.id} label={`${item.name} · ${item.status}`} onPress={() => router.push({ pathname: "/project/[id]", params: { id: item.id } })} />)}
      <Text className="mt-4 text-lg font-semibold text-textPrimary">Workspace</Text>
      <Action label="Browse repositories" onPress={() => router.push("/(tabs)/repositories")} />
      <Action label="Projects and deployment logs" onPress={() => router.push("/(tabs)/deployments")} />
      <Action label="Investigate incidents" onPress={() => router.push("/(tabs)/incidents")} />
      <Text className="mt-5 text-lg font-semibold text-textPrimary">Connections</Text>
      <Action label="GitHub accounts" onPress={() => router.push("/connections")} />
      <Action label="Render accounts" onPress={() => router.push("/project/connections")} />
    </View>
  </Screen>;
}
