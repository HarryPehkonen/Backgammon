# Backgammon

A complete backgammon rules engine in pure TypeScript. No UI, no dependencies, no network — just the
rules, an explainable position evaluator, and a small AI that plays through them.

The engine is written to be _read_. Functions are named after the rule they implement, and the
evaluator reports why it liked a move, so you can learn the game from the code and from the AI's
explanations.

## Running the tests

```sh
export PATH="$HOME/.deno/bin:$PATH"
deno task test      # or: deno test
deno task check     # type-check engine and tests
```

Requires Deno 2.x. Nothing is fetched over the network; even the assertion helpers
(`tests/assert.ts`) are local.

## Layout

```
engine/
├── types.ts      # Player, Board, Roll, Move, GameState, Evaluation, constants
├── board.ts      # opening position, pip arithmetic, inspection, win detection
├── moves.ts      # legal-move generation and application — the rules core
├── dice.ts       # seedable rolls, doubles
├── evaluator.ts  # weighted position scoring with named, signed factors
├── ai.ts         # picks and explains a turn
└── game.ts       # the Game class: turn cycle, forfeits, winner
tests/            # one test file per module, plus local assert helpers
```

## Board representation

A position is an `Int8Array`. Points `0..23` hold a signed checker count: **positive is White,
negative is Black**, and the magnitude is how many checkers sit there. Because the sign carries
ownership, a slot never has to describe two colours at once — which is exactly the rule that a point
belongs to one player or to nobody.

| Slot    | Meaning                            |
| ------- | ---------------------------------- |
| `0..23` | the points, signed by owner        |
| `24`    | White's bar (stored positive)      |
| `25`    | White's tray of borne-off checkers |
| `26`    | Black's bar (stored negative)      |
| `27`    | Black's tray                       |

White runs `0 → 23` and bears off past 23; Black runs `23 → 0` and bears off past 0. One checker is
a **blot** and can be hit; two or more make the point and block the opponent.

In a `Move`, `from: 24` (`BAR`) and `to: 25` (`OFF`) are symbolic endpoints that mean "off the bar"
and "borne off" for _either_ colour. Use `barIndex(player)` and `offIndex(player)` to reach storage;
nothing outside `board.ts` indexes the special slots directly.

### Pip distance is the trick that keeps both colours symmetric

Every rule below is written once and applied to both players, because `pipOf(player, point)`
converts a point into **how far that checker still has to travel**, counting down to 1. White's
point 23 and Black's point 0 are both one pip from home. A die of `n` always subtracts `n`.
`pointFromPip` converts back.

That single helper is why there is no `if (player === WHITE)` scattered through the move generator:

- **Bar entry** is pip `25 - die`, which lands in the _opponent's_ home board for both colours:
  White enters on `die - 1`, Black on `24 - die`.
- **Bearing off** is "pip reaches 0 or less".
- **Pip count** is the sum of pip distances, 25 per checker on the bar. The opening position is 167
  for each side.

## Rules implemented

- Movement in each player's own direction, blocked by two or more enemy checkers.
- **Hitting**: landing on a lone enemy checker sends it to the bar.
- **The bar**: while you have a checker on the bar, nothing else may move, and entry can be blocked
  entirely (a closed home board forfeits the turn).
- **Doubles** are four moves of the same value.
- **Maximal play**: you must play as many dice as the position allows. If only one die can be played
  and the two differ, the higher one is required.
- **Bearing off**: legal only once every checker is home (a checker on the bar is not home). An
  exact die lifts from the matching pip; an oversized die may lift only from the point furthest from
  home.
- **Forfeit**: a roll with no legal play passes the dice.
- **Winning**: all fifteen checkers borne off.

Not implemented, because they are match rules rather than movement rules: the doubling cube, gammons
and backgammons, and opening-roll tie-breaks.

## Core API

```ts
initialBoard(): Board
pipCount(board, player): number
hasWon(board, player): boolean

rollDice(seed?): Roll                       // deterministic when seeded
createRoller(seed?): DiceRoller             // a replayable stream of rolls

legalMoves(board, player, roll): MoveSequence[]
applyMove(board, move): Board               // pure; returns a new board
applySequence(board, sequence): Board
isLegalSequence(board, player, roll, seq): boolean

evaluate(board, player): Evaluation
chooseMove(board, player, roll): MoveSequence | null
explainMove(board, player, roll, count?): RankedMove[]
```

