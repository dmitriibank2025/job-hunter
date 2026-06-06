import { downloadStorageFile } from "../../api/client";
import type { Job } from "../../types/domain";
import { shortText } from "../../utils/form";

function inferredPdfPath(filePath?: string, pdfFilePath?: string | null) {
  if (pdfFilePath) return pdfFilePath;
  if (!filePath || !/\.docx$/i.test(filePath)) return undefined;
  return filePath.replace(/\.docx$/i, ".pdf");
}

export function JobsList({ jobs, onMark, onDownload, onSelect }: { jobs: Job[]; onMark?: (jobId: string, patch: { applied?: boolean; ignored?: boolean }) => Promise<void>; onDownload?: (filePath?: string) => Promise<void>; onSelect?: (jobId: string) => void }) {
  if (!jobs.length) return <div className="empty">No jobs found.</div>;
  return <div className="jobs-list">{jobs.map((job) => {
    const score = job.userMatch?.matchScore ?? job.matchScore;
    const isApplied = Boolean(job.userMatch?.appliedAt);
    const isIgnored = Boolean(job.userMatch?.ignoredAt);
    const missingSkills = (job.userMatch?.analysis?.missingSkills || job.analysis?.missingSkills || []).slice(0, 8);
    const recommendation = job.userMatch?.analysis?.recommendation || job.analysis?.recommendation;
    const download = onDownload || downloadStorageFile;
    return (
      <article className={`job-row ${isApplied ? "is-applied" : ""} ${isIgnored ? "is-ignored" : ""}`} key={job.id}>
        <div className="job-main">
          <div className="job-title">{job.title || "Untitled job"}</div>
          <div className="job-meta">{[job.company || "Unknown company", job.location || "Unknown location", job.source || "UNKNOWN", isApplied ? "Applied" : isIgnored ? "Ignored" : ""].filter(Boolean).join(" | ")}</div>
          <div className="job-desc">{shortText(job.description || job.analysis?.reason || "")}</div>
          {score !== undefined && score < 70 && missingSkills.length > 0 && (
            <div className="missing-skills">
              <span>Missing skills</span>
              <div>{missingSkills.map((skill) => <b key={skill}>{skill}</b>)}</div>
            </div>
          )}
        </div>
        <div className="job-side">
          <div className={`job-score ${score !== undefined ? score >= 80 ? "is-high" : score >= 60 ? "is-mid" : "is-low" : ""}`}>
            <span>{score ?? "-"}</span>
            <small>{score === undefined ? "Not analyzed" : "Match"}{recommendation ? ` | ${recommendation}` : ""}</small>
          </div>
          <div className="job-actions">
            {onSelect && <button className="btn btn-primary" type="button" onClick={() => onSelect(job.id)}>Review</button>}
            {job.url && <a className="btn btn-secondary" href={job.url} target="_blank" rel="noreferrer">Open</a>}
            {(job.resumeVersions || []).map((resume, index) => {
              const pdfPath = inferredPdfPath(resume.filePath, resume.pdfFilePath);
              return (
                <span className="doc-link-set" key={resume.id || `${resume.filePath}-${index}`}>
                  {resume.filePath && <button className="btn btn-primary" type="button" onClick={() => void download(resume.filePath)}>DOCX {index + 1}</button>}
                  {pdfPath && <button className="btn btn-secondary" type="button" onClick={() => void download(pdfPath)}>PDF {index + 1}</button>}
                </span>
              );
            })}
            {(job.coverLetters || []).map((letter, index) => (
              letter.filePath && <button className="btn btn-secondary" type="button" onClick={() => void download(letter.filePath)} key={letter.id || `${letter.filePath}-${index}`}>Letter {index + 1}</button>
            ))}
            {onMark && <button className="btn btn-secondary" type="button" onClick={() => void onMark(job.id, { applied: !isApplied })}>{isApplied ? "Undo Applied" : "Applied"}</button>}
            {onMark && <button className="btn btn-secondary" type="button" onClick={() => void onMark(job.id, { ignored: !isIgnored })}>{isIgnored ? "Undo Ignore" : "Ignore"}</button>}
          </div>
        </div>
      </article>
    );
  })}</div>;
}
