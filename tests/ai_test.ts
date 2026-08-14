import { boardKey, initialBoard, makeBoard, offCount } from "../engine/board.ts";
import { applySequence, legalMoves } from "../engine/moves.ts";
import { chooseMove, explainMove, rankMoves } from "../engine/ai.ts";
import { BLACK, OFF, type Roll, WHITE } from "../engine/types.ts";
import { assert, assertEquals } from "./assert.ts";

Deno.test("chooseMove returns one of the legal sequences", () => {
  const board = initialBoard();
  for (const roll of [{ a: 3, b: 1 }, { a: 6, b: 5 }, { a: 2, b: 2 }] as Roll[]) {
    const chosen = chooseMove(board, WHITE, roll);
    assert(chosen !== null);
    const legal = new Set(
      legalMoves(board, WHITE, roll).map((seq) => boardKey(applySequence(board, seq))),
    );
    assert(
      legal.has(boardKey(applySequence(board, chosen))),
      `roll (${roll.a},${roll.b}) produced an illegal play`,
    );
  }
});

Deno.test("chooseMove works for black as well as white", () => {
  const board = initialBoard();
  const chosen = chooseMove(board, BLACK, { a: 5, b: 3 });
  assert(chosen !== null);
  for (const move of chosen.moves) assertEquals(move.player, BLACK);
});

Deno.test("chooseMove is deterministic", () => {
  const board = initialBoard();
  const first = chooseMove(board, WHITE, { a: 4, b: 2 });
  const second = chooseMove(board, WHITE, { a: 4, b: 2 });
  assert(first !== null && second !== null);
  assertEquals(first, second);
});

Deno.test("chooseMove makes the point instead of leaving two blots", () => {
  // White has two stragglers on 0 and 1; the rest of the army is frozen on 20
  // (point 23 is blocked and white may not bear off with checkers outside home).
  // A 4 from point 0 and a 3 from point 1 both land on point 4.
  const board = makeBoard({ points: { 0: 1, 1: 1, 20: 13, 23: -2, 12: -13 } });
  const chosen = chooseMove(board, WHITE, { a: 4, b: 3 });

  assert(chosen !== null);
  const after = applySequence(board, chosen);
  assertEquals(after[4], 2, "both stragglers should land on point 4 and make the point");
  assertEquals(after[0], 0);
  assertEquals(after[1], 0);
});

Deno.test("chooseMove returns null when the turn is forfeited", () => {
  const board = makeBoard({
    points: { 0: -2, 1: -2, 2: -2, 3: -2, 4: -2, 5: -2, 20: 3 },
    whiteBar: 1,
  });
  assertEquals(chooseMove(board, WHITE, { a: 2, b: 6 }), null);
  assertEquals(explainMove(board, WHITE, { a: 2, b: 6 }), []);
});

Deno.test("explainMove returns the top three alternatives with full breakdowns", () => {
  const board = initialBoard();
  const roll: Roll = { a: 6, b: 5 };
  const alternatives = explainMove(board, WHITE, roll);

  assertEquals(alternatives.length, 3);
  for (const alternative of alternatives) {
    assert(alternative.sequence.moves.length > 0);
    assert(alternative.evaluation.factors.length > 0);
    assert(Number.isFinite(alternative.evaluation.score));
    for (const factor of alternative.evaluation.factors) {
      assert(factor.name.length > 0);
      assert(Number.isFinite(factor.contribution));
    }
  }
});

Deno.test("explainMove ranks alternatives best first, and the best is what chooseMove plays", () => {
  const board = initialBoard();
  const roll: Roll = { a: 6, b: 5 };
  const alternatives = explainMove(board, WHITE, roll);

  for (let i = 1; i < alternatives.length; i++) {
    assert(
      alternatives[i - 1].evaluation.score >= alternatives[i].evaluation.score,
      "alternatives must be sorted by score, descending",
    );
  }

  const chosen = chooseMove(board, WHITE, roll);
  assert(chosen !== null);
  assertEquals(
    boardKey(applySequence(board, chosen)),
    boardKey(applySequence(board, alternatives[0].sequence)),
  );
});

Deno.test("explainMove never invents alternatives that do not exist", () => {
  // Only one legal play: both runners advance five pips and then hit a wall.
  const board = makeBoard({ points: { 0: 1, 1: 1, 10: -2, 11: -2 } });
  const alternatives = explainMove(board, WHITE, { a: 5, b: 5 });
  assertEquals(alternatives.length, 1);
});

Deno.test("rankMoves scores every legal sequence exactly once", () => {
  const board = initialBoard();
  const roll: Roll = { a: 3, b: 2 };
  const ranked = rankMoves(board, WHITE, roll);
  assertEquals(ranked.length, legalMoves(board, WHITE, roll).length);
  const keys = new Set(ranked.map((entry) => boardKey(entry.board)));
  assertEquals(keys.size, ranked.length);
});

Deno.test("the AI takes checkers off rather than shuffling them around", () => {
  // Point 23 is one pip from home and point 22 is two, so a (1,2) roll can
  // bear off twice. Shuffling 22->23 first would waste the 1.
  const board = makeBoard({ points: { 23: 2, 22: 2, 0: -15 }, whiteOff: 11 });
  const chosen = chooseMove(board, WHITE, { a: 1, b: 2 });

  assert(chosen !== null);
  assertEquals(chosen.moves.filter((move) => move.to === OFF).length, 2);
  assertEquals(offCount(applySequence(board, chosen), WHITE), 13);
});
