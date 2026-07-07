import { AlertCircle, Check, Loader2 } from "lucide-react";
import type { StatusMessage } from "../../contexts/workspace-context";

export function StatusBanner({ status }: { status: StatusMessage }) {
  return (
    <div className={`status-banner ${status.kind}`}>
      {status.kind === "loading" && <Loader2 size={14} className="animate-spin" />}
      {status.kind === "success" && <Check size={14} />}
      {status.kind === "error" && <AlertCircle size={14} />}
      <span>{status.text}</span>
    </div>
  );
}

export function InlineStatus({ status }: { status: StatusMessage }) {
  return (
    <div className={`inline-status ${status.kind}`}>
      {status.kind === "loading" && <Loader2 size={12} className="animate-spin" />}
      {status.kind === "success" && <Check size={12} />}
      {status.kind === "error" && <AlertCircle size={12} />}
      <span>{status.text}</span>
    </div>
  );
}
