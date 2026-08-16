/**
 * Tests for the turn controller.
 *
 * The controller is where "what the rules allow" meets "what a mouse can do":
 * the engine speaks in whole maximal turns, while a player clicks one checker
 * at a time. These tests pin down that translation — especially the rule that
 * only the *first* move of a legal turn may be offered, which is what stops a
 * player from stumbling into a position the rules would never let them stop
 * at.
 */
import { describe, expect, it } from "vitest";
import { boardKey, initialBoard, makeBoard } from "../../engine/board.ts";
import { applySequence, legalMoves } from "../../engine/moves.ts";
import { createRoller, diceFromRoll } from "../../engine/dice.ts";
import { chooseMove } from "../../engine/ai.ts";
import {
  BAR,
  BLACK,
  BLACK_BAR,
  OFF,
  type Roll,
  WHITE,
  WHITE_BAR,
  WHITE_OFF,
} from "../../engine/types.ts";
import { legalTurns, TurnController } from "./controller.ts";

/** A roller that always throws the same numbers, so tests are deterministic. */
function fixedRoller(roll: Roll): () => Roll {
  return () => ({ ...roll });
}

/**
 * A controller sitting on a known position with a known roll already made.
 * Defaults to White, because White is the human seat.
 */
function positionWith(
  board: Int8Array,
  roll: Roll,
  player = WHITE,
): TurnController {
  const controller = new TurnController({ board, player, roller: fixedRoller(roll) });
  controller.roll();
  return controller;
}

describe("rolling", () => {
  it("starts with no dice to play", () => {
    const controller = new TurnController({ roller: fixedRoller({ a: 3, b: 1 }) });
    expect(controller.remainingDice()).toEqual([]);
    expect(controller.currentRoll()).toBeNull();
  });

  it("turns a roll into the dice still to be played", () => {
    const controller = new TurnController({ roller: fixedRoller({ a: 3, b: 1 }) });
    expect(controller.roll()).toEqual({ a: 3, b: 1 });
    expect(controller.currentRoll()).toEqual({ a: 3, b: 1 });
    expect(controller.remainingDice()).toEqual([3, 1]);
  });

  it("gives doubles four dice, not two", () => {
    const controller = new TurnController({ roller: fixedRoller({ a: 2, b: 2 }) });
    controller.roll();
    expect(controller.remainingDice()).toEqual([2, 2, 2, 2]);
  });

  it("hands out a copy of the remaining dice", () => {
    const controller = positionWith(initialBoard(), { a: 3, b: 1 });
    controller.remainingDice().push(99);
    expect(controller.remainingDice()).toEqual([3, 1]);
  });

  it("starts the human on White with both sides at 167 pips", () => {
    const controller = new TurnController();
    expect(controller.player()).toBe(WHITE);
    expect(controller.pipCounts()).toEqual({ white: 167, black: 167 });
  });
});

describe("legalDestinations", () => {
  const opening = () => positionWith(initialBoard(), { a: 3, b: 1 });

  it("offers both dice from a point that can play either", () => {
    // White's 6-point (engine 18): the 3 goes to 21, the 1 goes to 19.
    expect(opening().legalDestinations(18)).toEqual([19, 21]);
  });

  it("leaves out destinations the opponent has made", () => {
    // From the midpoint (engine 11) the 3 reaches 14, but the 1 would land on
    // engine 12, where Black has five checkers.
    expect(opening().legalDestinations(11)).toEqual([14]);
  });

  it("offers nothing from a point the player does not own", () => {
    expect(opening().legalDestinations(5)).toEqual([]); // Black's
    expect(opening().legalDestinations(3)).toEqual([]); // empty
  });

  it("lists exactly the points that can start a move", () => {
    expect(opening().legalSources()).toEqual([0, 11, 16, 18]);
  });
});

