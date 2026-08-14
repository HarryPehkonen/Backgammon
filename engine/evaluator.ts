/**
 * Position evaluation, with its reasoning left visible.
 *
 * Every factor is computed as *this player's value minus the opponent's*, which
 * has two useful consequences: a balanced position scores exactly zero, and
 * evaluating the same board for the other player returns exactly the negated
 * score. Nothing here secretly favours a colour.
 *
 * The factors are deliberately readable rather than tuned. The point is that a
 * learner can look at the breakdown and see *why* the engine liked a play.
 */

import {
  barCount,
  homePoints,
  isBlot,
  isInHome,
  isMadePoint,
  offCount,
  owns,
  pipCount,
  pipOf,
} from "./board.ts";
import {
  type Board,
  direction,
  type Evaluation,
  type Factor,
  MAX_PIP,
  NUM_POINTS,
  opponent,
  type Player,
  playerName,
} from "./types.ts";

/**
 * How much each consideration is worth. These are the knobs a stronger engine
 * would tune; they are set here to values that play sensible, explainable
 * backgammon.
 */
export const WEIGHTS = {
  /** Per pip of lead in the race. */
  pip: 0.35,
  /** Per point held with two or more checkers. */
  madePoint: 2.0,
  /** Extra for a made point inside your own home board. */
  homePoint: 2.5,
  /** Per blot, scaled by how exposed it is. */
  blot: 3.0,
  /** Per checker stuck on the bar. */
  bar: 12.0,
  /** Per checker still sitting in the opponent's home board. */
  backChecker: 1.2,
  /** Per point of a prime of three or more consecutive made points. */
  prime: 3.0,
  /** Per checker already borne off. */
  borneOff: 10.0,
} as const;

/** A blot the opponent cannot reach this turn still costs you a little. */
const UNREACHABLE_BLOT_RISK = 0.25;

/** The furthest an opponent checker can travel in one turn without doubles. */
const DIRECT_REACH = 12;

/** Consecutive made points only count as a prime from this length up. */
const MIN_PRIME = 3;

/**
 * Scores a position from one player's point of view: positive is good for
 * `player`, negative is good for the opponent.
 */
export function evaluate(board: Board, player: Player): Evaluation {
  const mine = measure(board, player);
  const theirs = measure(board, opponent(player));

  const factors: Factor[] = [
    {
      name: "pip_count",
      contribution: (theirs.pips - mine.pips) * WEIGHTS.pip,
      detail: `${playerName(player)} needs ${mine.pips} pips, opponent ${theirs.pips}`,
    },
    {
      name: "made_points",
      contribution: (mine.madePoints.length - theirs.madePoints.length) * WEIGHTS.madePoint,
      detail: `points held ${listPoints(mine.madePoints)} against ${listPoints(theirs.madePoints)}`,
    },
    {
      name: "home_board",
      contribution: (mine.homeBoardPoints.length - theirs.homeBoardPoints.length) *
        WEIGHTS.homePoint,
      detail: `home board points ${listPoints(mine.homeBoardPoints)} against ` +
        `${listPoints(theirs.homeBoardPoints)}`,
    },
    {
      name: "blots",
      contribution: (theirs.blotRisk - mine.blotRisk) * WEIGHTS.blot,
      detail: `blots ${listPoints(mine.blots)} against ${listPoints(theirs.blots)}`,
    },
    {
      name: "bar",
      contribution: (theirs.onBar - mine.onBar) * WEIGHTS.bar,
      detail: `${mine.onBar} on the bar against ${theirs.onBar}`,
    },
    {
      name: "back_checkers",
      contribution: (theirs.backCheckers - mine.backCheckers) * WEIGHTS.backChecker,
      detail: `${mine.backCheckers} checkers still in the opponent's home board, ` +
        `against ${theirs.backCheckers}`,
    },
    {
      name: "prime",
      contribution: (mine.primeLength - theirs.primeLength) * WEIGHTS.prime,
      detail: `longest wall ${mine.primeLength} points against ${theirs.primeLength}`,
    },
    {
      name: "borne_off",
      contribution: (mine.borneOff - theirs.borneOff) * WEIGHTS.borneOff,
      detail: `${mine.borneOff} checkers off against ${theirs.borneOff}`,
    },
  ];

  const score = factors.reduce((total, factor) => total + factor.contribution, 0);
  return { score, factors };
}

