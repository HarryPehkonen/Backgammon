/**
 * The bridge between the engine's rules and a player's mouse.
 *
 * The engine thinks in *whole turns*: `legalMoves` hands back every complete
 * play of a roll, because backgammon's maximal-play rule is a statement about
 * the turn as a whole, not about individual moves. A person, meanwhile, moves
 * one checker at a time and expects the board to tell them, right now, where
 * this checker may go.
 *
 * `TurnController` reconciles the two. It keeps the position and the dice
 * still to be played, and at every moment knows every complete turn that is
 * still available. From that it answers the only two questions the UI has:
 *
 * - which checkers may be picked up (the *first* move of some complete turn),
 * - and where the checker in hand may be put down.
 *
 * Answering from complete turns is what makes the maximal-play rule work
 * without the UI knowing anything about it. If a move is legal on its own but
 * would strand a die that could otherwise have been played, it simply never
 * appears as the first move of a complete turn, and the board never offers it.
 *
 * No Lit, no DOM: everything here is plain data, so it can be tested directly.
 */

import {
  boardKey,
  cloneBoard,
  hasWon,
  initialBoard,
  pipCount,
} from "../../engine/board.ts";
import { createRoller, type DiceRoller, diceFromRoll } from "../../engine/dice.ts";
import { applyMove, movesForDie } from "../../engine/moves.ts";
import {
  BAR,
  BLACK,
  type Board,
  type Move,
  type MoveSequence,
  OFF,
  opponent,
  type Player,
  type Roll,
  WHITE,
} from "../../engine/types.ts";

/** Both players' distance from home, for the scoreboard. */
export interface PipCounts {
  white: number;
  black: number;
}

/** How to start a controller. Every field has a sensible game-opening default. */
export interface TurnControllerOptions {
  /** Starting position; defaults to the standard opening setup. */
  board?: Board;
  /** Who is on turn; defaults to White, the human's seat. */
  player?: Player;
  /** Dice source; defaults to a genuinely random roller. */
  roller?: DiceRoller;
}

/**
 * One complete turn, as an ordered list of moves.
 *
 * This is `MoveSequence.moves` without the wrapper — the wrapper only earns
 * its keep at the engine boundary.
 */
export type Turn = Move[];

/** The empty continuation: "nothing more can be played from here". */
const NOTHING: Turn = [];

/**
 * Every complete legal turn playable from `board` with `dice` in hand.
 *
 * This deliberately re-derives what the engine's `legalMoves` computes, for
 * two reasons the UI cannot live without:
 *
 * 1. **Any number of dice.** `legalMoves` takes a `Roll`, so it can only
 *    describe two dice or four identical ones. Halfway through a double the
 *    player has three left, which no `Roll` can express.
 * 2. **Every ordering.** `legalMoves` collapses turns that reach the same
 *    position, so of the two ways to play 8/5 6/5 only one survives. That is
 *    right for an engine picking a move and wrong for a person clicking one:
 *    both checkers really can be picked up first, and refusing one of them
 *    would feel broken.
 *
 * The rules themselves still come from the engine — `movesForDie` decides
 * what a single die may do, and `applyMove` decides what it does. The tests
 * check that the positions reachable through this function are exactly the
 * ones the engine calls legal.
 */
export function legalTurns(board: Board, player: Player, dice: number[]): Turn[] {
  if (dice.length === 0) return [];
  const turns = longestTurnsFrom(board, player, dice, new Map())
    .filter((turn) => turn.length > 0);
  return preferHigherDie(turns, dice);
}

/**
 * The longest turns playable from one position, best-first search with memos.
 *
 * A turn is maximal when it cannot be extended, and the rules force the
 * longest one available. Taking only the longest continuations at every step
 * finds the global maximum, because a turn's length is one plus its tail's.
 *
 * The memo is keyed on position *and* dice left, which is what keeps doubles
 * cheap: the four ways to reach the same position with the same dice
 * remaining all share one answer.
 */
function longestTurnsFrom(
  board: Board,
  player: Player,
  dice: number[],
  memo: Map<string, Turn[]>,
): Turn[] {
  if (dice.length === 0) return [NOTHING];

  const key = `${boardKey(board)}|${dice.join(",")}`;
  const memoised = memo.get(key);
  if (memoised) return memoised;

  let longest: Turn[] = [];
  let length = 0;

  for (const die of new Set(dice)) {
    const rest = withoutOne(dice, die);
    for (const move of movesForDie(board, player, die)) {
      for (const tail of longestTurnsFrom(applyMove(board, move), player, rest, memo)) {
        const turn = [move, ...tail];
        if (turn.length > length) {
          length = turn.length;
          longest = [turn];
        } else if (turn.length === length) {
          longest.push(turn);
        }
      }
    }
  }

  if (length === 0) longest = [NOTHING];
  memo.set(key, longest);
  return longest;
}

/**
 * The higher-die rule: when only one of two different dice can be played, it
 * has to be the higher one — you may not choose the small number to keep a
 * checker safe.
 *
 * This only ever bites at the start of a turn, since that is the only moment
 * two *different* dice are in hand.
 */
function preferHigherDie(turns: Turn[], dice: number[]): Turn[] {
  if (dice.length !== 2 || dice[0] === dice[1]) return turns;
  if (turns.some((turn) => turn.length > 1)) return turns;

  const higher = Math.max(dice[0], dice[1]);
  const usingHigher = turns.filter((turn) => turn[0].die === higher);
  return usingHigher.length > 0 ? usingHigher : turns;
}

/** A copy of `dice` with one occurrence of `die` taken out. */
function withoutOne(dice: number[], die: number): number[] {
  const index = dice.indexOf(die);
  return [...dice.slice(0, index), ...dice.slice(index + 1)];
}

