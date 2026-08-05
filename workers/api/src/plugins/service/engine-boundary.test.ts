import { describe, expect, it } from "vitest";

/**
 * Structural guard on the pure/impure boundary.
 *
 * availability.ts and assignment.ts are unit-testable only for as long as they
 * stay free of the database and the clock, and that property erodes one
 * innocent-looking query at a time. Asserting it here means the erosion fails
 * the build instead of being noticed months later when the suite has gone
 * slow and flaky.
 *
 * Source is read via import.meta.glob (resolved by Vite at build time) because
 * these tests run inside workerd, which has no node:fs.
 */

const sources = import.meta.glob<string>(
  ["./availability.ts", "./assignment.ts"],
  { query: "?raw", import: "default", eager: true }
);

const PURE_ENGINES = ["./availability.ts", "./assignment.ts"];

const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  { pattern: /\benv\.DB\b/, why: "queries the database directly" },
  { pattern: /\bD1PreparedStatement\b/, why: "references a D1 type" },
  { pattern: /from\s+"(\.\.\/)*\.?\.?\/?db\//, why: "imports a db module" },
  { pattern: /\bDate\.now\s*\(/, why: "reads an ambient clock" },
  { pattern: /new\s+Date\s*\(\s*\)/, why: "reads an ambient clock" },
  { pattern: /\bMath\.random\s*\(/, why: "is non-deterministic" },
  { pattern: /\bcrypto\.randomUUID\b/, why: "is non-deterministic" },
  { pattern: /from\s+"[^"]*\/env"/, why: "imports the Worker environment" },
];

describe("engine purity boundary", () => {
  it("finds the engine sources", () => {
    for (const path of PURE_ENGINES) {
      expect(sources[path], `${path} was not loaded`).toBeTypeOf("string");
    }
  });

  for (const path of PURE_ENGINES) {
    describe(path, () => {
      for (const { pattern, why } of FORBIDDEN) {
        it(`${why} — must not`, () => {
          const source = sources[path];
          // Strip comments so prose about the database is not a false positive.
          const code = source
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/^\s*\/\/.*$/gm, "");
          expect(pattern.test(code)).toBe(false);
        });
      }
    });
  }
});
