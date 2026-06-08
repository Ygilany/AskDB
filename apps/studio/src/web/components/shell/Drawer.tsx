import { useEffect, useRef } from "react";
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
  const handleKeyDownRef = useRef<(e: KeyboardEvent) => void>(() => {});
  handleKeyDownRef.current = (e: KeyboardEvent) => {
    if (e.key === "Escape" && open) onClose();
  };

  useEffect(() => {
    const listener = (e: KeyboardEvent) => handleKeyDownRef.current(e);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  return (
    <>
      <div
        className={`drawer-overlay ${open ? "open" : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <dialog
        className={`drawer ${open ? "open" : ""}`}
        aria-hidden={!open || undefined}
        aria-label={title}
      >
        <div className="drawer-hd">
          <h3>{title}</h3>
          <button type="button" className="btn ghost sm" onClick={onClose} aria-label="Close drawer">
            <X size={14} />
          </button>
        </div>
        <div className="drawer-bd">{children}</div>
      </dialog>
    </>
  );
}
