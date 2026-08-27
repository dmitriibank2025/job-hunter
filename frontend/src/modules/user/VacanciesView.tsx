import { Field, SectionHead } from "../../components/ui";
import type { Job, ResumeBase } from "../../types/domain";
import { JobsList } from "./JobsList";
import { shortText } from "../../utils/form";
import { isBlockedCompany } from "../../utils/company";

type VacancyFilters = {
  title: string;
  minScore: string;
  status: string;
  dateRange: string;
  sortBy: string;
};

type VacanciesViewProps = {
  jobs: Job[];
  visibleJobs: Job[];
  selectedJob?: Job;
  selectedResumeBase?: ResumeBase;
  vacancyFilters: VacancyFilters;
  setVacancyFilters: (filters: VacancyFilters) => void;
  onSelectJob: (jobId: string) => void;
  onMark: (jobId: string, patch: { applied?: boolean; ignored?: boolean; status?: "REJECTED"; notes?: string; rejectionReason?: string }) => Promise<void>;
  onDownload: (filePath?: string) => Promise<void>;
  onAnalyzeMissing: () => void;
  onGenerateMissingResumes: () => void;
  onGenerateResume: (jobId: string) => void;
  onGenerateCoverLetter: (jobId: string) => void;
  onGeneratePackage: (jobId: string) => void;
  onBlockCompany: (company: string) => void;
  blockedSet: Set<string>;
};

const DATE_RANGE_OPTIONS = [
  { label: "Any date", value: "ALL" },
  { label: "Last 24 hours", value: "1" },
  { label: "Last 3 days", value: "3" },
  { label: "Last 7 days", value: "7" },
  { label: "Last 14 days", value: "14" },
  { label: "Last 30 days", value: "30" },
];

const SORT_OPTIONS = [
  { label: "Best match (default)", value: "relevance" },
  { label: "Newest first", value: "newest" },
  { label: "Oldest first", value: "oldest" },
  { label: "Match score", value: "score" },
  { label: "Resume ATS score", value: "ats" },
  { label: "Company A–Z", value: "company" },
];

