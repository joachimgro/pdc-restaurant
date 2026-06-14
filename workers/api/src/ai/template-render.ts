const MAX_SMS_LEN = 320;

const ALLOWED_PARAMS = new Set([
  "business_name",
  "first_name",
  "location_names",
  "programme_names",
  "interest",
  "location_name",
  "interest_label",
  "location_label",
  "trial_label",
]);

export type TemplateParams = Record<string, string>;

export function renderTemplate(
  template: string,
  params: TemplateParams
): string {
  let out = template;
  for (const [key, value] of Object.entries(params)) {
    if (!ALLOWED_PARAMS.has(key)) continue;
    out = out.replaceAll(`{{${key}}}`, value);
  }
  // Strip any unresolved placeholders
  out = out.replace(/\{\{[a-z_]+\}\}/g, "").replace(/\s+/g, " ").trim();
  if (out.length > MAX_SMS_LEN) {
    return out.slice(0, MAX_SMS_LEN - 1) + "…";
  }
  return out;
}

export function formatNameList(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}
