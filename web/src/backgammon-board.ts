/**
 * The whole user interface: one custom element.
 *
 * Everything that could be got wrong quietly — the rules, the maximal-play
 * rule, the board-to-screen mapping — lives in `controller.ts` and
 * `layout.ts`, where it is tested directly. What is left here is the part a
 * test cannot really judge anyway: drawing, clicking and timing.
 *
 * The point of the app is the tutor panel. After every move Black makes it
 * shows the play the engine picked with its full reasoning, and then, for each
 * play it rejected, only what that play would have done differently. That is
 * the whole reason this AI is a transparent one-ply evaluator rather than a
 * black box.
 *
 * The Hint button turns that same machinery around and points it at the
 * player's own roll, which is the difference between an opponent and a tutor.
 */

import { css, html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { chooseMove, explainMove, type RankedMove } from "../../engine/ai.ts";
import { cloneBoard } from "../../engine/board.ts";
import { explainEvaluation } from "../../engine/evaluator.ts";
import { describeSequence } from "../../engine/moves.ts";
import {
  BAR,
  BLACK,
  BLACK_BAR,
  BLACK_OFF,
  NUM_POINTS,
  OFF,
  type Player,
  playerName,
  type Roll,
  WHITE,
  WHITE_BAR,
  WHITE_OFF,
} from "../../engine/types.ts";
import { diffEvaluations, formatDelta } from "./compare.ts";
import { TurnController } from "./controller.ts";
import {
  BAR_COLUMN,
  BOARD_COLS,
  BOTTOM_ROW,
  checkerStack,
  type CheckerStack,
  pointPosition,
  TOP_ROW,
  TRAY_COLUMN,
} from "./layout.ts";

/** How long Black appears to think before playing, in milliseconds. */
const AI_THINKING_TIME = 600;

/** How many alternative plays the tutor panel compares against Black's choice. */
const TUTOR_ALTERNATIVES = 3;

/** Every engine point, in index order. */
const POINTS = Array.from({ length: NUM_POINTS }, (_, point) => point);

/**
 * Discs drawn before a stack switches to a count badge. A point is only ever
 * tall enough for so many checkers, and five is what a real board shows before
 * players start piling them up.
 */
const MAX_VISIBLE_CHECKERS = 5;

/**
 * Where the dots sit on each die face, as `[row, column]` in a 3x3 grid.
 * Hard-coding the faces is what makes a die read as a die rather than as a
 * pile of dots.
 */
const DIE_FACES: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[2, 2]],
  [[1, 1], [3, 3]],
  [[1, 1], [2, 2], [3, 3]],
  [[1, 1], [1, 3], [3, 1], [3, 3]],
  [[1, 1], [1, 3], [2, 2], [3, 1], [3, 3]],
  [[1, 1], [1, 3], [2, 1], [2, 3], [3, 1], [3, 3]],
];

/** A roll the engine was asked about, together with the plays it ranked. */
interface Advice {
  /** Whose roll it was — the panels explain Black's play and White's alike. */
  player: Player;
  roll: Roll;
  /** Best first, as {@link explainMove} returns them; empty if nothing is legal. */
  moves: RankedMove[];
}

/**
 * The tutor's block of text: one play explained in full, the rest explained by
 * subtraction.
 *
 * Only the best play gets the whole breakdown, because it is the reference the
 * others are read against. Repeating all eight factors for every rejected play
 * would say the same thing three more times and bury the two lines that
 * actually decided the choice.
 */
function describeAdvice(advice: Advice): string {
  const header = `${playerName(advice.player)} rolls (${advice.roll.a},${advice.roll.b})`;
  const [best, ...rejected] = advice.moves;
  if (!best) return `${header}: no legal move, turn forfeited`;

  const lines = [
    header,
    `plays ${describeSequence(best.sequence)}`,
    ...explainEvaluation(best.evaluation).map((line) => `  ${line}`),
  ];

  for (const alternative of rejected) {
    lines.push(describeRejected(best, alternative));
    lines.push(
      ...diffEvaluations(best.evaluation, alternative.evaluation).map((diff) =>
        // "worse" is a letter shorter than "better", so it is padded out: the
        // details then start in the same column and read as a list.
        `  ${diff.name} ${formatDelta(diff.delta)}  ` +
        `${(diff.better ? "better:" : "worse:").padEnd(7)} ${diff.detail}`
      ),
    );
  }

  return lines.join("\n");
}

