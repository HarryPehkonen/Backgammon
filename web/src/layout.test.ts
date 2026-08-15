/**
 * Tests for the board -> screen mapping.
 *
 * The mapping is the one place where an off-by-one silently turns into a
 * board where checkers appear to run backwards, so every one of the 24 points
 * is pinned down here: which quadrant it lands in, which way its triangle
 * points, and — most importantly — that White's engine direction (0 -> 23)
 * traces the standard counter-clockwise path around the screen.
 */
import { describe, expect, it } from "vitest";
import { initialBoard, makeBoard } from "../../engine/board.ts";
import {
  BLACK,
  BLACK_BAR,
  BLACK_OFF,
  WHITE,
  WHITE_BAR,
  WHITE_OFF,
} from "../../engine/types.ts";
import {
  BAR_COLUMN,
  BOARD_COLS,
  BOTTOM_ROW,
  checkerStack,
  GRID_COLUMNS,
  pointPosition,
  quadrantOf,
  TOP_ROW,
  TRAY_COLUMN,
} from "./layout.ts";

/** Every engine point, once. */
const ALL_POINTS = Array.from({ length: 24 }, (_, point) => point);

describe("grid constants", () => {
  it("describes a 12-column board with a bar down the middle and a tray at the edge", () => {
    expect(BOARD_COLS).toBe(12);
    expect(BAR_COLUMN).toBe(7);
    expect(TRAY_COLUMN).toBe(GRID_COLUMNS);
    expect(GRID_COLUMNS).toBe(14);
    expect(TOP_ROW).toBeLessThan(BOTTOM_ROW);
  });
});

describe("pointPosition", () => {
  it("places every point in its standard quadrant", () => {
    for (const point of ALL_POINTS) {
      const { x, y } = pointPosition(point);
      const expected = point <= 5
        ? "top-right"
        : point <= 11
        ? "top-left"
        : point <= 17
        ? "bottom-left"
        : "bottom-right";
      expect(quadrantOf(point)).toBe(expected);

      // Rows: engine points 0..11 sit along the top, 12..23 along the bottom.
      expect(y).toBe(point <= 11 ? TOP_ROW : BOTTOM_ROW);

      // Halves: the bar column splits the grid, and nothing may sit on it.
      const onRight = expected.endsWith("right");
      expect(x).not.toBe(BAR_COLUMN);
      expect(onRight ? x > BAR_COLUMN : x < BAR_COLUMN).toBe(true);
      expect(x).toBeGreaterThanOrEqual(1);
      expect(x).toBeLessThan(TRAY_COLUMN);
    }
  });

  it("points the top triangles down and the bottom triangles up", () => {
    for (const point of ALL_POINTS) {
      expect(pointPosition(point).rotation).toBe(point <= 11 ? 180 : 0);
    }
  });

  it("gives each point its own cell", () => {
    const cells = new Set(
      ALL_POINTS.map((point) => {
        const { x, y } = pointPosition(point);
        return `${x},${y}`;
      }),
    );
    expect(cells.size).toBe(24);
  });

  it("puts White's home board in the bottom-right corner, ordered towards the tray", () => {
    // Engine 18 is White's 6-point (beside the bar); engine 23 is the
    // 1-point, hard against the tray it bears off into.
    expect(pointPosition(18).x).toBe(BAR_COLUMN + 1);
    expect(pointPosition(23).x).toBe(TRAY_COLUMN - 1);
  });

  it("puts Black's home board in the top-right corner, ordered towards the tray", () => {
    // Black runs 23 -> 0, so engine 5 is Black's 6-point and engine 0 its
    // 1-point: the mirror image of White's home, directly above it.
    expect(pointPosition(5).x).toBe(BAR_COLUMN + 1);
    expect(pointPosition(0).x).toBe(TRAY_COLUMN - 1);
  });

  it("runs the bottom half left to right, so White advances towards its tray", () => {
    for (let point = 12; point < 23; point++) {
      // Strictly increasing rather than exactly +1: the bar column sits
      // between engine 17 and 18, so the two halves are one column apart.
      expect(pointPosition(point + 1).x).toBeGreaterThan(pointPosition(point).x);
    }
    expect(pointPosition(12).x).toBe(1);
    expect(pointPosition(17).x).toBe(BAR_COLUMN - 1);
    expect(pointPosition(18).x).toBe(BAR_COLUMN + 1);
  });

  it("runs the top half right to left, so White's path is one continuous loop", () => {
    for (let point = 0; point < 11; point++) {
      expect(pointPosition(point + 1).x).toBeLessThan(pointPosition(point).x);
    }
    // White leaves the top half at engine 11 and enters the bottom half at
    // engine 12 — the same screen column, one row down.
    expect(pointPosition(11).x).toBe(pointPosition(12).x);
    expect(pointPosition(11).y).toBe(TOP_ROW);
    expect(pointPosition(12).y).toBe(BOTTOM_ROW);
  });

  it("rejects points outside 0..23", () => {
    expect(() => pointPosition(-1)).toThrow();
    expect(() => pointPosition(24)).toThrow();
  });
});

describe("checkerStack", () => {
  it("reads the opening position's points with the right owner", () => {
    const board = initialBoard();
    expect(checkerStack(board, 0)).toEqual({ count: 2, owner: WHITE });
    expect(checkerStack(board, 11)).toEqual({ count: 5, owner: WHITE });
    expect(checkerStack(board, 23)).toEqual({ count: 2, owner: BLACK });
    expect(checkerStack(board, 12)).toEqual({ count: 5, owner: BLACK });
  });

  it("reports an empty point as unowned", () => {
    expect(checkerStack(initialBoard(), 3)).toEqual({ count: 0, owner: null });
  });

  it("reads both bars", () => {
    const board = makeBoard({ points: { 10: 3 }, whiteBar: 2, blackBar: 1 });
    expect(checkerStack(board, WHITE_BAR)).toEqual({ count: 2, owner: WHITE });
    expect(checkerStack(board, BLACK_BAR)).toEqual({ count: 1, owner: BLACK });
  });

  it("reads both trays", () => {
    const board = makeBoard({ whiteOff: 5, blackOff: 15 });
    expect(checkerStack(board, WHITE_OFF)).toEqual({ count: 5, owner: WHITE });
    expect(checkerStack(board, BLACK_OFF)).toEqual({ count: 15, owner: BLACK });
  });

  it("reports empty bars and trays as unowned", () => {
    const board = initialBoard();
    expect(checkerStack(board, WHITE_BAR)).toEqual({ count: 0, owner: null });
    expect(checkerStack(board, BLACK_OFF)).toEqual({ count: 0, owner: null });
  });
});
