import { useState } from "react"
import { parseList } from "@/web/lib/format"
import { Input } from "./input"

function formatList(list: string[] | undefined): string {
  return list?.join(", ") ?? ""
}

export function ListInput({
  value,
  onChange,
}: {
  value: string[] | undefined
  onChange: (value: string[]) => void
}) {
  const [editValue, setEditValue] = useState<string | null>(null)
  const display = editValue ?? formatList(value)

  return (
    <Input
      value={display}
      onChange={(e) => setEditValue(e.target.value)}
      onFocus={() => setEditValue(formatList(value))}
      onBlur={() => {
        onChange(parseList(editValue ?? formatList(value)))
        setEditValue(null)
      }}
    />
  )
}
