import { barCount, hasWon, initialBoard, makeBoard, offCount, pipCount } from "../engine/board.ts";
import { Game } from "../engine/game.ts";
import { BLACK, CHECKERS_PER_PLAYER, WHITE } from "../engine/types.ts";
import { assert, assertEquals, assertFalse, assertThrows } from "./assert.ts";

Deno.test("a new game starts from the opening position with white to roll", () => {
  const game = new Game({ seed: 1 });
  assertEquals(game.board, initialBoard());
  assertEquals(game.currentPlayer, WHITE);
  assertEquals(game.phase, "rolling");
  assertEquals(game.winner, null);
  assertEquals(game.roll, null);
  assertFalse(game.isOver());
});

Deno.test("state() reports the position, the player and both pip counts", () => {
  const game = new Game({ seed: 1 });
  const state = game.state();
  assertEquals(state.player, WHITE);
  assertEquals(state.phase, "rolling");
  assertEquals(state.pipCounts.white, 167);
  assertEquals(state.pipCounts.black, 167);
  assertEquals(state.winner, null);
});

Deno.test("rolling moves the game into the moving phase", () => {
  const game = new Game({ roller: () => ({ a: 3, b: 2 }) });
  const roll = game.rollDice();
  assertEquals(roll, { a: 3, b: 2 });
  assertEquals(game.phase, "moving");
  assertEquals(game.roll, { a: 3, b: 2 });
  assertThrows(() => game.rollDice(), "cannot roll twice in one turn");
});

Deno.test("a turn must be rolled before it can be played", () => {
  const game = new Game({ roller: () => ({ a: 3, b: 2 }) });
  assertThrows(() => game.legalSequences(), "no roll yet");
});

Deno.test("playing a legal sequence hands the turn to the other player", () => {
  const game = new Game({ roller: () => ({ a: 3, b: 2 }) });
  game.rollDice();
  const sequences = game.legalSequences();
  assert(sequences.length > 0);
  game.playSequence(sequences[0]);

  assertEquals(game.currentPlayer, BLACK);
  assertEquals(game.phase, "rolling");
  assertEquals(game.roll, null);
  assertEquals(game.turnCount, 1);
});

Deno.test("illegal sequences are rejected", () => {
  const game = new Game({ roller: () => ({ a: 3, b: 2 }) });
  game.rollDice();
  assertThrows(
    () => game.playSequence({ moves: [{ from: 0, to: 6, die: 6, player: WHITE }] }),
    "a 6 was never rolled",
  );
  assertEquals(game.currentPlayer, WHITE, "a rejected play must not change the game");
});

Deno.test("playTurn alternates players", () => {
  const game = new Game({ seed: 11 });
  assertEquals(game.currentPlayer, WHITE);
  game.playTurn();
  assertEquals(game.currentPlayer, BLACK);
  game.playTurn();
  assertEquals(game.currentPlayer, WHITE);
});

Deno.test("a turn with no legal move is forfeited and passes to the opponent", () => {
  // White sits on the bar facing a closed home board: nothing can enter.
  const board = makeBoard({
    points: { 0: -2, 1: -2, 2: -2, 3: -2, 4: -2, 5: -2, 20: 3 },
    whiteBar: 1,
  });
  const game = new Game({ board, roller: () => ({ a: 3, b: 3 }) });

  const record = game.playTurn();
  assert(record.forfeited);
  assertEquals(record.player, WHITE);
  assertEquals(record.sequence.moves, []);
  assertEquals(game.currentPlayer, BLACK);
  assertEquals(game.phase, "rolling");
  assertEquals(barCount(game.board, WHITE), 1, "the checker stays on the bar");
});

Deno.test("hasWon triggers exactly when the fifteenth checker comes off", () => {
  const board = makeBoard({ points: { 23: 1, 0: -15 }, whiteOff: 14 });
  const game = new Game({ board, roller: () => ({ a: 1, b: 1 }) });

  assertFalse(hasWon(game.board, WHITE));
  assertFalse(game.isOver());

  game.playTurn();

  assertEquals(offCount(game.board, WHITE), CHECKERS_PER_PLAYER);
  assert(hasWon(game.board, WHITE));
  assert(game.isOver());
  assertEquals(game.winner, WHITE);
  assertEquals(game.phase, "finished");
});

Deno.test("a finished game refuses further play", () => {
  const board = makeBoard({ points: { 23: 1, 0: -15 }, whiteOff: 14 });
  const game = new Game({ board, roller: () => ({ a: 1, b: 1 }) });
  game.playTurn();
  assertThrows(() => game.playTurn(), "the game is over");
  assertThrows(() => game.rollDice(), "the game is over");
});

Deno.test("black can win too", () => {
  const board = makeBoard({ points: { 0: -1, 23: 15 }, blackOff: 14 });
  const game = new Game({ board, player: BLACK, roller: () => ({ a: 1, b: 1 }) });
  game.playTurn();
  assertEquals(game.winner, BLACK);
  assert(hasWon(game.board, BLACK));
});

Deno.test("a full self-played game reaches a winner", () => {
  for (const seed of [3, 2024]) {
    const game = new Game({ seed });
    const history = game.playToEnd(3000);

    assert(game.isOver(), `seed ${seed} did not finish`);
    assert(history.length > 20, `seed ${seed} finished suspiciously fast`);
    assert(history.length < 3000, `seed ${seed} hit the turn cap`);

    const winner = game.winner;
    assert(winner !== null);
    assertEquals(offCount(game.board, winner), CHECKERS_PER_PLAYER);
    assertEquals(pipCount(game.board, winner), 0);
    assert(offCount(game.board, winner === WHITE ? BLACK : WHITE) < CHECKERS_PER_PLAYER);

    // Turns alternate except that both sides keep their own count of forfeits.
    for (let i = 1; i < history.length; i++) {
      assert(history[i].player !== history[i - 1].player, "players must alternate");
    }
  }
});

Deno.test("checkers are conserved throughout a game", () => {
  const game = new Game({ seed: 77 });
  while (!game.isOver() && game.turnCount < 3000) {
    game.playTurn();
    for (const player of [WHITE, BLACK] as const) {
      const board = game.board;
      let onPoints = 0;
      for (let point = 0; point < 24; point++) {
        const owner = player === WHITE ? Math.max(board[point], 0) : Math.max(-board[point], 0);
        onPoints += owner;
      }
      assertEquals(
        onPoints + barCount(board, player) + offCount(board, player),
        CHECKERS_PER_PLAYER,
        `checkers lost for player ${player}`,
      );
    }
  }
  assert(game.isOver());
});

Deno.test("every turn the game plays is a legal one", () => {
  const game = new Game({ seed: 5 });
  const history = game.playToEnd(3000);
  for (const record of history) {
    if (record.forfeited) {
      assertEquals(record.sequence.moves.length, 0);
      continue;
    }
    assert(record.sequence.moves.length > 0);
    for (const move of record.sequence.moves) {
      assertEquals(move.player, record.player);
      assert(move.die === record.roll.a || move.die === record.roll.b);
    }
  }
});
