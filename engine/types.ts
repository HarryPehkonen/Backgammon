/**
 * Core vocabulary of the backgammon engine.
 *
 * The whole engine is built on one idea: a position is a flat array of signed
 * checker counts. A positive entry means White owns that slot, a negative entry
 * means Black owns it, and the magnitude is how many checkers are sitting
 * there. Because the sign carries ownership, a slot never needs to record two
 * colours at once — which is exactly the rule of backgammon: a point belongs to
 * one player or to nobody.
 */

/** The two sides. White is stored positive, Black negative. */
export type Player = 1 | 2;

/** White moves from point 0 up to point 23 and bears off past 23. */
export const WHITE: Player = 1;

/** Black moves from point 23 down to point 0 and bears off past 0. */
export const BLACK: Player = 2;

/**
 * A position: 24 points plus each player's bar and bear-off tray.
 *
 * Layout:
 * - `0..23`    the points, signed by owner
 * - `24, 25`   White's bar and White's tray (stored positive)
 * - `26, 27`   Black's bar and Black's tray (stored negative)
 *
 * Each player gets private bar and tray slots because both players are
 * regularly on the bar at the same time, and both accumulate borne-off
 * checkers; a single shared signed slot could not represent that.
 */
export type Board = Int8Array;

/** Points on the board, not counting the bar and the trays. */
export const NUM_POINTS = 24;

/** Each player's home board is the last six points of their run. */
export const HOME_SIZE = 6;

/** Checkers per side. */
export const CHECKERS_PER_PLAYER = 15;

/** Slot indices within a {@link Board}. */
export const WHITE_BAR = 24;
export const WHITE_OFF = 25;
export const BLACK_BAR = 26;
export const BLACK_OFF = 27;

/** Length of a {@link Board}. */
export const BOARD_SIZE = 28;

/**
 * `from` value marking a move that comes off the bar.
 *
 * This is a symbolic endpoint in a {@link Move}, not a board index — use
 * `barIndex(player)` to reach the storage slot.
 */
export const BAR = 24;

/**
 * `to` value marking a move that bears a checker off.
 *
 * Symbolic, like {@link BAR}; use `offIndex(player)` for storage.
 */
export const OFF = 25;

/**
 * Pip distance of a checker on the bar. A checker re-enters the board at the
 * far end of its run, so it has the full 24-point journey plus one to get on.
 */
export const MAX_PIP = 25;

/** A throw of the two dice, as an ordered pair. */
export interface Roll {
  a: number;
  b: number;
}

/** A single checker movement consuming one die. */
export interface Move {
  /** Origin point `0..23`, or {@link BAR}. */
  from: number;
  /** Destination point `0..23`, or {@link OFF}. */
  to: number;
  /** The die value this move spends. */
  die: number;
  player: Player;
}

/** One complete turn: every move a player makes before passing the dice. */
export interface MoveSequence {
  moves: Move[];
}

/** Where a game stands in the roll-then-move cycle. */
export type Phase = "rolling" | "moving" | "finished";

/** A snapshot of a game, suitable for handing to a UI. */
export interface GameState {
  board: Board;
  player: Player;
  phase: Phase;
  roll: Roll | null;
  winner: Player | null;
  pipCounts: { white: number; black: number };
}

/** One named, signed reason contributing to an {@link Evaluation}. */
export interface Factor {
  /** Stable identifier, e.g. `"made_points"`. */
  name: string;
  /** Signed contribution to the score: positive helps the player being evaluated. */
  contribution: number;
  /** Human-readable explanation, for tutor mode. */
  detail?: string;
}

/** A position's worth to one player, together with the reasons why. */
export interface Evaluation {
  /** Positive is good for the player the evaluation was requested for. */
  score: number;
  factors: Factor[];
}

/** The other player. */
export function opponent(player: Player): Player {
  return player === WHITE ? BLACK : WHITE;
}

/**
 * The sign this player's checkers are stored with, which doubles as the
 * direction their count moves when checkers arrive or leave.
 */
export function direction(player: Player): 1 | -1 {
  return player === WHITE ? 1 : -1;
}

/** Type guard for values arriving from outside the engine. */
export function isPlayer(value: unknown): value is Player {
  return value === WHITE || value === BLACK;
}

/** Display name of a player. */
export function playerName(player: Player): string {
  return player === WHITE ? "White" : "Black";
}
