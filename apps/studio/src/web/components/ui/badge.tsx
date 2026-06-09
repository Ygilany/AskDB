import { cva, type VariantProps } from "class-variance-authority"
import type { ComponentPropsWithoutRef } from "react"
import { cn } from "@/web/lib/utils"

const badgeVariants = cva(
  "inline-flex min-h-6 max-w-full items-center rounded-md px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        warning: "bg-warning text-warning-foreground",
        danger: "bg-destructive text-destructive-foreground",
        outline: "border border-border bg-background text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export type BadgeProps = ComponentPropsWithoutRef<"span"> & VariantProps<typeof badgeVariants>

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}
