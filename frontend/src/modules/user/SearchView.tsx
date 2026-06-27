import { useEffect, useMemo } from "react";
import { Field, SectionHead, TextArea } from "../../components/ui";
import type { ResumeBase, Technology } from "../../types/domain";
import type { AppSettings } from "../app/types";

type ManualJobDraft = {
  url: string;
  title: string;
  company: string;
  location: string;
  description: string;
};

type SearchViewProps = {
  settings: AppSettings;
  selectedResumeBaseId: string;
  resumeBases: ResumeBase[];
  catalog: Technology[];
  linkedinStatus: {
    connected: boolean;
    email?: string;
    profileUrl?: string;
    connectionStatus?: "PENDING" | "CONNECTED" | "FAILED";
    error?: string;
  };
  manualJob: ManualJobDraft;
  persist: (settings: AppSettings) => void;
  setManualJob: (manualJob: ManualJobDraft) => void;
  onConnectLinkedIn: () => void;
  onRefreshLinkedIn: () => void;
  onRunSearch: (sourceMode: string) => void;
  onExtractManualVacancy: () => void;
  onCreateManualVacancy: () => void;
};

const roleOptions = [
  "Frontend Developer",
  "Backend Developer",
  "Full Stack Developer",
  "Node.js Developer",
  "React Developer",
  "Software Engineer",
];

const locationOptions = [
  "Israel",
  "Tel Aviv",
  "Ramat Gan",
  "Herzliya",
  "Ra'anana",
  "Modiin-Maccabim-Reut",
  "Remote Israel",
  "Remote Europe",
  "Remote US",
];

const excludedKeywordOptions = [
  "PHP",
  "WordPress",
  "C#",
  ".NET",
  "Java",
  "unpaid internship",
  "student position",
  "on-site only",
  "security clearance",
];

const dateRangeOptions = [
  { label: "Last 24 hours", value: "1" },
  { label: "Last 3 days", value: "3" },
  { label: "Last 7 days", value: "7" },
  { label: "Last 14 days", value: "14" },
];

const matchScoreOptions = ["50", "60", "70", "80", "90"];

function splitSelected(value: string) {
  return new Set(value.split(/[\n,;]/).map((item) => item.trim()).filter(Boolean));
}

function selectedOptions(value: string, options: string[]) {
  const allowed = new Set(options);
  return Array.from(splitSelected(value)).filter((item) => allowed.has(item));
}

function sanitizeCsv(value: string, options: string[]) {
  return selectedOptions(value, options).join(", ");
}

function toggleCsv(value: string, option: string, selected: boolean, options: string[]) {
  const next = new Set(selectedOptions(value, options));
  if (selected) next.add(option);
  else next.delete(option);
  return Array.from(next).join(", ");
}

function OptionChips({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  const selected = new Set(selectedOptions(value, options));

  return (
    <div className="search-option-group">
      <strong>{label}</strong>
      <div>
        {options.map((option) => (
          <label className="tech-chip" key={option}>
            <input
              type="checkbox"
              checked={selected.has(option)}
              onChange={(event) => onChange(toggleCsv(value, option, event.target.checked, options))}
            />
            {option}
          </label>
        ))}
      </div>
    </div>
  );
}

function RoleResumeSelect({
  label,
  target,
  value,
  resumeBases,
  onChange,
}: {
  label: string;
  target: "FULLSTACK" | "BACKEND" | "FRONTEND";
  value: string;
  resumeBases: ResumeBase[];
  onChange: (value: string) => void;
}) {
  const matching = resumeBases.filter((resume) => resume.target === target);
  const fallback = resumeBases.filter((resume) => resume.target !== target);

  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Auto by target</option>
        {matching.map((resume) => <option value={resume.id} key={resume.id}>{resume.name}{resume.isDefault ? " (default)" : ""}</option>)}
        {fallback.length > 0 && <option disabled>──────────</option>}
        {fallback.map((resume) => <option value={resume.id} key={resume.id}>{resume.name} [{resume.target}]</option>)}
      </select>
    </label>
  );
}

