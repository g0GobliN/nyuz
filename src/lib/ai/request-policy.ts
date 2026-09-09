export type PipelineOperation = "cluster" | "analyse" | "enrich" | "translate" | "impact" | "probe";

// Estimates, not DeepSeek tokenization. Non-ASCII is counted by UTF-8 bytes
// because dividing CJK characters by an English ratio undercounts badly.
export function requestTokens(system: string, user: string): number {
  const text = `${system}\n${user}`;
  let ascii = 0;
  let otherBytes = 0;
  for (const byte of new TextEncoder().encode(text)) {
    if (byte < 128) ascii++;
    else otherBytes++;
  }
  return 32 + Math.ceil(ascii / 3) + otherBytes;
}

// A separate pessimistic reservation bound; never depend on compression or
// provider cache hits when authorizing spend. Includes message framing.
export function requestTokenCeiling(system: string, user: string): number {
  return 128 + new TextEncoder().encode(`${system}\n${user}`).length;
}

export const REQUEST_LIMITS: Record<PipelineOperation, { normal: number; hard: number }> = {
  probe: { normal: 256, hard: 256 },
  cluster: { normal: 2048, hard: 4096 },
  // Four 500-character CJK excerpts plus the full contract fit the normal
  // estimate. Up to twelve distinct sources require an explicit exception.
  analyse: { normal: 9000, hard: 24000 },
  enrich: { normal: 9000, hard: 24000 },
  translate: { normal: 8000, hard: 16000 },
  impact: { normal: 6500, hard: 12000 },
};

export class AiRequestBudgetError extends Error {}

export function budgetThresholds(secrets: Record<string, string | undefined>): {
  warning: number;
  degradation: number;
} {
  const warning = Number(secrets["AI_BUDGET_WARNING_FRACTION"] ?? 0.8);
  const degradation = Number(secrets["AI_BUDGET_DEGRADE_FRACTION"] ?? 1);
  if (
    !Number.isFinite(warning) ||
    !Number.isFinite(degradation) ||
    warning <= 0 ||
    warning > degradation ||
    degradation > 1
  ) {
    throw new Error("AI budget fractions must satisfy 0 < warning <= degradation <= 1");
  }
  return { warning, degradation };
}

export function checkRequestBudget(
  operation: PipelineOperation,
  system: string,
  user: string,
  exceptionReason?: string,
): number {
  const tokens = requestTokens(system, user);
  const limits = REQUEST_LIMITS[operation];
  if (tokens > limits.hard || (tokens > limits.normal && !exceptionReason)) {
    throw new AiRequestBudgetError(
      `${operation} request estimate ${tokens} exceeds ${exceptionReason ? limits.hard : limits.normal} tokens`,
    );
  }
  return tokens;
}

export function operationThinking(
  operation: PipelineOperation,
  secrets: Record<string, string | undefined>,
): "enabled" | "disabled" {
  const value = secrets[`AI_THINKING_${operation.toUpperCase()}`] ?? "enabled";
  if (value !== "enabled" && value !== "disabled")
    throw new Error(`Invalid thinking mode for ${operation}`);
  return value;
}
