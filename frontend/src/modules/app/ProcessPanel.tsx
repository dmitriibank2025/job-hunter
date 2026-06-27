import { useEffect, useState } from "react";

type Operation = { label: string; startedAt: string };

type ProcessPanelProps = {
  operation: Operation | null;
  progress: any | null;
  steps: string[];           // ordered log of stage messages
  status: string;
};

function elapsed(startedAt: string): string {
  const seconds = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function useElapsed(startedAt: string | undefined): string {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return startedAt ? elapsed(startedAt) : "";
}

const STAGE_LABELS: Record<string, string> = {
  idle: "Idle",
  starting: "Starting up",
  collecting: "Collecting vacancies",
  deduplicating: "Removing duplicates",
  filtering: "Applying filters",
  analyzing: "Analyzing job fit",
  generating: "Generating documents",
  email: "Checking email",
  done: "Completed",
  error: "Failed",
};

function stageLabel(stage?: string): string {
  if (!stage) return "—";
  return STAGE_LABELS[stage.toLowerCase()] ?? stage;
}

export function ProcessPanel({ operation, progress, steps, status }: ProcessPanelProps) {
  const elapsedTime = useElapsed(operation?.startedAt);
  const hasContent = Boolean(operation || progress || steps.length || status);
  if (!hasContent) return null;

  const isRunning = Boolean(operation);
  const hasError = progress?.error || (status.startsWith("Error:"));
  const percent = progress?.percent ?? null;

  const displayStage = stageLabel(progress?.stage ?? progress?.status);
  const displayMessage = progress?.message || status;

  return (
    <section className={`process-panel ${isRunning ? "is-running" : ""} ${hasError ? "has-error" : ""}`}>
      <div className="process-head">
        <div>
          <strong>
            {isRunning && <span className="spinner" style={{ display: "inline-block", marginRight: 7 }} />}
            {operation?.label || "Last process"}
          </strong>
          {displayMessage && <span className="process-message">{displayMessage}</span>}
        </div>
        <div className="process-meta">
          {isRunning && elapsedTime && <span className="elapsed">{elapsedTime}</span>}
          <span className={`process-state ${isRunning ? "is-active" : ""}`}>
            {isRunning ? "Running" : hasError ? "Failed" : "Done"}
          </span>
        </div>
      </div>

      {percent !== null && (
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${Math.max(2, Math.min(100, Number(percent) || 0))}%` }} />
        </div>
      )}

      <div className="process-grid">
        <div><span>Stage</span><strong>{displayStage}</strong></div>
        <div><span>Provider</span><strong>{progress?.provider || "—"}</strong></div>
        <div><span>Collected</span><strong>{progress?.collectedJobs ?? progress?.newJobsCount ?? "—"}</strong></div>
        <div><span>Analyzed</span><strong>{progress?.analyzedJobs ?? progress?.analyzedJobsCount ?? "—"}</strong></div>
        <div><span>Resumes</span><strong>{progress?.generatedResumes ?? progress?.generatedResumesCount ?? "—"}</strong></div>
        <div><span>Letters</span><strong>{progress?.generatedCoverLetters ?? progress?.generatedCoverLettersCount ?? "—"}</strong></div>
      </div>

      {steps.length > 0 && (
        <div className="process-steps">
          {steps.slice(-6).map((step, i) => (
            <div key={i} className={`process-step ${i === steps.slice(-6).length - 1 ? "is-current" : ""}`}>
              {step}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
