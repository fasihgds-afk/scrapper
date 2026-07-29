import { GenericTableAdapter } from "./generic-table";
import type { SiteAdapter, SiteConfig } from "./types";
import defaultSite from "../config/sites/default.site.json";
import quotesSite from "../config/sites/quotes.site.json";

const configs: Record<string, SiteConfig> = {
  default: defaultSite as SiteConfig,
  quotes: quotesSite as SiteConfig,
};

export function registerSiteConfig(config: SiteConfig): void {
  configs[config.siteKey] = config;
}

export function getSiteConfig(siteKey = "default"): SiteConfig {
  return configs[siteKey] ?? configs.default;
}

export function createAdapter(siteKey = "default"): SiteAdapter {
  return new GenericTableAdapter(getSiteConfig(siteKey));
}

export function resolveAdapterForUrl(url: string, preferredKey?: string): SiteAdapter {
  if (preferredKey && configs[preferredKey]) {
    return createAdapter(preferredKey);
  }

  // Prefer specific host matches over catch-all default
  const specific = Object.values(configs).filter(
    (c) => c.siteKey !== "default" && c.match.some((m) => urlMatches(url, m)),
  );
  if (specific.length > 0) {
    return new GenericTableAdapter(specific[0]);
  }

  return createAdapter("default");
}

function urlMatches(url: string, pattern: string): boolean {
  try {
    if (pattern === "*://*/*") return false; // catch-all handled separately
    // Convert simple chrome-style patterns to regex
    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`, "i").test(url);
  } catch {
    return url.includes("quotes.toscrape.com");
  }
}
