import {
  barCount,
  barIndex,
  boardKey,
  checkersInPlay,
  cloneBoard,
  emptyBoard,
  hasWon,
  homePoints,
  initialBoard,
  isBlocked,
  isBlot,
  isInHome,
  isMadePoint,
  makeBoard,
  mirrorBoard,
  offCount,
  offIndex,
  pipCount,
  pipOf,
  pointFromPip,
  pointOwner,
} from "../engine/board.ts";
import {
  BLACK,
  BOARD_SIZE,
  CHECKERS_PER_PLAYER,
  MAX_PIP,
  NUM_POINTS,
  WHITE,
} from "../engine/types.ts";
import { assert, assertEquals, assertFalse, assertNotEquals } from "./assert.ts";

Deno.test("initial board holds 15 checkers for each player", () => {
  const board = initialBoard();
  assertEquals(board.length, BOARD_SIZE);
  assertEquals(checkersInPlay(board, WHITE) + offCount(board, WHITE), CHECKERS_PER_PLAYER);
  assertEquals(checkersInPlay(board, BLACK) + offCount(board, BLACK), CHECKERS_PER_PLAYER);
});

Deno.test("initial board uses the standard opening distribution", () => {
  const board = initialBoard();
  // White runs 0 -> 23: the 24-, 13-, 8- and 6-points.
  assertEquals(board[0], 2);
  assertEquals(board[11], 5);
  assertEquals(board[16], 3);
  assertEquals(board[18], 5);
  // Black runs 23 -> 0, an exact mirror.
  assertEquals(board[23], -2);
  assertEquals(board[12], -5);
  assertEquals(board[7], -3);
  assertEquals(board[5], -5);

  const occupied = [0, 5, 7, 11, 12, 16, 18, 23];
  for (let point = 0; point < NUM_POINTS; point++) {
    if (!occupied.includes(point)) assertEquals(board[point], 0, `point ${point} should be empty`);
  }
});

Deno.test("initial board starts with nothing on the bar and nothing borne off", () => {
  const board = initialBoard();
  assertEquals(barCount(board, WHITE), 0);
  assertEquals(barCount(board, BLACK), 0);
  assertEquals(offCount(board, WHITE), 0);
  assertEquals(offCount(board, BLACK), 0);
});

Deno.test("sign convention: white is positive, black is negative", () => {
  const board = initialBoard();
  assert(board[0] > 0, "white checkers are stored positive");
  assert(board[23] < 0, "black checkers are stored negative");
  assertEquals(pointOwner(board, 0), WHITE);
  assertEquals(pointOwner(board, 23), BLACK);
  assertEquals(pointOwner(board, 1), null);
});

Deno.test("pip count of the opening position is 167 for both players", () => {
  const board = initialBoard();
  assertEquals(pipCount(board, WHITE), 167);
  assertEquals(pipCount(board, BLACK), 167);
});

Deno.test("a checker on the bar costs the full 25 pips", () => {
  const board = makeBoard({ points: { 23: 1 } });
  assertEquals(pipCount(board, WHITE), 1);
  const barred = makeBoard({ whiteBar: 1 });
  assertEquals(pipCount(barred, WHITE), MAX_PIP);
});

Deno.test("borne-off checkers cost no pips", () => {
  const board = makeBoard({ points: { 23: 1 }, whiteOff: 14 });
  assertEquals(pipCount(board, WHITE), 1);
});

Deno.test("pipOf and pointFromPip are inverse for both players", () => {
  for (let point = 0; point < NUM_POINTS; point++) {
    for (const player of [WHITE, BLACK] as const) {
      const pip = pipOf(player, point);
      assert(pip >= 1 && pip <= 24, `pip ${pip} out of range`);
      assertEquals(pointFromPip(player, pip), point);
    }
  }
});

Deno.test("pip distance counts down toward each player's own home edge", () => {
  // White bears off past point 23, so point 23 is one pip from home.
  assertEquals(pipOf(WHITE, 23), 1);
  assertEquals(pipOf(WHITE, 0), 24);
  // Black bears off past point 0.
  assertEquals(pipOf(BLACK, 0), 1);
  assertEquals(pipOf(BLACK, 23), 24);
});

