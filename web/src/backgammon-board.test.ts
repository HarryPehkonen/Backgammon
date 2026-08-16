/**
 * Smoke tests for the Lit element.
 *
 * The interesting logic lives in `controller.ts` and `layout.ts`, which are
 * tested directly; all this file needs to prove is that the component wires
 * those two to a real shadow DOM — that the furniture is on the table and
 * that a click reaches the controller.
 *
 * The exception is the handling a player *feels* rather than reads: putting a
 * half-picked-up checker back, and asking the engine for a hint. Those live
 * only in the element, so they are pinned down here.
 */
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";
import { chooseMove, explainMove } from "../../engine/ai.ts";
import { initialBoard, makeBoard } from "../../engine/board.ts";
import { describeSequence } from "../../engine/moves.ts";
import { BLACK, type Board, type Roll, WHITE } from "../../engine/types.ts";
import { BackgammonBoard } from "./backgammon-board.ts";
import { diffEvaluations } from "./compare.ts";
import { TurnController } from "./controller.ts";

/** Mounts a fresh board and waits for its first render. */
async function mount(): Promise<BackgammonBoard> {
  const element = document.createElement("backgammon-board") as BackgammonBoard;
  document.body.append(element);
  await element.updateComplete;
  return element;
}

/**
 * The element's own state, reachable for a test.
 *
 * TypeScript's `private` is a compile-time fiction, so a test may hand the
 * element a rigged controller — the only way to put a known position and a
 * known roll in front of the UI, since the element makes its own game.
 */
interface Internals {
  controller: TurnController;
  thinking: boolean;
  flash: { from: number; to: number } | null;
}

function internals(element: BackgammonBoard): Internals {
  return element as unknown as Internals;
}

/** A board mounted on a known position, with a known roll already thrown. */
async function mountWithRoll(board: Board, roll: Roll): Promise<BackgammonBoard> {
  const element = await mount();
  internals(element).controller = new TurnController({
    board,
    player: WHITE,
    roller: () => ({ ...roll }),
  });
  controlButton(element, ".roll-button").click();
  await element.updateComplete;
  return element;
}

/** Everything matching a selector inside the element's shadow root. */
function shadowAll(element: BackgammonBoard, selector: string): Element[] {
  return [...element.shadowRoot!.querySelectorAll(selector)];
}

function shadow(element: BackgammonBoard, selector: string): HTMLElement {
  const found = element.shadowRoot!.querySelector<HTMLElement>(selector);
  expect(found, `no ${selector} in the shadow root`).not.toBeNull();
  return found!;
}

function controlButton(element: BackgammonBoard, selector: string): HTMLButtonElement {
  return shadow(element, selector) as HTMLButtonElement;
}

/** The one-line prompt under the board. */
function status(element: BackgammonBoard): string {
  return shadow(element, ".status").textContent ?? "";
}

/** The engine point a highlighted slot stands for, read back off its title. */
function pointsOf(element: BackgammonBoard, selector: string): number[] {
  return shadowAll(element, selector)
    .map((slot) => Number(slot.getAttribute("title")!.replace("point ", "")));
}

/** Picks up the first checker the board is offering. */
async function pickUpFirstChecker(element: BackgammonBoard): Promise<HTMLElement> {
  const source = shadowAll(element, ".point.pickable")[0] as HTMLElement;
  expect(source, "the position offers nothing to pick up").toBeDefined();
  source.click();
  await element.updateComplete;
  return source;
}

/**
 * Answers the question the element asks before it throws a game away.
 *
 * happy-dom has no `confirm` of its own, so this is a definition rather than
 * an override — an unstubbed call would be a TypeError, which is exactly the
 * failure a test wants if the guard fires when it should not.
 */