describe("checkers on the bar", () => {
  // One White checker on the bar, the rest parked on the midpoint. Black holds
  // only engine 5, so both entry points are open.
  const barred = () =>
    positionWith(makeBoard({ points: { 11: 14, 5: -2 }, whiteBar: 1 }), { a: 3, b: 1 });

  it("makes the bar the only legal source", () => {
    const controller = barred();
    expect(controller.legalSources()).toEqual([BAR]);
    expect(controller.legalDestinations(11)).toEqual([]);
  });

  it("enters at the pip matching each die", () => {
    // A die of n enters at pip 25 - n, which for White is point n - 1.
    expect(barred().legalDestinations(BAR)).toEqual([0, 2]);
  });

  it("frees the other checkers once the bar is clear", () => {
    const controller = barred();
    controller.applyMove(BAR, 2);
    expect(controller.board()[WHITE_BAR]).toBe(0);
    expect(controller.board()[2]).toBe(1);
    expect(controller.remainingDice()).toEqual([1]);
    expect(controller.legalDestinations(11)).toEqual([12]);
  });
});

describe("applyMove", () => {
  it("spends exactly the die the move needs", () => {
    const controller = positionWith(initialBoard(), { a: 3, b: 1 });
    controller.applyMove(18, 21);
    expect(controller.remainingDice()).toEqual([1]);
    expect(controller.board()[18]).toBe(4);
    expect(controller.board()[21]).toBe(1);
    expect(controller.turnMoves()).toHaveLength(1);
    expect(controller.turnMoves()[0].die).toBe(3);
  });

  it("sends a hit checker to the opponent's bar", () => {
    // Black blot on engine 21; White's 6-point checker runs it down with a 3.
    const controller = positionWith(
      makeBoard({ points: { 18: 5, 21: -1, 0: -2 } }),
      { a: 3, b: 1 },
    );
    controller.applyMove(18, 21);
    expect(controller.board()[21]).toBe(1);
    expect(controller.board()[BLACK_BAR]).toBe(-1);
  });

  it("plays all four dice of a double", () => {
    const controller = positionWith(initialBoard(), { a: 2, b: 2 });
    controller.applyMove(11, 13);
    expect(controller.remainingDice()).toEqual([2, 2, 2]);
    controller.applyMove(11, 13);
    expect(controller.remainingDice()).toEqual([2, 2]);
    controller.applyMove(16, 18);
    expect(controller.remainingDice()).toEqual([2]);
    controller.applyMove(16, 18);
    expect(controller.remainingDice()).toEqual([]);
    expect(controller.isTurnOver()).toBe(true);
    expect(controller.turnMoves()).toHaveLength(4);
    expect(controller.board()[13]).toBe(2);
    expect(controller.board()[18]).toBe(7);
  });

  it("refuses a move the rules do not allow", () => {
    const controller = positionWith(initialBoard(), { a: 3, b: 1 });
    expect(() => controller.applyMove(11, 12)).toThrow();
  });
});

describe("the first-move-only rule", () => {
  /*
   * White has a checker on engine 10 and another on 14, with Black holding
   * engine 16 and 20. Rolling 6-5, the 6 cannot be played at all from where
   * the checkers stand — but 10/15 first *unblocks* it (15/21), making a
   * two-move turn possible. Backgammon forces the longer turn, so 14/19 and
   * 18/23 (each legal on its own, each a dead end) must not be offered.
   */
  const forced = () =>
    positionWith(
      makeBoard({ points: { 10: 1, 14: 1, 18: 13, 16: -2, 20: -2, 5: -11 } }),
      { a: 5, b: 6 },
    );

  it("offers only the move that keeps the maximal turn alive", () => {
    const controller = forced();
    expect(controller.legalDestinations(10)).toEqual([15]);
    expect(controller.legalDestinations(14)).toEqual([]);
    expect(controller.legalDestinations(18)).toEqual([]);
    expect(controller.legalSources()).toEqual([10]);
  });

  it("does not offer a destination that needs both dice combined", () => {
    expect(forced().legalDestinations(10)).not.toContain(21);
  });

  it("offers the follow-up move only once the first one is played", () => {
    const controller = forced();
    expect(controller.legalDestinations(15)).toEqual([]);
    controller.applyMove(10, 15);
    expect(controller.remainingDice()).toEqual([6]);
    expect(controller.legalDestinations(15)).toEqual([21]);
  });
});