/** Sorted, de-duplicated — the shape the UI wants for highlighting. */
function sortedUnique(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

/** How a move endpoint reads in an error message. */
function endpointName(endpoint: number): string {
  if (endpoint === BAR) return "bar";
  if (endpoint === OFF) return "off";
  return String(endpoint);
}

/**
 * A game in progress, driven one click at a time.
 *
 * The usual cycle is: `roll()`, then `legalSources()` / `legalDestinations()`
 * and `applyMove()` until `isTurnOver()`, then `endTurn()`.
 */
export class TurnController {
  #board: Board;
  #player: Player;
  #roller: DiceRoller;
  #roll: Roll | null = null;
  #dice: number[] = [];
  #played: Move[] = [];
  /** Every complete turn still available from the current position. */
  #turns: Turn[] = [];

  constructor(options: TurnControllerOptions = {}) {
    this.#board = options.board ? cloneBoard(options.board) : initialBoard();
    this.#player = options.player ?? WHITE;
    this.#roller = options.roller ?? createRoller();
  }

  /** The current position. Treat it as read-only; the engine never mutates. */
  board(): Board {
    return this.#board;
  }

  /** Whose turn it is. */
  player(): Player {
    return this.#player;
  }

  /** The dice as thrown, or `null` before this turn's roll. */
  currentRoll(): Roll | null {
    return this.#roll;
  }

  /** The dice values not yet spent — one to four of them. */
  remainingDice(): number[] {
    return [...this.#dice];
  }

  /** The moves made so far this turn, in the order they were played. */
  turnMoves(): Move[] {
    return [...this.#played];
  }

  /** Both sides' pip counts, for display. */
  pipCounts(): PipCounts {
    return { white: pipCount(this.#board, WHITE), black: pipCount(this.#board, BLACK) };
  }

  /** Throws the dice and opens a turn. */
  roll(): Roll {
    this.#roll = this.#roller();
    this.#dice = diceFromRoll(this.#roll);
    this.#played = [];
    this.#recount();
    return this.#roll;
  }

  /**
   * The points a checker may be lifted from right now — or just {@link BAR}
   * while this player has a checker waiting to enter, since nothing else may
   * move until the bar is clear.
   */
  legalSources(): number[] {
    return sortedUnique(this.#turns.map((turn) => turn[0].from));
  }

  /**
   * Where the checker on `source` may be put down, as engine points, with
   * {@link OFF} for the bear-off tray.
   *
   * Only single moves are offered. A destination two dice away is not a legal
   * move — the player plays the first leg, and the second is then offered from
   * where the checker landed.
   */
  legalDestinations(source: number): number[] {
    return sortedUnique(
      this.#turns.filter((turn) => turn[0].from === source).map((turn) => turn[0].to),
    );
  }

  /** Whether the player can do anything at all with the dice in hand. */
  hasLegalMoves(): boolean {
    return this.#turns.length > 0;
  }

  /**
   * Whether the dice should be handed over: either they are all spent, or the
   * position leaves nothing legal to do with them and the turn is forfeited.
   */
  isTurnOver(): boolean {
    return this.#dice.length === 0 || !this.hasLegalMoves();
  }

  /**
   * Plays one move, chosen by its endpoints the way a player clicks it.
   *
   * Throws when `from -> to` is not currently on offer, which includes moves
   * that are legal in isolation but would break the maximal-play rule.
   */
  applyMove(from: number, to: number): void {
    const options = this.#turns
      .map((turn) => turn[0])
      .filter((move) => move.from === from && move.to === to);

    if (options.length === 0) {
      throw new Error(
        `${endpointName(from)}/${endpointName(to)} is not a legal move with ` +
          `[${this.#dice.join(", ")}]`,
      );
    }

    // Bearing off is the one move two different dice can make: an exact roll,
    // or an oversized one when nothing sits further back. Spend the smaller
    // die and keep the bigger one for a checker deeper in the home board.
    const move = options.reduce((best, option) => (option.die < best.die ? option : best));
    this.#play(move);
  }

  /**
   * Plays one move the engine has already chosen, exactly as chosen.
   *
   * This is {@link applyMove}'s opposite number. A move clicked on the board
   * arrives as two endpoints and its die has to be worked back out; a move
   * that came from the engine already knows which die it spends, and a
   * bear-off is the case where the two can disagree — an oversized roll takes
   * a checker off from the same point an exact one would. Playing the turn
   * move by move, as the animation does, must not quietly re-decide that.
   */
  playMove(move: Move): void {
    this.#play(move);
  }

  /**
   * Plays a whole turn the engine has already chosen, without re-checking it.
   *
   * This is how the AI moves: `chooseMove` only ever returns turns it drew
   * from `legalMoves`, so re-validating them here would be busywork.
   */
  playSequence(sequence: MoveSequence): void {
    for (const move of sequence.moves) this.playMove(move);
  }

  /** Passes the dice to the other player and clears the turn. */
  endTurn(): void {
    this.#player = opponent(this.#player);
    this.#roll = null;
    this.#dice = [];
    this.#played = [];
    this.#recount();
  }

  /** The player who has borne off all fifteen checkers, if there is one. */
  winner(): Player | null {
    if (hasWon(this.#board, WHITE)) return WHITE;
    if (hasWon(this.#board, BLACK)) return BLACK;
    return null;
  }

  /** Applies a move and spends its die. */
  #play(move: Move): void {
    this.#board = applyMove(this.#board, move);
    const die = this.#dice.indexOf(move.die);
    if (die >= 0) this.#dice.splice(die, 1);
    this.#played.push(move);
    this.#recount();
  }

  /** Re-derives the turns still available. Called after anything changes. */
  #recount(): void {
    this.#turns = legalTurns(this.#board, this.#player, this.#dice);
  }
}
