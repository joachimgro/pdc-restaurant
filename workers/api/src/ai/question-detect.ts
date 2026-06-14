/** True when the inbound message looks like a question the LLM should answer. */
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  if (!t) return false;

  if (t.includes("?")) return true;

  if (
    /^(what|how|when|where|why|who|which|can|could|would|do|does|is|are|tell me|do you)\b/i.test(
      t
    )
  ) {
    return true;
  }

  if (/\b(difference|compare|vs\.?|versus|between|better|recommend|suggest)\b/i.test(t)) {
    return true;
  }

  // Short greetings / affirmations are not questions
  if (t.length < 25 && /^(hi|hey|hello|yes|yeah|yep|ok|okay|sure|thanks)\b/i.test(t)) {
    return false;
  }

  return false;
}
