import type { ReactNode } from "react"
import { useState } from "react"
import { cn } from "@/web/lib/utils"

export function Panel({
  title,
  children,
  action,
  className,
  collapsible = false,
  defaultOpen = true,
}: {
  title?: string
  children: ReactNode
  action?: ReactNode
  className?: string
  collapsible?: boolean
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={cn("border-b border-border px-5 py-5", className)}>
      {title || action ? (
        <div className="mb-4 flex min-w-0 items-center justify-between gap-3">
          {title ? (
            collapsible ? (
              <button
                type="button"
                className="flex min-w-0 items-center gap-1.5 text-sm font-semibold hover:text-primary transition-colors"
                onClick={() => setOpen(!open)}
              >
                <svg
                  className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-90")}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m9 18 6-6-6-6" />
                </svg>
                {title}
              </button>
            ) : (
              <h3 className="min-w-0 text-sm font-semibold">{title}</h3>
            )
          ) : <span />}
          {(!collapsible || open) && action}
        </div>
      ) : null}
      {(!collapsible || open) && children}
    </section>
  )
}
