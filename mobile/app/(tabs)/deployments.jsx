import Screen from "../../src/components/Screen";
import InfoCard from "../../src/components/InfoCard";
export default function Page() {
  return (
    <Screen
      title="Deployments"
      subtitle="Inspect logs, deployments and recovery status."
    >
      <InfoCard
        title="Render integration"
        description="Provider connections, deployment logs and explicit redeploy actions are not enabled yet."
        badge="Planned"
      />
    </Screen>
  );
}
