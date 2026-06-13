import { Text, useInput } from "ink";
import { useRef, useState, type JSX } from "react";

type TextInputProps = {
  initialValue?: string;
  multiline?: boolean;
  onSubmit: (value: string) => void;
  onCancel?: () => void;
  placeholder?: string;
};

type EditorState = {
  value: string;
  cursor: number;
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
  const stateRef = useRef<EditorState>({ value: initialValue, cursor: initialValue.length });
  stateRef.current = { value, cursor };

  const updateEditor = (next: EditorState) => {
    stateRef.current = next;
    setValue(next.value);
    setCursor(next.cursor);
  };

  useInput((input, key) => {
    const { value, cursor } = stateRef.current;
    if (key.escape) {
      onCancel?.();
      return;
    }
    if (key.return) {
      if (multiline) {
        updateEditor({
          value: value.slice(0, cursor) + "\n" + value.slice(cursor),
          cursor: cursor + 1,
        });
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
        updateEditor({
          value: value.slice(0, cursor - 1) + value.slice(cursor),
          cursor: cursor - 1,
        });
      }
      return;
    }
    if (key.leftArrow) {
      updateEditor({ value, cursor: Math.max(0, cursor - 1) });
      return;
    }
    if (key.rightArrow) {
      updateEditor({ value, cursor: Math.min(value.length, cursor + 1) });
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      updateEditor({
        value: value.slice(0, cursor) + input + value.slice(cursor),
        cursor: cursor + input.length,
      });
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
