import type { ExtractedRecord, SiteAdapter, SiteConfig } from "./types";

function readField(root: Element, selector: string, attr = "text"): string {
  const el = root.querySelector(selector);
  if (!el) return "";
  if (attr === "text") return (el.textContent ?? "").trim();
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

export class GenericTableAdapter implements SiteAdapter {
  constructor(public config: SiteConfig) {}

  getRows(root: ParentNode = document): Element[] {
    return Array.from(root.querySelectorAll(this.config.rowSelector));
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
      el.getAttribute("data-id") ||
      el.getAttribute("data-record") ||
      el.getAttribute("id") ||
      "";

    const fingerprint =
      stableId ||
      buildFingerprint({ name, email, upn, type }, this.config.fingerprint);

    return { name, email, upn, type, sourceUrl, fingerprint };
  }

  getScrollTarget(): Element | Window {
    const sel = this.config.scrollContainer;
    if (!sel || sel === "body" || sel === "window") return window;
    const el = document.querySelector(sel);
    return el ?? window;
  }
}
