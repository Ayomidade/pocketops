import Screen from "../../src/components/Screen";
import InfoCard from "../../src/components/InfoCard";
export default function Page() {
  return (
    <Screen
      title="Settings"
      subtitle="Manage connections and application security."
    >
      <InfoCard
        title="Account and connections"
        description="Secure authentication and provider connection management will be implemented next."
        badge="Planned"
      />
    </Screen>
  );
}
