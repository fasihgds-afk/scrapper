import { GenericTableAdapter } from "./generic-table";
import { OutlookGroupMembersAdapter } from "./outlook-members";
import type { SiteAdapter, SiteConfig } from "./types";
import defaultSite from "../config/sites/default.site.json";
import quotesSite from "../config/sites/quotes.site.json";
import waldenSite from "../config/sites/walden.site.json";
import gcuCon3pSite from "../config/sites/gcu-con-3p.site.json";

const configs: Record<string, SiteConfig> = {
  default: defaultSite as SiteConfig,
  quotes: quotesSite as SiteConfig,
  walden: waldenSite as SiteConfig,
  gcu_con_3p: gcuCon3pSite as SiteConfig,
};

export function registerSiteConfig(config: SiteConfig): void {
  configs[config.siteKey] = config;
}

export function getSiteConfig(siteKey = "default"): SiteConfig {
  return configs[siteKey] ?? configs.default;
}

export function createAdapter(siteKey = "default"): SiteAdapter {
  const config = getSiteConfig(siteKey);
  if (config.siteKey === "gcu_con_3p") {
    return new OutlookGroupMembersAdapter(config);
  }
  return new GenericTableAdapter(config);
}

export function resolveAdapterForUrl(url: string, preferredKey?: string): SiteAdapter {
  if (preferredKey && configs[preferredKey]) {
    return createAdapter(preferredKey);
  }

  const specific = Object.values(configs).filter(
    (c) =>
      c.siteKey !== "default" &&
      c.siteKey !== "walden" &&
      c.siteKey !== "gcu_con_3p" &&
      c.match.some((m) => urlMatches(url, m)),
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
