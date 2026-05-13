export type StatusMessage = {
  kind: "neutral" | "loading" | "success" | "error";
  text: string;
};
