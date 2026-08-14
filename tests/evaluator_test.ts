import { initialBoard, makeBoard, mirrorBoard } from "../engine/board.ts";
import { evaluate, explainEvaluation, factorNamed } from "../engine/evaluator.ts";
import { BLACK, type Board, WHITE } from "../engine/types.ts";
import { assert, assertAlmostEquals, assertEquals } from "./assert.ts";

/** A handful of lopsided positions, for the structural invariants. */
const positions: Board[] = [
  initialBoard(),
  makeBoard({ points: { 0: 2, 5: -3, 12: 4, 18: -1, 23: 1 } }),
  makeBoard({ points: { 20: 5, 21: 5, 3: -5, 1: -2 }, whiteBar: 1, blackOff: 3 }),
  makeBoard({ points: { 7: 1, 8: 1, 9: -2 }, blackBar: 2, whiteOff: 5 }),
];

Deno.test("a mirror-symmetric position evaluates to exactly zero", () => {
  assertAlmostEquals(evaluate(initialBoard(), WHITE).score, 0);
  assertAlmostEquals(evaluate(initialBoard(), BLACK).score, 0);
  for (const factor of evaluate(initialBoard(), WHITE).factors) {
    assertAlmostEquals(factor.contribution, 0, 1e-9, `factor ${factor.name} should cancel out`);
  }
});

Deno.test("evaluation is antisymmetric: what helps one player hurts the other", () => {
  for (const board of positions) {
    const white = evaluate(board, WHITE).score;
    const black = evaluate(board, BLACK).score;
    assertAlmostEquals(white, -black, 1e-9);
  }
});

Deno.test("evaluation is colour-blind: mirroring the board swaps the verdict", () => {
  for (const board of positions) {
    assertAlmostEquals(
      evaluate(mirrorBoard(board), BLACK).score,
      evaluate(board, WHITE).score,
      1e-9,
    );
  }
});

Deno.test("the score is exactly the sum of its factors", () => {
  for (const board of positions) {
    for (const player of [WHITE, BLACK] as const) {
      const evaluation = evaluate(board, player);
      const total = evaluation.factors.reduce((sum, f) => sum + f.contribution, 0);
      assertAlmostEquals(evaluation.score, total, 1e-9);
    }
  }
});

Deno.test("every factor carries a name and a finite signed contribution", () => {
  for (const board of positions) {
    const evaluation = evaluate(board, WHITE);
    assert(evaluation.factors.length >= 6, "the tutor needs a breakdown, not a single number");
    for (const factor of evaluation.factors) {
      assert(typeof factor.name === "string" && factor.name.length > 0, "factor needs a name");
      assert(Number.isFinite(factor.contribution), `factor ${factor.name} is not finite`);
      assert(
        typeof factor.detail === "string" && factor.detail.length > 0,
        "factor needs a detail",
      );
    }
    const names = evaluation.factors.map((f) => f.name);
    assertEquals(new Set(names).size, names.length, "factor names must be unique");
    for (
      const expected of ["pip_count", "made_points", "blots", "bar", "home_board", "back_checkers"]
    ) {
      assert(names.includes(expected), `missing factor ${expected}`);
    }
  }
});

Deno.test("making a point beats leaving the same two checkers split", () => {
  const stacked = makeBoard({ points: { 20: 2, 3: -1, 4: -1 } });
  const split = makeBoard({ points: { 19: 1, 21: 1, 3: -1, 4: -1 } });

  // Both positions have identical pip counts, so only the structure differs.
  assert(evaluate(stacked, WHITE).score > evaluate(split, WHITE).score);
  assert(factorNamed(evaluate(stacked, WHITE), "made_points").contribution > 0);
  assertAlmostEquals(factorNamed(evaluate(split, WHITE), "made_points").contribution, 0);
});