/** A rejected play's headline: what it was worth, and what it cost to reject. */
function describeRejected(best: RankedMove, alternative: RankedMove): string {
  const margin = best.evaluation.score - alternative.evaluation.score;
  // Ranked plays arrive best first, so the margin is normally positive; a tie
  // broken the other way should still read as a sentence rather than a minus.
  const verdict = margin >= 0
    ? `chosen wins by ${margin.toFixed(2)}`
    : `alternative wins by ${(-margin).toFixed(2)}`;

  return `instead of ${describeSequence(alternative.sequence)}  ` +
    `(${formatDelta(alternative.evaluation.score)} — ${verdict})`;
}

@customElement("backgammon-board")
export class BackgammonBoard extends LitElement {
  /**
   * The game. It is mutable and not a reactive value, so every handler that
   * touches it finishes by calling {@link requestUpdate}.
   */
  private controller = new TurnController();

  /** The point a checker has been picked up from, if any. */
  @state() private selected: number | null = null;

  /** Where the picked-up checker may go — highlighted on the board. */
  @state() private destinations: number[] = [];

  /** How the engine ranked the plays available for Black's last roll. */
  @state() private tutorAdvice: Advice | null = null;

  /**
   * How the engine would play the roll *White* is holding, set by the Hint
   * button and cleared the rest of the time.
   */
  @state() private hintAdvice: Advice | null = null;

  /** What White has played so far this turn, in `13/7 8/7` notation. */
  @state() private humanMoveText = "";

  /** What Black played last turn, in the same notation. */
  @state() private blackMoveText = "";

  /** The one-line prompt under the board. */
  @state() private status = "Your roll.";

  /** True while Black's move is pending, so the board stops taking clicks. */
  @state() private thinking = false;

  /** Handle for the pending AI move, cleared if the element goes away. */
  private aiTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Whether there is a game here worth losing — true from the first roll until
   * a new game is started, a won game included.
   *
   * It is a flag rather than something read off the controller because the
   * roll is cleared at every handover, and a game between turns is still a
   * game. Nothing is drawn from it, so it is not reactive.
   */
  private started = false;

