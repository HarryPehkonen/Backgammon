/**
 * The rules core: which moves are legal, and what a move does to a position.
 *
 * Everything here is expressed in pip distances (see `board.ts`), so the same
 * code plays both colours. A die of `n` always subtracts `n` from a checker's
 * pip distance; reaching zero or less means the checker comes off.
 */

import {
  barCount,
  barIndex,
  boardKey,
  cloneBoard,
  isBlocked,
  offIndex,
  owns,
  pipOf,
  pointFromPip,
} from "./board.ts";
import { diceFromRoll, isDoubles } from "./dice.ts";
import {
  BAR,
  type Board,
  direction,
  HOME_SIZE,
  MAX_PIP,
  type Move,
  type MoveSequence,
  NUM_POINTS,
  OFF,
  opponent,
  type Player,
  type Roll,
} from "./types.ts";

/**
 * Every complete legal way to play a roll.
 *
 * "Complete" is the important word. Backgammon does not let you stop early: you
 * must play as many dice as the position allows, so this returns only the
 * longest playable sequences. When exactly one die can be played, the higher
 * one wins. An empty array means the turn is forfeited.
 *
 * Sequences are deduplicated by the position they reach, because checkers are
 * indistinguishable — playing 8/5 then 6/5 is the same turn as 6/5 then 8/5.
 */
export function legalMoves(board: Board, player: Player, roll: Roll): MoveSequence[] {
  const candidates = collectMaximalSequences(board, player, diceFromRoll(roll));
  if (candidates.length === 0) return [];

  const longest = Math.max(...candidates.map((candidate) => candidate.moves.length));
  let best = candidates.filter((candidate) => candidate.moves.length === longest);
  best = preferHigherDie(best, roll, longest);

  const byPosition = new Map<string, MoveSequence>();
  for (const candidate of best) {
    if (!byPosition.has(candidate.key)) byPosition.set(candidate.key, { moves: candidate.moves });
  }
  return [...byPosition.values()];
}

/** A play that cannot be extended, together with the position it reaches. */
interface Candidate {
  moves: Move[];
  key: string;
}

/**
 * Walks every ordering of the dice and records the plays that run out of legal
 * continuations. Orderings that transpose into the same position with the same
 * dice left are explored once, which keeps doubles from exploding.
 */
function collectMaximalSequences(board: Board, player: Player, dice: number[]): Candidate[] {
  const candidates: Candidate[] = [];
  const visited = new Set<string>();

  const walk = (position: Board, remaining: number[], played: Move[]): void => {
    const state = `${boardKey(position)}|${remaining.join(",")}`;
    if (visited.has(state)) return;
    visited.add(state);

    let extended = false;
    for (const die of new Set(remaining)) {
      const rest = removeOne(remaining, die);
      for (const move of movesForDie(position, player, die)) {
        extended = true;
        walk(applyMove(position, move), rest, [...played, move]);
      }
    }

    if (!extended && played.length > 0) {
      candidates.push({ moves: played, key: boardKey(position) });
    }
  };

  walk(board, dice, []);
  return candidates;
}

/**
 * If only one die can be played and the two dice differ, the rules require the
 * higher one whenever it is playable on its own.
 */
function preferHigherDie(candidates: Candidate[], roll: Roll, longest: number): Candidate[] {
  if (longest !== 1 || isDoubles(roll)) return candidates;
  const higher = Math.max(roll.a, roll.b);
  const usingHigher = candidates.filter((candidate) => candidate.moves[0].die === higher);
  return usingHigher.length > 0 ? usingHigher : candidates;
}

/** A copy of `dice` with one occurrence of `die` removed. */
function removeOne(dice: number[], die: number): number[] {
  const index = dice.indexOf(die);
  return [...dice.slice(0, index), ...dice.slice(index + 1)];
}

/**
 * Every single move this player could make with one die value.
 *
 * While a checker sits on the bar nothing else may move, so this returns bar
 * entries only until the bar is clear.
 */
export function movesForDie(board: Board, player: Player, die: number): Move[] {
  if (barCount(board, player) > 0) {
    const entry = entryMove(board, player, die);
    return entry ? [entry] : [];
  }

  const moves: Move[] = [];
  for (let point = 0; point < NUM_POINTS; point++) {
    if (!owns(board, point, player)) continue;
    const move = moveFromPoint(board, player, point, die);
    if (move) moves.push(move);
  }
  return moves;
}

