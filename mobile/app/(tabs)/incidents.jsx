import Screen from "../../src/components/Screen";
import InfoCard from "../../src/components/InfoCard";
export default function Page() {
  return (
    <Screen
      title="Incidents"
      subtitle="Investigate production problems from anywhere."
    >
      <InfoCard
        title="Incident workspace"
        description="Incident timelines, severity and recovery verification arrive in a later milestone."
        badge="Planned"
      />
    </Screen>
  );
}
