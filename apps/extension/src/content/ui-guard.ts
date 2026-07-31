import type { UiGuardConfig } from "../adapters/types";

export type UiGuardResult = {
  wait: boolean;
  reason?: string;
};

function isVisible(el: Element): boolean {
  const html = el as HTMLElement;
  if (html.offsetParent === null && getComputedStyle(html).position !== "fixed") {
    return false;
  }
  const style = getComputedStyle(html);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
    return false;
  }
  const rect = html.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function anyVisibleMatch(selectors: string[] | undefined): Element | null {
  if (!selectors?.length) return null;
  for (const sel of selectors) {
    try {
      for (const el of Array.from(document.querySelectorAll(sel))) {
        if (isVisible(el)) return el;
      }
    } catch {
      // invalid selector — skip
    }
  }
  return null;
}

function bodyTextSample(limit = 8000): string {
  const text = document.body?.innerText ?? "";
  return text.slice(0, limit).toLowerCase();
}

/**
 * Detect Fluent loading spinners, error banners, or throttle messaging
 * so the scroller can pause instead of hammering a stuck UI.
 */
export function checkUiGuard(config?: UiGuardConfig): UiGuardResult {
  if (!config) return { wait: false };

  const loading = anyVisibleMatch(config.loadingSelectors);
  if (loading) {
    return { wait: true, reason: "loading" };
  }

  const errorEl = anyVisibleMatch(config.errorSelectors);
  if (errorEl) {
    return { wait: true, reason: "error_banner" };
  }

  const patterns = config.throttleTextPatterns;
  if (patterns?.length) {
    const sample = bodyTextSample();
    for (const raw of patterns) {
      const p = raw.toLowerCase();
      if (p && sample.includes(p)) {
        return { wait: true, reason: "throttle_text" };
      }
    }
  }

  return { wait: false };
}

export function createShouldWait(config?: UiGuardConfig): () => Promise<boolean> {
  return async () => checkUiGuard(config).wait;
}
