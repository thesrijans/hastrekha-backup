import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored third-party WASM glue (see scripts/vendor-mediapipe.mjs) — generated, not ours.
    "public/**",
    // Prisma's generated client, which ships with its own @ts-nocheck.
    "lib/generated/**",
  ]),
]);

export default eslintConfig;
