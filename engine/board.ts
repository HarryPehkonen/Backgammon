/**
 * Board construction, inspection and the pip arithmetic the rules are built on.
 *
 * The one concept worth internalising here is the **pip distance**: how far a
 * checker still has to travel to leave the board. White counts down toward
 * point 23, Black counts down toward point 0, but both count *down*, so every
 * rule below can be written once and applied to both players. A die of `n`
 * always subtracts `n` pips.
 */

import {
  BLACK,
  BLACK_BAR,
  BLACK_OFF,
  type Board,
  BOARD_SIZE,
  CHECKERS_PER_PLAYER,
  direction,
  HOME_SIZE,
  MAX_PIP,
  NUM_POINTS,
  type Player,
  WHITE,
  WHITE_BAR,
  WHITE_OFF,
} from "./types.ts";

/** A board with nothing on it. */
export function emptyBoard(): Board {
  return new Int8Array(BOARD_SIZE);
}

/** An independent copy of a board. */
export function cloneBoard(board: Board): Board {
  return board.slice();
}

/**
 * The standard opening position: 15 checkers a side, on the 24-, 13-, 8- and
 * 6-points of each player's run. Both sides start at 167 pips.
 */
export function initialBoard(): Board {
  return makeBoard({
    points: {
      0: 2, //  White's 24-point, deep in Black's home board
      11: 5, //  White's 13-point (the midpoint)
      16: 3, //  White's 8-point
      18: 5, //  White's 6-point
      23: -2, //  and the exact mirror for Black
      12: -5,
      7: -3,
      5: -5,
    },
  });
}

/** Description of a position, for tests and for setting up puzzles. */
export interface BoardSpec {
  /** Point index to signed checker count: positive White, negative Black. */
  points?: Record<number, number>;
  whiteBar?: number;
  blackBar?: number;
  whiteOff?: number;
  blackOff?: number;
}

/**
 * Builds a board from a sparse description. Counts are given with the sign
 * convention, and the bar/tray counts are given as plain magnitudes.
 */
export function makeBoard(spec: BoardSpec = {}): Board {
  const board = emptyBoard();
  for (const [point, count] of Object.entries(spec.points ?? {})) {
    const index = Number(point);
    if (!Number.isInteger(index) || index < 0 || index >= NUM_POINTS) {
      throw new Error(`point ${point} is outside 0..23`);
    }
    board[index] = count;
  }
  board[WHITE_BAR] = spec.whiteBar ?? 0;
  board[WHITE_OFF] = spec.whiteOff ?? 0;
  board[BLACK_BAR] = -(spec.blackBar ?? 0);
  board[BLACK_OFF] = -(spec.blackOff ?? 0);
  return board;
}

/** Storage slot holding this player's checkers on the bar. */
export function barIndex(player: Player): number {
  return player === WHITE ? WHITE_BAR : BLACK_BAR;
}

/** Storage slot holding this player's borne-off checkers. */
export function offIndex(player: Player): number {
  return player === WHITE ? WHITE_OFF : BLACK_OFF;
}

/** How many of this player's checkers are on the bar. */
export function barCount(board: Board, player: Player): number {
  return Math.abs(board[barIndex(player)]);
}

/** How many of this player's checkers have been borne off. */
export function offCount(board: Board, player: Player): number {
  return Math.abs(board[offIndex(player)]);
}

/** How many checkers this player owns on points and the bar (not borne off). */
export function checkersInPlay(board: Board, player: Player): number {
  let total = barCount(board, player);
  for (let point = 0; point < NUM_POINTS; point++) {
    if (owns(board, point, player)) total += Math.abs(board[point]);
  }
  return total;
}

/** Whether a point is occupied by this player. */
export function owns(board: Board, point: number, player: Player): boolean {
  return Math.sign(board[point]) === direction(player);
}

/** Which player holds a point, or `null` if it is empty. */
export function pointOwner(board: Board, point: number): Player | null {
  if (board[point] > 0) return WHITE;
  if (board[point] < 0) return BLACK;
  return null;
}

