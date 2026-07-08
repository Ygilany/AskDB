import { useState } from "react";
import { Pencil } from "lucide-react";
import { Field } from "../../components/ui/field";
import { Input } from "../../components/ui/input";

/**
 * An env var NAME field, shown as a static default until clicked. Naming an
 * env var rarely matters — showing an editable input for it up front just
 * adds a decision nobody asked for. Click-to-edit keeps the default visible
 * without hiding that it can be changed.
 */
export function EnvVarField({
  label,
  description,
  value,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);

  if (editing && !disabled) {
    return (
      <Field label={label} description={description}>
        <Input
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
      </Field>
    );
  }

  return (
    <Field label={label} description={description}>
      <button type="button" className="env-var-field" disabled={disabled} onClick={() => setEditing(true)}>
        <span className="mono env-var-field-value">{value}</span>
        {!disabled && <Pencil size={12} className="muted" />}
      </button>
    </Field>
  );
}
