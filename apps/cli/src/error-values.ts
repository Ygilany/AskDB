/**
 * Whether an error may repeat `value`: it looks like a name or a number. Anything else, such as a
 * connection string given to the wrong flag, is left out because it can hold a password.
 */
export function showable(value: string): boolean {
  return /^[\w.+-]{1,40}$/.test(value);
}

/** `label: value` when `value` is `showable`, else `label` alone. */
export function labelled(label: string, value: string): string {
  return showable(value) ? `${label}: ${value}` : label;
}
