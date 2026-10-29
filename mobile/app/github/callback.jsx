import { Link } from "expo-router";
import { Text, View } from "react-native";
import Screen from "../../src/components/Screen";

export default function GitHubCallbackPage() {
  return (
    <Screen
      title="GitHub connection"
      subtitle="The browser callback contains no access token or repository data."
    >
      <View className="rounded-2xl bg-surface p-5">
        <Text className="text-textPrimary">
          Return to PocketOps to refresh your GitHub connection status.
        </Text>
        <Link
          className="mt-4 text-accentHi"
          href="/connections"
          accessibilityRole="link"
        >
          Continue to connections
        </Link>
      </View>
    </Screen>
  );
}


// //
// ts
// ```ts
// export const colors = {
//   // Surfaces (dark, slightly blue so it doesn't feel dead black)
//   bg:        "#0B0F14",
//   surface:   "#121821",
//   surfaceHi: "#1A2230",
//   border:    "#263042",

//   // Text
//   textPrimary:   "#E6EDF3",
//   textSecondary: "#9AA7B8",
//   textMuted:     "#6B7788",

//   // Brand accent (use sparingly: primary buttons, links, active tab)
//   accent:    "#3B82F6",
//   accentHi:  "#60A5FA",

//   // Status (these are the most important colors in the app)
//   critical:  "#EF4444", // outage, failed deploy, P1
//   warning:   "#F59E0B", // degraded, P2, pending approval
//   success:   "#22C55E", // healthy, resolved, deployed
//   info:      "#38BDF8", // in progress, investigating
//   neutral:   "#64748B", // acknowledged, muted, unknown
// };
// ```
// - Dark blue-gray base: Easier on the eyes at night than pure black or pure white, and it matches what GitHub, Vercel, PagerDuty and Datadog users are already used to.
// - One accent only: Blue reads as trustworthy and operational. If you add a second brand color, it competes with your status colors.
// - Red, amber, green, blue are reserved for status: Never use red for a decorative element or a delete button that isn’t dangerous. When red appears, it should always mean “something is wrong”. That consistency is what makes the app scannable in two seconds.
// - Text hierarchy through gray levels: Use textPrimary for titles and key values, textSecondary for labels, and textMuted for timestamps and metadata.
// 1. Never rely on color alone. About 8% of men are red/green colorblind. Pair every status color with an icon or label (a dot plus “Critical”, a check plus “Healthy”).
// 2. Keep contrast at WCAG AA or better: 4.5:1 for body text. #9AA7B8 on #0B0F14 passes. Check anything lighter-on-light or dimmer than textMuted.
// 3. Use tinted backgrounds for status cards: For example critical at 12% opacity as the background with a full-strength left border. It’s readable without being a wall of red.
// 4. Use red actions with care: Rollback or redeploy buttons should be visually distinct (outlined or tinted) from your primary accent button, with a confirmation step.
// 5. Offer a light theme later, driven by the same token names, so you only swap values rather than touching components.
