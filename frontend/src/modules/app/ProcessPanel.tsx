type ProcessPanelProps = {
  operation: { label: string; startedAt: string } | null;
  progress: any | null;
  status: string;
  lastError: string;
};

export function ProcessPanel({ operation, progress, status, lastError }: ProcessPanelProps) {
  if (!operation && !progress && !lastError) return null;

  return (
    <section className={`process-panel ${operation ? "is-running" : ""} ${lastError ? "has-error" : ""}`}>
      <div className="process-head">
        <div>
          <strong>{operation?.label || (lastError ? "Last error" : "Last process")}</strong>
          <span>{progress?.message || status}</span>
        </div>
        <div className="process-state">{operation ? "Running" : progress?.status || "Idle"}</div>
      </div>
      {progress?.percent !== undefined && (
        <div className="progress-track"><div className="progress-fill" style={{ width: `${Math.max(0, Math.min(100, Number(progress.percent) || 0))}%` }} /></div>
      )}
      <div className="process-grid">
        <div><span>Stage</span><strong>{progress?.stage || progress?.status || "-"}</strong></div>
        <div><span>Provider</span><strong>{progress?.provider || "-"}</strong></div>
        <div><span>Collected</span><strong>{progress?.collectedJobs ?? progress?.newJobsCount ?? "-"}</strong></div>
        <div><span>Analyzed</span><strong>{progress?.analyzedJobs ?? progress?.analyzedJobsCount ?? "-"}</strong></div>
        <div><span>Resumes</span><strong>{progress?.generatedResumes ?? progress?.generatedResumesCount ?? "-"}</strong></div>
        <div><span>Letters</span><strong>{progress?.generatedCoverLetters ?? progress?.generatedCoverLettersCount ?? "-"}</strong></div>
      </div>
      {lastError && <div className="error-banner">{lastError}</div>}
    </section>
  );
}
