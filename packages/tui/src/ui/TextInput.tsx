import { Text, useInput } from "ink";
import { useState } from "react";

type TextInputProps = {
  initialValue?: string;
  multiline?: boolean;
  onSubmit: (value: string) => void;
  onCancel?: () => void;
  placeholder?: string;
};

/**
 * Minimal text editor for Ink. Single-line by default; in multiline mode
 * Enter inserts a newline and Ctrl-D submits.
 *
 * Bindings:
 *   Enter         → submit (single-line) / newline (multiline)
 *   Ctrl-D        → submit (multiline)
 *   Esc           → cancel
 *   Backspace     → delete before cursor
 *   Left/Right    → move cursor
 *   Home/End      → start/end of line
 *   Printable     → insert
 */
export function TextInput({
  initialValue = "",
  multiline = false,
  onSubmit,
  onCancel,
  placeholder,
}: TextInputProps): JSX.Element {
  const [value, setValue] = useState(initialValue);
  const [cursor, setCursor] = useState(initialValue.length);

  useInput((input, key) => {
    if (key.escape) {
      onCancel?.();
      return;
    }
    if (key.return) {
      if (multiline) {
        const next = value.slice(0, cursor) + "\n" + value.slice(cursor);
        setValue(next);
        setCursor(cursor + 1);
      } else {
        onSubmit(value);
      }
      return;
    }
    if (key.ctrl && input === "d" && multiline) {
      onSubmit(value);
      return;
    }
    if (key.backspace || key.delete) {
      if (cursor > 0) {
        const next = value.slice(0, cursor - 1) + value.slice(cursor);
        setValue(next);
        setCursor(cursor - 1);
      }
      return;
    }
    if (key.leftArrow) {
      setCursor(Math.max(0, cursor - 1));
      return;
    }
    if (key.rightArrow) {
      setCursor(Math.min(value.length, cursor + 1));
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      const next = value.slice(0, cursor) + input + value.slice(cursor);
      setValue(next);
      setCursor(cursor + input.length);
    }
  });

  if (value === "") {
    return (
      <Text>
        <Text inverse> </Text>
        {placeholder ? <Text dimColor> {placeholder}</Text> : null}
      </Text>
    );
  }

  const before = value.slice(0, cursor);
  const at = value.slice(cursor, cursor + 1) || " ";
  const after = value.slice(cursor + 1);

  return (
    <Text>
      {before}
      <Text inverse>{at}</Text>
      {after}
    </Text>
  );
}
