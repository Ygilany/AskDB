// The Markdown "page not found" body, at `/404.md`.
import type { APIRoute } from "astro";
import { notFoundMarkdown } from "../utils/not-found.mjs";

export const prerender = true;

export const GET: APIRoute = (context) => {
  const siteUrl = new URL(import.meta.env.BASE_URL.replace(/\/?$/, "/"), context.site).href;
  return new Response(notFoundMarkdown(siteUrl), { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
};
