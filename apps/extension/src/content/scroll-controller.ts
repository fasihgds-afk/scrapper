export type ScrollOptions = {
  stepPx: number;
  delayMs: number;
  idleRounds: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

export class ScrollController {
  private running = false;
  private paused = false;
  private idleRounds = 0;
  private lastSeenCount = 0;

  constructor(
    private target: Element | Window,
    private options: ScrollOptions,
    private getSeenCount: () => number,
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
    await sleep(this.options.delayMs);
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

  async run(): Promise<"completed" | "stopped" | "stalled"> {
    this.running = true;
    this.paused = false;
    this.idleRounds = 0;
    this.lastSeenCount = this.getSeenCount();

    while (this.running) {
      while (this.paused && this.running) {
        await sleep(200);
      }
      if (!this.running) break;

      scrollBy(this.target, this.options.stepPx);
      await sleep(this.options.delayMs);

      const seen = this.getSeenCount();
      if (seen > this.lastSeenCount) {
        this.idleRounds = 0;
        this.lastSeenCount = seen;
      } else {
        this.idleRounds += 1;
      }

      if (this.idleRounds >= this.options.idleRounds) {
        // Try one more hard jump to bottom
        const metrics = getScrollMetrics(this.target);
        if (metrics.scrollTop + metrics.clientHeight < metrics.scrollHeight - 20) {
          scrollBy(this.target, metrics.scrollHeight);
          await sleep(this.options.delayMs * 2);
          const after = this.getSeenCount();
          if (after > this.lastSeenCount) {
            this.idleRounds = 0;
            this.lastSeenCount = after;
            continue;
          }
        }
        this.running = false;
        return "stalled";
      }
    }

    return this.paused ? "stopped" : "stopped";
  }
}
