import { Metric, SectionHead } from "../../components/ui";
import type { Job, View, WorkspaceUser } from "../../types/domain";
import { JobsList } from "./JobsList";
import type { AppSettings, JobStatistics } from "../app/types";

type OverviewViewProps = {
  user: WorkspaceUser | null;
  jobs: Job[];
  generatedCount: number;
  companiesCount: number;
  settings: AppSettings;
  statistics: JobStatistics | null;
  lowMatchMissingSkills: Array<[string, number]>;
  status: string;
  onLoginClick: () => void;
  onNavigate: (view: View) => void;
  onRunSearch: () => void;
  onAnalyzeMissing: () => void;
  onMark: (jobId: string, patch: { applied?: boolean; ignored?: boolean; status?: "REJECTED"; notes?: string; rejectionReason?: string }) => Promise<void>;
  onDownload: (filePath?: string) => Promise<void>;
};

function hasProfile(user: WorkspaceUser) {
  return Boolean(user.profile?.fullName && user.profile?.email);
}

function hasResume(user: WorkspaceUser) {
  return Boolean(user.resumeBases?.length);
}

function analyzedJobs(jobs: Job[]) {
  return jobs.filter((job) => (job.userMatch?.matchScore ?? job.matchScore) != null).length;
}

function bestJobs(jobs: Job[]) {
  return jobs
    .filter((job) => (job.userMatch?.ignoredAt == null) && (job.userMatch?.appliedAt == null))
    .sort((a, b) => ((b.userMatch?.matchScore ?? b.matchScore ?? -1) - (a.userMatch?.matchScore ?? a.matchScore ?? -1)))
    .slice(0, 3);
}