`legalMoves` is the heart of it. It returns **complete turns**, not individual moves, because the
maximal-play rule can only be applied to a whole turn: you cannot tell whether a move is legal
without knowing what it leaves you able to do afterwards. An empty array means the turn is
forfeited.

### Deduplication

Checkers are indistinguishable, so two orderings that reach the same position are the same turn —
playing 8/5 then 6/5 is playing 6/5 then 8/5. Sequences are therefore deduplicated **by the position
they reach**, which also collapses the 24 permutations a doubles roll would otherwise produce. The
generator prunes transpositions as it searches (positions already seen with the same dice remaining
are not re-expanded), which is what keeps doubles cheap.

## Evaluator

`evaluate(board, player)` returns a score plus the `Factor[]` that produced it — each with a name, a
signed contribution, and a human-readable detail. The score is exactly the sum of the factors, so
the breakdown is the whole story:

| Factor          | What it measures                                       |
| --------------- | ------------------------------------------------------ |
| `pip_count`     | the race: how far ahead you are                        |
| `made_points`   | points held with two or more checkers                  |
| `home_board`    | extra credit for made points in your own home board    |
| `blots`         | lone checkers, weighted by whether the enemy can reach |
| `bar`           | checkers stuck on the bar — heavily penalised          |
| `back_checkers` | your checkers still in the opponent's home board       |
| `prime`         | walls of three or more consecutive made points         |
| `borne_off`     | checkers already off                                   |

Every factor is computed as **your value minus your opponent's**. Two things follow for free: a
balanced position scores exactly zero, and evaluating the same board for the other player returns
exactly the negated score. Nothing secretly favours a colour, and the tests check it.

Weights live in one exported `WEIGHTS` object in `evaluator.ts` — they are the knobs to turn, and
they are set for sensible, explainable play rather than strength.

## AI

One ply, no lookahead: play out every legal turn, score the position it reaches, keep the best.
`explainMove` returns the top alternatives with their full factor breakdowns so you can see what the
engine rejected and why, and `describeChoice` formats that for printing.

It is beatable — but it makes the standard opening plays for the right reasons. Given an opening 3-1
it plays 16/19 18/19, making the five-point, and the breakdown shows exactly why
(`home_board +2.50`, `made_points +2.00`).

## Game

```ts
const game = new Game({ seed: 3 }); // or { board, player, roller }
game.rollDice();
game.playSequence(game.legalSequences()[0]);
game.playTurn(); // roll + AI move, forfeits if it must
game.playToEnd(); // AI against AI, returns the history
```

`Game` owns the roll-then-move cycle and enforces it: you cannot roll twice, or move before rolling,
or play on after someone has won. Illegal plays are rejected without changing the game. A roll with
no legal play is recorded as a forfeit and the dice pass.

## Notes on the spec

Three points in the original brief were internally inconsistent; the engine implements the actual
backgammon rule in each case.

1. **The board needs 28 slots, not 26.** One signed slot for "the bar" cannot hold both players'
   checkers, and both players are on the bar simultaneously all the time. Same for borne-off
   checkers. Each player gets private bar and tray slots. `Move.from = 24` / `to = 25` remain as the
   brief specified — they are symbolic endpoints, independent of storage.
2. **The opening distribution.** The brief's layout (2 on 0, 5 on 5, 3 on 7, 5 on 11) totals 259
   pips, but the brief also requires the correct starting pip count of 167. The standard position is
   used: White on 0×2, 11×5, 16×3, 18×5, mirrored for Black — which is 167 a side.
3. **Bar entry direction.** The brief has White entering at `24 - die`, i.e. points 18–23, but that
   is White's _own_ home board. A checker on the bar restarts its whole journey and enters in the
   _opponent's_ home, so White enters at `die - 1` and Black at `24 - die`. This is also what makes
   a barred checker worth the full 25 pips that the 167 arithmetic assumes.
