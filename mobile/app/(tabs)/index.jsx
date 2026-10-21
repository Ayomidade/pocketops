import Screen from "../../src/components/Screen";
import InfoCard from "../../src/components/InfoCard";
export default function Page() {
  return (
    <Screen
      title="Your operations, anywhere."
      subtitle="Native incident response and mobile development."
    >
      <InfoCard
        title="Starter ready"
        description="Connect GitHub and Render in the upcoming milestones."
        badge="Foundation"
      />
    </Screen>
  );
}
