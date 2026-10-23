import { readFile, writeFile } from "node:fs/promises";
import SwaggerParser from "@apidevtools/swagger-parser";
import { openapi } from "../src/contracts/openapi.js";

await SwaggerParser.validate(structuredClone(openapi));
const output = `${JSON.stringify(openapi, null, 2)}\n`;
const destination = new URL("../../docs/openapi.json", import.meta.url);
if (process.argv.includes("--check")) {
  if ((await readFile(destination, "utf8")) !== output) {
    throw new Error("OpenAPI artifact is stale; run npm run api:contract");
  }
  console.info("OpenAPI is valid and generated artifact is current");
} else {
  await writeFile(destination, output);
  console.info("Generated docs/openapi.json");
}
