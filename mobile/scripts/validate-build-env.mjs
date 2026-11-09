import { readFileSync, writeFileSync } from "node:fs";
// EAS does not upload ignored .env files; require an explicit public API URL.
const value = process.env.EXPO_PUBLIC_API_URL;
let valid = false;
try {
  const url = new URL(value);
  valid =
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    url.pathname === "/api/v1" &&
    url.hostname !== "localhost" &&
    url.hostname !== "127.0.0.1" &&
    url.hostname !== "[::1]";
} catch {
  /* Report only the setting name, never environment values. */
}
if (!valid) {
  throw new Error(
    "Set EXPO_PUBLIC_API_URL in the EAS preview environment to a reachable HTTPS API URL ending in /api/v1.",
  );
}
console.info(
  "EAS public API URL format validated; reachability must be checked separately.",
);

// Checked-in Android projects do not automatically run config plugins in EAS.
if (process.env.GOOGLE_SERVICES_JSON) {
  try {
    const raw = readFileSync(process.env.GOOGLE_SERVICES_JSON, "utf8");
    const firebase = JSON.parse(raw);
    const app = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8")).expo;
    if (!firebase.client?.some(c => c.client_info?.android_client_info?.package_name === app.android.package)) throw new Error("Package mismatch");
    writeFileSync(new URL("../android/app/google-services.json", import.meta.url), raw, { mode: 0o600 });
    console.info("Firebase Android client configuration installed.");
  } catch { throw new Error("GOOGLE_SERVICES_JSON must point to a valid Firebase client file matching the Android package."); }
} else {
  console.info("GOOGLE_SERVICES_JSON absent: Android remote push requires Firebase setup before device verification.");
}
