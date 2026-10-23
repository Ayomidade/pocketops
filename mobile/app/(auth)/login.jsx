import { Pressable, Text, View } from "react-native";
import RemoteState from "../../src/components/RemoteState";
import Screen from "../../src/components/Screen";
import { useAuth } from "../../src/features/auth/AuthProvider";

export default function LoginPage() {
  const {
    status,
    message,
    beginGithubLogin,
    cancelGithubLogin,
    restoreSession,
  } = useAuth();

  if (status === "starting") {
    return (
      <Screen title="Sign in" subtitle="Preparing a secure GitHub sign-in.">
        <RemoteState kind="loading" title="Please wait..." />
      </Screen>
    );
  }

  if (status === "awaiting_callback" || status === "exchanging") {
    return (
      <Screen title="Sign in" subtitle="Continue in the system browser.">
        <RemoteState
          kind="loading"
          title={
            status === "exchanging"
              ? "Completing sign-in..."
              : "Waiting for GitHub..."
          }
          message="PocketOps will return here after GitHub confirms your identity."
        />
        {status === "awaiting_callback" ? (
          <Pressable
            className="mt-4 min-h-12 items-center justify-center rounded-xl border border-slate-600 px-5"
            accessibilityRole="button"
            accessibilityLabel="Cancel GitHub sign-in"
            onPress={() => void cancelGithubLogin()}
          >
            <Text className="text-white font-semibold">Cancel</Text>
          </Pressable>
        ) : null}
      </Screen>
    );
  }

  return (
    <Screen
      title="Welcome to PocketOps"
      subtitle="Sign in to manage your PocketOps identity. Repository access is configured separately."
    >
      {message ? (
        <View
          className="mb-4 rounded-xl bg-panel p-4"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          <Text className="text-amber-200">{message}</Text>
        </View>
      ) : null}
      {status === "failed" ? (
        <Pressable
          className="mb-3 min-h-12 items-center justify-center rounded-xl border border-slate-600 px-5"
          accessibilityRole="button"
          accessibilityLabel="Retry restoring your session"
          onPress={() => void restoreSession()}
        >
          <Text className="text-white font-semibold">Retry connection</Text>
        </Pressable>
      ) : null}
      <Pressable
        className="min-h-14 items-center justify-center rounded-xl bg-accent px-5"
        accessibilityRole="button"
        accessibilityLabel="Continue with GitHub"
        onPress={() => void beginGithubLogin()}
      >
        <Text className="text-white font-semibold text-base">
          Continue with GitHub
        </Text>
      </Pressable>
      <Text className="mt-4 text-slate-400 text-sm leading-5">
        PocketOps requests GitHub identity only. This sign-in does not grant
        repository access.
      </Text>
    </Screen>
  );
}
