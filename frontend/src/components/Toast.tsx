import { useEffect, useState } from "react";

export type ToastKind = "success" | "error" | "info" | "warning";

export type Toast = {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string;
  autoDismiss?: boolean; // default true for success/info, false for error
};

type ToastItemProps = {
  toast: Toast;
  onDismiss: (id: string) => void;
};

const ICONS: Record<ToastKind, string> = {
  success: "✓",
  error: "✕",
  warning: "⚠",
  info: "ℹ",
};

const AUTO_DISMISS_MS: Record<ToastKind, number> = {
  success: 4000,
  info: 5000,
  warning: 8000,
  error: 0, // never auto-dismiss errors
};

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Trigger enter animation
    const t = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const ms = toast.autoDismiss === false ? 0
      : toast.autoDismiss === true ? AUTO_DISMISS_MS[toast.kind]
      : AUTO_DISMISS_MS[toast.kind];
    if (!ms) return;
    const t = setTimeout(() => onDismiss(toast.id), ms);
    return () => clearTimeout(t);
  }, [toast.id, toast.kind, toast.autoDismiss, onDismiss]);

  return (
    <div className={`toast toast-${toast.kind} ${visible ? "is-visible" : ""}`}>
      <span className="toast-icon">{ICONS[toast.kind]}</span>
      <div className="toast-body">
        <strong>{toast.title}</strong>
        {toast.message && <span>{toast.message}</span>}
      </div>
      <button className="toast-close" type="button" onClick={() => onDismiss(toast.id)}>×</button>
    </div>
  );
}

export function ToastContainer({ toasts, onDismiss }: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  if (!toasts.length) return null;
  return (
    <div className="toast-container">
      {toasts.map((t) => <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />)}
    </div>
  );
}

let _nextId = 1;
export function makeToast(kind: ToastKind, title: string, message?: string, autoDismiss?: boolean): Toast {
  return { id: String(_nextId++), kind, title, message, autoDismiss };
}