/** A lone checker: it can be hit. */
export function isBlot(board: Board, point: number): boolean {
  return Math.abs(board[point]) === 1;
}

/** Two or more checkers of one colour: the point is made. */
export function isMadePoint(board: Board, point: number): boolean {
  return Math.abs(board[point]) >= 2;
}

/**
 * Whether `player` is barred from landing on a point, which happens only when
 * the opponent has two or more checkers there. A single enemy checker is a
 * target, not a wall.
 */
export function isBlocked(board: Board, point: number, player: Player): boolean {
  const count = board[point];
  return Math.sign(count) === -direction(player) && Math.abs(count) >= 2;
}

/**
 * How far a checker on `point` still has to travel, counted in pips, where 1
 * means "one pip from bearing off". Every die subtracts from this number,
 * whichever colour is moving.
 */
export function pipOf(player: Player, point: number): number {
  return player === WHITE ? NUM_POINTS - point : point + 1;
}

/** Inverse of {@link pipOf}: the point that sits at a given pip distance. */
export function pointFromPip(player: Player, pip: number): number {
  return player === WHITE ? NUM_POINTS - pip : pip - 1;
}

/** The six points a player must fill before bearing off. */
export function homePoints(player: Player): number[] {
  const points: number[] = [];
  for (let pip = HOME_SIZE; pip >= 1; pip--) points.push(pointFromPip(player, pip));
  return points.sort((a, b) => a - b);
}

/** Whether a point lies in this player's own home board. */
export function isInHome(player: Player, point: number): boolean {
  return pipOf(player, point) <= HOME_SIZE;
}

/**
 * Total pips this player must still travel to bear every checker off. A checker
 * on the bar counts the full {@link MAX_PIP}; borne-off checkers count nothing.
 * The opening position is 167.
 */
export function pipCount(board: Board, player: Player): number {
  let total = barCount(board, player) * MAX_PIP;
  for (let point = 0; point < NUM_POINTS; point++) {
    if (owns(board, point, player)) total += Math.abs(board[point]) * pipOf(player, point);
  }
  return total;
}

/** The game is over for this player once all fifteen checkers are off. */
export function hasWon(board: Board, player: Player): boolean {
  return offCount(board, player) === CHECKERS_PER_PLAYER;
}

/**
 * The same position seen from the other side of the table: colours swapped and
 * the points reflected. Useful for testing that nothing favours a colour.
 */
export function mirrorBoard(board: Board): Board {
  const mirrored = emptyBoard();
  for (let point = 0; point < NUM_POINTS; point++) {
    mirrored[NUM_POINTS - 1 - point] = -board[point];
  }
  mirrored[WHITE_BAR] = -board[BLACK_BAR];
  mirrored[BLACK_BAR] = -board[WHITE_BAR];
  mirrored[WHITE_OFF] = -board[BLACK_OFF];
  mirrored[BLACK_OFF] = -board[WHITE_OFF];
  return mirrored;
}

/** A compact string identifying a position, for comparison and deduplication. */
export function boardKey(board: Board): string {
  let key = "";
  for (let slot = 0; slot < board.length; slot++) {
    key += String.fromCharCode(board[slot] + 128);
  }
  return key;
}

/** A one-line rendering of a position, for debugging and logs. */
export function describeBoard(board: Board): string {
  const parts: string[] = [];
  for (let point = 0; point < NUM_POINTS; point++) {
    if (board[point] !== 0) {
      parts.push(`${point}:${board[point] > 0 ? "W" : "B"}${Math.abs(board[point])}`);
    }
  }
  if (barCount(board, WHITE) > 0) parts.push(`bar:W${barCount(board, WHITE)}`);
  if (barCount(board, BLACK) > 0) parts.push(`bar:B${barCount(board, BLACK)}`);
  if (offCount(board, WHITE) > 0) parts.push(`off:W${offCount(board, WHITE)}`);
  if (offCount(board, BLACK) > 0) parts.push(`off:B${offCount(board, BLACK)}`);
  return parts.join(" ") || "empty";
}

export { BLACK, WHITE };
