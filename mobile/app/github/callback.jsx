import { Redirect, useLocalSearchParams } from "expo-router";

// Cold starts and Router-handled returns may bypass the original browser promise.
// The status is only a hint: Connections rechecks membership through the API.
export default function GitHubCallbackPage() {
  const params = useLocalSearchParams();
  const valid =
    Object.keys(params).every((key) => key === "status") &&
    typeof params.status === "string" &&
    ["connected", "cancelled", "failed"].includes(params.status);
  return (
    <Redirect
      href={{
        pathname: "/connections",
        params: { githubStatus: valid ? params.status : "failed" },
      }}
    />
  );
}
