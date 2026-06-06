import type { ResumeBase, WorkspaceUser } from "../../types/domain";
import type { AppSettings } from "./types";

type WorkspaceToolbarProps = {
  user: WorkspaceUser;
  settings: AppSettings;
  selectedResumeBaseId: string;
  selectedResumeBase?: ResumeBase;
  persist: (settings: AppSettings) => void;
  onCreateBaseResume: () => void;
};

export function WorkspaceToolbar({
  user,
  settings,
  selectedResumeBaseId,
  selectedResumeBase,
  persist,
  onCreateBaseResume,
}: WorkspaceToolbarProps) {
  return (
    <section className="workspace-toolbar">
      <div>
        <p className="eyebrow">Active base resume</p>
        <strong>{selectedResumeBase?.name || "No base resume selected"}</strong>
        <span>{selectedResumeBase ? `${selectedResumeBase.target}${selectedResumeBase.targetTitle ? ` | ${selectedResumeBase.targetTitle}` : ""}` : "Create or upload a base resume before searching."}</span>
      </div>
      <label className="field compact-field">
        <span>Base Resume</span>
        <select value={selectedResumeBaseId} onChange={(event) => persist({ ...settings, selectedResumeBaseId: event.target.value })}>
          <option value="">Select base resume</option>
          {(user.resumeBases || []).map((resume) => <option value={resume.id} key={resume.id}>{resume.name}{resume.isDefault ? " (default)" : ""}</option>)}
        </select>
      </label>
      {!user.resumeBases?.length && (
        <button className="btn btn-secondary" type="button" onClick={onCreateBaseResume}>Create Base Resume</button>
      )}
    </section>
  );
}
