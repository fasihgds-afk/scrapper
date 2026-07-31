export type FieldSelector = {
  selector: string;
  attr?: "text" | "href" | "value" | string;
};

export type UiGuardConfig = {
  loadingSelectors?: string[];
  errorSelectors?: string[];
  throttleTextPatterns?: string[];
};

export type ScrollConfig = {
  stepPx: number;
  delayMs: number;
  idleRounds: number;
  /** Optional range — when set, each tick picks a random delay in [min, max] */
  delayMsMin?: number;
  delayMsMax?: number;
  /** Optional range — when set, each tick picks a random step in [min, max] */
  stepPxMin?: number;
  stepPxMax?: number;
  /** Extra bottom-jump cycles before marking the list stalled/complete */
  stallRetries?: number;
};

export type SiteConfig = {
  siteKey: string;
  match: string[];
  scrollContainer: string;
  rowSelector: string;
  fields: {
    name: FieldSelector;
    email: FieldSelector;
    upn: FieldSelector;
    type: FieldSelector;
  };
  fingerprint: Array<"name" | "email" | "upn" | "type">;
  scroll: ScrollConfig;
  batchSize?: number;
  /** Re-read all visible rows after each scroll (needed for virtualized Fluent lists) */
  rescanOnScroll?: boolean;
  /** Pause scrolling when loading spinners / throttle banners appear */
  uiGuard?: UiGuardConfig;
};

export type ExtractedRecord = {
  name: string;
  email: string;
  upn: string;
  type: string;
  sourceUrl: string;
  fingerprint: string;
};

export interface SiteAdapter {
  config: SiteConfig;
  getRows(root?: ParentNode): Element[];
  extractRow(el: Element, sourceUrl: string): ExtractedRecord | null;
  getScrollTarget(): Element | Window;
}
