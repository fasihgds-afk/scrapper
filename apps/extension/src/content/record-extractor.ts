import type { SiteAdapter } from "../adapters/types";
import type { ExtractedRecord } from "../adapters/types";

export class RecordExtractor {
  constructor(private adapter: SiteAdapter) {}

  extractAll(sourceUrl: string): ExtractedRecord[] {
    const rows = this.adapter.getRows();
    const out: ExtractedRecord[] = [];
    for (const row of rows) {
      const record = this.adapter.extractRow(row, sourceUrl);
      if (record) out.push(record);
    }
    return out;
  }

  extractFromNodes(nodes: Node[], sourceUrl: string): ExtractedRecord[] {
    const out: ExtractedRecord[] = [];
    for (const node of nodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches(this.adapter.config.rowSelector)) {
        const record = this.adapter.extractRow(node, sourceUrl);
        if (record) out.push(record);
        continue;
      }
      for (const row of node.querySelectorAll(this.adapter.config.rowSelector)) {
        const record = this.adapter.extractRow(row, sourceUrl);
        if (record) out.push(record);
      }
    }
    return out;
  }
}
