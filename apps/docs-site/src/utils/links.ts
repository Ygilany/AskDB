export const base = import.meta.env.BASE_URL.replace(/\/$/, "");
export const withBase = (href: string) =>
  href.startsWith("/") && !href.startsWith("//") ? base + href : href;
