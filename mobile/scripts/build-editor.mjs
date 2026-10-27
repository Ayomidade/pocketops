import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const entry = fileURLToPath(
  new URL("../src/features/editor/codemirror-entry.js", import.meta.url),
);
const destination = new URL(
  "../src/features/editor/codemirror.bundle.js",
  import.meta.url,
);
const result = await build({
  entryPoints: [entry],
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  target: "es2020",
  minify: true,
  legalComments: "inline",
});
await writeFile(destination, `export default ${JSON.stringify(result.outputFiles[0].text)};\n`);
console.info("Generated the local CodeMirror editor bundle");
