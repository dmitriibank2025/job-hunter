import { Field } from "../../components/ui";
import type { AuthMode, AppSettings } from "./types";

type AuthPanelProps = {
  authMode: AuthMode;
  settings: AppSettings;
  setAuthMode: (mode: AuthMode) => void;
  setSettings: (settings: AppSettings) => void;
  persist: (settings: AppSettings) => void;
  onClose: () => void;
  onLogin: () => void;
  onRegister: () => void;
};

export function AuthPanel({
  authMode,
  settings,
  setAuthMode,
  setSettings,
  persist,
  onClose,
  onLogin,
  onRegister,
}: AuthPanelProps) {
  return (
    <section className="auth-panel">
      <div className="auth-tabs">
        <button className={`pill-tab ${authMode === "login" ? "is-active" : ""}`} type="button" onClick={() => setAuthMode("login")}>Login</button>
        <button className={`pill-tab ${authMode === "register" ? "is-active" : ""}`} type="button" onClick={() => setAuthMode("register")}>Register</button>
      </div>
      <div className="form-grid">
        <Field label="Email" value={settings.accountEmail} onChange={(value) => persist({ ...settings, accountEmail: value })} />
        {authMode === "register" && <Field label="Full Name" value={settings.accountFullName} onChange={(value) => persist({ ...settings, accountFullName: value })} />}
        <label className="field">
          <span>Password</span>
          <input type="password" value={settings.accountPassword} onChange={(event) => setSettings({ ...settings, accountPassword: event.target.value })} />
        </label>
        {authMode === "register" && (
          <label className="field">
            <span>Plan</span>
            <select value={settings.accountPlan} onChange={(event) => persist({ ...settings, accountPlan: event.target.value })}>
              <option value="FREE">Free</option>
              <option value="PRO">Pro</option>
            </select>
          </label>
        )}
      </div>
      <div className="inline-actions">
        {authMode === "login"
          ? <button className="btn btn-primary" type="button" onClick={onLogin}>Login</button>
          : <button className="btn btn-primary" type="button" onClick={onRegister}>Create Account</button>}
        <button className="btn btn-secondary" type="button" onClick={onClose}>Close</button>
      </div>
    </section>
  );
}