Deno.test("home boards are the last six points of each player's run", () => {
  assertEquals(homePoints(WHITE), [18, 19, 20, 21, 22, 23]);
  assertEquals(homePoints(BLACK), [0, 1, 2, 3, 4, 5]);
  assert(isInHome(WHITE, 18));
  assert(isInHome(WHITE, 23));
  assertFalse(isInHome(WHITE, 17));
  assert(isInHome(BLACK, 5));
  assertFalse(isInHome(BLACK, 6));
});

Deno.test("blots, made points and blocking follow the checker count", () => {
  const board = makeBoard({ points: { 3: 1, 4: 2, 7: -1, 8: -2 } });

  assert(isBlot(board, 3));
  assertFalse(isBlot(board, 4));
  assert(isBlot(board, 7));
  assertFalse(isBlot(board, 8));

  assert(isMadePoint(board, 4));
  assert(isMadePoint(board, 8));
  assertFalse(isMadePoint(board, 3));

  // A point is blocked for the player who does not own it, and only at 2+.
  assertFalse(isBlocked(board, 7, WHITE), "a lone enemy checker is a target, not a wall");
  assert(isBlocked(board, 8, WHITE));
  assertFalse(isBlocked(board, 4, WHITE), "your own stack never blocks you");
  assert(isBlocked(board, 4, BLACK));
  assertFalse(isBlocked(board, 0, WHITE), "empty points are open");
});

Deno.test("hasWon is true only once all 15 checkers are borne off", () => {
  const board = initialBoard();
  assertFalse(hasWon(board, WHITE));
  assertFalse(hasWon(board, BLACK));

  const almost = makeBoard({ points: { 23: 1 }, whiteOff: 14 });
  assertFalse(hasWon(almost, WHITE));

  const won = makeBoard({ whiteOff: 15 });
  assert(hasWon(won, WHITE));
  assertFalse(hasWon(won, BLACK));

  const blackWon = makeBoard({ blackOff: 15 });
  assert(hasWon(blackWon, BLACK));
});

Deno.test("bar and off slots are private to each player", () => {
  const board = makeBoard({ whiteBar: 2, blackBar: 3, whiteOff: 4, blackOff: 5 });
  assertEquals(barCount(board, WHITE), 2);
  assertEquals(barCount(board, BLACK), 3);
  assertEquals(offCount(board, WHITE), 4);
  assertEquals(offCount(board, BLACK), 5);
  assertNotEquals(barIndex(WHITE), barIndex(BLACK));
  assertNotEquals(offIndex(WHITE), offIndex(BLACK));
  // Sign convention holds in the special slots too.
  assert(board[barIndex(WHITE)] > 0);
  assert(board[barIndex(BLACK)] < 0);
});

Deno.test("cloneBoard copies without aliasing", () => {
  const board = initialBoard();
  const copy = cloneBoard(board);
  assertEquals(copy, board);
  copy[0] = 0;
  assertEquals(board[0], 2, "original must be untouched");
});

Deno.test("emptyBoard is all zeros", () => {
  const board = emptyBoard();
  assertEquals(board.length, BOARD_SIZE);
  assert(Array.from(board).every((v) => v === 0));
});

Deno.test("mirrorBoard swaps colours and reflects the geometry", () => {
  const board = makeBoard({ points: { 0: 2, 7: -3 }, whiteBar: 1, blackOff: 2 });
  const mirrored = mirrorBoard(board);
  assertEquals(mirrored[23], -2);
  assertEquals(mirrored[16], 3);
  assertEquals(barCount(mirrored, BLACK), 1);
  assertEquals(offCount(mirrored, WHITE), 2);
  assertEquals(mirrorBoard(mirrored), board, "mirroring twice is the identity");
});

Deno.test("the opening position is its own mirror", () => {
  assertEquals(mirrorBoard(initialBoard()), initialBoard());
});

Deno.test("boardKey distinguishes positions and matches equal ones", () => {
  assertEquals(boardKey(initialBoard()), boardKey(initialBoard()));
  const moved = initialBoard();
  moved[0] = 1;
  moved[3] = 1;
  assertNotEquals(boardKey(moved), boardKey(initialBoard()));
});
