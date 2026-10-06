import { useMemo, useState } from "react";
import { SectionHead } from "../../components/ui";
import type { BlacklistedCompany } from "../../types/domain";

type CompaniesViewProps = {
  companies: any[];
  blacklistedCompanies: BlacklistedCompany[];
  onBlockCompany: (name: string) => void;
  onUnblockCompany: (companyId: string) => void;
};

// Mirror of the backend normalization (search-preferences.service.ts) so the UI
// can tell whether a priority company is already blocked.
function normalizeCompanyName(value?: string | null): string {
  return (value ?? "")
    .replace(/\b(israel|ltd|limited|inc|corp|corporation|technologies|technology|staffing|recruiting|recruitment)\b/gi, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
}

function formatDate(value?: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-GB").format(new Date(value));
}

export function CompaniesView({
  companies,
  blacklistedCompanies,
  onBlockCompany,
  onUnblockCompany,
}: CompaniesViewProps) {
  const [newBlacklistCompany, setNewBlacklistCompany] = useState("");

  // Map normalized name → blacklist entry, so a priority card can show its
  // blocked state and offer Unblock instead of Block.
  const blockedByNormalized = useMemo(() => {
    const map = new Map<string, BlacklistedCompany>();
    for (const entry of blacklistedCompanies) {
      const key = normalizeCompanyName(entry.name);
      if (key) map.set(key, entry);
    }
    return map;
  }, [blacklistedCompanies]);

  function submitBlacklistCompany() {
    const trimmed = newBlacklistCompany.trim();
    if (!trimmed) return;
    onBlockCompany(trimmed);
    setNewBlacklistCompany("");
  }

  return (
    <section className="view is-active">
      <section className="surface">
        <SectionHead
          title="Blocked Companies"
          subtitle="Vacancies from these companies are never collected, analyzed, or turned into resumes — in both the daily automation and manual searches."
        />

        <div className="blacklist-input-row">
          <input
            type="text"
            placeholder="Company name to block (e.g. Hired, Hire Feed, Quik Hire Staffing)"
            value={newBlacklistCompany}
            onChange={(event) => setNewBlacklistCompany(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitBlacklistCompany();
              }
            }}
          />
          <button className="btn btn-primary" type="button" onClick={submitBlacklistCompany} disabled={!newBlacklistCompany.trim()}>
            Block company
          </button>
        </div>

        <div className="company-grid">
          {blacklistedCompanies.length ? blacklistedCompanies.map((company) => (
            <article className="company-card is-blocked" key={company.id}>
              <strong>{company.name}</strong>
              <span>Blocked{company.createdAt ? ` | ${formatDate(company.createdAt)}` : ""}</span>
              <div className="company-card-actions">
                <span className="badge is-blocked">Blocked</span>
                <button className="btn btn-secondary" type="button" onClick={() => onUnblockCompany(company.id)}>
                  Unblock
                </button>
              </div>
            </article>
          )) : <div className="empty">No blocked companies yet.</div>}
        </div>
      </section>

      <section className="surface">
        <SectionHead title="Company Priority" subtitle="Active company targets promoted by provider results. Block the ones you no longer want." />
        <div className="company-grid">
          {companies.map((company, index) => {
            const blockedEntry = blockedByNormalized.get(normalizeCompanyName(company.name));
            const isBlocked = Boolean(blockedEntry);
            return (
              <article className={`company-card ${isBlocked ? "is-blocked" : company.active ? "is-active" : ""}`} key={`${company.name}-${index}`}>
                <strong>{index + 1}. {company.name}</strong>
                <span>{company.locationHint || "Israel"} | priority {company.priority ?? "-"}</span>
                <span>{isBlocked ? "Blocked" : company.active ? "Active" : "Cooling down"}</span>
                <div className="company-card-actions">
                  {isBlocked ? (
                    <>
                      <span className="badge is-blocked">Blocked</span>
                      <button className="btn btn-secondary" type="button" onClick={() => onUnblockCompany(blockedEntry!.id)}>
                        Unblock
                      </button>
                    </>
                  ) : (
                    <button className="btn btn-danger" type="button" onClick={() => onBlockCompany(company.name)}>
                      Block
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </section>
  );
}
