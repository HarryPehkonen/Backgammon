import {
  barCount,
  boardKey,
  cloneBoard,
  initialBoard,
  makeBoard,
  offCount,
} from "../engine/board.ts";
import { applyMove, applySequence, canBearOff, legalMoves, movesForDie } from "../engine/moves.ts";
import {
  BAR,
  BLACK,
  type Board,
  type Move,
  type MoveSequence,
  OFF,
  WHITE,
} from "../engine/types.ts";
import { assert, assertEquals, assertFalse } from "./assert.ts";

/** Board positions reachable by playing each sequence, as comparable keys. */
function resultingKeys(board: Board, sequences: MoveSequence[]): Set<string> {
  return new Set(sequences.map((seq) => boardKey(applySequence(board, seq))));
}

function move(from: number, to: number, die: number, player = WHITE): Move {
  return { from, to, die, player };
}

// --- Basic movement -------------------------------------------------------

Deno.test("opening roll (3,2) yields only complete two-die sequences", () => {
  const board = initialBoard();
  const sequences = legalMoves(board, WHITE, { a: 3, b: 2 });

  assert(sequences.length > 0);
  for (const seq of sequences) {
    assertEquals(seq.moves.length, 2, "both dice are playable, so both must be played");
    const dice = seq.moves.map((m) => m.die).sort();
    assertEquals(dice, [2, 3]);
    for (const m of seq.moves) assertEquals(m.player, WHITE);
  }
});

Deno.test("opening moves start from points white actually occupies", () => {
  const board = initialBoard();
  const sequences = legalMoves(board, WHITE, { a: 3, b: 2 });
  const whitePoints = [0, 11, 16, 18];
  for (const seq of sequences) {
    assert(
      whitePoints.includes(seq.moves[0].from),
      `first move came from unoccupied point ${seq.moves[0].from}`,
    );
  }
});

Deno.test("opening roll (3,2) includes the 24/13 split 0->3, 11->13", () => {
  const board = initialBoard();
  const sequences = legalMoves(board, WHITE, { a: 3, b: 2 });
  const expected = applySequence(board, { moves: [move(0, 3, 3), move(11, 13, 2)] });
  assert(resultingKeys(board, sequences).has(boardKey(expected)));
});

Deno.test("black moves down the board, mirroring white", () => {
  const board = initialBoard();
  const sequences = legalMoves(board, BLACK, { a: 3, b: 2 });
  const expected = applySequence(board, {
    moves: [move(23, 20, 3, BLACK), move(12, 10, 2, BLACK)],
  });
  assert(resultingKeys(board, sequences).has(boardKey(expected)));
});

// --- Blocking and hitting -------------------------------------------------

Deno.test("cannot land on a point held by two or more enemy checkers", () => {
  const board = makeBoard({ points: { 0: 1, 5: -2 } });
  assertEquals(movesForDie(board, WHITE, 5), [], "point 5 is walled off");
  assertEquals(movesForDie(board, WHITE, 3), [move(0, 3, 3)], "point 3 is open");
});

Deno.test("landing on a lone enemy checker sends it to the bar", () => {
  const board = makeBoard({ points: { 0: 1, 3: -1 } });
  const next = applyMove(board, move(0, 3, 3));
  assertEquals(next[3], 1, "white now owns the point outright");
  assertEquals(next[0], 0);
  assertEquals(barCount(next, BLACK), 1);
  assertEquals(barCount(next, WHITE), 0);
});

Deno.test("hitting works the same way in the other direction", () => {
  const board = makeBoard({ points: { 23: -1, 20: 1 } });
  const next = applyMove(board, move(23, 20, 3, BLACK));
  assertEquals(next[20], -1);
  assertEquals(barCount(next, WHITE), 1);
});

// --- The bar --------------------------------------------------------------

Deno.test("a checker on the bar must enter before anything else moves", () => {
  const board = makeBoard({ points: { 0: 2, 20: 1 }, whiteBar: 1 });
  const sequences = legalMoves(board, WHITE, { a: 3, b: 4 });

  assert(sequences.length > 0);
  for (const seq of sequences) {
    assertEquals(seq.moves[0].from, BAR, "the first move must come off the bar");
    for (const m of seq.moves.slice(1)) {
      assertEquals(m.from === BAR, false, "only one checker was on the bar");
    }
  }
});

