import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { test } from "node:test";
import { Linter } from "eslint";

// Jest's host renderer accepts props that Android's native setter rejects.
// Compare literal roles with the installed React Native Android contract.
test("native screen accessibility roles are supported by the installed Android renderer", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const native = readFileSync(
    new URL(
      "../../node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/uimanager/ReactAccessibilityDelegate.java",
      import.meta.url,
    ),
    "utf8",
  );
  const enumBody = /public enum AccessibilityRole\s*\{([^;]+);/.exec(
    native,
  )?.[1];
  assert.ok(enumBody, "React Native role contract must be available");
  const supported = new Set(
    enumBody.split(",").map((v) => v.trim().toLowerCase()),
  );
  const linter = new Linter();
  const config = {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      native: {
        rules: {
          roles: {
            create(context) {
              return {
                JSXAttribute(node) {
                  if (node.name.name !== "accessibilityRole") return;
                  const value =
                    node.value?.type === "Literal"
                      ? node.value.value
                      : node.value?.expression?.type === "Literal"
                        ? node.value.expression.value
                        : null;
                  if (typeof value === "string" && !supported.has(value))
                    context.report({
                      node,
                      message: `Android does not support accessibilityRole="${value}".`,
                    });
                },
              };
            },
          },
        },
      },
    },
    rules: { "native/roles": "error" },
  };
  const walk = (path) =>
    readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(join(path, entry.name))
        : /\.[jm]sx?$/.test(entry.name)
          ? [join(path, entry.name)]
          : [],
    );
  const failures = [];
  for (const path of [...walk(join(root, "app")), ...walk(join(root, "src"))]) {
    for (const result of linter.verify(readFileSync(path, "utf8"), config))
      failures.push(`${relative(root, path)}:${result.line} ${result.message}`);
  }
  assert.deepEqual(failures, []);
});
