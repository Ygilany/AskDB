import { useCallback, useEffect } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";

export function Drawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) onClose();
    },
    [open, onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <>
      <div
        className={`drawer-overlay ${open ? "open" : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div className={`drawer ${open ? "open" : ""}`} role="dialog" aria-modal={open}>
        <div className="drawer-hd">
          <h3>{title}</h3>
          <button className="btn ghost sm" onClick={onClose} aria-label="Close drawer">
            <X size={14} />
          </button>
        </div>
        <div className="drawer-bd">{children}</div>
      </div>
    </>
  );
}
