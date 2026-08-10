import { getApiUrl } from "@/lib/api/client";
import {
  IntakeFormSchema,
  IntakeResponseSchema,
  type IntakeFormInput,
} from "@lead-intake/shared-types";

export async function submitIntakeForm(data: IntakeFormInput) {
  const payload = IntakeFormSchema.parse(data);

  const res = await fetch(`${getApiUrl()}/leads/intake`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const json = await res.json();
  if (!res.ok) {
    const err = json as { error?: string; issues?: unknown };
    throw new Error(err.error ?? "Failed to submit");
  }

  return IntakeResponseSchema.parse(json);
}

export async function fetchLocations() {
  const res = await fetch(`${getApiUrl()}/locations`);
  if (!res.ok) throw new Error("Failed to load locations");
  const data = (await res.json()) as {
    locations: Array<{
      id: string;
      name: string;
      abbrev: string;
      badge_count: number | null;
    }>;
  };
  return data.locations;
}
