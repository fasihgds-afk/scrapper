export type FieldSelector = {
  selector: string;
  attr?: "text" | "href" | "value" | string;
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
  scroll: {
    stepPx: number;
    delayMs: number;
    idleRounds: number;
  };
  batchSize?: number;
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
