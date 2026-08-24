import type { ExtractedRecord, SiteAdapter, SiteConfig } from "./types";

function readField(root: Element, selector: string, attr = "text"): string {
  const el = root.querySelector(selector);
  if (!el) return "";
  if (attr === "text") return (el.textContent ?? "").trim().replace(/\s+/g, " ");
  if (attr === "value" && "value" in el) {
    return String((el as HTMLInputElement).value ?? "").trim();
  }
  return (el.getAttribute(attr) ?? "").trim();
}

function buildFingerprint(
  record: Pick<ExtractedRecord, "name" | "email" | "upn" | "type">,
  keys: SiteConfig["fingerprint"],
): string {
  return keys.map((k) => record[k] ?? "").join("|");
}

function firstMatching(selectors: string): Element | null {
  for (const raw of selectors.split(",")) {
    const sel = raw.trim();
    if (!sel) continue;
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function isScrollable(el: Element): boolean {
  const style = window.getComputedStyle(el);
  return (
    /(auto|scroll|overlay)/.test(style.overflowY) &&
    el.scrollHeight > el.clientHeight + 20
  );
}

/** Walk up from a row to the pane that actually scrolls (Fluent virtualized lists). */
function scrollParentOf(el: Element): Element | null {
  let node: HTMLElement | null = el.parentElement;
  while (node && node !== document.documentElement) {
    if (isScrollable(node)) return node;
    node = node.parentElement;
  }
  return null;
}

/** Prefer the tallest scrollable element among matches (Fluent list pane). */
function bestScrollable(selectors: string): Element | null {
  let best: Element | null = null;
  let bestScore = 0;
  for (const raw of selectors.split(",")) {
    const sel = raw.trim();
    if (!sel) continue;
    for (const el of Array.from(document.querySelectorAll(sel))) {
      const style = window.getComputedStyle(el);
      const canScroll =
        /(auto|scroll|overlay)/.test(style.overflowY) ||
        el.scrollHeight > el.clientHeight + 40;
      if (!canScroll) continue;
      const score = el.clientHeight * (el.scrollHeight - el.clientHeight);
      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    }
  }
  return best;
}

export class GenericTableAdapter implements SiteAdapter {
  constructor(public config: SiteConfig) {}

  getRows(root: ParentNode = document): Element[] {
    return Array.from(root.querySelectorAll(this.config.rowSelector)).filter(
      (el) => {
        // Skip header rows in Fluent DetailsList
        const autoid = el.getAttribute("data-automationid") ?? "";
        if (autoid === "DetailsHeader") return false;
        if (el.getAttribute("role") === "row" && el.classList.contains("ms-DetailsHeader")) {
          return false;
        }
        return true;
      },
    );
  }

  extractRow(el: Element, sourceUrl: string): ExtractedRecord | null {
    const name = readField(
      el,
      this.config.fields.name.selector,
      this.config.fields.name.attr ?? "text",
    );
    const email = readField(
      el,
      this.config.fields.email.selector,
      this.config.fields.email.attr ?? "text",
    );
    const upn = readField(
      el,
      this.config.fields.upn.selector,
      this.config.fields.upn.attr ?? "text",
    );
    const type = readField(
      el,
      this.config.fields.type.selector,
      this.config.fields.type.attr ?? "text",
    );

    if (!name && !email && !upn) return null;

    const stableId =
      el.getAttribute("data-item-key") ||
      el.getAttribute("data-selection-index") ||
      el.getAttribute("data-id") ||
      el.getAttribute("data-record") ||
      "";

    // Prefer content fingerprint for virtualized lists (DOM ids get reused)
    const fingerprint = buildFingerprint(
      { name, email, upn, type },
      this.config.fingerprint,
    );

    return {
      name,
      email,
      upn,
      type,
      sourceUrl,
      fingerprint: fingerprint || stableId,
    };
  }

  getScrollTarget(): Element | Window {
    const firstRow = this.getRows()[0];
    if (firstRow) {
      const fromRow = scrollParentOf(firstRow);
      if (fromRow) return fromRow;
    }

    const sel = this.config.scrollContainer;
    if (!sel || sel === "body" || sel === "window") return window;
    return bestScrollable(sel) ?? firstMatching(sel) ?? window;
  }
}