export function OverviewView({
  user,
  jobs,
  generatedCount,
  companiesCount,
  settings,
  statistics,
  lowMatchMissingSkills,
  status,
  onLoginClick,
  onNavigate,
  onRunSearch,
  onAnalyzeMissing,
  onMark,
  onDownload,
}: OverviewViewProps) {
  const missingAnalysisCount = jobs.filter((job) => (job.userMatch?.matchScore ?? job.matchScore) == null).length;
  const topJobs = bestJobs(jobs);
  const generatedJobs = jobs.filter((job) => (job.resumeVersions?.length || 0) + (job.coverLetters?.length || 0) > 0).length;
  const appliedJobs = jobs.filter((job) => job.userMatch?.appliedAt).length;
  const responses = (statistics?.positive ?? 0) + (statistics?.negative ?? 0);
  const sentApplications = statistics?.sent ?? appliedJobs;
  const trackedApplications = statistics?.tracked ?? 0;

  return (
    <section className="view is-active">
      {!user ? (
        <section className="signin-gate">
          <div>
            <p className="eyebrow">Private workspace</p>
            <h1>Sign in to view vacancies and generated documents</h1>
            <p>Vacancies, resumes, cover letters, application history, and email tracking are scoped to the logged-in user only.</p>
          </div>
          <button className="btn btn-primary" type="button" onClick={onLoginClick}>Login / Register</button>
        </section>
      ) : (
        <>
          <section className="surface cockpit">
            <div className="section-head">
              <div>
                <h2>Job Search Cockpit</h2>
                <p>{status || "Follow the next step to move from profile setup to targeted applications."}</p>
              </div>
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => {
                  if (!hasProfile(user) || !hasResume(user)) onNavigate("account");
                  else if (!jobs.length) onRunSearch();
                  else onNavigate("vacancies");
                }}
              >
                {!hasProfile(user) ? "Complete Profile" : !hasResume(user) ? "Create Resume" : !jobs.length ? "Run Search" : "Review Matches"}
              </button>
            </div>
            <div className="flow-steps">
              {[
                ["Profile", hasProfile(user), "Contact, links, skills, history"],
                ["Base Resume", hasResume(user), "Reusable resume source and PDF"],
                ["Vacancies", jobs.length > 0, `${jobs.length} collected`],
                ["Match Review", analyzedJobs(jobs) > 0, `${analyzedJobs(jobs)} analyzed`],
                ["Applications", sentApplications > 0, `${sentApplications} sent`],
              ].map(([label, done, detail]) => (
                <button
                  className={`flow-step ${done ? "is-done" : ""}`}
                  key={String(label)}
                  type="button"
                  onClick={() => {
                    if (label === "Profile" || label === "Base Resume") onNavigate("account");
                    else if (label === "Vacancies" || label === "Match Review") onNavigate("vacancies");
                    else onNavigate("documents");
                  }}
                >
                  <span>{done ? "Done" : "Next"}</span>
                  <strong>{label}</strong>
                  <small>{detail}</small>
                </button>
              ))}
            </div>
          </section>
          <div className="metric-grid">
            <Metric label="Jobs" value={jobs.length} />
            <Metric label="Generated" value={generatedCount} />
            <Metric label="Companies" value={companiesCount} />
            <Metric label="Plan" value={user.plan || settings.accountPlan} />
          </div>
          <section className="surface">
            <SectionHead title="Application Statistics" subtitle="Sent = manual applied marks or submitted applications. Tracked = email-synced vacancies. Rejections = from email + manual marks." />
            <div className="pipeline-funnel">
              {[
                ["Found", jobs.length],
                ["Analyzed", analyzedJobs(jobs)],
                ["Generated", generatedJobs],
                ["Applied", sentApplications],
                ["Tracked", trackedApplications],
                ["Responses", responses],
              ].map(([label, value], index) => (
                <button className="funnel-step" type="button" key={label} onClick={() => onNavigate(index >= 2 ? "documents" : "vacancies")}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </button>
              ))}
            </div>
            <div className="stats-layout">
              {[
                ["Sent", statistics?.sent ?? 0, "sent"],
                ["Positive", statistics?.positive ?? 0, "positive"],
                ["Rejections", statistics?.negative ?? 0, "negative"],
                ["No response", statistics?.noResponse ?? 0, "silent"],
                ["Pending", statistics?.pendingFeedback ?? 0, "silent"],
                ["Tracked total", statistics?.rejectionRecords ?? 0, "silent"],
              ].map(([label, value, tone]) => {
                const max = Math.max(statistics?.sent ?? 0, statistics?.positive ?? 0, statistics?.negative ?? 0, statistics?.noResponse ?? 0, statistics?.pendingFeedback ?? 0, 1);
                return (
                  <div className={`bar-stat is-${tone}`} key={label}>
                    <div><span>{label}</span><strong>{value}</strong></div>
                    <i style={{ height: `${Math.max(10, (Number(value) / max) * 100)}%` }} />
                  </div>
                );
              })}
            </div>
          </section>
          <section className="surface">
            <SectionHead title="Apply Pipeline" subtitle="Highest match vacancies that still need a decision." />
            {topJobs.length ? (
              <>
                <JobsList jobs={topJobs} onMark={onMark} onDownload={onDownload} />
                <div className="inline-actions">
                  {missingAnalysisCount > 0 && <button className="btn btn-secondary" type="button" onClick={onAnalyzeMissing}>Analyze Missing ({missingAnalysisCount})</button>}
                  <button className="btn btn-primary" type="button" onClick={() => onNavigate("vacancies")}>Open All Vacancies</button>
                </div>
              </>
            ) : (
              <div className="empty">No open matches yet. Run a search or add a manual vacancy to start the application pipeline.</div>
            )}
          </section>
          {lowMatchMissingSkills.length > 0 && (
            <section className="surface">
              <SectionHead title="Missing Skills" subtitle="Aggregated from low-match vacancies, highest frequency first." />
              <div className="skill-rank-list">
                {lowMatchMissingSkills.map(([skill, count]) => <span key={skill}><b>{skill}</b><small>{count}</small></span>)}
              </div>
            </section>
          )}
          <section className="surface">
            <SectionHead title="Status" subtitle={status} />
            <JobsList jobs={jobs.slice(0, 8)} onMark={onMark} onDownload={onDownload} />
          </section>
        </>
      )}
    </section>
  );
}