describe("a turn with nothing to play", () => {
  it("reports no legal moves when the entry points are all blocked", () => {
    const controller = positionWith(
      makeBoard({
        points: { 0: -2, 1: -2, 2: -2, 3: -2, 4: -2, 5: -2, 11: 14 },
        whiteBar: 1,
      }),
      { a: 6, b: 5 },
    );
    expect(controller.hasLegalMoves()).toBe(false);
    expect(controller.isTurnOver()).toBe(true);
    expect(controller.legalSources()).toEqual([]);
    expect(controller.legalDestinations(BAR)).toEqual([]);
  });
});

describe("bearing off and winning", () => {
  // White's last two checkers, on engine 22 and 23; thirteen already off.
  const endgame = () =>
    positionWith(
      makeBoard({ points: { 23: 1, 22: 1, 0: -2 }, whiteOff: 13, blackOff: 13 }),
      { a: 1, b: 2 },
    );

  it("offers the tray as a destination", () => {
    const controller = endgame();
    expect(controller.legalDestinations(23)).toEqual([OFF]);
    expect(controller.legalDestinations(22)).toEqual([23, OFF]);
  });

  it("declares a winner once the fifteenth checker comes off", () => {
    const controller = endgame();
    expect(controller.winner()).toBeNull();

    controller.applyMove(23, OFF); // the exact 1
    expect(controller.remainingDice()).toEqual([2]);
    expect(controller.winner()).toBeNull();

    controller.applyMove(22, OFF); // the exact 2
    expect(controller.board()[WHITE_OFF]).toBe(15);
    expect(controller.winner()).toBe(WHITE);
  });

  it("recognises a Black win too", () => {
    const controller = new TurnController({ board: makeBoard({ blackOff: 15 }) });
    expect(controller.winner()).toBe(BLACK);
  });
});

describe("legalTurns agrees with the engine", () => {
  /*
   * The controller enumerates turns itself, because it has to answer questions
   * the engine's `legalMoves` cannot: what is playable with three dice left of
   * a double, and which *equivalent orderings* of a turn a player may click
   * through (the engine collapses those, since they reach the same position).
   *
   * That freedom is only safe if the two agree on the thing that actually
   * matters — the set of positions a turn is allowed to end on. This checks
   * exactly that, over every distinct roll on a handful of positions.
   */
  const positions = [
    initialBoard(),
    makeBoard({ points: { 10: 1, 14: 1, 18: 13, 16: -2, 20: -2, 5: -11 } }),
    makeBoard({ points: { 11: 14, 5: -2, 3: -3 }, whiteBar: 1, blackBar: 2 }),
    makeBoard({ points: { 23: 2, 22: 3, 20: 4, 0: -3, 2: -2 }, whiteOff: 6, blackOff: 10 }),
  ];

  const rolls: Roll[] = [];
  for (let a = 1; a <= 6; a++) for (let b = a; b <= 6; b++) rolls.push({ a, b });

  it("reaches exactly the positions the engine calls legal", () => {
    for (const board of positions) {
      for (const player of [WHITE, BLACK] as const) {
        for (const roll of rolls) {
          const mine = legalTurns(board, player, diceFromRoll(roll))
            .map((moves) => boardKey(applySequence(board, { moves })))
            .sort();
          const engine = legalMoves(board, player, roll)
            .map((sequence) => boardKey(applySequence(board, sequence)))
            .sort();
          expect([...new Set(mine)]).toEqual([...new Set(engine)]);
        }
      }
    }
  });
});

describe("handing the dice over", () => {
  it("clears the turn and passes to the other player", () => {
    const controller = positionWith(initialBoard(), { a: 3, b: 1 });
    controller.applyMove(18, 21);
    controller.endTurn();
    expect(controller.player()).toBe(BLACK);
    expect(controller.currentRoll()).toBeNull();
    expect(controller.remainingDice()).toEqual([]);
    expect(controller.turnMoves()).toEqual([]);
  });

  it("plays a whole engine-chosen turn in one go", () => {
    const controller = positionWith(initialBoard(), { a: 3, b: 1 }, BLACK);
    const sequence = chooseMove(controller.board(), BLACK, { a: 3, b: 1 });
    expect(sequence).not.toBeNull();

    controller.playSequence(sequence!);
    expect(controller.remainingDice()).toEqual([]);
    expect(controller.isTurnOver()).toBe(true);
    expect(controller.turnMoves()).toEqual(sequence!.moves);
    expect(controller.pipCounts().black).toBeLessThan(167);
  });
});

