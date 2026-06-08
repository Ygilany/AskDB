import { Collapsible as CollapsiblePrimitive } from "radix-ui"

export const CollapsibleTrigger = (props: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>) =>
  <CollapsiblePrimitive.CollapsibleTrigger data-slot="collapsible-trigger" {...props} />
