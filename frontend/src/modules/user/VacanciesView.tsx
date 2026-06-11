import { Field, SectionHead } from "../../components/ui";
import type { Job, ResumeBase } from "../../types/domain";
import { JobsList } from "./JobsList";
import { shortText } from "../../utils/form";

type VacancyFilters = {
  title: string;
  minScore: string;
};

type VacanciesViewProps = {
  jobs: Job[];
  visibleJobs: Job[];
  selectedJob?: Job;
  selectedResumeBase?: ResumeBase;
  vacancyFilters: VacancyFilters;
  setVacancyFilters: (filters: VacancyFilters) => void;
  onSelectJob: (jobId: string) => void;
  onMark: (jobId: string, patch: { applied?: boolean; ignored?: boolean; status?: "REJECTED"; notes?: string }) => Promise<void>;
  onDownload: (filePath?: string) => Promise<void>;
  onAnalyzeMissing: () => void;
  onGenerateResume: (jobId: string) => void;
  onGenerateCoverLetter: (jobId: string) => void;
  onGeneratePackage: (jobId: string) => void;
};

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
          <div className="inline-actions">
            <button className="btn btn-primary" type="button" onClick={() => onGeneratePackage(job.id)}>Generate Package</button>
            <button className="btn btn-secondary" type="button" onClick={() => onGenerateResume(job.id)}>Resume</button>
            <button className="btn btn-secondary" type="button" onClick={() => onGenerateCoverLetter(job.id)}>Cover Letter</button>
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
  onGenerateResume,
  onGenerateCoverLetter,
  onGeneratePackage,
}: VacanciesViewProps) {
  const missingAnalysisCount = jobs.filter((job) => (job.userMatch?.matchScore ?? job.matchScore) == null).length;

  return (
    <section className="view is-active">
      <section className="surface">
        <SectionHead title="Found Vacancies" subtitle={`${visibleJobs.length} of ${jobs.length} user vacancies shown`} />
        <div className="filter-row">
          <Field label="Title / Company" value={vacancyFilters.title} onChange={(value) => setVacancyFilters({ ...vacancyFilters, title: value })} />
          <Field label="Minimum Match" value={vacancyFilters.minScore} onChange={(value) => setVacancyFilters({ ...vacancyFilters, minScore: value })} />
        </div>
        {missingAnalysisCount > 0 && (
          <div className="inline-actions">
            <button className="btn btn-primary" type="button" onClick={onAnalyzeMissing}>Analyze Missing ({missingAnalysisCount})</button>
          </div>
        )}
        <JobsList jobs={visibleJobs} onMark={onMark} onDownload={onDownload} onSelect={onSelectJob} />
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