/** Looks up one factor by name; throws if the evaluator did not produce it. */
export function factorNamed(evaluation: Evaluation, name: string): Factor {
  const factor = evaluation.factors.find((candidate) => candidate.name === name);
  if (!factor) throw new Error(`no factor named ${name}`);
  return factor;
}

/** Renders an evaluation as lines a human can read, strongest reason first. */
export function explainEvaluation(evaluation: Evaluation): string[] {
  const ordered = [...evaluation.factors].sort(
    (a, b) => Math.abs(b.contribution) - Math.abs(a.contribution),
  );
  return [
    `score ${format(evaluation.score)}`,
    ...ordered.map((factor) =>
      `  ${factor.name}: ${format(factor.contribution)} — ${factor.detail}`
    ),
  ];
}

/** The raw quantities the factors are built from, for one player. */
interface Measurements {
  pips: number;
  madePoints: number[];
  homeBoardPoints: number[];
  blots: number[];
  blotRisk: number;
  onBar: number;
  backCheckers: number;
  primeLength: number;
  borneOff: number;
}

function measure(board: Board, player: Player): Measurements {
  const madePoints: number[] = [];
  const homeBoardPoints: number[] = [];
  const blots: number[] = [];
  let blotRisk = 0;
  let backCheckers = 0;

  const enemyHome = new Set(homePoints(opponent(player)));

  for (let point = 0; point < NUM_POINTS; point++) {
    if (!owns(board, point, player)) continue;

    if (isMadePoint(board, point)) {
      madePoints.push(point);
      if (isInHome(player, point)) homeBoardPoints.push(point);
    }
    if (isBlot(board, point)) {
      blots.push(point);
      blotRisk += canBeReached(board, point, player) ? 1 : UNREACHABLE_BLOT_RISK;
    }
    if (enemyHome.has(point)) backCheckers += Math.abs(board[point]);
  }

  return {
    pips: pipCount(board, player),
    madePoints,
    homeBoardPoints,
    blots,
    blotRisk,
    onBar: barCount(board, player),
    backCheckers,
    primeLength: longestPrime(board, player),
    borneOff: offCount(board, player),
  };
}

/**
 * Whether the opponent has a checker close enough behind a blot to hit it. The
 * opponent runs the other way, so "behind" means a larger pip distance in *the
 * opponent's* counting.
 */
function canBeReached(board: Board, point: number, owner: Player): boolean {
  const hitter = opponent(owner);
  const target = pipOf(hitter, point);

  if (barCount(board, hitter) > 0 && MAX_PIP - target <= DIRECT_REACH) return true;

  for (let from = 0; from < NUM_POINTS; from++) {
    if (!owns(board, from, hitter)) continue;
    const distance = pipOf(hitter, from) - target;
    if (distance >= 1 && distance <= DIRECT_REACH) return true;
  }
  return false;
}

/**
 * The longest wall of consecutive made points. Six in a row is a full prime and
 * the opponent cannot jump it at all; three or more already obstructs.
 */
function longestPrime(board: Board, player: Player): number {
  let longest = 0;
  let run = 0;
  for (let point = 0; point < NUM_POINTS; point++) {
    const held = Math.sign(board[point]) === direction(player) && isMadePoint(board, point);
    run = held ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return longest >= MIN_PRIME ? longest : 0;
}

function listPoints(points: number[]): string {
  return points.length > 0 ? points.join(", ") : "none";
}

function format(value: number): string {
  return (value >= 0 ? "+" : "") + value.toFixed(2);
}
