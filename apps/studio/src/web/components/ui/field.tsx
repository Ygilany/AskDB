import type { ReactNode } from "react"
import { cn } from "@/web/lib/utils"

export function Field({
  label,
  description,
  children,
  className,
}: {
  label: string
  description?: string
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cn("grid gap-1.5", className)}>
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      {children}
      {description ? <span className="text-xs text-muted-foreground">{description}</span> : null}
    </label>
  )
}
