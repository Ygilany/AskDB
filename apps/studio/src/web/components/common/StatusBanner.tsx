import { AlertCircle, Check, Loader2 } from "lucide-react";
import { cn } from "../../lib/utils";
import type { StatusMessage } from "./types";

export function StatusBanner({ status }: { status: StatusMessage }) {
  return (
    <div className={cn("status-banner", status.kind)}>
      {status.kind === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {status.kind === "success" ? <Check className="h-4 w-4" /> : null}
      {status.kind === "error" ? <AlertCircle className="h-4 w-4" /> : null}
      <span>{status.text}</span>
    </div>
  );
}

export function InlineStatus({ status }: { status: StatusMessage }) {
  return <div className={cn("inline-status", status.kind)}>{status.text}</div>;
}
