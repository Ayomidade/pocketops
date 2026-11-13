import { Text, Card, SectionHeader, ListRow, StatusPill, Button } from '../../src/components/ui';
import { useDeploymentList, listItems } from '../../src/features/deployments/queries';
import { useIncidentPages } from '../../src/features/incidents/queries';
import { QueryState } from '../../src/features/deployments/components';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import Screen from '../../src/components/Screen';
export default function Page() {
 const router = useRouter(); const projects = useDeploymentList('projects'); const incidents = useIncidentPages('list', '', { status: 'open' });
 const rank = { critical: 0, high: 1, medium: 2, low: 3 };
 const open = incidents.isError ? [] : listItems(incidents).sort((a,b) => rank[a.severity] - rank[b.severity]);
 const mapped = projects.isError ? [] : listItems(projects);
 return <Screen title="Overview" subtitle="Your operations workspace">
  <View className="flex-row flex-wrap gap-3"><Card title="Open incidents"><Text>{incidents.isPending || incidents.isError ? '—' : `${open.length}${incidents.hasNextPage ? '+' : ''}`} in loaded results</Text></Card><Card title="Projects"><Text>{projects.isPending || projects.isError ? '—' : `${mapped.length}${projects.hasNextPage ? '+' : ''}`} connected mappings</Text></Card></View>
  <SectionHeader title="Needs attention" subtitle="Open incidents, highest severity first" />
  {incidents.isPending || incidents.isError || !open.length ? <QueryState query={incidents} empty="No open incidents." /> : open.slice(0, 3).map(item => <ListRow key={item.id} icon="incident" title={item.title} badge={<StatusPill value={item.severity} />} meta={item.status} onPress={() => router.push({ pathname: '/incident/[id]', params: { id: item.id } })} />)}
  <Button label="View all incidents" variant="ghost" onPress={() => router.push('/(tabs)/incidents')} />
  <SectionHeader title="Projects" subtitle="Open a service for deployment history and health" />
  {projects.isPending || projects.isError || !mapped.length ? <QueryState query={projects} empty="Map a Render service in Projects to get started." /> : mapped.slice(0,3).map(item => <ListRow key={item.id} icon="deploy" title={item.name} badge={<StatusPill value={item.status} />} onPress={() => router.push({ pathname: '/project/[id]', params: { id: item.id } })} />)}
  <SectionHeader title="Quick actions" /><View className="flex-row flex-wrap gap-3"><Button label="Browse repositories" onPress={() => router.push('/(tabs)/repositories')} /><Button label="Projects and deployment logs" onPress={() => router.push('/(tabs)/deployments')} /></View>
 </Screen>;
}