export function SearchView({
  settings,
  selectedResumeBaseId,
  resumeBases,
  catalog,
  linkedinStatus,
  manualJob,
  persist,
  setManualJob,
  onConnectLinkedIn,
  onRefreshLinkedIn,
  onRunSearch,
  onExtractManualVacancy,
  onCreateManualVacancy,
}: SearchViewProps) {
  const technologyOptions = useMemo(
    () => catalog.length
      ? catalog.map((item) => item.name)
      : ["React", "TypeScript", "Node.js", "Express", "PostgreSQL", "Redis", "AWS"],
    [catalog],
  );
  const linkedinPending = linkedinStatus.connectionStatus === "PENDING";
  const linkedinConnected = linkedinStatus.connected;

  useEffect(() => {
    const targetRoles = sanitizeCsv(settings.targetRoles, roleOptions);
    const targetLocations = sanitizeCsv(settings.targetLocations, locationOptions);
    const requiredTech = catalog.length ? sanitizeCsv(settings.requiredTech, technologyOptions) : settings.requiredTech;
    const excludedKeywords = sanitizeCsv(settings.excludedKeywords, excludedKeywordOptions);

    if (
      targetRoles !== settings.targetRoles ||
      targetLocations !== settings.targetLocations ||
      requiredTech !== settings.requiredTech ||
      excludedKeywords !== settings.excludedKeywords
    ) {
      persist({
        ...settings,
        targetRoles,
        targetLocations,
        requiredTech,
        excludedKeywords,
        searchLocation: selectedOptions(targetLocations, locationOptions)[0] || settings.searchLocation,
      });
    }
  }, [settings, persist, technologyOptions]);

  return (
    <section className="view is-active">
      <div className="two-column">
        <section className="surface">
          <SectionHead title="Search Preferences" subtitle="Excluded keywords are sent to backend filtering." />
          <div className="search-explainer">
            <strong>LinkedIn search conditions</strong>
            <span>Default backend providers: LinkedIn, Greenhouse, Glassdoor unless source mode is Product Firms or Email Jobs.</span>
            <span>LinkedIn search URLs are built from the selected roles and locations, with results limited by the selected date range.</span>
            <span>Before opening job details, LinkedIn prefilters titles by selected engineering roles. Then backend filters by role, location, required tech, excluded keywords, date range, and minimum match score.</span>
          </div>
          <div className={`linkedin-search-panel ${linkedinConnected ? "is-connected" : linkedinPending ? "is-pending" : ""}`}>
            <div>
              <strong>{linkedinConnected ? "LinkedIn connected" : linkedinPending ? "LinkedIn login pending" : "Connect LinkedIn for search"}</strong>
              <span>{linkedinStatus.email || linkedinStatus.profileUrl || (linkedinPending ? "Finish login in the opened browser window." : "Use your LinkedIn session for provider search.")}</span>
              {linkedinStatus.error && <small>{linkedinStatus.error}</small>}
            </div>
            <div className="button-row">
              <button className="btn btn-secondary" type="button" onClick={onRefreshLinkedIn}>Refresh</button>
              {!linkedinConnected && <button className="btn btn-primary" type="button" onClick={onConnectLinkedIn}>{linkedinPending ? "Open Again" : "Connect"}</button>}
            </div>
          </div>
          <label className="field"><span>Fallback Base Resume</span><select value={selectedResumeBaseId} onChange={(event) => persist({ ...settings, selectedResumeBaseId: event.target.value })}>
            <option value="">Select base resume</option>
            {resumeBases.map((resume) => <option value={resume.id} key={resume.id}>{resume.name}{resume.isDefault ? " (default)" : ""}</option>)}
          </select></label>
          <div className="search-explainer">
            <strong>Automatic resume selection</strong>
            <span>Choose which base resume should be used for each vacancy type. If a field is left on Auto, backend uses the newest base resume with the matching target.</span>
          </div>
          <div className="form-grid">
            <RoleResumeSelect label="Full Stack Resume" target="FULLSTACK" value={settings.selectedFullstackResumeBaseId} resumeBases={resumeBases} onChange={(value) => persist({ ...settings, selectedFullstackResumeBaseId: value })} />
            <RoleResumeSelect label="Backend Resume" target="BACKEND" value={settings.selectedBackendResumeBaseId} resumeBases={resumeBases} onChange={(value) => persist({ ...settings, selectedBackendResumeBaseId: value })} />
            <RoleResumeSelect label="Frontend Resume" target="FRONTEND" value={settings.selectedFrontendResumeBaseId} resumeBases={resumeBases} onChange={(value) => persist({ ...settings, selectedFrontendResumeBaseId: value })} />
          </div>
          <OptionChips label="Target Roles" value={settings.targetRoles} options={roleOptions} onChange={(value) => persist({ ...settings, targetRoles: value })} />
          <OptionChips label="Locations" value={settings.targetLocations} options={locationOptions} onChange={(value) => persist({ ...settings, targetLocations: value, searchLocation: selectedOptions(value, locationOptions)[0] || settings.searchLocation })} />
          <OptionChips label="Required Technologies" value={settings.requiredTech} options={technologyOptions} onChange={(value) => persist({ ...settings, requiredTech: value })} />
          <OptionChips label="Excluded Keywords" value={settings.excludedKeywords} options={excludedKeywordOptions} onChange={(value) => persist({ ...settings, excludedKeywords: value })} />
          <div className="form-grid">
            <label className="field"><span>Date Range</span><select value={settings.dateRangeDays} onChange={(event) => persist({ ...settings, dateRangeDays: event.target.value })}>
              {dateRangeOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
            </select></label>
            <label className="field"><span>Minimum Match Score</span><select value={settings.minMatchScore} onChange={(event) => persist({ ...settings, minMatchScore: event.target.value })}>
              {matchScoreOptions.map((option) => <option value={option} key={option}>{option}%</option>)}
            </select></label>
          </div>
          <div className="inline-actions">
            <button className="btn btn-primary" onClick={() => onRunSearch("PROVIDERS")}>Providers</button>
            <button className="btn btn-secondary" onClick={() => onRunSearch("CENTER_ISRAEL")}>Product Firms</button>
            <button className="btn btn-secondary" onClick={() => onRunSearch("EMAIL")}>Email Jobs</button>
          </div>
        </section>
        <section className="surface">
          <SectionHead title="Manual Vacancy" subtitle="Paste a direct job URL, extract details, then generate a tailored application package." />
          <Field label="URL" value={manualJob.url} onChange={(value) => setManualJob({ ...manualJob, url: value })} />
          <div className="search-explainer">
            <strong>URL import</strong>
            <span>Use Extract from URL to fill title, company, location, and description automatically. If extraction is partial, keep the URL and paste the missing vacancy text below.</span>
          </div>
          <Field label="Title" value={manualJob.title} onChange={(value) => setManualJob({ ...manualJob, title: value })} />
          <Field label="Company" value={manualJob.company} onChange={(value) => setManualJob({ ...manualJob, company: value })} />
          <Field label="Location" value={manualJob.location} onChange={(value) => setManualJob({ ...manualJob, location: value })} />
          <label className="field"><span>Base Resume</span><select value={selectedResumeBaseId} onChange={(event) => persist({ ...settings, selectedResumeBaseId: event.target.value })}>
            <option value="">Select base resume</option>
            {resumeBases.map((resume) => <option value={resume.id} key={resume.id}>{resume.name}{resume.isDefault ? " (default)" : ""}</option>)}
          </select></label>
          <TextArea label="Vacancy Text" rows={8} value={manualJob.description} onChange={(value) => setManualJob({ ...manualJob, description: value })} />
          {manualJob.description.length > 0 && manualJob.description.length < 50 && (
            <p className="field-hint is-warn">Need at least 50 characters — currently {manualJob.description.length}.</p>
          )}
          {manualJob.description.length >= 50 && (
            <p className="field-hint is-ok">Vacancy text ready ({manualJob.description.length} chars).</p>
          )}
          <div className="inline-actions">
            <button className="btn btn-secondary" type="button" onClick={onExtractManualVacancy} disabled={!manualJob.url.trim()}>Extract from URL</button>
            <button
              className="btn btn-primary"
              type="button"
              onClick={onCreateManualVacancy}
              disabled={!manualJob.url.trim() && manualJob.description.trim().length < 50}
            >
              Create Application Package
            </button>
          </div>
        </section>
      </div>
    </section>
  );
}
