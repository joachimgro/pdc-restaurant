import genericService from "../../presets/generic-service.json";
import martialArts from "../../presets/martial-arts.json";
import musicSchool from "../../presets/music-school.json";
import tuitionCentre from "../../presets/tuition-centre.json";
import type { FieldLabels, QualificationField, QualificationTemplates } from "../db/ai-qualification-config";

export type AiPreset = {
  id: string;
  label: string;
  fieldLabels: FieldLabels;
  requiredFields: QualificationField[];
  qualificationTemplates: QualificationTemplates;
  programmeAliases: Record<string, string>;
  defaultTone?: string;
  defaultGoals?: string;
  defaultRules?: string;
};

const PRESETS: AiPreset[] = [
  genericService as AiPreset,
  martialArts as AiPreset,
  musicSchool as AiPreset,
  tuitionCentre as AiPreset,
];

export function listAiPresets(): { id: string; label: string }[] {
  return PRESETS.map((p) => ({ id: p.id, label: p.label }));
}

export function getAiPreset(id: string): AiPreset | undefined {
  return PRESETS.find((p) => p.id === id);
}
