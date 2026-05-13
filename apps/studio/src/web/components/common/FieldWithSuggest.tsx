import { Loader2, Wand2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../ui";

export function FieldWithSuggest({
  aiConfigured,
  children,
  label,
  onSuggest,
  suggesting,
}: {
  aiConfigured: boolean;
  children: ReactNode;
  label: string;
  onSuggest: () => Promise<void>;
  suggesting: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-muted-foreground">{label}</span>
        <Button
          disabled={!aiConfigured || suggesting}
          size="sm"
          type="button"
          variant="ghost"
          onClick={() => void onSuggest()}
          title={
            aiConfigured
              ? "Suggest with configured AI model"
              : "Configure an AI key to enable suggestions"
          }
        >
          {suggesting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Wand2 className="h-3.5 w-3.5" />
          )}
          Suggest
        </Button>
      </div>
      {children}
    </div>
  );
}