  /**
   * Escape puts a picked-up checker back down.
   *
   * It listens on the window rather than on the element because a player who
   * has just clicked a point has not necessarily left focus anywhere useful,
   * and "Escape means cancel" is a promise the whole page should keep. Bound
   * once, as a field, so it can be removed again by identity.
   */
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || this.selected === null) return;
    this.cancelSelection();
  };

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("keydown", this.onKeyDown);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.onKeyDown);
    this.cancelAiTurn();
  }

  // ---------------------------------------------------------------- game flow

  /** Whether White may act: their turn, nobody has won, Black is not moving. */
  private get humanCanAct(): boolean {
    return this.controller.player() === WHITE && !this.thinking &&
      this.controller.winner() === null;
  }

  private onRoll(): void {
    if (!this.humanCanAct || this.controller.currentRoll() !== null) return;

    this.controller.roll();
    this.started = true;
    this.selected = null;
    this.destinations = [];
    this.humanMoveText = "";
    // Advice about the previous roll is worse than no advice at all.
    this.hintAdvice = null;

    if (this.controller.hasLegalMoves()) {
      this.status = "Pick a checker.";
      this.requestUpdate();
      return;
    }

    // Nothing is playable, so the turn is simply forfeited — there is no
    // decision for the player to make and nothing to click.
    this.status = "No legal move with that roll — passing.";
    this.requestUpdate();
    this.handOverToBlack();
  }

  /**
   * A click on any slot: a point, White's half of the bar, or White's tray.
   *
   * One handler covers both halves of a move. If the slot is currently
   * highlighted as a destination the move is played; otherwise the click is
   * read as picking a checker up (and picking up a checker that cannot move
   * just clears the selection).
   */
  private onSlot(slot: number): void {
    if (!this.humanCanAct || this.controller.currentRoll() === null) return;

    // Clicking the checker you just picked up puts it back where it was —
    // the mouse equivalent of Escape, and the first thing a player tries.
    if (this.selected === slot) {
      this.cancelSelection();
      return;
    }

    if (this.selected !== null && this.destinations.includes(slot)) {
      this.playHumanMove(this.selected, slot);
      return;
    }

    const destinations = this.controller.legalDestinations(slot);
    this.selected = destinations.length > 0 ? slot : null;
    this.destinations = destinations;
    this.status = destinations.length > 0
      ? "Now pick where it goes."
      : "That checker has nowhere to go — pick another.";
  }

  /**
   * Puts a half-made move back: nothing is in hand, nothing is highlighted,
   * and the board is waiting for a checker again.
   *
   * A hint deliberately survives this. It is reference material about the
   * roll, not about the checker that was just put down.
   */
  private cancelSelection(): void {
    this.selected = null;
    this.destinations = [];
    this.status = "Pick a checker.";
  }

  private playHumanMove(from: number, to: number): void {
    this.controller.applyMove(from, to);
    this.selected = null;
    this.destinations = [];
    this.hintAdvice = null;
    this.humanMoveText = describeSequence({ moves: this.controller.turnMoves() });

    if (this.controller.winner() !== null) {
      this.status = "";
      this.requestUpdate();
      return;
    }

    if (this.controller.isTurnOver()) {
      this.handOverToBlack();
      return;
    }

    this.status = "Pick a checker.";
    this.requestUpdate();
  }

  /**
   * Whether asking for a hint would mean anything: White is on turn with dice
   * in hand and something legal to do with them.
   */
  private get canHint(): boolean {
    return this.humanCanAct && this.controller.currentRoll() !== null &&
      this.controller.hasLegalMoves();
  }

  /**
   * The tutor's answer to "what would you do here?".
   *
   * The engine is asked to play White's roll exactly as it plays its own, and
   * the reasoning is printed the same way — the play it would choose, the
   * plays it would reject, and the score behind each. The recommendation is
   * then loaded into the ordinary selection, so accepting it is just clicking
   * the highlighted point and ignoring it costs nothing.
   */
  private onHint(): void {
    if (!this.canHint) return;

    const roll = this.controller.currentRoll();
    if (roll === null) return;

    const before = cloneBoard(this.controller.board());
    const sequence = chooseMove(before, WHITE, roll);
    if (sequence === null) return;

    // Normally this is the sequence's first move. Half-way through a turn the
    // advice is still worked out from the whole roll, so its opening leg can
    // need a die that has already been spent; in that case highlight the
    // first leg the board is actually offering rather than an illegal one.
    const suggested = sequence.moves.find((move) =>
      this.controller.legalDestinations(move.from).includes(move.to)
    );

    this.hintAdvice = {
      player: WHITE,
      roll,
      moves: explainMove(before, WHITE, roll, TUTOR_ALTERNATIVES),
    };
    this.selected = suggested ? suggested.from : null;
    this.destinations = suggested ? [suggested.to] : [];
    if (suggested) this.status = "Here's a suggested play — try it or pick your own.";
  }

  /** Passes the dice to Black and schedules its reply. */
  private handOverToBlack(): void {
    this.controller.endTurn();
    this.thinking = true;
    this.status = `${playerName(BLACK)} is thinking...`;
    this.aiTimer = setTimeout(() => this.playBlackTurn(), AI_THINKING_TIME);
    this.requestUpdate();
  }

  /**
   * Black's whole turn: roll, choose, explain, play.
   *
   * The explanation has to be built from the position *before* the move, since
   * it is a comparison of the plays that were available at that moment.
   */
  private playBlackTurn(): void {
    this.aiTimer = null;

    const roll = this.controller.roll();
    const before = cloneBoard(this.controller.board());
    const sequence = chooseMove(before, BLACK, roll);

    this.tutorAdvice = {
      player: BLACK,
      roll,
      moves: explainMove(before, BLACK, roll, TUTOR_ALTERNATIVES),
    };
    this.blackMoveText = sequence ? describeSequence(sequence) : "(no legal move)";
    if (sequence) this.controller.playSequence(sequence);

    this.thinking = false;

    if (this.controller.winner() !== null) {
      this.status = "";
      this.requestUpdate();
      return;
    }

    this.controller.endTurn();
    this.status = "Your roll.";
    this.requestUpdate();
  }

  private cancelAiTurn(): void {
    if (this.aiTimer !== null) clearTimeout(this.aiTimer);
    this.aiTimer = null;
  }

  /**
   * Starts again — but a game in progress is thrown away only on purpose. The
   * button stays live while Black is thinking, so the question covers a
   * mis-click there too. An untouched board has nothing to lose and is reset
   * without a word.
   */
  private onNewGame(): void {
    if (this.started && !window.confirm("Are you sure you want to end this game?")) return;

    this.cancelAiTurn();
    this.started = false;
    this.controller = new TurnController();
    this.selected = null;
    this.destinations = [];
    this.tutorAdvice = null;
    this.hintAdvice = null;
    this.humanMoveText = "";
    this.blackMoveText = "";
    this.thinking = false;
    this.status = "Your roll.";
    this.requestUpdate();
  }

  // ------------------------------------------------------------------ drawing

  override render(): TemplateResult {
    const winner = this.controller.winner();
    const sources = this.humanCanAct ? this.controller.legalSources() : [];
    const pips = this.controller.pipCounts();

    return html`
      <div class="app">
        <header class="scoreboard">
          <h1>Backgammon</h1>
          <div class="sides">
            ${this.renderSide(BLACK, pips.black)} ${this.renderSide(WHITE, pips.white)}
          </div>
        </header>

        <div class="table" role="grid" aria-label="Backgammon board">
          ${POINTS.map((point) => this.renderPoint(point, sources))}
          ${this.renderBar(sources)} ${this.renderTray(BLACK)} ${this.renderTray(WHITE)}
        </div>

        ${this.renderControls(winner)} ${this.renderHint()} ${this.renderTutor()}
      </div>
    `;
  }

  /** One player's name, pip count and turn indicator. */
  private renderSide(player: Player, pips: number): TemplateResult {
    const active = this.controller.player() === player && this.controller.winner() === null;
    return html`
      <div class=${classMap({ side: true, active, black: player === BLACK })}>
        <span class="disc"></span>
        <span class="who">${playerName(player)}${player === WHITE ? " (you)" : ""}</span>
        <span class="pips">${pips} pips</span>
      </div>
    `;
  }

  private renderPoint(point: number, sources: number[]): TemplateResult {
    const { x, y, rotation } = pointPosition(point);
    const stack = checkerStack(this.controller.board(), point);

    const classes = {
      point: true,
      shaded: x % 2 === 0,
      top: y === TOP_ROW,
      selected: this.selected === point,
      target: this.destinations.includes(point),
      pickable: sources.includes(point),
    };

    return html`
      <div
        class=${classMap(classes)}
        style="grid-column: ${x}; grid-row: ${y};"
        title=${`point ${point}`}
        @click=${() => this.onSlot(point)}
      >
        <div class="triangle" style="transform: rotate(${rotation}deg);"></div>
        ${this.renderStack(stack, y === TOP_ROW)}
      </div>
    `;
  }

  /**
   * The centre bar. Black's checkers wait in the top half and White's in the
   * bottom half, matching the direction each player re-enters from.
   */
  private renderBar(sources: number[]): TemplateResult {
    const board = this.controller.board();
    const white = checkerStack(board, WHITE_BAR);

    const whiteClasses = {
      "bar-slot": true,
      selected: this.selected === BAR,
      pickable: sources.includes(BAR),
    };

    return html`
      <div
        class="bar"
        style="grid-column: ${BAR_COLUMN}; grid-row: ${TOP_ROW} / ${BOTTOM_ROW + 1};"
      >
        <div class="bar-slot">${this.renderStack(checkerStack(board, BLACK_BAR), true)}</div>
        <div class=${classMap(whiteClasses)} title="your bar" @click=${() => this.onSlot(BAR)}>
          ${this.renderStack(white, false)}
        </div>
      </div>
    `;
  }

  /**
   * A bear-off tray. White's sits below Black's, on the same side White is
   * running towards.
   */
  private renderTray(player: Player): TemplateResult {
    const stack = checkerStack(
      this.controller.board(),
      player === WHITE ? WHITE_OFF : BLACK_OFF,
    );
    const mine = player === WHITE;
    const classes = {
      tray: true,
      target: mine && this.destinations.includes(OFF),
    };

    return html`
      <div
        class=${classMap(classes)}
        style="grid-column: ${TRAY_COLUMN}; grid-row: ${mine ? BOTTOM_ROW : TOP_ROW};"
        title=${`${playerName(player)} borne off`}
        @click=${() => (mine ? this.onSlot(OFF) : undefined)}
      >
        <span class="tray-count">${stack.count}</span>
        <div class="tray-checkers">
          ${Array.from({ length: stack.count }, () => html`<div class="checker borne"></div>`)}
        </div>
      </div>
    `;
  }

  /**
   * A pile of checkers. Stacks grow away from the edge they sit on, so the
   * top row hangs downwards and the bottom row grows upwards. Anything taller
   * than {@link MAX_VISIBLE_CHECKERS} is drawn short and labelled with its
   * real height, exactly as players stack them on a wooden board.
   */
  private renderStack(stack: CheckerStack, downwards: boolean): TemplateResult | typeof nothing {
    if (stack.count === 0) return nothing;
    const owner = stack.owner === WHITE ? "white" : "black";
    const visible = Math.min(stack.count, MAX_VISIBLE_CHECKERS);

    return html`
      <div class=${classMap({ stack: true, down: downwards })}>
        ${Array.from({ length: visible }, () => html`<div class="checker ${owner}"></div>`)}
        ${stack.count > visible ? html`<span class="count">${stack.count}</span>` : nothing}
      </div>
    `;
  }

  private renderControls(winner: Player | null): TemplateResult {
    const roll = this.controller.currentRoll();
    const unspent = this.controller.remainingDice();
    const canRoll = this.humanCanAct && roll === null;

    return html`
      <div class="controls">
        <div class="dice">
          ${roll === null
            ? html`<span class="no-dice">no dice yet</span>`
            : this.renderDice(roll.a, roll.b, unspent)}
        </div>

        <div class="buttons">
          <button class="roll-button" ?disabled=${!canRoll} @click=${this.onRoll}>
            Roll dice
          </button>
          <button
            class="hint-button"
            ?disabled=${!this.canHint}
            title="Ask the engine how it would play this roll"
            @click=${this.onHint}
          >
            Hint
          </button>
          <button class="new-game" @click=${this.onNewGame}>New game</button>
        </div>

        ${winner === null
          ? html`<p class="status">${this.status}</p>`
          : html`<p class="banner">
              ${playerName(winner)} wins${winner === WHITE ? " — well played!" : "."}
            </p>`}
      </div>
    `;
  }

  /** The two dice as thrown, dimmed once spent, plus what is left to play. */
  private renderDice(a: number, b: number, unspent: number[]): TemplateResult {
    const left = [...unspent];
    const spent = [a, b].map((face) => {
      const index = left.indexOf(face);
      if (index < 0) return true;
      left.splice(index, 1);
      return false;
    });

    return html`
      ${this.renderDie(a, spent[0])} ${this.renderDie(b, spent[1])}
      ${unspent.length > 0
        ? html`<span class="unspent">
            still to play: ${unspent.map((face) => html`<span class="chip">${face}</span>`)}
          </span>`
        : nothing}
    `;
  }

  private renderDie(face: number, spent: boolean): TemplateResult {
    return html`
      <div class=${classMap({ die: true, spent })} aria-label=${`die showing ${face}`}>
        ${DIE_FACES[face - 1].map(
          ([row, column]) =>
            html`<span class="pip" style="grid-row: ${row}; grid-column: ${column};"></span>`,
        )}
      </div>
    `;
  }

  /**
   * The hint panel: the engine's reasoning about the roll the player is
   * holding, in the same format it uses for its own moves.
   *
   * It only exists once a hint has been asked for. An unasked-for answer on
   * screen at all times would just be a solver, and the player would stop
   * thinking.
   */
  private renderHint(): TemplateResult | typeof nothing {
    if (this.hintAdvice === null) return nothing;

    return html`
      <section class="tutor hint">
        <h2>Hint: how I would play it</h2>
        <pre class="tutor-text hint-text">${describeAdvice(this.hintAdvice)}</pre>
      </section>
    `;
  }

  /**
   * The tutor panel: the engine's own explanation of Black's last play, in the
   * same format the hint panel uses for White's.
   */
  private renderTutor(): TemplateResult {
    return html`
      <section class="tutor">
        <h2>Why Black played that</h2>
        <div class="moves">
          ${this.humanMoveText
            ? html`<p><strong>You:</strong> <code>${this.humanMoveText}</code></p>`
            : nothing}
          ${this.blackMoveText
            ? html`<p><strong>Black:</strong> <code>${this.blackMoveText}</code></p>`
            : nothing}
        </div>
        <pre class="tutor-text">${this.tutorAdvice
          ? describeAdvice(this.tutorAdvice)
          : "Black has not moved yet. Once it does, the engine's reasoning appears here: the play it chose, the plays it rejected, and the score behind each."}</pre>
      </section>
    `;
  }

  static override styles = css`
    :host {
      display: block;
      --felt: #16281f;
      --frame: #4a3524;
      --frame-light: #6b4c33;
      --point-a: #c8a06a;
      --point-b: #7a4a34;
      --white: #f2ece1;
      --black: #23211f;
      --ink: #e8e2d6;
      --accent: #ffd166;
      --target: #7ee08a;

      color: var(--ink);
      font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
    }

    .app {
      max-width: 1100px;
      margin: 0 auto;
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    h1 {
      margin: 0;
      font-size: 1.4rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .scoreboard {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      flex-wrap: wrap;
    }

    .sides {
      display: flex;
      gap: 0.75rem;
    }

    .side {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.35rem 0.75rem;
      border: 1px solid transparent;
      border-radius: 999px;
      background: rgba(0, 0, 0, 0.25);
      font-size: 0.9rem;
    }

    .side.active {
      border-color: var(--accent);
      box-shadow: 0 0 0 1px var(--accent) inset;
    }

    .side .disc {
      width: 0.9rem;
      height: 0.9rem;
      border-radius: 50%;
      background: var(--white);
      border: 1px solid #0006;
    }

    .side.black .disc {
      background: var(--black);
      border-color: #fff3;
    }

    .pips {
      opacity: 0.75;
      font-variant-numeric: tabular-nums;
    }

    /* The board: six points, the bar, six points, then the trays. */
    .table {
      display: grid;
      grid-template-columns:
        repeat(${BOARD_COLS / 2}, 1fr) 0.55fr
        repeat(${BOARD_COLS / 2}, 1fr) 0.8fr;
      /* Tall enough for five checkers plus breathing room. */
      grid-template-rows: repeat(2, minmax(180px, 32vh));
      gap: 0;
      padding: 0.6rem;
      background: var(--frame);
      border: 3px solid var(--frame-light);
      border-radius: 8px;
      box-shadow: 0 10px 30px #0007;
    }

    .point {
      position: relative;
      background: var(--felt);
      cursor: default;
    }

    .triangle {
      position: absolute;
      inset: 0;
      background: var(--point-a);
      clip-path: polygon(50% 0%, 100% 100%, 0% 100%);
      opacity: 0.85;
    }

    .point.shaded .triangle {
      background: var(--point-b);
    }

    /* Checkers sit above the triangle, stacked from the edge inwards. */
    .stack {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column-reverse;
      align-items: center;
      justify-content: flex-start;
      padding: 3px;
      gap: 1px;
      overflow: hidden;
    }

    .stack.down {
      flex-direction: column;
    }

    .checker {
      width: min(2rem, 78%);
      aspect-ratio: 1;
      border-radius: 50%;
      flex: 0 0 auto;
      background: radial-gradient(circle at 35% 30%, #fff, var(--white) 60%, #b9b0a0);
      border: 1px solid #0007;
      box-shadow: 0 1px 2px #0008;
    }

    .checker.black {
      background: radial-gradient(circle at 35% 30%, #6a6560, var(--black) 60%, #000);
      border-color: #fff2;
    }

    .stack .count {
      position: absolute;
      align-self: center;
      top: calc(50% - 0.6rem);
      font-size: 0.8rem;
      font-weight: 700;
      color: var(--ink);
      text-shadow: 0 0 3px #000, 0 0 3px #000;
      pointer-events: none;
    }

    /* Click affordances. */
    .point.pickable,
    .bar-slot.pickable {
      cursor: pointer;
    }

    .point.pickable .triangle {
      opacity: 1;
    }

    .point.selected,
    .bar-slot.selected {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
    }

    .point.target,
    .tray.target {
      cursor: pointer;
      animation: pulse 1s ease-in-out infinite;
      outline: 2px solid var(--target);
      outline-offset: -2px;
    }

    @keyframes pulse {
      0%,
      100% {
        box-shadow: inset 0 0 0 0 rgba(126, 224, 138, 0.15);
      }
      50% {
        box-shadow: inset 0 0 22px 4px rgba(126, 224, 138, 0.45);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .point.target,
      .tray.target {
        animation: none;
      }
    }

    .bar {
      background: var(--frame-light);
      border-inline: 2px solid #2b1d12;
      display: flex;
      flex-direction: column;
    }

    .bar-slot {
      position: relative;
      flex: 1;
    }

    .tray {
      background: #0f1a14;
      border: 2px solid #2b1d12;
      margin: 2px;
      border-radius: 4px;
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      overflow: hidden;
    }

    .tray-count {
      position: absolute;
      top: 2px;
      font-size: 0.75rem;
      opacity: 0.6;
    }

    .tray-checkers {
      display: flex;
      flex-direction: column;
      gap: 1px;
      width: 80%;
    }

    .checker.borne {
      width: 100%;
      aspect-ratio: auto;
      height: 0.4rem;
      min-height: 2px;
      flex: 0 1 auto;
      border-radius: 2px;
    }

    .controls {
      display: flex;
      align-items: center;
      gap: 1rem;
      flex-wrap: wrap;
    }

    .dice {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      min-height: 2.5rem;
    }

    .die {
      display: grid;
      grid-template: repeat(3, 1fr) / repeat(3, 1fr);
      width: 2.4rem;
      height: 2.4rem;
      padding: 0.25rem;
      background: #f7f3ea;
      border-radius: 6px;
      box-shadow: 0 2px 4px #0008;
    }

    .die.spent {
      opacity: 0.3;
    }

    .pip {
      width: 0.42rem;
      height: 0.42rem;
      border-radius: 50%;
      background: #1b1b1b;
      place-self: center;
    }

    .unspent,
    .no-dice {
      font-size: 0.85rem;
      opacity: 0.75;
    }

    .chip {
      display: inline-block;
      min-width: 1.1rem;
      padding: 0 0.25rem;
      margin-inline: 0.1rem;
      text-align: center;
      border-radius: 3px;
      background: #0006;
      font-variant-numeric: tabular-nums;
    }

    .buttons {
      display: flex;
      gap: 0.5rem;
    }

    button {
      font: inherit;
      padding: 0.45rem 0.9rem;
      border-radius: 6px;
      border: 1px solid var(--frame-light);
      background: var(--frame);
      color: var(--ink);
      cursor: pointer;
    }

    button:hover:not(:disabled) {
      background: var(--frame-light);
    }

    button:disabled {
      opacity: 0.4;
      cursor: default;
    }

    .status {
      margin: 0;
      opacity: 0.85;
    }

    .banner {
      margin: 0;
      padding: 0.4rem 0.9rem;
      border-radius: 6px;
      background: var(--accent);
      color: #201a08;
      font-weight: 700;
    }

    /* The tutor panel — the reason the app exists, so it gets real estate. */
    .tutor {
      background: #11150f;
      border: 1px solid #2c3327;
      border-radius: 8px;
      padding: 0.9rem 1.1rem;
    }

    /* The hint says the same kind of thing about your roll, so it looks the
       same — but it is advice, not commentary, so it wears the accent. */
    .tutor.hint {
      border-color: var(--accent);
    }

    .tutor.hint h2 {
      color: var(--accent);
      opacity: 0.95;
    }

    .tutor h2 {
      margin: 0 0 0.5rem;
      font-size: 1rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      opacity: 0.8;
    }

    .moves p {
      margin: 0.15rem 0;
      font-size: 0.9rem;
    }

    code {
      background: #0006;
      padding: 0.05rem 0.3rem;
      border-radius: 3px;
    }

    .tutor-text {
      margin: 0.6rem 0 0;
      padding: 0.75rem;
      background: #0b0e09;
      border-radius: 6px;
      font-family: ui-monospace, "Cascadia Code", "Fira Code", Consolas, monospace;
      font-size: 0.85rem;
      line-height: 1.45;
      white-space: pre-wrap;
      overflow-x: auto;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "backgammon-board": BackgammonBoard;
  }
}
