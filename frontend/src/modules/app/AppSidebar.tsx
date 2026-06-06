import type { View, WorkspaceUser } from "../../types/domain";

type AppSidebarProps = {
  availableViews: View[];
  currentView: View;
  user: WorkspaceUser | null;
  onViewChange: (view: View) => void;
  onAuthClick: () => void;
  guardBusy: (action?: string) => boolean;
};

export function AppSidebar({
  availableViews,
  currentView,
  user,
  onViewChange,
  onAuthClick,
  guardBusy,
}: AppSidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-mark">JH</div>
        <div className="brand-text">
          <strong>Job Hunter</strong>
          <span>Private workspace</span>
        </div>
        <div className="sidebar-auth">
          {user ? (
            <button
              className="sidebar-user-btn"
              type="button"
              onClick={() => {
                if (!guardBusy("open account")) return;
                onViewChange("account");
              }}
            >
              <span className="sidebar-avatar">{(user.profile?.fullName || user.email || "U").slice(0, 1).toUpperCase()}</span>
              <span className="sidebar-user-info">
                <strong>{user.profile?.fullName || user.email}</strong>
                <span>{user.plan || "FREE"}</span>
              </span>
              <span className="status-dot is-active" />
            </button>
          ) : (
            <button className="btn btn-secondary btn-full" type="button" onClick={onAuthClick}>Login / Register</button>
          )}
        </div>
      </div>
      <nav className="nav">
        {availableViews.map((item) => (
          <button
            key={item}
            className={`nav-item ${currentView === item ? "is-active" : ""}`}
            onClick={() => {
              if (item !== currentView && !guardBusy("change pages")) return;
              onViewChange(item);
            }}
            type="button"
          >
            {item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </nav>
      <div className="sidebar-foot"><span>Daily search</span><strong>09:00 Asia/Jerusalem</strong></div>
    </aside>
  );
}
