/**
 * Rough token estimate for MVP budgeting (HLD-SRD §6): chars / 4.
 * A tokenizer-accurate count lands in a later slice.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
