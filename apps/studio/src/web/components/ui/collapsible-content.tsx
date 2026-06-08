import { Collapsible as CollapsiblePrimitive } from "radix-ui"

export const CollapsibleContent = (props: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>) =>
  <CollapsiblePrimitive.CollapsibleContent data-slot="collapsible-content" {...props} />
