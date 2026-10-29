// EAS does not upload ignored .env files; require an explicit public API URL.
const value = process.env.EXPO_PUBLIC_API_URL;
let valid = false;
try {
  const url = new URL(value);
  valid = url.protocol === "https:" && !url.username && !url.password &&
    !url.search && !url.hash && url.pathname === "/api/v1" &&
    url.hostname !== "localhost" && url.hostname !== "127.0.0.1" &&
    url.hostname !== "[::1]";
} catch { /* Report only the setting name, never environment values. */ }
if (!valid) {
  throw new Error("Set EXPO_PUBLIC_API_URL in the EAS preview environment to a reachable HTTPS API URL ending in /api/v1.");
}
console.info("EAS public API URL format validated; reachability must be checked separately.");
