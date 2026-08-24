import type { ScrollConfig } from "../adapters/types";

export type ScrollOptions = ScrollConfig;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function resolveDelayMs(options: ScrollOptions): number {
  if (
    typeof options.delayMsMin === "number" &&
    typeof options.delayMsMax === "number"
  ) {
    return randomInt(options.delayMsMin, options.delayMsMax);
  }
  return options.delayMs;
}

function resolveStepPx(options: ScrollOptions): number {
  if (
    typeof options.stepPxMin === "number" &&
    typeof options.stepPxMax === "number"
  ) {
    return randomInt(options.stepPxMin, options.stepPxMax);
  }
  return options.stepPx;
}

function maxDelayMs(options: ScrollOptions): number {
  if (typeof options.delayMsMax === "number") return options.delayMsMax;
  return options.delayMs;
}

function getScrollMetrics(target: Element | Window) {
  if (target === window) {
    const el = document.documentElement;
    return {
      scrollTop: window.scrollY || el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: window.innerHeight,
    };
  }
  const el = target as Element;
  return {
    scrollTop: el.scrollTop,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  };
}

function scrollBy(target: Element | Window, amount: number): void {
  if (target === window) {
    window.scrollBy(0, amount);
    return;
  }
  const el = target as HTMLElement;
  const next = Math.min(el.scrollHeight, (el.scrollTop || 0) + amount);
  el.scrollTop = next;
  el.dispatchEvent(new Event("scroll", { bubbles: true }));
  try {
    el.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: amount,
        bubbles: true,
        cancelable: true,
        composed: true,
      }),
    );
  } catch {
    // some environments block synthetic WheelEvent
  }
}

function scrollLastRowIntoView(target: Element | Window): void {
  if (target === window) return;
  const el = target as Element;
  const rows = el.querySelectorAll(
    "[role='listitem'], .ms-List-cell, .ms-Persona, .ms-DetailsRow[role='row']",
  );
  const last = rows[rows.length - 1] as HTMLElement | undefined;
  last?.scrollIntoView({ block: "end", inline: "nearest" });
}

export type ShouldWaitFn = () => Promise<boolean>;
export type TargetFn = () => Element | Window;

export class ScrollController {
  private running = false;
  private paused = false;
  private idleRounds = 0;
  private lastSeenCount = 0;
  private stallAttempts = 0;
  private getTarget: TargetFn;

  constructor(
    target: Element | Window | TargetFn,
    private options: ScrollOptions,
    private getSeenCount: () => number,
    private onTick?: () => void | Promise<void>,
    private shouldWait?: ShouldWaitFn,
  ) {
    this.getTarget = typeof target === "function" ? target : () => target;
  }

  get scrollY(): number {
    return getScrollMetrics(this.getTarget()).scrollTop;
  }

  async restorePosition(scrollY: number): Promise<void> {
    const target = this.getTarget();
    if (target === window) {
      window.scrollTo(0, scrollY);
    } else {
      (target as Element).scrollTop = scrollY;
    }
    await sleep(resolveDelayMs(this.options));
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  stop(): void {
    this.running = false;
    this.paused = false;
  }

  private async waitWhilePaused(): Promise<boolean> {
    while (this.paused && this.running) {
      await sleep(200);
    }
    return this.running;
  }

  /** Wait for UI guard without burning idle rounds. Returns false if stopped. */
  private async waitForClearUi(): Promise<boolean> {
    if (!this.shouldWait) return true;
    const maxWaitMs = 12_000;
    const pollMs = 400;
    let waited = 0;
    while (this.running && (await this.shouldWait())) {
      if (!(await this.waitWhilePaused())) return false;
      await sleep(pollMs);
      waited += pollMs;
      if (waited >= maxWaitMs) break;
    }
    return this.running;
  }

  async run(): Promise<"completed" | "stopped" | "stalled"> {
    this.running = true;
    this.paused = false;
    this.idleRounds = 0;
    this.stallAttempts = 0;
    this.lastSeenCount = this.getSeenCount();
    const stallRetries = this.options.stallRetries ?? 0;

    while (this.running) {
      if (!(await this.waitWhilePaused())) break;
      if (!(await this.waitForClearUi())) break;

      const target = this.getTarget();
      const step = resolveStepPx(this.options);
      const delay = resolveDelayMs(this.options);
      scrollBy(target, step);
      await sleep(delay);
      if (this.onTick) await this.onTick();

      const seen = this.getSeenCount();
      if (seen > this.lastSeenCount) {
        this.idleRounds = 0;
        this.stallAttempts = 0;
        this.lastSeenCount = seen;
        continue;
      }

      this.idleRounds += 1;
      if (this.idleRounds < this.options.idleRounds) continue;

      // No new unique rows for idleRounds ticks. Outlook virtual lists often
      // still report "not at bottom" forever — do a few extra nudges, then finish.
      if (this.stallAttempts < stallRetries) {
        this.stallAttempts += 1;
        const metrics = getScrollMetrics(this.getTarget());
        scrollBy(this.getTarget(), Math.max(step, metrics.clientHeight));
        scrollLastRowIntoView(this.getTarget());
        await sleep(maxDelayMs(this.options));
        if (this.onTick) await this.onTick();
        const after = this.getSeenCount();
        if (after > this.lastSeenCount) {
          this.idleRounds = 0;
          this.stallAttempts = 0;
          this.lastSeenCount = after;
        }
        continue;
      }

      this.running = false;
      return "stalled";
    }

    return "stopped";
  }
}
