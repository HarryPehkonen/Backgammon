/**
 * Board -> screen mapping.
 *
 * The engine numbers points 0..23 along *White's* run: White starts on 0 and
 * bears off past 23. A real board is not a line but a ring of four quadrants,
 * so this module is the dictionary between the two.
 *
 * The screen layout is the standard one, with the human (White) sitting at the
 * bottom and bearing off to the right:
 *
 * ```
 *            left half            bar            right half         tray
 *   top    11 10  9  8  7  6      ||       5  4  3  2  1  0        Black off
 *   bottom 12 13 14 15 16 17      ||      18 19 20 21 22 23        White off
 * ```
 *
 * Read White's path off that picture: it enters at the top right (engine 0),
 * runs leftwards across the top, drops to the bottom left (engine 12), runs
 * rightwards across the bottom, and bears off past engine 23 into the tray on
 * the right — the familiar counter-clockwise loop. Black's run is the exact
 * reverse, which puts Black's home board (engine 0..5) in the top-right
 * quadrant, directly above White's.
 *
 * Nothing here knows about Lit or CSS syntax; it only produces grid
 * coordinates, so the component and the stylesheet can agree on one source of
 * truth.
 */

import { pointOwner } from "../../engine/board.ts";
import { NUM_POINTS, type Board, type Player } from "../../engine/types.ts";

/** Point columns on the board: six per quadrant, two quadrants per row. */
export const BOARD_COLS = 12;

/** Total CSS grid columns: 6 points, the bar, 6 points, then the trays. */
export const GRID_COLUMNS = 14;

/** The centre divider, between the two halves of the board. */
export const BAR_COLUMN = 7;

/** The bear-off trays, stacked at the outer edge. */
export const TRAY_COLUMN = 14;

/** Grid row holding engine points 0..11 — the far side of the table. */
export const TOP_ROW = 1;

/** Grid row holding engine points 12..23 — the human's side. */
export const BOTTOM_ROW = 2;

/** Which corner of the table a point sits in. */
export type Quadrant = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/** A point's cell in the CSS grid, and which way its triangle points. */
export interface PointPosition {
  /** 1-based CSS grid column. Never {@link BAR_COLUMN}. */
  x: number;
  /** {@link TOP_ROW} or {@link BOTTOM_ROW}. */
  y: number;
  /** Degrees to rotate the triangle: 0 points up, 180 points down. */
  rotation: number;
}

/** A slot's contents, ready to draw: how many checkers, and whose. */
export interface CheckerStack {
  count: number;
  owner: Player | null;
}

/**
 * Where a point is drawn.
 *
 * The arithmetic is two lines because the layout above is two mirrored runs:
 * across the bottom the column simply follows the engine index, while across
 * the top it runs backwards. The `+ 1` turns a 0-based column into a 1-based
 * CSS grid line, and the second `+ 1` on the right half steps over the bar.
 */
export function pointPosition(point: number): PointPosition {
  if (!Number.isInteger(point) || point < 0 || point >= NUM_POINTS) {
    throw new RangeError(`point ${point} is outside 0..23`);
  }

  const onTop = point < BOARD_COLS;
  // 0 at the far left of the row, 11 at the far right.
  const column = onTop ? BOARD_COLS - 1 - point : point - BOARD_COLS;

  return {
    x: column < BOARD_COLS / 2 ? column + 1 : column + 2,
    y: onTop ? TOP_ROW : BOTTOM_ROW,
    rotation: onTop ? 180 : 0,
  };
}

/** Which quadrant a point belongs to — used for alternating point colours. */
export function quadrantOf(point: number): Quadrant {
  const { x, y } = pointPosition(point);
  const onLeft = x < BAR_COLUMN;
  if (y === TOP_ROW) return onLeft ? "top-left" : "top-right";
  return onLeft ? "bottom-left" : "bottom-right";
}

/**
 * What is sitting on a slot.
 *
 * `slot` is a storage index, not a move endpoint: any of the 24 points, or one
 * of `WHITE_BAR` / `WHITE_OFF` / `BLACK_BAR` / `BLACK_OFF`. Ownership comes
 * from the sign the engine stores, so the same three lines cover points, bars
 * and trays alike.
 */
export function checkerStack(board: Board, slot: number): CheckerStack {
  return { count: Math.abs(board[slot]), owner: pointOwner(board, slot) };
}
