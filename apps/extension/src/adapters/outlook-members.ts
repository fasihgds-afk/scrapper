import { GenericTableAdapter } from "./generic-table";
import type { ExtractedRecord, SiteConfig } from "./types";

const ROLE_WORDS = /^(member|owner|guest|moderator|admin|organizer)$/i;
const ROLE_SUFFIX = /\s+(member|owner|guest|moderator|admin|organizer)$/i;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

const SKIP_NAMES = /^(overview|members|send email|private group|search|filter)$/i;

const ROW_SELECTORS = [
  ".ms-DetailsRow[role='row']",
  "[data-automationid='DetailsRow']",
  ".ms-List-cell",
  "div[role='listitem']",
  "li[role='listitem']",
  ".fui-Persona",
  ".ms-Persona",
  "[data-automationid='Persona']",
];

function textOf(el: Element | null): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function firstMatch(root: Element, selectors: string[]): Element | null {
  for (const sel of selectors) {
    try {
      const el = root.querySelector(sel);
      if (el) return el;
    } catch {
      // invalid selector
    }
  }
  return null;
}

function cleanMemberName(raw: string): string {
  let name = raw.replace(/\s+/g, " ").trim();
  name = name.replace(ROLE_SUFFIX, "").trim();
  name = name.replace(/^\d+\s*members?$/i, "").trim();

  const initials = name.match(/^([A-Z]{1,4})\s+(.+)$/);
  if (initials) {
    const letters = initials[2].replace(/[^A-Za-z]/g, "").toUpperCase();
    if (letters.startsWith(initials[1])) {
      name = initials[2].trim();
    }
  }
  return name;
}

function looksLikeChrome(name: string): boolean {
  if (!name) return true;
  if (SKIP_NAMES.test(name)) return true;
  if (ROLE_WORDS.test(name)) return true;
  if (/^\d+\s*members?$/i.test(name)) return true;
  return name.length < 2;
}

function extractEmail(row: Element, explicit: string): string {
  if (explicit.includes("@")) return explicit.trim();
  const mail = row.querySelector("a[href^='mailto:']") as HTMLAnchorElement | null;
  if (mail?.href) {
    try {
      return decodeURIComponent(mail.href.replace(/^mailto:/i, "").split("?")[0]).trim();
    } catch {
      return mail.href.replace(/^mailto:/i, "").split("?")[0].trim();
    }
  }
  const dataEmail = row.getAttribute("data-email") || "";
  if (dataEmail.includes("@")) return dataEmail.trim();

  const blobs = [
    row.getAttribute("aria-label") ?? "",
    row.getAttribute("title") ?? "",
    textOf(row),
  ];
  for (const blob of blobs) {
    const match = blob.match(EMAIL_RE);
    if (match) return match[0];
  }
  return "";
}

function extractRole(row: Element, explicit: string): string {
  const cleaned = explicit.replace(/\s+/g, " ").trim();
  if (ROLE_WORDS.test(cleaned)) return cleaned;
  const bits = textOf(row).split(" ").filter(Boolean);
  const last = bits[bits.length - 1] ?? "";
  if (ROLE_WORDS.test(last)) return last;
  return cleaned || "Member";
}

export class OutlookGroupMembersAdapter extends GenericTableAdapter {
  constructor(config: SiteConfig) {
    super(config);
  }

  getRows(root: ParentNode = document): Element[] {
    let best: Element[] = [];
    let bestValid = 0;
    for (const sel of ROW_SELECTORS) {
      try {
        const nodes = Array.from(root.querySelectorAll(sel)).filter((el) => {
          const autoid = el.getAttribute("data-automationid") ?? "";
          if (autoid === "DetailsHeader") return false;
          if (el.getAttribute("role") === "row" && el.classList.contains("ms-DetailsHeader")) {
            return false;
          }
          const rect = el.getBoundingClientRect();
          if (rect.height > 0 && rect.height < 24) return false;
          return true;
        });
        const valid = nodes.filter((n) => this.extractRow(n, "") !== null).length;
        if (valid > bestValid) {
          best = nodes;
          bestValid = valid;
        }
      } catch {
        // skip
      }
    }
    return best;
  }

  extractRow(el: Element, sourceUrl: string): ExtractedRecord | null {
    const nameEl = firstMatch(el, [
      ".ms-Persona-primaryText",
      ".fui-Persona__primaryText",
      "[class*='Persona__primaryText']",
      "[data-automation-key='name']",
    ]);
    const rawName = textOf(nameEl) || textOf(el);
    const name = cleanMemberName(rawName);
    if (looksLikeChrome(name)) return null;

    const email = extractEmail(
      el,
      textOf(firstMatch(el, ["[data-automation-key='email']", "a[href^='mailto:']"])),
    );
    const upn = textOf(firstMatch(el, ["[data-automation-key='upn']"]));
    const type = extractRole(
      el,
      textOf(firstMatch(el, [".ms-Persona-secondaryText", "[data-automation-key='type']"])),
    );

    const tag = (this.config.tag ?? "GCU_CON-3P").trim();
    const fingerprint = `${tag}|${name.toLowerCase()}|${email.toLowerCase()}|${upn.toLowerCase()}`;

    return {
      name,
      email,
      upn,
      type,
      tag,
      sourceUrl,
      fingerprint,
    };
  }
}
