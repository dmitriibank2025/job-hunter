import { useEffect, useState } from "react";
import { SectionHead } from "../../components/ui";
import type { AppliedVacancy, WorkspaceUser } from "../../types/domain";

type LinkedInStatus = {
  connected: boolean;
  email?: string;
  profileUrl?: string;
  connectedAt?: string;
  lastUsedAt?: string;
  connectionStatus?: "PENDING" | "CONNECTED" | "FAILED";
  error?: string;
};

type SettingsViewProps = {
  user: WorkspaceUser | null;
  linkedinStatus: LinkedInStatus;
  appliedVacancies: AppliedVacancy[];
  onRefreshLinkedIn: () => void;
  onConnectLinkedIn: () => void;
  onDisconnectLinkedIn: () => void;
  onLoadApplications: () => void;
  onSyncEmailApplications: () => void;
  onSaveDailyAutomation: (settings: { enabled: boolean; time: string; timezone: string }) => void;
};

function formatDate(value?: string) {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat("en-GB").format(new Date(value));
}

export function SettingsView({
  user,
  linkedinStatus,
  appliedVacancies,
  onRefreshLinkedIn,
  onConnectLinkedIn,
  onDisconnectLinkedIn,
  onLoadApplications,
  onSyncEmailApplications,
  onSaveDailyAutomation,
}: SettingsViewProps) {
  const isPending = linkedinStatus.connectionStatus === "PENDING";
  const isConnected = linkedinStatus.connected;
  const [dailyAutomation, setDailyAutomation] = useState({
    enabled: false,
    time: "09:00",
    timezone: "Asia/Jerusalem",
  });

  useEffect(() => {
    setDailyAutomation({
      enabled: Boolean(user?.dailyAutomationEnabled),
      time: user?.dailyAutomationTime || "09:00",
      timezone: user?.dailyAutomationTimezone || "Asia/Jerusalem",
    });
  }, [user?.dailyAutomationEnabled, user?.dailyAutomationTime, user?.dailyAutomationTimezone]);

  return (
    <section className="view is-active">
      <section className="surface">
        <SectionHead title="Integrations" subtitle="Connect personal accounts used by provider automation." />

        <div className="integration-panel">
          <div>
            <p className="eyebrow">LinkedIn</p>
            <h3>{isConnected ? "LinkedIn Connected ✓" : isPending ? "LinkedIn Connection Pending" : "LinkedIn Disconnected"}</h3>
          </div>

          <div className="integration-status-grid">
            <span>Status</span>
            <strong>{isConnected ? "Connected" : isPending ? "Waiting for login" : "Disconnected"}</strong>
            <span>Account</span>
            <strong>{linkedinStatus.email || linkedinStatus.profileUrl || "Not available"}</strong>
            <span>Connected</span>
            <strong>{formatDate(linkedinStatus.connectedAt)}</strong>
            <span>Last used</span>
            <strong>{formatDate(linkedinStatus.lastUsedAt)}</strong>
          </div>

          {linkedinStatus.error && <p className="error-text">{linkedinStatus.error}</p>}

          <div className="button-row">
            <button className="btn btn-secondary" type="button" onClick={onRefreshLinkedIn}>Refresh</button>
            <button className="btn btn-primary" type="button" onClick={onConnectLinkedIn}>
              {isConnected ? "Reconnect LinkedIn" : "Connect LinkedIn"}
            </button>
            <button className="btn btn-secondary" type="button" onClick={onDisconnectLinkedIn} disabled={!isConnected && !isPending}>
              Disconnect
            </button>
          </div>
        </div>
      </section>

      <section className="surface">
        <SectionHead title="Application Feedback" subtitle="Email responses are matched back to generated applications and used for prompt learning." />

        <div className="button-row">
          <button className="btn btn-primary" type="button" onClick={onSyncEmailApplications}>Sync Gmail Responses</button>
          <button className="btn btn-secondary" type="button" onClick={onLoadApplications}>Load History</button>
        </div>

        <div className="application-history">
          {appliedVacancies.length ? appliedVacancies.map((item) => (
            <article className={`application-row status-${item.status.toLowerCase()}`} key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <span>{[item.company, item.source, formatDate(item.lastSeenAt)].filter(Boolean).join(" | ")}</span>
                {item.emailSubject && <small>{item.emailSubject}</small>}
              </div>
              <div>
                <b>{item.status.replaceAll("_", " ")}</b>
                {item.jobUrl && <a href={item.jobUrl} target="_blank" rel="noreferrer">Open</a>}
              </div>
            </article>
          )) : <div className="empty">No application feedback loaded yet.</div>}
        </div>
      </section>

      <section className="surface">
        <SectionHead title="Daily Automation" subtitle="Run fresh vacancy analysis and create resumes with cover letters on your schedule." />

        <div className="automation-settings">
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={dailyAutomation.enabled}
              onChange={(event) => setDailyAutomation({ ...dailyAutomation, enabled: event.target.checked })}
            />
            <span>
              <strong>Daily fresh vacancy analysis</strong>
              <small>Collect fresh jobs, analyze matches, and generate resume plus cover letter for suitable vacancies.</small>
            </span>
          </label>

          <div className="form-grid">
            <label className="field">
              <span>Run Time</span>
              <input
                type="time"
                value={dailyAutomation.time}
                onChange={(event) => setDailyAutomation({ ...dailyAutomation, time: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Timezone</span>
              <select
                value={dailyAutomation.timezone}
                onChange={(event) => setDailyAutomation({ ...dailyAutomation, timezone: event.target.value })}
              >
                {["Asia/Jerusalem", "UTC", "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles"].map((timezone) => (
                  <option value={timezone} key={timezone}>{timezone}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="button-row">
            <button className="btn btn-primary" type="button" onClick={() => onSaveDailyAutomation(dailyAutomation)}>Save Schedule</button>
          </div>
        </div>
      </section>
    </section>
  );
}
