import { Collapsible as CollapsiblePrimitive } from "radix-ui"
import { CollapsibleTrigger } from "./collapsible-trigger"
import { CollapsibleContent } from "./collapsible-content"

const Collapsible = (props: React.ComponentProps<typeof CollapsiblePrimitive.Root>) =>
  <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
