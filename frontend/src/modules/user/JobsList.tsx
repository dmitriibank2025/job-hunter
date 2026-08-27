import { useState } from "react";
import { downloadStorageFile } from "../../api/client";
import type { Job } from "../../types/domain";
import { shortText } from "../../utils/form";
import { isBlockedCompany } from "../../utils/company";
import { REJECTION_REASONS } from "../app/types";

function inferredPdfPath(filePath?: string, pdfFilePath?: string | null) {
  if (pdfFilePath) return pdfFilePath;
  if (!filePath || !/\.docx$/i.test(filePath)) return undefined;
  return filePath.replace(/\.docx$/i, ".pdf");
}

function atsClass(score?: number | null) {
  if (score == null) return "";
  if (score >= 85) return "is-high";
  if (score >= 75) return "is-mid";
  return "is-low";
}

function formatDate(value?: string) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(d);
}

const REJECTION_LABEL = new Map<string, string>(REJECTION_REASONS.map((r) => [r.value, r.label]));

function bestAtsScore(job: Job): number | null {
  const scores = (job.resumeVersions || []).map((rv) => rv.atsScore).filter((v): v is number => typeof v === "number");
  return scores.length ? Math.max(...scores) : null;
}

export function JobsList({
  jobs,
  onMark,
  onDownload,
  onSelect,
  onGenerateResume,
  onGenerateCoverLetter,
  onGeneratePackage,
  onBlockCompany,
  blockedSet,
}: {
  jobs: Job[];
  onMark?: (jobId: string, patch: { applied?: boolean; ignored?: boolean; status?: "REJECTED"; notes?: string; rejectionReason?: string }) => Promise<void>;
  onDownload?: (filePath?: string) => Promise<void>;
  onSelect?: (jobId: string) => void;
  onGenerateResume?: (jobId: string) => void;
  onGenerateCoverLetter?: (jobId: string) => void;
  onGeneratePackage?: (jobId: string) => void;
  onBlockCompany?: (company: string) => void;
  blockedSet?: Set<string>;
}) {
  const [rejectingJobId, setRejectingJobId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("OTHER");

  if (!jobs.length) return <div className="empty">No jobs found.</div>;
  return <div className="jobs-list">{jobs.map((job) => {
    const score = job.userMatch?.matchScore ?? job.matchScore;
    const isApplied = Boolean(job.userMatch?.appliedAt) || job.userMatch?.status === "APPLIED";
    const isIgnored = Boolean(job.userMatch?.ignoredAt) || job.userMatch?.status === "IGNORED";
    const isRejected = job.userMatch?.status === "REJECTED";
    const isBlocked = isBlockedCompany(job.company, blockedSet ?? new Set());
    const hasResume = Boolean(job.resumeVersions?.length);
    const hasLetter = Boolean(job.coverLetters?.length);
    const missingSkills = (job.userMatch?.analysis?.missingSkills || job.analysis?.missingSkills || []).slice(0, 8);
    const recommendation = job.userMatch?.analysis?.recommendation || job.analysis?.recommendation;
    const download = onDownload || downloadStorageFile;
    const postedAt = formatDate(job.postedAt);
    const addedAt = formatDate(job.createdAt);
    const ats = bestAtsScore(job);
    const rejectionReason = job.userMatch?.rejectionReason;
    const statusBadge = isRejected
      ? { label: "Rejected", cls: "is-rejected" }
      : isApplied
        ? { label: "Applied", cls: "is-applied" }
        : isIgnored
          ? { label: "Ignored", cls: "is-ignored" }
          : { label: "Active", cls: "is-active" };
    return (
      <article className={`job-row ${isApplied ? "is-applied" : ""} ${isIgnored ? "is-ignored" : ""} ${isRejected ? "is-rejected-row" : ""} ${isBlocked ? "is-blocked-row" : ""}`} key={job.id}>
        <div className="job-main">
          <div className="job-title">{job.title || "Untitled job"}</div>
          <div className="job-meta">{[job.company || "Unknown company", job.location || "Unknown location"].filter(Boolean).join("  ·  ")}</div>
          <div className="job-tags">
            <span className={`badge ${statusBadge.cls}`}>{statusBadge.label}</span>
            {isBlocked && <span className="badge is-blocked">Blocked company</span>}
            {job.source && <span className="tag tag-source">{job.source}</span>}
            {ats != null && <span className={`tag tag-ats ${atsClass(ats)}`}>ATS {ats}</span>}
            {postedAt && <span className="tag tag-date" title="Posted">📅 {postedAt}</span>}
            {addedAt && <span className="tag tag-date" title="Added to your list">➕ {addedAt}</span>}
          </div>
          {isRejected && rejectionReason && (
            <div className="job-reject-note">Rejected: {REJECTION_LABEL.get(rejectionReason) || rejectionReason}{job.userMatch?.notes && job.userMatch.notes !== rejectionReason ? ` — ${job.userMatch.notes}` : ""}</div>
          )}
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
            {onGeneratePackage && <button className="btn btn-primary" type="button" onClick={() => onGeneratePackage(job.id)}>Package</button>}
            {onGenerateResume && <button className="btn btn-secondary" type="button" onClick={() => onGenerateResume(job.id)}>{hasResume ? "Rebuild Resume" : "Generate Resume"}</button>}
            {onGenerateCoverLetter && <button className="btn btn-secondary" type="button" onClick={() => onGenerateCoverLetter(job.id)}>{hasLetter ? "Rebuild Letter" : "Generate Letter"}</button>}
            {job.url && <a className="btn btn-secondary" href={job.url} target="_blank" rel="noreferrer">Open</a>}
            {(job.resumeVersions || []).map((resume, index) => {
              const pdfPath = inferredPdfPath(resume.filePath, resume.pdfFilePath);
              const issueCount = resume.atsIssues?.length || 0;
              return (
                <span className="doc-link-set" key={resume.id || `${resume.filePath}-${index}`}>
                  {resume.atsScore != null && (
                    <span
                      className={`ats-score ${atsClass(resume.atsScore)}`}
                      title={issueCount ? resume.atsIssues?.join("\n") : "ATS validation passed"}
                    >
                      ATS {resume.atsScore}{issueCount ? ` / ${issueCount}` : ""}
                    </span>
                  )}
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
            {onMark && !isRejected && rejectingJobId !== job.id && (
              <button className="btn btn-secondary" type="button" onClick={() => { setRejectingJobId(job.id); setRejectReason("OTHER"); }}>Reject</button>
            )}
            {onMark && !isRejected && rejectingJobId === job.id && (
              <span className="reject-inline">
                <select value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}>
                  {REJECTION_REASONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                </select>
                <button className="btn btn-primary" type="button" onClick={() => { void onMark(job.id, { status: "REJECTED", rejectionReason: rejectReason as any, notes: rejectReason }); setRejectingJobId(null); }}>Confirm</button>
                <button className="btn btn-secondary" type="button" onClick={() => setRejectingJobId(null)}>Cancel</button>
              </span>
            )}
            {isRejected && <span className="badge is-rejected">Rejected</span>}
            {onBlockCompany && job.company && !isBlocked && (
              <button
                className="btn btn-danger"
                type="button"
                title={`Blacklist ${job.company} — stop collecting and generating resumes for this company`}
                onClick={() => onBlockCompany(job.company as string)}
              >
                Block Company
              </button>
            )}
          </div>
        </div>
      </article>
    );
  })}</div>;
}
