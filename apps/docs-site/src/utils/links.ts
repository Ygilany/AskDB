export const base = import.meta.env.BASE_URL.replace(/\/$/, "");
export const withBase = (href: string) =>
  href.startsWith("/") && !href.startsWith("//") ? base + href : href;

export const REPO_URL = "https://github.com/Ygilany/AskDB";
export const repoPath = (path: string) => `${REPO_URL}/tree/main/${path}`;
