import { createRoller, diceFromRoll, isDoubles, rollDice } from "../engine/dice.ts";
import { assert, assertEquals, assertFalse } from "./assert.ts";

Deno.test("the same seed always produces the same roll", () => {
  for (const seed of [0, 1, 7, 42, 12345]) {
    assertEquals(rollDice(seed), rollDice(seed));
  }
});

Deno.test("different seeds do not all collapse to one roll", () => {
  const rolls = new Set<string>();
  for (let seed = 0; seed < 200; seed++) {
    const { a, b } = rollDice(seed);
    rolls.add(`${a},${b}`);
  }
  assert(rolls.size > 20, `only ${rolls.size} distinct rolls across 200 seeds`);
});

Deno.test("every die shows a whole number from 1 to 6", () => {
  for (let seed = 0; seed < 500; seed++) {
    const { a, b } = rollDice(seed);
    for (const die of [a, b]) {
      assert(Number.isInteger(die), `die ${die} is not an integer`);
      assert(die >= 1 && die <= 6, `die ${die} out of range`);
    }
  }
});

Deno.test("all six faces appear on both dice", () => {
  const first = new Set<number>();
  const second = new Set<number>();
  for (let seed = 0; seed < 500; seed++) {
    const { a, b } = rollDice(seed);
    first.add(a);
    second.add(b);
  }
  assertEquals([...first].sort(), [1, 2, 3, 4, 5, 6]);
  assertEquals([...second].sort(), [1, 2, 3, 4, 5, 6]);
});

Deno.test("a roll is an ordered pair, and the order survives re-rolling the seed", () => {
  let seed = 0;
  while (seed < 500 && rollDice(seed).a === rollDice(seed).b) seed++;
  assert(seed < 500, "expected to find a non-double seed");

  const roll = rollDice(seed);
  assertEquals(rollDice(seed).a, roll.a);
  assertEquals(rollDice(seed).b, roll.b);
  assert(roll.a !== roll.b);
});

Deno.test("doubles turn up at roughly the expected rate", () => {
  let doubles = 0;
  const trials = 600;
  for (let seed = 0; seed < trials; seed++) {
    if (isDoubles(rollDice(seed))) doubles++;
  }
  assert(doubles > 0, "no doubles at all across 600 seeds");
  const rate = doubles / trials;
  assert(rate > 0.08 && rate < 0.27, `doubles rate ${rate} is implausible (expected ~1/6)`);
});

Deno.test("isDoubles recognises matching faces", () => {
  assert(isDoubles({ a: 4, b: 4 }));
  assertFalse(isDoubles({ a: 4, b: 3 }));
});

Deno.test("doubles are worth four moves, other rolls two", () => {
  assertEquals(diceFromRoll({ a: 4, b: 4 }), [4, 4, 4, 4]);
  assertEquals(diceFromRoll({ a: 3, b: 2 }), [3, 2]);
  assertEquals(diceFromRoll({ a: 1, b: 1 }).length, 4);
});

Deno.test("a seeded roller replays the same sequence of rolls", () => {
  const first = createRoller(2024);
  const second = createRoller(2024);
  for (let i = 0; i < 50; i++) {
    assertEquals(first(), second());
  }
});

Deno.test("a seeded roller keeps producing fresh rolls, not one repeated roll", () => {
  const roller = createRoller(99);
  const seen = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const { a, b } = roller();
    assert(a >= 1 && a <= 6 && b >= 1 && b <= 6);
    seen.add(`${a},${b}`);
  }
  assert(seen.size > 15, `roller produced only ${seen.size} distinct rolls in 100 draws`);
});

Deno.test("an unseeded roll is still a valid roll", () => {
  for (let i = 0; i < 100; i++) {
    const { a, b } = rollDice();
    assert(Number.isInteger(a) && a >= 1 && a <= 6);
    assert(Number.isInteger(b) && b >= 1 && b <= 6);
  }
});
