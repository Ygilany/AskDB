import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export function InspectorTab({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={cn("inspector-tab", active && "active")} type="button" onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}