function stubConfirm(answer: boolean): Mock {
  const confirm = vi.fn(() => answer);
  vi.stubGlobal("confirm", confirm);
  return confirm;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("<backgammon-board>", () => {
  it("upgrades to the registered element class", async () => {
    const element = await mount();
    expect(element).toBeInstanceOf(BackgammonBoard);
    expect(element.shadowRoot).not.toBeNull();
  });

  it("lays out 24 points, one bar and two trays", async () => {
    const element = await mount();
    expect(shadowAll(element, ".point")).toHaveLength(24);
    expect(shadowAll(element, ".bar")).toHaveLength(1);
    expect(shadowAll(element, ".tray")).toHaveLength(2);
  });

  it("puts all thirty checkers on the opening position", async () => {
    const element = await mount();
    expect(shadowAll(element, ".checker")).toHaveLength(30);
  });

  it("asks the controller for a roll when the roll button is clicked", async () => {
    const rolled = vi.spyOn(TurnController.prototype, "roll");
    const element = await mount();

    const button = element.shadowRoot!.querySelector<HTMLButtonElement>(".roll-button");
    expect(button).not.toBeNull();
    button!.click();
    await element.updateComplete;

    expect(rolled).toHaveBeenCalledTimes(1);
    expect(shadowAll(element, ".die")).toHaveLength(2);
  });
});

/** The opening roll these tests play with: a real 3-1, with a known best play. */
const OPENING_ROLL: Roll = { a: 3, b: 1 };

describe("putting a checker back", () => {
  it("drops the selection when Escape is pressed", async () => {
    const element = await mountWithRoll(initialBoard(), OPENING_ROLL);
    const played = vi.spyOn(TurnController.prototype, "applyMove");

    await pickUpFirstChecker(element);
    expect(shadowAll(element, ".selected")).toHaveLength(1);
    expect(shadowAll(element, ".target").length).toBeGreaterThan(0);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await element.updateComplete;

    expect(shadowAll(element, ".selected")).toHaveLength(0);
    expect(shadowAll(element, ".target")).toHaveLength(0);
    expect(status(element)).toBe("Pick a checker.");
    expect(played).not.toHaveBeenCalled();
  });

  it("ignores Escape when nothing has been picked up", async () => {
    const element = await mountWithRoll(initialBoard(), OPENING_ROLL);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await element.updateComplete;

    expect(status(element)).toBe("Pick a checker.");
    expect(shadowAll(element, ".point.pickable").length).toBeGreaterThan(0);
  });

  it("toggles the selection off when the same point is clicked again", async () => {
    const element = await mountWithRoll(initialBoard(), OPENING_ROLL);
    const played = vi.spyOn(TurnController.prototype, "applyMove");

    const source = await pickUpFirstChecker(element);
    expect(shadowAll(element, ".selected")).toHaveLength(1);

    source.click();
    await element.updateComplete;

    expect(shadowAll(element, ".selected")).toHaveLength(0);
    expect(shadowAll(element, ".target")).toHaveLength(0);
    expect(status(element)).toBe("Pick a checker.");
    expect(played).not.toHaveBeenCalled();
  });
});

describe("the hint button", () => {
  it("highlights the play the engine would make for White", async () => {
    const element = await mountWithRoll(initialBoard(), OPENING_ROLL);
    const advice = chooseMove(initialBoard(), WHITE, OPENING_ROLL)!;
    const first = advice.moves[0];

    controlButton(element, ".hint-button").click();
    await element.updateComplete;

    expect(pointsOf(element, ".point.selected")).toEqual([first.from]);
    expect(pointsOf(element, ".point.target")).toEqual([first.to]);
    expect(status(element)).toContain("suggested play");
  });

  it("prints the engine's reasoning in the tutor panel", async () => {
    const element = await mountWithRoll(initialBoard(), OPENING_ROLL);
    const advice = chooseMove(initialBoard(), WHITE, OPENING_ROLL)!;

    controlButton(element, ".hint-button").click();
    await element.updateComplete;

    const text = shadow(element, ".hint-text").textContent ?? "";
    expect(text).toContain("White rolls (3,1)");
    expect(text).toContain(describeSequence(advice));
    // The panel still explains Black's play as well — the hint is an addition.
    expect(shadowAll(element, ".tutor")).toHaveLength(2);
  });

  it("lets the player accept the hint by clicking the highlighted point", async () => {
    const element = await mountWithRoll(initialBoard(), OPENING_ROLL);
    const advice = chooseMove(initialBoard(), WHITE, OPENING_ROLL)!;
    const first = advice.moves[0];
    const played = vi.spyOn(TurnController.prototype, "applyMove");

    controlButton(element, ".hint-button").click();
    await element.updateComplete;
    shadow(element, ".point.target").click();
    await element.updateComplete;

    expect(played).toHaveBeenCalledWith(first.from, first.to);
  });

  it("keeps the hint on screen after the selection is cancelled", async () => {
    const element = await mountWithRoll(initialBoard(), OPENING_ROLL);

    controlButton(element, ".hint-button").click();
    await element.updateComplete;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await element.updateComplete;

    expect(shadowAll(element, ".selected")).toHaveLength(0);
    expect(shadow(element, ".hint-text").textContent).toContain("White rolls (3,1)");
  });

  it("forgets the hint on the next roll", async () => {
    const element = await mountWithRoll(initialBoard(), OPENING_ROLL);

    controlButton(element, ".hint-button").click();
    await element.updateComplete;
    expect(shadowAll(element, ".hint-text")).toHaveLength(1);

    // Straight back to the top of a turn: a fresh roll wipes stale advice.
    // The controller swap needs a render of its own, or the roll button is
    // still drawn disabled from the roll that is being replaced.
    internals(element).controller = new TurnController({
      board: initialBoard(),
      player: WHITE,
      roller: () => ({ ...OPENING_ROLL }),
    });
    element.requestUpdate();
    await element.updateComplete;

    controlButton(element, ".roll-button").click();
    await element.updateComplete;

    expect(shadowAll(element, ".hint-text")).toHaveLength(0);
  });

  it("is disabled until the dice have been thrown", async () => {
    const element = await mount();
    expect(controlButton(element, ".hint-button").disabled).toBe(true);
  });

  it("is disabled while Black is thinking", async () => {
    const element = await mountWithRoll(initialBoard(), OPENING_ROLL);
    expect(controlButton(element, ".hint-button").disabled).toBe(false);

    internals(element).thinking = true;
    await element.updateComplete;

    expect(controlButton(element, ".hint-button").disabled).toBe(true);
  });

  it("compares the play it recommends against the ones it rejected", async () => {
    const element = await mountWithRoll(initialBoard(), OPENING_ROLL);

    controlButton(element, ".hint-button").click();
    await element.updateComplete;

    const [first] = alternativeBlocks(shadow(element, ".hint-text").textContent ?? "");
    // 16/19 18/19 makes the five point; 11/14 14/15 makes nothing and leaves a blot.
    expect(first).toContain("instead of 11/14 14/15  (-1.60 — chosen wins by 7.50)");
    expect(first).toContain("blots +3.00  better: ");
    expect(first).toContain("made_points +2.00  better: ");
  });

  it("is disabled once the game has been won", async () => {
    // White's last checker sits one pip from home; a 1 bears it off and wins.
    const finish = makeBoard({ points: { 23: 1, 0: -2 }, whiteOff: 14 });
    const element = await mountWithRoll(finish, { a: 1, b: 1 });

    await pickUpFirstChecker(element);
    shadow(element, ".tray.target").click();
    await element.updateComplete;

    expect(shadow(element, ".banner").textContent).toContain("White wins");
    expect(controlButton(element, ".hint-button").disabled).toBe(true);
  });
});

/**
 * A position where White cannot move at all: a checker on the bar and Black
 * holding all six entry points. Rolling therefore hands the dice straight to
 * Black, which is the shortest honest route to a tutor panel with something in
 * it — no checkers have to be pushed around first.
 */
function blockedWhite(): Board {
  return makeBoard({
    points: { 0: -2, 1: -2, 2: -2, 3: -2, 4: -2, 5: -2, 12: -3, 18: 6, 20: 4, 22: 4 },
    whiteBar: 1,
  });
}

/** The roll both sides get in the tutor tests. Black has several ways to play it. */
const BLACK_ROLL: Roll = { a: 6, b: 5 };

/** Longer than the element waits before Black moves. */
const PAST_THINKING_TIME = 5000;

/**
 * Rolls for a blocked White and lets Black answer.
 *
 * Only the timers are faked; Lit schedules its renders on microtasks, which
 * have to keep running or `updateComplete` would never settle.
 */
async function playBlackTurn(board: Board = blockedWhite()): Promise<BackgammonBoard> {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const element = await mountWithRoll(board, BLACK_ROLL);
  // Asynchronously, because Black plays its move one checker at a time and
  // each step waits on a timer of its own.
  await vi.advanceTimersByTimeAsync(PAST_THINKING_TIME);
  await element.updateComplete;
  return element;
}

/** One block of text per rejected play, header line included. */
function alternativeBlocks(text: string): string[] {
  return text.split("instead of ").slice(1).map((block) => `instead of ${block}`);
}

describe("the tutor panel", () => {
  it("invites the player to make a move before there is anything to explain", async () => {
    const element = await mount();
    expect(shadow(element, ".tutor-text").textContent).toContain("Black has not moved yet");
  });

  it("gives Black's chosen play its full breakdown", async () => {
    const element = await playBlackTurn();
    const text = shadow(element, ".tutor-text").textContent ?? "";
    const best = explainMove(blockedWhite(), BLACK, BLACK_ROLL, 1)[0];

    expect(text).toContain("Black rolls (6,5)");
    expect(text).toContain(`plays ${describeSequence(best.sequence)}`);
    expect(text).toContain("score +50.75");
    // Every factor, whether or not it separates this play from the others.
    for (const factor of best.evaluation.factors) {
      expect(text.split("instead of ")[0]).toContain(`${factor.name}: `);
    }
  });

  it("reduces each rejected play to what it did differently", async () => {
    const element = await playBlackTurn();
    const [first] = alternativeBlocks(shadow(element, ".tutor-text").textContent ?? "");

    expect(first).toContain("instead of 12/6 12/7  (+42.00 — chosen wins by 8.75)");
    expect(first).toContain("blots +6.75  better: blots none against none");
    expect(first).toContain("made_points +2.00  better: ");
  });

  it("says nothing about the factors the two plays agree on", async () => {
    const element = await playBlackTurn();
    const [first] = alternativeBlocks(shadow(element, ".tutor-text").textContent ?? "");

    const ranked = explainMove(blockedWhite(), BLACK, BLACK_ROLL, 2);
    const changed = diffEvaluations(ranked[0].evaluation, ranked[1].evaluation)
      .map((diff) => diff.name);
    const unchanged = ranked[0].evaluation.factors
      .map((factor) => factor.name)
      .filter((name) => !changed.includes(name));

    expect(changed.length).toBeGreaterThan(0);
    expect(unchanged.length).toBeGreaterThan(0);
    for (const name of unchanged) expect(first).not.toContain(name);
  });
});

/** Past the moment Black stops thinking, but not past its first move. */
const INTO_THE_ANIMATION = 700;

/**
 * Answers the reduced-motion question for the element.
 *
 * happy-dom's own `matchMedia` says "no preference" to everything, which is
 * the animated case; a player who has asked their system to calm down gets
 * this instead.
 */
function stubReducedMotion(): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe("watching Black move", () => {
  it("lights up each move it is about to play", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const element = await mountWithRoll(blockedWhite(), BLACK_ROLL);
    expect(internals(element).flash).toBeNull();

    await vi.advanceTimersByTimeAsync(INTO_THE_ANIMATION);
    await element.updateComplete;

    // Mid-turn: something on the board is glowing and the dice are still
    // Black's, so the player cannot reach in and touch anything.
    expect(internals(element).flash).not.toBeNull();
    expect(internals(element).thinking).toBe(true);
    expect(shadowAll(element, ".flash").length).toBeGreaterThan(0);
    expect(shadowAll(element, ".point.pickable")).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(PAST_THINKING_TIME);
    await element.updateComplete;

    expect(internals(element).flash).toBeNull();
    expect(shadowAll(element, ".flash")).toHaveLength(0);
    expect(internals(element).thinking).toBe(false);
    expect(status(element)).toBe("Your roll.");
  });

  it("plays the moves one at a time rather than all at once", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const element = await mountWithRoll(blockedWhite(), BLACK_ROLL);
    const controller = internals(element).controller;
    const sequence = chooseMove(blockedWhite(), BLACK, BLACK_ROLL)!;
    expect(sequence.moves.length).toBeGreaterThan(1);

    // The point is lit before its checker moves, so the player sees where the
    // move is going to come from.
    await vi.advanceTimersByTimeAsync(INTO_THE_ANIMATION);
    expect(internals(element).flash).toEqual({
      from: sequence.moves[0].from,
      to: sequence.moves[0].to,
    });
    expect(controller.turnMoves()).toEqual([]);

    await vi.advanceTimersByTimeAsync(400);
    expect(controller.turnMoves()).toEqual([sequence.moves[0]]);

    await vi.advanceTimersByTimeAsync(PAST_THINKING_TIME);
    await element.updateComplete;
    expect(controller.player()).toBe(WHITE);
  });

  it("plays instantly for a player who asked for less motion", async () => {
    stubReducedMotion();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const element = await mountWithRoll(blockedWhite(), BLACK_ROLL);

    // The same moment that finds the animated board mid-flash finds this one
    // finished: only the thinking pause is left.
    await vi.advanceTimersByTimeAsync(INTO_THE_ANIMATION);
    await element.updateComplete;

    expect(internals(element).flash).toBeNull();
    expect(internals(element).thinking).toBe(false);
    expect(status(element)).toBe("Your roll.");
    expect(shadow(element, ".moves").textContent).toContain("Black:");
  });

  it("abandons a half-played turn when a new game is started", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    stubConfirm(true);
    const element = await mountWithRoll(blockedWhite(), BLACK_ROLL);

    await vi.advanceTimersByTimeAsync(INTO_THE_ANIMATION);
    await element.updateComplete;
    expect(internals(element).flash).not.toBeNull();

    controlButton(element, ".new-game").click();
    await element.updateComplete;
    const fresh = internals(element).controller;

    // The abandoned turn must not carry on playing Black's moves into the
    // board that replaced it.
    await vi.advanceTimersByTimeAsync(PAST_THINKING_TIME);
    await element.updateComplete;

    expect(internals(element).controller).toBe(fresh);
    expect(fresh.turnMoves()).toEqual([]);
    expect(fresh.player()).toBe(WHITE);
    expect(internals(element).flash).toBeNull();
    expect(shadowAll(element, ".flash")).toHaveLength(0);
    expect(shadowAll(element, ".checker")).toHaveLength(30);
    expect(status(element)).toBe("Your roll.");
  });
});

