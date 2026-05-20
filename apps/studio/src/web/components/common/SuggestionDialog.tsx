import { X } from "lucide-react";
import type { SuggestSource } from "@askdb/enrich";

export type SuggestionDialogState = {
  source: SuggestSource;
  label: string;
  candidates: Array<{ text: string }>;
};

export function SuggestionDialog({
  dialog,
  onApply,
  onClose,
}: {
  dialog: SuggestionDialogState;
  onApply: (text: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-hd">
          <h3>Suggestions for {dialog.label}</h3>
          <button className="btn ghost sm" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <div className="dialog-bd">
          {dialog.candidates.map((candidate, index) => (
            <button
              key={index}
              className="candidate"
              onClick={() => onApply(candidate.text)}
            >
              {candidate.text}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
