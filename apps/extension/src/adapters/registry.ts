import { GenericTableAdapter } from "./generic-table";
import type { SiteAdapter, SiteConfig } from "./types";
import defaultSite from "../config/sites/default.site.json";
import quotesSite from "../config/sites/quotes.site.json";
import waldenSite from "../config/sites/walden.site.json";

const configs: Record<string, SiteConfig> = {
  default: defaultSite as SiteConfig,
  quotes: quotesSite as SiteConfig,
  walden: waldenSite as SiteConfig,
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

  const specific = Object.values(configs).filter(
    (c) => c.siteKey !== "default" && c.siteKey !== "walden" && c.match.some((m) => urlMatches(url, m)),
  );
  if (specific.length > 0) {
    return new GenericTableAdapter(specific[0]);
  }

  return createAdapter("default");
}

function urlMatches(url: string, pattern: string): boolean {
  try {
    if (pattern === "*://*/*") return false;
    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`, "i").test(url);
  } catch {
    return false;
  }
}