Deno.test("a point in your own home board is worth more than one outside it", () => {
  const home = makeBoard({ points: { 20: 2, 3: -1 } });
  const outfield = makeBoard({ points: { 10: 2, 3: -1 } });
  assert(factorNamed(evaluate(home, WHITE), "home_board").contribution > 0);
  assertAlmostEquals(factorNamed(evaluate(outfield, WHITE), "home_board").contribution, 0);
});

Deno.test("blots count against you, and count more when the enemy can reach them", () => {
  const exposed = makeBoard({ points: { 19: 1, 20: 2, 23: -2 } });
  const safe = makeBoard({ points: { 19: 1, 20: 2, 1: -2 } });
  const clean = makeBoard({ points: { 20: 2, 1: -2 } });

  const exposedBlots = factorNamed(evaluate(exposed, WHITE), "blots").contribution;
  const safeBlots = factorNamed(evaluate(safe, WHITE), "blots").contribution;

  assert(exposedBlots < 0, "a blot is a liability");
  assert(safeBlots < 0);
  assert(exposedBlots < safeBlots, "a blot the enemy can hit is worse than one it cannot");
  assertAlmostEquals(factorNamed(evaluate(clean, WHITE), "blots").contribution, 0);
});

Deno.test("a checker on the bar is strongly negative", () => {
  const barred = makeBoard({ points: { 20: 2 }, whiteBar: 1 });
  const free = makeBoard({ points: { 20: 2, 0: 1 } });

  const barFactor = factorNamed(evaluate(barred, WHITE), "bar").contribution;
  assert(barFactor <= -10, `bar penalty ${barFactor} is not strong enough`);
  assertAlmostEquals(factorNamed(evaluate(free, WHITE), "bar").contribution, 0);
  assert(evaluate(barred, WHITE).score < evaluate(free, WHITE).score);

  // And it cuts both ways.
  assert(factorNamed(evaluate(barred, BLACK), "bar").contribution >= 10);
});

Deno.test("a pip lead is a positive score in a pure race", () => {
  const even = makeBoard({ points: { 20: 5, 21: 5, 22: 5, 3: -5, 2: -5, 1: -5 } });
  const ahead = makeBoard({ points: { 21: 5, 22: 5, 23: 5, 3: -5, 2: -5, 1: -5 } });

  assertAlmostEquals(evaluate(even, WHITE).score, 0);
  assert(evaluate(ahead, WHITE).score > 0);
  assert(factorNamed(evaluate(ahead, WHITE), "pip_count").contribution > 0);
  assert(factorNamed(evaluate(ahead, BLACK), "pip_count").contribution < 0);
});

Deno.test("checkers borne off are pure profit", () => {
  const none = makeBoard({ points: { 20: 3, 3: -3 } });
  const two = makeBoard({ points: { 20: 3, 3: -3 }, whiteOff: 2 });
  assert(evaluate(two, WHITE).score > evaluate(none, WHITE).score);
});

Deno.test("back checkers stuck in the enemy home board count against you", () => {
  const stuck = makeBoard({ points: { 0: 2, 20: 2, 12: -2 } });
  const advanced = makeBoard({ points: { 10: 2, 20: 2, 12: -2 } });
  assert(
    factorNamed(evaluate(stuck, WHITE), "back_checkers").contribution <
      factorNamed(evaluate(advanced, WHITE), "back_checkers").contribution,
  );
});

Deno.test("explainEvaluation renders the breakdown as readable lines", () => {
  const lines = explainEvaluation(evaluate(positions[1], WHITE));
  assert(lines.length > 0);
  for (const line of lines) {
    assert(typeof line === "string" && line.length > 0);
  }
  assert(lines.some((line) => line.includes("pip_count")));
});

Deno.test("factorNamed throws for an unknown factor rather than returning junk", () => {
  let threw = false;
  try {
    factorNamed(evaluate(initialBoard(), WHITE), "no_such_factor");
  } catch {
    threw = true;
  }
  assert(threw);
});