function JobMatchDetail({
  job,
  selectedResumeBase,
  onDownload,
  onGenerateResume,
  onGenerateCoverLetter,
  onGeneratePackage,
}: {
  job?: Job;
  selectedResumeBase?: ResumeBase;
  onDownload: (filePath?: string) => Promise<void>;
  onGenerateResume: (jobId: string) => void;
  onGenerateCoverLetter: (jobId: string) => void;
  onGeneratePackage: (jobId: string) => void;
}) {
  if (!job) return <div className="empty">Select a vacancy to review the resume match.</div>;

  const score = job.userMatch?.matchScore ?? job.matchScore;
  const analysis = job.userMatch?.analysis || job.analysis;
  const matchedSkills = analysis?.matchedSkills || [];
  const missingSkills = analysis?.missingSkills || [];
  const latestResume = job.resumeVersions?.[0];
  const latestLetter = job.coverLetters?.[0];

  return (
    <section className="surface match-workspace">
      <SectionHead title="Resume-to-Job Match" subtitle={`${job.company || "Company"} | ${job.title || "Untitled job"}`} />
      <div className="match-layout">
        <div className="match-panel">
          <div className={`job-score match-score ${score !== undefined ? score >= 80 ? "is-high" : score >= 60 ? "is-mid" : "is-low" : ""}`}>
            <span>{score ?? "-"}</span>
            <small>{score === undefined ? "Not analyzed yet" : `Match | ${analysis?.recommendation || "Review"}`}</small>
          </div>
          {analysis?.reason && <p className="match-reason">{analysis.reason}</p>}
          <div className="keyword-panel">
            <strong>Matched Skills</strong>
            <div>{matchedSkills.length ? matchedSkills.map((skill) => <span className="keyword-chip is-matched" key={skill}>{skill}</span>) : <small>No matched skills recorded.</small>}</div>
          </div>
          <div className="keyword-panel">
            <strong>Missing Skills</strong>
            <div>{missingSkills.length ? missingSkills.map((skill) => <span className="keyword-chip" key={skill}>{skill}</span>) : <small>No missing skills recorded.</small>}</div>
          </div>
          {analysis?.recommendation === "SKIP" && (
            <div className="match-warning">
              ⚠️ Score too low or wrong stack — generating a resume for this job is not recommended.
            </div>
          )}
          {score !== undefined && score < 70 && analysis?.recommendation !== "APPLY" && (
            <div className="match-warning">
              ⚠️ Match score below 70 — resume generation may not be effective for this vacancy.
            </div>
          )}
          <div className="inline-actions">
            <button className="btn btn-primary" type="button" onClick={() => onGeneratePackage(job.id)}>Generate Package</button>
            <button className="btn btn-secondary" type="button" onClick={() => onGenerateResume(job.id)}>{latestResume ? "Rebuild Resume" : "Generate Resume"}</button>
            <button className="btn btn-secondary" type="button" onClick={() => onGenerateCoverLetter(job.id)}>{latestLetter ? "Rebuild Cover Letter" : "Generate Cover Letter"}</button>
          </div>
          <div className="inline-actions">
            {latestResume?.filePath && <button className="btn btn-primary" type="button" onClick={() => void onDownload(latestResume.filePath)}>Download Resume</button>}
            {latestLetter?.filePath && <button className="btn btn-secondary" type="button" onClick={() => void onDownload(latestLetter.filePath)}>Download Letter</button>}
            {job.url && <a className="btn btn-secondary" href={job.url} target="_blank" rel="noreferrer">Open Job</a>}
          </div>
        </div>
        <div className="match-copy">
          <div>
            <strong>Job Description</strong>
            <p>{job.description || "No description saved."}</p>
          </div>
          <div>
            <strong>Selected Base Resume</strong>
            <p>{selectedResumeBase?.content ? shortText(selectedResumeBase.content, 1400) : "Select or create a base resume before generating tailored documents."}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

export function VacanciesView({
  jobs,
  visibleJobs,
  selectedJob,
  selectedResumeBase,
  vacancyFilters,
  setVacancyFilters,
  onSelectJob,
  onMark,
  onDownload,
  onAnalyzeMissing,
  onGenerateMissingResumes,
  onGenerateResume,
  onGenerateCoverLetter,
  onGeneratePackage,
  onBlockCompany,
  blockedSet,
}: VacanciesViewProps) {
  const missingAnalysisCount = jobs.filter((job) => (job.userMatch?.matchScore ?? job.matchScore) == null).length;
  const missingResumeCount = visibleJobs.filter((job) => !job.resumeVersions?.length).length;

  const counts = jobs.reduce(
    (acc, job) => {
      const applied = Boolean(job.userMatch?.appliedAt) || job.userMatch?.status === "APPLIED";
      const rejected = job.userMatch?.status === "REJECTED";
      const ignored = Boolean(job.userMatch?.ignoredAt) || job.userMatch?.status === "IGNORED";
      const blocked = isBlockedCompany(job.company, blockedSet);
      if (applied) acc.applied++;
      else if (rejected) acc.rejected++;
      else if (ignored) acc.ignored++;
      else if (blocked) acc.blocked++;
      else acc.active++;
      return acc;
    },
    { active: 0, applied: 0, rejected: 0, ignored: 0, blocked: 0 },
  );

  const statusChips: Array<{ key: string; label: string; count: number; cls: string }> = [
    { key: "ALL", label: "All", count: jobs.length, cls: "" },
    { key: "ACTIVE", label: "Active", count: counts.active, cls: "is-active" },
    { key: "APPLIED", label: "Applied", count: counts.applied, cls: "is-applied" },
    { key: "REJECTED", label: "Rejected", count: counts.rejected, cls: "is-rejected" },
    { key: "IGNORED", label: "Ignored", count: counts.ignored, cls: "is-ignored" },
    { key: "BLOCKED", label: "Blocked", count: counts.blocked, cls: "is-blocked" },
  ];

  return (
    <section className="view is-active">
      <section className="surface">
        <SectionHead
          title="Found Vacancies"
          subtitle={`All vacancies collected for your account (providers, email, manual). Showing ${visibleJobs.length} of ${jobs.length}.`}
        />

        <div className="vacancy-status-bar">
          {statusChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className={`status-pill ${chip.cls} ${vacancyFilters.status === chip.key ? "is-selected" : ""}`}
              onClick={() => setVacancyFilters({ ...vacancyFilters, status: chip.key })}
            >
              <b>{chip.count}</b>
              <span>{chip.label}</span>
            </button>
          ))}
        </div>

        <div className="filter-row">
          <Field label="Title / Company" value={vacancyFilters.title} onChange={(value) => setVacancyFilters({ ...vacancyFilters, title: value })} />
          <label className="field">
            <span>Added / posted</span>
            <select value={vacancyFilters.dateRange} onChange={(event) => setVacancyFilters({ ...vacancyFilters, dateRange: event.target.value })}>
              {DATE_RANGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Sort by</span>
            <select value={vacancyFilters.sortBy} onChange={(event) => setVacancyFilters({ ...vacancyFilters, sortBy: event.target.value })}>
              {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <Field label="Minimum Match" value={vacancyFilters.minScore} onChange={(value) => setVacancyFilters({ ...vacancyFilters, minScore: value })} />
        </div>
        {missingAnalysisCount > 0 && (
          <div className="inline-actions">
            <button className="btn btn-primary" type="button" onClick={onAnalyzeMissing}>Analyze Missing ({missingAnalysisCount})</button>
          </div>
        )}
        {missingResumeCount > 0 && (
          <div className="inline-actions">
            <button className="btn btn-primary" type="button" onClick={onGenerateMissingResumes}>Generate Missing Resumes ({missingResumeCount})</button>
          </div>
        )}
        <JobsList
          jobs={visibleJobs}
          onMark={onMark}
          onDownload={onDownload}
          onSelect={onSelectJob}
          onGenerateResume={onGenerateResume}
          onGenerateCoverLetter={onGenerateCoverLetter}
          onGeneratePackage={onGeneratePackage}
          onBlockCompany={onBlockCompany}
          blockedSet={blockedSet}
        />
      </section>
      <JobMatchDetail
        job={selectedJob}
        selectedResumeBase={selectedResumeBase}
        onDownload={onDownload}
        onGenerateResume={onGenerateResume}
        onGenerateCoverLetter={onGenerateCoverLetter}
        onGeneratePackage={onGeneratePackage}
      />
    </section>
  );
}
