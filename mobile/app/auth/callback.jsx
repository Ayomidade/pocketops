import { useEffect, useState } from "react";
import { Link, Redirect, useLocalSearchParams } from "expo-router";
import * as Linking from "expo-linking";
import RemoteState from "../../src/components/RemoteState";
import Screen from "../../src/components/Screen";
import { useAuth } from "../../src/features/auth/AuthProvider";

function singleValue(value) {
  return typeof value === "string" ? value : null;
}

export default function AuthCallbackPage() {
  const params = useLocalSearchParams();
  const { status, message, completeCallbackUrl } = useAuth();
  const [processing, setProcessing] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const callbackUrl = new URL(Linking.createURL("auth/callback"));
    const handoff = singleValue(params.handoff);
    const providerError = singleValue(params.error);
    if (handoff) callbackUrl.searchParams.set("handoff", handoff);
    if (providerError) callbackUrl.searchParams.set("error", providerError);
    void completeCallbackUrl(callbackUrl.toString())
      .catch(() => {
        setError(
          "This sign-in attempt is no longer active. Please start again.",
        );
      })
      .finally(() => setProcessing(false));
  }, [completeCallbackUrl, params.error, params.handoff]);

  if (status === "authenticated") return <Redirect href="/(tabs)" />;
  if (!processing && !error && status !== "failed") {
    return <Redirect href="/(auth)/login" />;
  }
  return (
    <Screen title="Completing sign-in">
      {error || status === "failed" ? (
        <RemoteState
          kind="error"
          title="Sign-in interrupted"
          message={error || message}
        />
      ) : (
        <RemoteState
          kind="loading"
          title="Verifying your PocketOps session..."
        />
      )}
      {error || status === "failed" ? (
        <Link
          className="mt-4 text-center text-accentHi"
          href="/(auth)/login"
          accessibilityRole="link"
        >
          Return to sign in
        </Link>
      ) : null}
    </Screen>
  );
}
