import type { SuggestSource } from "@askdb/enrich";
import { Button } from "../ui";

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
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="suggestion-title">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h3 id="suggestion-title" className="truncate text-sm font-semibold">
              Suggestions for {dialog.label}
            </h3>
            <p className="text-xs text-muted-foreground">
              Select a candidate to apply it to the draft.
            </p>
          </div>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="grid gap-3 overflow-auto p-4">
          {dialog.candidates.length > 0 ? (
            dialog.candidates.map((candidate, index) => (
              <button
                className="candidate"
                key={`${candidate.text}-${index}`}
                type="button"
                onClick={() => onApply(candidate.text)}
              >
                {candidate.text}
              </button>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No suggestions returned.</p>
          )}
        </div>
      </div>
    </div>
  );
}
