#!/usr/bin/env node
/**
 * Apply a vertical profile or demo pack to a client wrangler.toml.
 *
 * Usage:
 *   node scripts/apply-profile.mjs tuition-centre --wrangler workers/api/wrangler.toml
 *   node scripts/apply-profile.mjs demos/oldham-tuition --wrangler ../pdc-phiof/workers/api/wrangler.toml
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function parseArgs(argv) {
  const profileId = argv[2];
  let wranglerPath = "workers/api/wrangler.toml";
  for (let i = 3; i < argv.length; i++) {
    if (argv[i] === "--wrangler" && argv[i + 1]) {
      wranglerPath = argv[++i];
    }
  }
  if (!profileId) {
    console.error(
      "Usage: node scripts/apply-profile.mjs <profile-id> [--wrangler path/to/wrangler.toml]"
    );
    process.exit(1);
  }
  return { profileId, wranglerPath: resolve(ROOT, wranglerPath) };
}

function loadProfile(profileId) {
  const candidates = [
    join(ROOT, "profiles", `${profileId}.json`),
    join(ROOT, profileId, "profile.json"),
    join(ROOT, "demos", profileId, "profile.json"),
  ];
  if (profileId.startsWith("demos/")) {
    candidates.unshift(join(ROOT, profileId, "profile.json"));
  }
  const path = candidates.find((p) => existsSync(p));
  if (!path) {
    console.error(`Profile not found: ${profileId}`);
    console.error("Tried:", candidates.join("\n  "));
    process.exit(1);
  }
  const profile = JSON.parse(readFileSync(path, "utf8"));
  if (profile.extends) {
    const base = loadProfile(profile.extends);
    return {
      ...base,
      ...profile,
      capabilities: { ...base.capabilities, ...profile.capabilities },
      ai: { ...base.ai, ...profile.ai },
    };
  }
  return profile;
}

function patchWranglerVars(toml, vars) {
  let out = toml;
  for (const [key, value] of Object.entries(vars)) {
    const re = new RegExp(`^${key}\\s*=\\s*".*"`, "m");
    const line = `${key} = "${value}"`;
    if (re.test(out)) {
      out = out.replace(re, line);
    } else {
      const varsMatch = out.match(/\[vars\]\n/);
      if (varsMatch) {
        const idx = varsMatch.index + varsMatch[0].length;
        out = out.slice(0, idx) + `${line}\n` + out.slice(idx);
      } else {
        out += `\n[vars]\n${line}\n`;
      }
    }
  }
  return out;
}

const { profileId, wranglerPath } = parseArgs(process.argv);
const profile = loadProfile(profileId);

if (!existsSync(wranglerPath)) {
  console.error(`wrangler.toml not found: ${wranglerPath}`);
  process.exit(1);
}

const caps = profile.capabilities ?? {};
const vars = {
  ENABLE_SIMPLE_SCHEDULING: caps.simpleScheduling ? "true" : "false",
  ENABLE_MULTI_LOCATION: caps.multiLocation ? "true" : "false",
};
if (caps.demoTools === true) {
  vars.ENABLE_DEMO_TOOLS = "true";
}

const toml = readFileSync(wranglerPath, "utf8");
const patched = patchWranglerVars(toml, vars);
writeFileSync(wranglerPath, patched);

console.log(`Applied profile "${profile.id ?? profileId}" → ${wranglerPath}`);
console.log("Capabilities:", vars);

const presetId = profile.presetId ?? profile.id;
console.log("\nNext steps:");
console.log(`  1. Deploy the Worker: cd workers/api && pnpm run deploy`);
console.log(
  `  2. Apply AI preset: POST /admin/ai-config/apply-preset { "presetId": "${presetId}" }`
);
if (profile.ai) {
  console.log(
    `  3. Patch AI persona fields (academyName, tone, goals, rules) via Settings → AI or PATCH /admin/ai-config`
  );
  console.log("     ", JSON.stringify(profile.ai, null, 2).split("\n").join("\n      "));
}
if (profile.knowledgePack) {
  const pack = join(ROOT, profile.knowledgePack);
  console.log(
    `  4. Seed knowledge: node scripts/seed-demo-knowledge.mjs ${pack} $WORKER_URL`
  );
}
if (profile.seedProfile === "tuition") {
  console.log(
    "  5. Seed demo leads: POST /admin/seed (clears only on empty inbox; use setup script to reset)"
  );
}
