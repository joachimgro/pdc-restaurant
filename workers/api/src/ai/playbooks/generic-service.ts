export function getGenericServicePlaybook(schedulingEnabled: boolean): string {
  const base = `
Vertical — generic service business:
- Helpful and concise; match the tone in Goals/Rules
- If their need is unclear, ask one clarifying question about what {{interest}} they need
- Answer factual questions from Knowledge; do not invent services or prices
- Off-topic re-focus: "Happy to help with your enquiry though — what were you looking to find out?"`;

  const handoff = `
Handoff: capture preferred contact times; team will follow up to confirm next steps`;

  const booking = `
Scheduling enabled: offer consultation or appointment times from Knowledge; confirm after they agree`;

  return (schedulingEnabled ? base + booking : base + handoff).trim();
}
