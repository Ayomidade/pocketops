import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const app = JSON.parse(readFileSync(new URL("../app.json", import.meta.url))).expo;
const strings = readFileSync(new URL("../android/app/src/main/res/values/strings.xml", import.meta.url), "utf8");
const nativeRuntime = strings.match(/<string name="expo_runtime_version">([^<]+)<\/string>/)?.[1];
if (typeof app.runtimeVersion !== "string" || app.runtimeVersion !== nativeRuntime) {
  throw new Error("Keep app.json runtimeVersion and Android expo_runtime_version identical.");
}
if (!app.updates?.enabled || app.updates.url !== `https://u.expo.dev/${app.extra.eas.projectId}`) {
  throw new Error("EAS Update must be enabled with this app's project URL.");
}
let base = process.env.UPDATE_BASE_SHA;
if (!base || /^0+$/.test(base)) {
  try { base = execFileSync("git", ["rev-parse", "HEAD^"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { base = null; } // A repository's first commit has no previous runtime.
}
if (base) {
  if (!/^[a-f0-9]{40}$/.test(base)) throw new Error("Invalid comparison commit.");
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const previous = JSON.parse(git("show", `${base}:mobile/app.json`)).expo;
  const changed = git("diff", "--name-only", base, "HEAD", "--",
    "mobile/android", "mobile/ios", "mobile/app.json", "mobile/app.config.js",
    "mobile/package.json", "package.json", "package-lock.json");
  if (changed.trim() && previous.runtimeVersion === app.runtimeVersion) {
    throw new Error("Native/config/dependency inputs changed: bump runtimeVersion in app.json and Android strings.xml before publishing updates.");
  }
}
console.info("Update runtime configuration verified.");
