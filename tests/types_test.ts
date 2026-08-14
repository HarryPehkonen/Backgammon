import {
  BAR,
  BLACK,
  BLACK_BAR,
  BLACK_OFF,
  BOARD_SIZE,
  CHECKERS_PER_PLAYER,
  direction,
  type Evaluation,
  type Factor,
  HOME_SIZE,
  isPlayer,
  MAX_PIP,
  type Move,
  type MoveSequence,
  NUM_POINTS,
  OFF,
  opponent,
  type Phase,
  playerName,
  type Roll,
  WHITE,
  WHITE_BAR,
  WHITE_OFF,
} from "../engine/types.ts";
import { assert, assertEquals, assertFalse } from "./assert.ts";

Deno.test("players are the numeric tags 1 (white) and 2 (black)", () => {
  assertEquals(WHITE, 1);
  assertEquals(BLACK, 2);
});

Deno.test("opponent is an involution", () => {
  assertEquals(opponent(WHITE), BLACK);
  assertEquals(opponent(BLACK), WHITE);
  assertEquals(opponent(opponent(WHITE)), WHITE);
  assertEquals(opponent(opponent(BLACK)), BLACK);
});

Deno.test("direction encodes the sign convention: white positive, black negative", () => {
  assertEquals(direction(WHITE), 1);
  assertEquals(direction(BLACK), -1);
  assertEquals(direction(WHITE) + direction(BLACK), 0);
});

Deno.test("isPlayer accepts only 1 and 2", () => {
  assert(isPlayer(1));
  assert(isPlayer(2));
  assertFalse(isPlayer(0));
  assertFalse(isPlayer(3));
  assertFalse(isPlayer("1"));
  assertFalse(isPlayer(undefined));
});

Deno.test("playerName gives readable colours for the tutor output", () => {
  assertEquals(playerName(WHITE), "White");
  assertEquals(playerName(BLACK), "Black");
});

Deno.test("board geometry constants", () => {
  assertEquals(NUM_POINTS, 24);
  assertEquals(HOME_SIZE, 6);
  assertEquals(CHECKERS_PER_PLAYER, 15);
  // 24 points + a bar and a bear-off tray for each player.
  assertEquals(BOARD_SIZE, 28);
  assertEquals(MAX_PIP, 25);
});

Deno.test("bar and off are distinct move sentinels just past the last point", () => {
  assertEquals(BAR, 24);
  assertEquals(OFF, 25);
  assert(BAR >= NUM_POINTS);
  assert(OFF > BAR);
});

Deno.test("each player owns a private bar slot and a private off slot", () => {
  const slots = [WHITE_BAR, WHITE_OFF, BLACK_BAR, BLACK_OFF];
  assertEquals(new Set(slots).size, 4, "slots must not collide");
  for (const slot of slots) {
    assert(slot >= NUM_POINTS && slot < BOARD_SIZE, `slot ${slot} out of range`);
  }
});

Deno.test("value types are plain structural data", () => {
  const roll: Roll = { a: 3, b: 5 };
  assertEquals(roll.a, 3);
  assertEquals(roll.b, 5);

  const move: Move = { from: 0, to: 3, die: 3, player: WHITE };
  assertEquals(move.from, 0);
  assertEquals(move.to, 3);
  assertEquals(move.die, 3);
  assertEquals(move.player, WHITE);

  const sequence: MoveSequence = { moves: [move] };
  assertEquals(sequence.moves.length, 1);

  const factor: Factor = { name: "made_points", contribution: 2, detail: "made point on 5" };
  const evaluation: Evaluation = { score: 2, factors: [factor] };
  assertEquals(evaluation.factors[0].name, "made_points");

  const phases: Phase[] = ["rolling", "moving", "finished"];
  assertEquals(phases.length, 3);
});
