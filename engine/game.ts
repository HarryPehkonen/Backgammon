/**
 * A game of backgammon: whose turn it is, what was rolled, and who has won.
 *
 * The class owns the turn cycle — roll, then play, then pass the dice — and
 * enforces it. All the rules themselves live in `moves.ts`; this is the shell a
 * UI or a driver script talks to.
 */

import { cloneBoard, hasWon, initialBoard, pipCount } from "./board.ts";
import { createRoller, type DiceRoller } from "./dice.ts";
import { chooseMove } from "./ai.ts";
import { applySequence, isLegalSequence, legalMoves } from "./moves.ts";
import {
  BLACK,
  type Board,
  type GameState,
  type MoveSequence,
  opponent,
  type Phase,
  type Player,
  type Roll,
  WHITE,
} from "./types.ts";

/** What happened on one turn. */
export interface TurnRecord {
  player: Player;
  roll: Roll;
  /** The moves played; empty when the turn was forfeited. */
  sequence: MoveSequence;
  /** True when the roll had no legal play at all. */
  forfeited: boolean;
  /** The position after the turn. */
  board: Board;
}

/** Options for starting a game. */
export interface GameOptions {
  /** Starting position; defaults to the standard opening. */
  board?: Board;
  /** Who moves first; defaults to White. */
  player?: Player;
  /** Seed for reproducible dice. Ignored when `roller` is given. */
  seed?: number;
  /** A custom source of rolls, for scripted games and tests. */
  roller?: DiceRoller;
}

/** Safety net for {@link Game.playToEnd}. */
const DEFAULT_TURN_LIMIT = 2000;

export class Game {
  #board: Board;
  #player: Player;
  #phase: Phase;
  #roll: Roll | null = null;
  #winner: Player | null = null;
  #turnCount = 0;
  readonly #roller: DiceRoller;

  constructor(options: GameOptions = {}) {
    this.#board = options.board ? cloneBoard(options.board) : initialBoard();
    this.#player = options.player ?? WHITE;
    this.#roller = options.roller ?? createRoller(options.seed);
    this.#phase = this.#winnerOnBoard() === null ? "rolling" : "finished";
    this.#winner = this.#winnerOnBoard();
  }

  /** The current position. The returned array is a copy. */
  get board(): Board {
    return cloneBoard(this.#board);
  }

  /** Whose turn it is. */
  get currentPlayer(): Player {
    return this.#player;
  }

  /** Whether the game is waiting for a roll, for a move, or is over. */
  get phase(): Phase {
    return this.#phase;
  }

  /** The roll waiting to be played, or `null` before it is thrown. */
  get roll(): Roll | null {
    return this.#roll;
  }

  /** The winner, or `null` while the game is still running. */
  get winner(): Player | null {
    return this.#winner;
  }

  /** Turns played so far, forfeits included. */
  get turnCount(): number {
    return this.#turnCount;
  }

  /** Whether the game has finished. */
  isOver(): boolean {
    return this.#phase === "finished";
  }

  /** A snapshot for a UI. */
  state(): GameState {
    return {
      board: this.board,
      player: this.#player,
      phase: this.#phase,
      roll: this.#roll,
      winner: this.#winner,
      pipCounts: {
        white: pipCount(this.#board, WHITE),
        black: pipCount(this.#board, BLACK),
      },
    };
  }

  /** Throws the dice for the current turn. */
  rollDice(): Roll {
    if (this.#phase === "finished") throw new Error("the game is over");
    if (this.#phase === "moving") throw new Error("this turn has already been rolled");
    this.#roll = this.#roller();
    this.#phase = "moving";
    return this.#roll;
  }

  /** Every legal way to play the current roll. Empty means the turn is lost. */
  legalSequences(): MoveSequence[] {
    if (this.#roll === null) throw new Error("roll the dice first");
    return legalMoves(this.#board, this.#player, this.#roll);
  }

  /**
   * Plays a turn. The sequence must be one the rules allow for the current
   * roll; an empty sequence is accepted only when there is no legal play.
   */
  playSequence(sequence: MoveSequence): void {
    if (this.#phase !== "moving" || this.#roll === null) throw new Error("roll the dice first");

    if (sequence.moves.length === 0) {
      if (this.legalSequences().length > 0) {
        throw new Error("this roll has a legal play, so it must be played");
      }
      this.#finishTurn(this.#board);
      return;
    }

    if (!isLegalSequence(this.#board, this.#player, this.#roll, sequence)) {
      throw new Error("that is not a legal play for this roll");
    }
    this.#finishTurn(applySequence(this.#board, sequence));
  }

  /**
   * Rolls and plays a turn with the built-in AI, forfeiting when the roll
   * cannot be played.
   */
  playTurn(): TurnRecord {
    if (this.#phase === "finished") throw new Error("the game is over");

    const roll = this.#phase === "moving" && this.#roll !== null ? this.#roll : this.rollDice();
    const player = this.#player;
    const sequence = chooseMove(this.#board, player, roll);

    this.playSequence(sequence ?? { moves: [] });

    return {
      player,
      roll,
      sequence: sequence ?? { moves: [] },
      forfeited: sequence === null,
      board: this.board,
    };
  }

  /** Plays AI against AI until someone wins or the turn limit is reached. */
  playToEnd(turnLimit: number = DEFAULT_TURN_LIMIT): TurnRecord[] {
    const history: TurnRecord[] = [];
    while (!this.isOver() && history.length < turnLimit) {
      history.push(this.playTurn());
    }
    return history;
  }

  /** Records the new position, then either ends the game or passes the dice. */
  #finishTurn(board: Board): void {
    this.#board = board;
    this.#turnCount++;
    this.#roll = null;

    const winner = this.#winnerOnBoard();
    if (winner !== null) {
      this.#winner = winner;
      this.#phase = "finished";
      return;
    }

    this.#player = opponent(this.#player);
    this.#phase = "rolling";
  }

  #winnerOnBoard(): Player | null {
    if (hasWon(this.#board, WHITE)) return WHITE;
    if (hasWon(this.#board, BLACK)) return BLACK;
    return null;
  }
}
