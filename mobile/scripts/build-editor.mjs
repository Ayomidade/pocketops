import { readFile, writeFile } from "node:fs/promises";
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
await writeFile(
  destination,
  `export default ${JSON.stringify(result.outputFiles[0].text)};\n`,
);
console.info("Generated the local CodeMirror editor bundle");

const font = await readFile(new URL("../assets/fonts/JetBrainsMono-Regular.ttf", import.meta.url));
await writeFile(new URL("../src/features/editor/font-data.js", import.meta.url), `export default "${font.toString("base64")}";\n`);
