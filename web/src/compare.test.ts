/**
 * Tests for the factor diff.
 *
 * The interesting cases are built from real engine evaluations rather than
 * from hand-written numbers: the whole point of the diff is that it lines two
 * genuine plays up against each other, and a fixture that drifted away from
 * what the evaluator actually emits would prove nothing. Hand-built
 * evaluations are kept for the shapes the engine never produces — a factor
 * missing from one side, a tie.
 */
import { describe, expect, it } from "vitest";
import { explainMove } from "../../engine/ai.ts";
import { applySequence } from "../../engine/moves.ts";
import { evaluate } from "../../engine/evaluator.ts";
import { initialBoard } from "../../engine/board.ts";
import { type Evaluation, type Factor, WHITE } from "../../engine/types.ts";
import { diffEvaluations, formatDelta } from "./compare.ts";

/** White's opening double 1: the best play makes a three-prime, the runner-up does not. */
const DOUBLE_ONE = { a: 1, b: 1 };

/** An evaluation with a score consistent with its factors, for the edge cases. */
function evaluationOf(factors: Factor[]): Evaluation {
  return { score: factors.reduce((total, factor) => total + factor.contribution, 0), factors };
}

describe("diffEvaluations", () => {
  const ranked = explainMove(initialBoard(), WHITE, DOUBLE_ONE, 2);
  const best = ranked[0].evaluation;
  const alternative = ranked[1].evaluation;

  it("reports only the factors the two plays disagree about", () => {
    const diffs = diffEvaluations(best, alternative);
    expect(diffs.map((diff) => diff.name)).toEqual(["prime", "blots"]);
  });

  it("measures each difference from the best play's point of view", () => {
    const [prime, blots] = diffEvaluations(best, alternative);
    // The chosen play builds a wall the alternative does not...
    expect(prime.delta).toBeCloseTo(9, 10);
    expect(prime.better).toBe(true);
    // ...at the cost of leaving a blot behind, which is a real point against it.
    expect(blots.delta).toBeCloseTo(-3, 10);
    expect(blots.better).toBe(false);
  });

  it("quotes the best play's own wording for each factor", () => {
    const [prime, blots] = diffEvaluations(best, alternative);
    expect(prime.detail).toBe("longest wall 3 points against 0");
    expect(blots.detail).toBe("blots 16 against none");
  });

  it("sorts by size of difference, largest first", () => {
    const deltas = diffEvaluations(best, alternative).map((diff) => Math.abs(diff.delta));
    expect(deltas).toEqual([...deltas].sort((a, b) => b - a));
  });

  it("recomputes the evaluations the same way the engine does", () => {
    // Guards the fixture above: the ranked evaluation of a play is exactly the
    // evaluation of the position that play reaches.
    const reached = evaluate(applySequence(initialBoard(), ranked[0].sequence), WHITE);
    expect(diffEvaluations(reached, alternative).map((diff) => diff.name))
      .toEqual(["prime", "blots"]);
  });

  it("says nothing when the two plays reach equally valued positions", () => {
    expect(diffEvaluations(best, best)).toEqual([]);
  });

  it("ignores differences too small to be worth a line", () => {
    const a = evaluationOf([{ name: "pip_count", contribution: 1.0, detail: "a" }]);
    const b = evaluationOf([{ name: "pip_count", contribution: 1.004, detail: "b" }]);
    expect(diffEvaluations(a, b)).toEqual([]);
  });

  it("keeps a difference that is only just visible", () => {
    const a = evaluationOf([{ name: "pip_count", contribution: 1.0, detail: "a" }]);
    const b = evaluationOf([{ name: "pip_count", contribution: 0.995, detail: "b" }]);
    expect(diffEvaluations(a, b)).toHaveLength(1);
  });

  it("marks a factor the alternative wins as worse for the chosen play", () => {
    const chosen = evaluationOf([{ name: "blots", contribution: -3, detail: "blots 16" }]);
    const other = evaluationOf([{ name: "blots", contribution: 0, detail: "blots none" }]);
    expect(diffEvaluations(chosen, other)).toEqual([
      { name: "blots", delta: -3, better: false, detail: "blots 16" },
    ]);
  });

  it("skips a factor the alternative does not have", () => {
    const chosen = evaluationOf([
      { name: "prime", contribution: 9, detail: "wall" },
      { name: "blots", contribution: -3, detail: "blots 16" },
    ]);
    const other = evaluationOf([{ name: "blots", contribution: 0, detail: "blots none" }]);
    expect(diffEvaluations(chosen, other).map((diff) => diff.name)).toEqual(["blots"]);
  });

  it("copes with a factor carrying no detail", () => {
    const chosen = evaluationOf([{ name: "prime", contribution: 9 }]);
    const other = evaluationOf([{ name: "prime", contribution: 0 }]);
    expect(diffEvaluations(chosen, other)[0].detail).toBe("");
  });
});

describe("formatDelta", () => {
  it("writes the sign out in full", () => {
    expect(formatDelta(9)).toBe("+9.00");
    expect(formatDelta(-3)).toBe("-3.00");
  });

  it("uses two decimals, like the evaluator", () => {
    expect(formatDelta(1.4)).toBe("+1.40");
    expect(formatDelta(-6.75)).toBe("-6.75");
  });

  it("treats zero as positive, so columns line up", () => {
    expect(formatDelta(0)).toBe("+0.00");
  });
});