/** What the element asks before it abandons a game in progress. */
const END_GAME_PROMPT = "Are you sure you want to end this game?";

describe("starting a new game", () => {
  it("resets a board nobody has played on without asking", async () => {
    const confirm = stubConfirm(true);
    const element = await mount();

    controlButton(element, ".new-game").click();
    await element.updateComplete;

    expect(confirm).not.toHaveBeenCalled();
    expect(status(element)).toBe("Your roll.");
    expect(shadowAll(element, ".checker")).toHaveLength(30);
  });

  it("asks once the dice have been thrown", async () => {
    const confirm = stubConfirm(true);
    const element = await mountWithRoll(initialBoard(), OPENING_ROLL);

    controlButton(element, ".new-game").click();
    await element.updateComplete;

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(END_GAME_PROMPT);
  });

  it("changes nothing when the player says no", async () => {
    const confirm = stubConfirm(false);
    const element = await mountWithRoll(initialBoard(), OPENING_ROLL);
    await pickUpFirstChecker(element);

    controlButton(element, ".new-game").click();
    await element.updateComplete;

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(shadowAll(element, ".die")).toHaveLength(2);
    expect(shadowAll(element, ".no-dice")).toHaveLength(0);
    expect(status(element)).toBe("Now pick where it goes.");
    // Even the half-made move is still in hand.
    expect(shadowAll(element, ".selected")).toHaveLength(1);
  });

  it("resets when the player says yes", async () => {
    stubConfirm(true);
    const element = await mountWithRoll(initialBoard(), OPENING_ROLL);

    controlButton(element, ".new-game").click();
    await element.updateComplete;

    expect(status(element)).toBe("Your roll.");
    expect(shadowAll(element, ".no-dice")).toHaveLength(1);
    expect(shadowAll(element, ".die")).toHaveLength(0);
    expect(shadowAll(element, ".checker")).toHaveLength(30);
  });

  it("asks after a move has been played", async () => {
    const confirm = stubConfirm(false);
    const element = await mountWithRoll(initialBoard(), OPENING_ROLL);
    await pickUpFirstChecker(element);
    (shadowAll(element, ".point.target")[0] as HTMLElement).click();
    await element.updateComplete;

    const played = shadow(element, ".moves").textContent ?? "";
    expect(played).toContain("You:");

    controlButton(element, ".new-game").click();
    await element.updateComplete;

    expect(confirm).toHaveBeenCalledWith(END_GAME_PROMPT);
    expect(shadow(element, ".moves").textContent).toBe(played);
  });

  it("asks while Black is thinking", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const confirm = stubConfirm(false);
    // White is blocked, so the roll hands straight over and Black is thinking.
    const element = await mountWithRoll(blockedWhite(), BLACK_ROLL);
    expect(internals(element).thinking).toBe(true);

    controlButton(element, ".new-game").click();
    await element.updateComplete;

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(internals(element).thinking).toBe(true);
  });

  it("asks even though the game is over", async () => {
    // White's last checker sits one pip from home; a 1 bears it off and wins.
    const finish = makeBoard({ points: { 23: 1, 0: -2 }, whiteOff: 14 });
    const confirm = stubConfirm(false);
    const element = await mountWithRoll(finish, { a: 1, b: 1 });

    await pickUpFirstChecker(element);
    shadow(element, ".tray.target").click();
    await element.updateComplete;
    expect(shadow(element, ".banner").textContent).toContain("White wins");

    controlButton(element, ".new-game").click();
    await element.updateComplete;

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(shadow(element, ".banner").textContent).toContain("White wins");
  });
});
