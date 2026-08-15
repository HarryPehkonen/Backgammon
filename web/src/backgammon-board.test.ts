/**
 * Smoke tests for the Lit element.
 *
 * The interesting logic lives in `controller.ts` and `layout.ts`, which are
 * tested directly; all this file needs to prove is that the component wires
 * those two to a real shadow DOM — that the furniture is on the table and
 * that a click reaches the controller.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackgammonBoard } from "./backgammon-board.ts";
import { TurnController } from "./controller.ts";

/** Mounts a fresh board and waits for its first render. */
async function mount(): Promise<BackgammonBoard> {
  const element = document.createElement("backgammon-board") as BackgammonBoard;
  document.body.append(element);
  await element.updateComplete;
  return element;
}

/** Everything matching a selector inside the element's shadow root. */
function shadowAll(element: BackgammonBoard, selector: string): Element[] {
  return [...element.shadowRoot!.querySelectorAll(selector)];
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
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
