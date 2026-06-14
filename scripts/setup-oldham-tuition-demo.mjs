#!/usr/bin/env node
/**
 * One-time D1 cleanup + AI config for phiof OTC demo.
 * Requires wrangler authenticated and pdc-phiof wrangler.toml configured.
 *
 * Usage (from repo root):
 *   node scripts/setup-oldham-tuition-demo.mjs
 *   node scripts/setup-oldham-tuition-demo.mjs --local
 */
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const WRANGLER = join(ROOT, "..", "pdc-phiof", "workers", "api", "wrangler.toml");
const PROFILE = JSON.parse(
  readFileSync(join(ROOT, "demos/oldham-tuition/profile.json"), "utf8")
);
const PRESET = JSON.parse(
  readFileSync(join(ROOT, "workers/api/presets/tuition-centre.json"), "utf8")
);

const local = process.argv.includes("--local");
const remoteFlag = local ? "" : "--remote";
const orgId = "phiof";

function sqlEscape(s) {
  return s.replace(/'/g, "''");
}

const KNOWLEDGE = JSON.parse(
  readFileSync(join(ROOT, "demos/oldham-tuition/knowledge-chunks.json"), "utf8")
);

function chunkInserts() {
  return KNOWLEDGE.map((chunk, i) => {
    const id = `portal-otc-${String(i + 1).padStart(2, "0")}`;
    return `INSERT INTO knowledge_chunks (id, organization_id, location_id, title, source, text)
VALUES ('${id}', '${orgId}', NULL, '${sqlEscape(chunk.title)}', 'portal', '${sqlEscape(chunk.text)}');`;
  }).join("\n");
}

const ai = PROFILE.ai;
const sql = `
-- Ensure default centre exists before re-pointing leads
INSERT OR IGNORE INTO locations (id, organization_id, name, abbrev, badge_count)
VALUES ('default', '${orgId}', 'Oldham Tuition Centre', 'OTC', NULL);

UPDATE leads SET location_id = 'default'
WHERE organization_id = '${orgId}' AND location_id != 'default';

DELETE FROM ai_location_overrides
WHERE location_id IN (
  SELECT id FROM locations WHERE organization_id = '${orgId}' AND id != 'default'
);

DELETE FROM location_programme_schedules
WHERE location_id IN (
  SELECT id FROM locations WHERE organization_id = '${orgId}' AND id != 'default'
);

DELETE FROM knowledge_chunks
WHERE organization_id = '${orgId}' AND source = 'schedule';

DELETE FROM locations WHERE organization_id = '${orgId}' AND id != 'default';

DELETE FROM knowledge_chunks
WHERE organization_id = '${orgId}' AND source = 'portal';

${chunkInserts()}

-- Replace AI config with OTC persona + tuition-centre preset fields
INSERT INTO ai_config (
  organization_id, academy_name, tone, goals, rules,
  model_reply, model_judge, safe_fallback_message, intake_context_label,
  qualification_enabled, required_fields, field_labels,
  programme_aliases, qualification_templates, preset_id
) VALUES (
  '${orgId}',
  '${sqlEscape(ai.academyName)}',
  '${sqlEscape(ai.tone)}',
  '${sqlEscape(ai.goals)}',
  '${sqlEscape(ai.rules)}',
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-3.1-8b-instruct',
  NULL,
  NULL,
  1,
  '${sqlEscape(JSON.stringify(PRESET.requiredFields))}',
  '${sqlEscape(JSON.stringify(PRESET.fieldLabels))}',
  '${sqlEscape(JSON.stringify(PRESET.programmeAliases))}',
  '${sqlEscape(JSON.stringify(PRESET.qualificationTemplates))}',
  'tuition-centre'
)
ON CONFLICT(organization_id) DO UPDATE SET
  academy_name = excluded.academy_name,
  tone = excluded.tone,
  goals = excluded.goals,
  rules = excluded.rules,
  qualification_enabled = excluded.qualification_enabled,
  required_fields = excluded.required_fields,
  field_labels = excluded.field_labels,
  programme_aliases = excluded.programme_aliases,
  qualification_templates = excluded.qualification_templates,
  preset_id = excluded.preset_id;

UPDATE leads SET location_confirmed = 1
WHERE organization_id = '${orgId}' AND location_confirmed = 0;
`;

const dir = mkdtempSync(join(tmpdir(), "otc-setup-"));
const sqlFile = join(dir, "setup.sql");
writeFileSync(sqlFile, sql);

try {
  console.log(`Running D1 setup (${local ? "local" : "remote"})...`);
  execSync(
    `wrangler d1 execute pdc-phiof-db ${remoteFlag} --file="${sqlFile}" --config="${WRANGLER}"`,
    { stdio: "inherit", cwd: join(ROOT, "..", "pdc-phiof", "workers", "api") }
  );
} finally {
  unlinkSync(sqlFile);
}

console.log("\nD1 cleanup + AI config + knowledge applied.");
console.log("Next:");
console.log("  1. node workers/api/scripts/ingest-knowledge.mjs $WORKER_URL");
console.log("  2. Clear leads if needed, then POST /admin/seed for tuition demo leads");
console.log("  3. SMS smoke test: ask about subjects, capture Saturday preference");