describe("playMove", () => {
  /*
   * `applyMove` re-derives the die from a pair of endpoints, which is the
   * right thing for a mouse and the wrong thing for the engine: the engine has
   * already decided which die each of its moves spends. `playMove` plays that
   * decision verbatim, which is what lets the UI animate a turn move by move
   * without the animation quietly changing the play.
   */
  it("plays one engine move and spends its die", () => {
    const controller = positionWith(initialBoard(), { a: 3, b: 1 }, BLACK);
    const sequence = chooseMove(controller.board(), BLACK, { a: 3, b: 1 })!;
    const [first] = sequence.moves;

    controller.playMove(first);

    const left = diceFromRoll({ a: 3, b: 1 });
    left.splice(left.indexOf(first.die), 1);

    expect(controller.turnMoves()).toEqual([first]);
    expect(controller.remainingDice()).toEqual(left);
    // The same move clicked by hand reaches the same position.
    const clicked = positionWith(initialBoard(), { a: 3, b: 1 }, BLACK);
    clicked.applyMove(first.from, first.to);
    expect(boardKey(controller.board())).toBe(boardKey(clicked.board()));
  });

  it("plays a whole turn one move at a time", () => {
    const controller = positionWith(initialBoard(), { a: 3, b: 1 }, BLACK);
    const sequence = chooseMove(controller.board(), BLACK, { a: 3, b: 1 })!;
    expect(sequence.moves.length).toBeGreaterThan(1);

    const wholeTurn = positionWith(initialBoard(), { a: 3, b: 1 }, BLACK);
    wholeTurn.playSequence(sequence);

    for (const move of sequence.moves) controller.playMove(move);

    expect(boardKey(controller.board())).toBe(boardKey(wholeTurn.board()));
    expect(controller.turnMoves()).toEqual(sequence.moves);
    expect(controller.remainingDice()).toEqual([]);
    expect(controller.isTurnOver()).toBe(true);
  });

  it("spends the die the engine chose, not the smallest that fits", () => {
    // White's last two checkers, one and two pips from home, with a 6-2 to
    // play. Either die bears the back checker off — the 2 exactly, the 6 as an
    // oversized roll — so the endpoints alone do not say which was meant.
    const bearOff = () =>
      positionWith(
        makeBoard({ points: { 23: 1, 22: 1, 0: -2 }, whiteOff: 13 }),
        { a: 6, b: 2 },
      );
    const sequence = chooseMove(bearOff().board(), WHITE, { a: 6, b: 2 })!;
    const [first] = sequence.moves;
    expect(first).toEqual({ from: 22, to: OFF, die: 6, player: WHITE });

    const played = bearOff();
    played.playMove(first);
    expect(played.remainingDice()).toEqual([2]);

    // Clicked by hand the same bear-off spends the exact die instead, which is
    // right for a player and would misreport what the engine actually did.
    const clicked = bearOff();
    clicked.applyMove(22, OFF);
    expect(clicked.remainingDice()).toEqual([6]);
  });
});

describe("a whole game", () => {
  /*
   * The turn loop the component drives, run to completion with the engine
   * playing both sides. It proves the two halves fit together: a maximal turn
   * always ends the turn, forfeits are handled, and the game terminates.
   */
  it("plays out to a winner", () => {
    const controller = new TurnController({ roller: createRoller(2026) });
    let turns = 0;

    while (controller.winner() === null && turns < 1000) {
      turns++;
      const roll = controller.roll();
      const sequence = chooseMove(controller.board(), controller.player(), roll);
      if (sequence) controller.playSequence(sequence);

      // A maximal turn leaves nothing further to do, by definition.
      expect(controller.isTurnOver()).toBe(true);
      if (controller.winner() !== null) break;
      controller.endTurn();
    }

    expect(controller.winner()).not.toBeNull();
    expect(turns).toBeLessThan(1000);
  });
});
