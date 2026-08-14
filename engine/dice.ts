/**
 * Dice.
 *
 * Rolls are seedable so that games and tests can be replayed exactly. The
 * generator is a small deterministic PRNG rather than `Math.random`, which
 * cannot be seeded.
 */

import type { Roll } from "./types.ts";

/** Produces a fresh roll each time it is called. */
export type DiceRoller = () => Roll;

/** Faces on a die. */
const FACES = 6;

/**
 * Throws two dice.
 *
 * With a `seed` the result is fixed: the same seed always gives the same roll,
 * which is what tests and replays need. Without one the roll is random.
 */
export function rollDice(seed?: number): Roll {
  const next = seed === undefined ? Math.random : mulberry32(seed);
  return { a: die(next()), b: die(next()) };
}

/**
 * A roller that walks a deterministic stream of rolls from a seed, so a whole
 * game can be replayed. Without a seed it produces genuinely random rolls.
 */
export function createRoller(seed?: number): DiceRoller {
  const next = seed === undefined ? Math.random : mulberry32(seed);
  return () => ({ a: die(next()), b: die(next()) });
}

/** Whether both dice show the same face. */
export function isDoubles(roll: Roll): boolean {
  return roll.a === roll.b;
}

/**
 * The dice a roll actually gives you to play. Doubles are worth four moves of
 * the same value, which is why a turn can be up to four moves long.
 */
export function diceFromRoll(roll: Roll): number[] {
  return isDoubles(roll) ? [roll.a, roll.a, roll.a, roll.a] : [roll.a, roll.b];
}

/** Maps a number in `[0, 1)` onto a die face. */
function die(unit: number): number {
  return Math.floor(unit * FACES) + 1;
}

/**
 * mulberry32: a compact, well-distributed 32-bit PRNG. Chosen because it is
 * short enough to read and needs no dependencies.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