/**
 * Coming off the bar. A barred checker restarts its whole journey, so it enters
 * at pip `25 - die` — which is the opponent's home board, the far end of the
 * run. It is blocked like any other landing.
 */
export function entryMove(board: Board, player: Player, die: number): Move | null {
  const destination = pointFromPip(player, MAX_PIP - die);
  if (isBlocked(board, destination, player)) return null;
  return { from: BAR, to: destination, die, player };
}

/** Moving a checker already on a point, whether onward or off the board. */
function moveFromPoint(board: Board, player: Player, point: number, die: number): Move | null {
  const pip = pipOf(player, point);
  const remaining = pip - die;

  if (remaining > 0) {
    const destination = pointFromPip(player, remaining);
    if (isBlocked(board, destination, player)) return null;
    return { from: point, to: destination, die, player };
  }

  return bearOffMove(board, player, point, die, remaining);
}

/**
 * Bearing off. Two rules apply: an exact die always lifts a checker from the
 * matching pip, and an oversized die may only lift from the point furthest from
 * home — you may not waste a big number while a checker is still further back.
 */
function bearOffMove(
  board: Board,
  player: Player,
  point: number,
  die: number,
  remaining: number,
): Move | null {
  if (!canBearOff(board, player)) return null;
  if (remaining === 0) return { from: point, to: OFF, die, player };
  if (highestOccupiedPip(board, player) > pipOf(player, point)) return null;
  return { from: point, to: OFF, die, player };
}

/** Bearing off may begin only once every checker has reached the home board. */
export function canBearOff(board: Board, player: Player): boolean {
  if (barCount(board, player) > 0) return false;
  for (let point = 0; point < NUM_POINTS; point++) {
    if (owns(board, point, player) && pipOf(player, point) > HOME_SIZE) return false;
  }
  return true;
}

/** Pip distance of this player's checker furthest from home; 0 if none remain. */
export function highestOccupiedPip(board: Board, player: Player): number {
  let highest = 0;
  for (let point = 0; point < NUM_POINTS; point++) {
    if (!owns(board, point, player)) continue;
    highest = Math.max(highest, pipOf(player, point));
  }
  return highest;
}

/**
 * Plays one move onto a copy of the board, leaving the original untouched.
 *
 * Landing on a lone enemy checker hits it: the checker goes to the enemy bar
 * and must re-enter before that player may do anything else.
 */
export function applyMove(board: Board, move: Move): Board {
  const next = cloneBoard(board);
  const sign = direction(move.player);

  if (move.from === BAR) next[barIndex(move.player)] -= sign;
  else next[move.from] -= sign;

  if (move.to === OFF) {
    next[offIndex(move.player)] += sign;
    return next;
  }

  if (next[move.to] === -sign) {
    next[move.to] = 0;
    next[barIndex(opponent(move.player))] -= sign;
  }
  next[move.to] += sign;
  return next;
}

/** Plays a whole turn in order, returning the resulting position. */
export function applySequence(board: Board, sequence: MoveSequence): Board {
  let position = cloneBoard(board);
  for (const move of sequence.moves) position = applyMove(position, move);
  return position;
}

/**
 * Whether a specific play is one the rules allow for this roll.
 *
 * Two things have to hold: each move must be legal as it is played, spending a
 * die the roll actually provides, and the position reached must be one the
 * maximal-play rule permits stopping at.
 */
export function isLegalSequence(
  board: Board,
  player: Player,
  roll: Roll,
  sequence: MoveSequence,
): boolean {
  const remaining = diceFromRoll(roll);
  let position = board;

  for (const move of sequence.moves) {
    if (move.player !== player) return false;
    const die = remaining.indexOf(move.die);
    if (die < 0) return false;

    const available = movesForDie(position, player, move.die);
    if (!available.some((option) => option.from === move.from && option.to === move.to)) {
      return false;
    }

    remaining.splice(die, 1);
    position = applyMove(position, move);
  }

  const target = boardKey(position);
  return legalMoves(board, player, roll).some(
    (legal) => boardKey(applySequence(board, legal)) === target,
  );
}

/** A short human-readable rendering of a move, e.g. `bar/20*` or `6/off`. */
export function describeMove(move: Move): string {
  const from = move.from === BAR ? "bar" : String(move.from);
  const to = move.to === OFF ? "off" : String(move.to);
  return `${from}/${to}`;
}

/** A short human-readable rendering of a whole turn. */
export function describeSequence(sequence: MoveSequence): string {
  if (sequence.moves.length === 0) return "(no legal move)";
  return sequence.moves.map(describeMove).join(" ");
}
