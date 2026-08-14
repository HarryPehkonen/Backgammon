/**
 * A one-ply opponent.
 *
 * The strategy is deliberately simple and completely transparent: play every
 * legal turn out, score the position it leads to, and keep the best one. There
 * is no search past the current turn and no lookahead over the opponent's dice,
 * so the AI is beatable — but every decision it makes can be explained by the
 * evaluator's factors, which is the point.
 */

import { applySequence, describeSequence, legalMoves } from "./moves.ts";
import { evaluate, explainEvaluation } from "./evaluator.ts";
import {
  type Board,
  type Evaluation,
  type MoveSequence,
  type Player,
  playerName,
  type Roll,
} from "./types.ts";

/** A candidate turn, the position it reaches and what that position is worth. */
export interface RankedMove {
  sequence: MoveSequence;
  /** The position after playing `sequence`. */
  board: Board;
  /** The evaluation of `board`, from the mover's point of view. */
  evaluation: Evaluation;
}

/** How many alternatives {@link explainMove} shows by default. */
const DEFAULT_ALTERNATIVES = 3;

/**
 * The turn the engine would play, or `null` when the roll cannot be played at
 * all and the turn is forfeited.
 */
export function chooseMove(board: Board, player: Player, roll: Roll): MoveSequence | null {
  const ranked = rankMoves(board, player, roll);
  return ranked.length > 0 ? ranked[0].sequence : null;
}

/**
 * Every legal turn, scored and sorted best first.
 *
 * Ties keep the order `legalMoves` produced, so the choice is deterministic.
 */
export function rankMoves(board: Board, player: Player, roll: Roll): RankedMove[] {
  const ranked = legalMoves(board, player, roll).map((sequence) => {
    const result = applySequence(board, sequence);
    return { sequence, board: result, evaluation: evaluate(result, player) };
  });
  return ranked.sort((a, b) => b.evaluation.score - a.evaluation.score);
}

/**
 * The best few turns available, best first, each with its full factor
 * breakdown — so a learner can compare the engine's choice against the plays it
 * rejected. Returns an empty array when the turn is forfeited.
 */
export function explainMove(
  board: Board,
  player: Player,
  roll: Roll,
  count: number = DEFAULT_ALTERNATIVES,
): RankedMove[] {
  return rankMoves(board, player, roll).slice(0, count);
}

/**
 * A ready-to-print comparison of the engine's choice and its runners-up.
 */
export function describeChoice(
  board: Board,
  player: Player,
  roll: Roll,
  count: number = DEFAULT_ALTERNATIVES,
): string {
  const alternatives = explainMove(board, player, roll, count);
  const header = `${playerName(player)} rolls (${roll.a},${roll.b})`;
  if (alternatives.length === 0) return `${header}: no legal move, turn forfeited`;

  const lines = [header];
  alternatives.forEach((alternative, index) => {
    const label = index === 0 ? "plays" : "instead of";
    lines.push(`${label} ${describeSequence(alternative.sequence)}`);
    lines.push(...explainEvaluation(alternative.evaluation).map((line) => `  ${line}`));
  });
  return lines.join("\n");
}