Deno.test("white enters in black's home board, one point per die value", () => {
  const board = makeBoard({ whiteBar: 1 });
  for (let die = 1; die <= 6; die++) {
    assertEquals(movesForDie(board, WHITE, die), [move(BAR, die - 1, die)]);
  }
});

Deno.test("black enters in white's home board, one point per die value", () => {
  const board = makeBoard({ blackBar: 1 });
  for (let die = 1; die <= 6; die++) {
    assertEquals(movesForDie(board, BLACK, die), [move(BAR, 24 - die, die, BLACK)]);
  }
});

Deno.test("a shut-out home board leaves no legal entry at all", () => {
  const board = makeBoard({
    points: { 0: -2, 1: -2, 2: -2, 3: -2, 4: -2, 5: -2, 20: 1 },
    whiteBar: 1,
  });
  assertEquals(legalMoves(board, WHITE, { a: 3, b: 4 }), []);
  assertEquals(legalMoves(board, WHITE, { a: 6, b: 6 }), []);
});

Deno.test("only the die matching the one open entry point may be played", () => {
  const board = makeBoard({
    points: { 0: -2, 1: -2, 2: -2, 3: -2, 5: -2, 20: 5 },
    whiteBar: 1,
  });
  const sequences = legalMoves(board, WHITE, { a: 2, b: 5 });
  assert(sequences.length > 0);
  for (const seq of sequences) {
    assertEquals(seq.moves[0], move(BAR, 4, 5), "point 4 is the only gap, reached with a 5");
  }
});

// --- Bearing off ----------------------------------------------------------

Deno.test("bearing off requires every checker to be home", () => {
  assertFalse(canBearOff(makeBoard({ points: { 0: 1, 20: 1 } }), WHITE));
  assert(canBearOff(makeBoard({ points: { 18: 1, 20: 1 } }), WHITE));
  assertFalse(
    canBearOff(makeBoard({ points: { 20: 1 }, whiteBar: 1 }), WHITE),
    "a checker on the bar is not home",
  );
  assert(canBearOff(makeBoard({ points: { 0: -1, 5: -1 } }), BLACK));
  assertFalse(canBearOff(makeBoard({ points: { 0: -1, 6: -1 } }), BLACK));
});

Deno.test("no bear-off while a checker is still outside the home board", () => {
  const board = makeBoard({ points: { 0: 1, 20: 1 } });
  assertEquals(movesForDie(board, WHITE, 6), [move(0, 6, 6)], "point 20 cannot bear off yet");
});

Deno.test("exact roll bears a checker off from the matching pip", () => {
  const board = makeBoard({ points: { 20: 1, 23: 1 } });
  const sequences = legalMoves(board, WHITE, { a: 4, b: 1 });

  // Point 20 is four pips from home, point 23 is one pip from home.
  const bothOff = sequences.find((seq) => offCount(applySequence(board, seq), WHITE) === 2);
  assert(bothOff !== undefined, "both checkers can come off");
  const signatures = bothOff.moves.map((m) => `${m.from}->${m.to}/${m.die}`).sort();
  assertEquals(signatures, [`20->${OFF}/4`, `23->${OFF}/1`]);
});

Deno.test("a higher die bears off from the highest occupied point", () => {
  const board = makeBoard({ points: { 20: 1 } });
  assertEquals(movesForDie(board, WHITE, 6), [move(20, OFF, 6)], "nothing is further back");
});

Deno.test("a higher die may not skip past a checker further from home", () => {
  const board = makeBoard({ points: { 18: 1, 20: 1 } });
  // Point 18 is six pips out, point 20 is four. A 5 cannot lift the checker on 20.
  assertEquals(movesForDie(board, WHITE, 5), [move(18, 23, 5)]);
});

