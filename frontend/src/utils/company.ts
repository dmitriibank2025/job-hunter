import type { BlacklistedCompany } from "../types/domain";

// Mirror of the backend normalization (search-preferences.service.ts) so the UI
// can tell whether a job's company is blacklisted.
export function normalizeCompanyName(value?: string | null): string {
  return (value ?? "")
    .replace(/\b(israel|ltd|limited|inc|corp|corporation|technologies|technology|staffing|recruiting|recruitment)\b/gi, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
}

export function buildBlockedSet(companies?: BlacklistedCompany[]): Set<string> {
  const set = new Set<string>();
  for (const c of companies ?? []) {
    const key = normalizeCompanyName(c.name);
    if (key) set.add(key);
  }
  return set;
}

// Containment match in either direction (same rule the backend filter uses):
// "Hire Feed" blocks "HireFeed Ltd." and "Hire Feed Global".
export function isBlockedCompany(company: string | null | undefined, blocked: Set<string>): boolean {
  if (!blocked.size) return false;
  const norm = normalizeCompanyName(company);
  if (!norm) return false;
  for (const entry of blocked) {
    if (norm.includes(entry) || entry.includes(norm)) return true;
  }
  return false;
}
