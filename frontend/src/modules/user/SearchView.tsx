import { Field, SectionHead, TextArea } from "../../components/ui";
import type { ResumeBase } from "../../types/domain";
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
  manualJob: ManualJobDraft;
  persist: (settings: AppSettings) => void;
  setManualJob: (manualJob: ManualJobDraft) => void;
  onRunSearch: (sourceMode: string) => void;
  onExtractManualVacancy: () => void;
  onCreateManualVacancy: () => void;
};

export function SearchView({
  settings,
  selectedResumeBaseId,
  resumeBases,
  manualJob,
  persist,
  setManualJob,
  onRunSearch,
  onExtractManualVacancy,
  onCreateManualVacancy,
}: SearchViewProps) {
  return (
    <section className="view is-active">
      <div className="two-column">
        <section className="surface">
          <SectionHead title="Search Preferences" subtitle="Excluded keywords are sent to backend filtering." />
          <div className="search-explainer">
            <strong>LinkedIn search conditions</strong>
            <span>Default backend providers: LinkedIn, Greenhouse, Glassdoor unless source mode is Product Firms or Email Jobs.</span>
            <span>LinkedIn currently scans configured `LINKEDIN_SEARCH_URLS` and adds `f_TPR=r86400`, so results are limited to jobs posted in the last 24 hours.</span>
            <span>Before opening job details, LinkedIn prefilters titles by Full Stack, Backend, or Frontend. Then this form filters by role, location, required tech, excluded keywords, date range, and minimum match score.</span>
          </div>
          <label className="field"><span>Base Resume</span><select value={selectedResumeBaseId} onChange={(event) => persist({ ...settings, selectedResumeBaseId: event.target.value })}>
            <option value="">Select base resume</option>
            {resumeBases.map((resume) => <option value={resume.id} key={resume.id}>{resume.name}{resume.isDefault ? " (default)" : ""}</option>)}
          </select></label>
          <Field label="Target Roles" value={settings.targetRoles} onChange={(value) => persist({ ...settings, targetRoles: value })} />
          <Field label="Locations" value={settings.targetLocations} onChange={(value) => persist({ ...settings, targetLocations: value })} />
          <Field label="Required Technologies" value={settings.requiredTech} onChange={(value) => persist({ ...settings, requiredTech: value })} />
          <TextArea label="Excluded Keywords" rows={3} value={settings.excludedKeywords} onChange={(value) => persist({ ...settings, excludedKeywords: value })} />
          <div className="form-grid">
            <Field label="Date Range Days" value={settings.dateRangeDays} onChange={(value) => persist({ ...settings, dateRangeDays: value })} />
            <Field label="Minimum Match Score" value={settings.minMatchScore} onChange={(value) => persist({ ...settings, minMatchScore: value })} />
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
          <div className="inline-actions">
            <button className="btn btn-secondary" type="button" onClick={onExtractManualVacancy}>Extract from URL</button>
            <button className="btn btn-primary" type="button" onClick={onCreateManualVacancy}>Create Application Package</button>
          </div>
        </section>
      </div>
    </section>
  );
}
