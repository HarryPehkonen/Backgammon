/**
 * What separates one play from another.
 *
 * The evaluator explains a position by listing every factor it looked at, which
 * is exactly right when you are reading about a single play. Set two plays side
 * by side, though, and most of that text is identical — both plays came from the
 * same position, so the pip count, the checkers on the bar and usually half the
 * rest are the same in both. The learner then has to diff two eight-line blocks
 * by eye to find the two lines that actually decided the choice.
 *
 * So this module subtracts one evaluation from the other and keeps only what is
 * left. Everything here is plain data: no Lit, no DOM, and the engine is only
 * ever read from.
 */

import type { Evaluation, Factor } from "../../engine/types.ts";

/**
 * The smallest difference worth printing. Contributions are sums of weighted
 * counts, so anything under half a hundredth is floating-point noise rather
 * than a reason — and it would print as `+0.00` anyway.
 */
const NOTICEABLE = 0.005;

/** One factor on which two plays disagree, seen from the chosen play's side. */
export interface FactorDiff {
  /** The evaluator's name for the factor, e.g. `"made_points"`. */
  name: string;
  /** The chosen play's contribution minus the alternative's. */
  delta: number;
  /** True when the chosen play comes out ahead on this factor. */
  better: boolean;
  /** The chosen play's own wording for the factor, or `""` if it gave none. */
  detail: string;
}

/**
 * Everything the alternative did differently, biggest difference first.
 *
 * Factors the two plays agree about are dropped entirely — that agreement is
 * precisely the part the reader does not need. A negative `delta` is not an
 * error: it means the rejected play was the better one on that factor, which
 * is worth seeing, because it is the price the engine decided to pay.
 */
export function diffEvaluations(best: Evaluation, alternative: Evaluation): FactorDiff[] {
  const diffs: FactorDiff[] = [];

  for (const factor of best.factors) {
    const other = factorNamed(alternative, factor.name);
    if (!other) continue;

    const delta = factor.contribution - other.contribution;
    if (Math.abs(delta) < NOTICEABLE) continue;

    diffs.push({ name: factor.name, delta, better: delta > 0, detail: factor.detail ?? "" });
  }

  return diffs.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

/** A signed, two-decimal difference, written the way the evaluator writes scores. */
export function formatDelta(delta: number): string {
  return (delta >= 0 ? "+" : "") + delta.toFixed(2);
}

/** One factor by name, or `undefined` when this evaluation does not have it. */
function factorNamed(evaluation: Evaluation, name: string): Factor | undefined {
  return evaluation.factors.find((candidate) => candidate.name === name);
}
