import Screen from "../../src/components/Screen";
import InfoCard from "../../src/components/InfoCard";
export default function Page() {
  return (
    <Screen
      title="Repositories"
      subtitle="Browse and edit your code from your phone."
    >
      <InfoCard
        title="GitHub integration"
        description="Repository access and branch editing will be implemented in Milestones 2\u20133."
        badge="Planned"
      />
    </Screen>
  );
}