Deno.test("black bears off past point 0 by the same rules", () => {
  const board = makeBoard({ points: { 3: -1 } });
  assertEquals(movesForDie(board, BLACK, 4), [move(3, OFF, 4, BLACK)]);
  assertEquals(movesForDie(board, BLACK, 6), [move(3, OFF, 6, BLACK)]);
  const blocked = makeBoard({ points: { 3: -1, 5: -1 } });
  assertEquals(movesForDie(blocked, BLACK, 5), [move(5, 0, 5, BLACK)]);
});

// --- Doubles and the maximal-play rule ------------------------------------

Deno.test("doubles give four moves of the same die", () => {
  const board = initialBoard();
  const sequences = legalMoves(board, WHITE, { a: 4, b: 4 });
  assert(sequences.length > 0);
  for (const seq of sequences) {
    assertEquals(seq.moves.length, 4);
    for (const m of seq.moves) assertEquals(m.die, 4);
  }
});

Deno.test("doubles play as many dice as the position allows, and no fewer", () => {
  // Both runners can advance five pips once, then run into a wall.
  const board = makeBoard({ points: { 0: 1, 1: 1, 10: -2, 11: -2 } });
  const sequences = legalMoves(board, WHITE, { a: 5, b: 5 });

  assertEquals(sequences.length, 1, "the two orderings are the same play");
  assertEquals(sequences[0].moves.length, 2, "only two of the four dice are playable");
  for (const m of sequences[0].moves) assertEquals(m.die, 5);

  const after = applySequence(board, sequences[0]);
  assertEquals(after[5], 1);
  assertEquals(after[6], 1);
  assertEquals(after[0], 0);
  assertEquals(after[1], 0);
});

Deno.test("when only one die can be played, it must be the higher one", () => {
  // Either die moves the runner, but the follow-up is walled off both ways.
  const board = makeBoard({ points: { 0: 1, 9: -2 } });
  const sequences = legalMoves(board, WHITE, { a: 6, b: 3 });

  assertEquals(sequences.length, 1);
  assertEquals(sequences[0].moves.length, 1);
  assertEquals(sequences[0].moves[0], move(0, 6, 6));
});

Deno.test("no legal move returns an empty array, and the turn is forfeited", () => {
  const board = makeBoard({ points: { 0: 1, 3: -2, 5: -2 } });
  assertEquals(legalMoves(board, WHITE, { a: 3, b: 5 }), []);
});

Deno.test("sequences are deduplicated: one entry per resulting position", () => {
  for (const roll of [{ a: 3, b: 2 }, { a: 4, b: 4 }, { a: 6, b: 1 }]) {
    const board = initialBoard();
    const sequences = legalMoves(board, WHITE, roll);
    assertEquals(
      resultingKeys(board, sequences).size,
      sequences.length,
      `duplicate positions for roll (${roll.a},${roll.b})`,
    );
  }
});

// --- Applying moves -------------------------------------------------------

Deno.test("applyMove leaves the original board untouched", () => {
  const board = initialBoard();
  const before = cloneBoard(board);
  const next = applyMove(board, move(0, 3, 3));
  assertEquals(board, before, "applyMove must be pure");
  assert(next !== board);
  assertEquals(next[0], 1);
  assertEquals(next[3], 1);
});

Deno.test("applySequence plays moves in order, including a double hit", () => {
  const board = makeBoard({ points: { 0: 1, 1: 1, 3: -1, 5: -1 } });
  const sequence: MoveSequence = { moves: [move(0, 3, 3), move(1, 5, 4)] };
  const after = applySequence(board, sequence);

  assertEquals(after[0], 0);
  assertEquals(after[1], 0);
  assertEquals(after[3], 1);
  assertEquals(after[5], 1);
  assertEquals(barCount(after, BLACK), 2, "both blots were hit");
  assertEquals(board[3], -1, "the input board is unchanged");
});

Deno.test("applySequence of an empty sequence is a no-op copy", () => {
  const board = initialBoard();
  const after = applySequence(board, { moves: [] });
  assertEquals(after, board);
  assert(after !== board);
});

Deno.test("bearing off increments the tray and empties the point", () => {
  const board = makeBoard({ points: { 23: 1 }, whiteOff: 14 });
  const after = applyMove(board, move(23, OFF, 1));
  assertEquals(after[23], 0);
  assertEquals(offCount(after, WHITE), 15);
});
