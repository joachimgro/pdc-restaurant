import type { Message, TimelineEvent, TimelinePart } from "@lead-intake/shared-types";

/** Demo HTML timeline strings → structured parts */
export function parseTimelineHtml(html: string): TimelinePart[] {
  const match = html.match(/^<strong>([^<]+)<\/strong>(.*)$/);
  if (match) {
    return [{ bold: match[1], text: match[2] }];
  }
  return [{ text: html }];
}

type RawMessage =
  | { day: string }
  | { autoFollowup: true; label: string }
  | {
      from: "lead" | "ai" | "staff";
      text: string;
      time: string;
      reasoning?: { verdict: string; stage: string; note: string };
    };

export function toMessages(raw: RawMessage[]): Message[] {
  return raw.map((m) => {
    if ("day" in m) return { kind: "day" as const, day: m.day };
    if ("autoFollowup" in m)
      return { kind: "auto_followup" as const, label: m.label };
    return {
      kind: "chat" as const,
      from: m.from,
      text: m.text,
      time: m.time,
      reasoning: m.reasoning,
    };
  });
}

export function toTimeline(
  raw: { time: string; text: string }[]
): TimelineEvent[] {
  return raw.map((t) => ({
    time: t.time,
    parts: parseTimelineHtml(t.text),
  }));
}
