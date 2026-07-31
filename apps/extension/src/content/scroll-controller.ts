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
  } else {
    (target as Element).scrollTop += amount;
  }
}

export type ShouldWaitFn = () => Promise<boolean>;

export class ScrollController {
  private running = false;
  private paused = false;
  private idleRounds = 0;
  private lastSeenCount = 0;
  private stallAttempts = 0;

  constructor(
    private target: Element | Window,
    private options: ScrollOptions,
    private getSeenCount: () => number,
    private onTick?: () => void | Promise<void>,
    private shouldWait?: ShouldWaitFn,
  ) {}

  get scrollY(): number {
    return getScrollMetrics(this.target).scrollTop;
  }

  async restorePosition(scrollY: number): Promise<void> {
    if (this.target === window) {
      window.scrollTo(0, scrollY);
    } else {
      (this.target as Element).scrollTop = scrollY;
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
    const maxWaitMs = 60_000;
    const pollMs = 1000;
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

      const step = resolveStepPx(this.options);
      const delay = resolveDelayMs(this.options);
      scrollBy(this.target, step);
      await sleep(delay);
      if (this.onTick) await this.onTick();

      const seen = this.getSeenCount();
      if (seen > this.lastSeenCount) {
        this.idleRounds = 0;
        this.stallAttempts = 0;
        this.lastSeenCount = seen;
      } else {
        this.idleRounds += 1;
      }

      if (this.idleRounds >= this.options.idleRounds) {
        const metrics = getScrollMetrics(this.target);
        const notAtBottom =
          metrics.scrollTop + metrics.clientHeight < metrics.scrollHeight - 20;

        if (notAtBottom || this.stallAttempts < stallRetries) {
          this.stallAttempts += 1;
          scrollBy(this.target, metrics.scrollHeight);
          await sleep(maxDelayMs(this.options) * 2);
          if (this.onTick) await this.onTick();
          const after = this.getSeenCount();
          if (after > this.lastSeenCount) {
            this.idleRounds = 0;
            this.stallAttempts = 0;
            this.lastSeenCount = after;
            continue;
          }
          // Soft retry: reset idle and keep scrolling a bit more before giving up
          if (this.stallAttempts < stallRetries) {
            this.idleRounds = Math.floor(this.options.idleRounds / 2);
            continue;
          }
        }
        this.running = false;
        return "stalled";
      }
    }

    return "stopped";
  }
}
