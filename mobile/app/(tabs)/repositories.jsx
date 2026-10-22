import Screen from "../../src/components/Screen";
import InfoCard from "../../src/components/InfoCard";
export default function Page() {
  return (
    <Screen
      title="Repositories"
      subtitle="Repositories explicitly selected in GitHub connections are available to PocketOps."
    >
      <InfoCard
        title="Read-only repository access"
        description="Connect GitHub and select repositories in Settings → GitHub connections. Repository tree browsing is planned for the next milestone; branch, commit and pull-request writes are not implemented."
        badge="Available"
      />
    </Screen>
  );
}
