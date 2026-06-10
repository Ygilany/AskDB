import fs from "node:fs";
import path from "node:path";

// Run from repo root: npm i -D @resvg/resvg-js && node docs/assets/brand/social-preview.generate.mjs
const OUTPUT_TYPE = "svg"; // "png" | "svg"
const REPO = process.cwd();
const OUT = path.join(REPO, `docs/assets/brand/social-preview.${OUTPUT_TYPE}`);

// ---- Brand palette ----
const RED = "#B0182B";       // primary brand red (logo)
const RED_DK = "#A10B2C";
const PINK = "#E5486A";      // sparkle accent
const INK = "#0F172A";       // headline navy
const SLATE = "#475569";
const SLATE2 = "#64748B";
const BORDER = "#E2E8F0";
const CODE_BG = "#0F172A";
const GREEN = "#34D399";
const COMMENT = "#94A3B8";
const KEY = "#F472B6";
const LIGHT = "#E2E8F0";

// ---- Embed the real stacked logo PNG ----
const logoPath = path.join(REPO, "docs/assets/brand/main-stacked.png");
const logoB64 = fs.readFileSync(logoPath).toString("base64");
const logoNatW = 610, logoNatH = 743;
const logoH = 340;
const logoW = Math.round((logoH * logoNatW) / logoNatH);
const leftX0 = 64, leftW = 436;
const logoX = leftX0 + Math.round((leftW - logoW) / 2);
const logoY = Math.round((640 - logoH) / 2) - 6;

// small helper for a decorative four-point sparkle (star) path
function sparkle(cx, cy, r, fill, opacity = 1) {
  const a = r, b = r * 0.32;
  const p = [
    [cx, cy - a], [cx + b, cy - b], [cx + a, cy], [cx + b, cy + b],
    [cx, cy + a], [cx - b, cy + b], [cx - a, cy], [cx - b, cy - b],
  ].map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return `<polygon points="${p}" fill="${fill}" opacity="${opacity}"/>`;
}

// pill chip (mono text, fixed-width => predictable sizing)
function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function pill(x, y, text) {
  const fs2 = 15, cw = fs2 * 0.6, padX = 14, h = 36;
  const w = Math.round(text.length * cw + padX * 2);
  const label = esc(text);
  const svg = `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="#FEF2F3" stroke="#F6C9D0"/>
    <circle cx="${x + padX}" cy="${y + h / 2}" r="3.5" fill="${RED}"/>
    <text x="${x + padX + 12}" y="${y + h / 2 + 6}" font-family="DejaVu Sans Mono" font-size="${fs2}" fill="${RED_DK}">${label}</text>`;
  return { svg, w };
}

const rx = 540; // right column start

// build pills row
let px = rx;
const pillTexts = ["Schema-grounded", "You run the SQL", "BYO model & DB", "Multi-tenant"];
let pillsSvg = "";
for (const t of pillTexts) {
  const { svg, w } = pill(px, 506, t);
  pillsSvg += svg;
  px += w + 12;
}

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1280" height="640" viewBox="0 0 1280 640" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="1" stop-color="#F1F4F9"/>
    </linearGradient>
    <linearGradient id="stripe" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${RED_DK}"/>
      <stop offset="1" stop-color="${PINK}"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="18" flood-color="#0F172A" flood-opacity="0.18"/>
    </filter>
  </defs>

  <!-- background -->
  <rect width="1280" height="640" fill="url(#bg)"/>

  <!-- faint decorative sparkle cluster, top-right -->
  ${sparkle(1180, 90, 46, RED, 0.07)}
  ${sparkle(1110, 150, 22, PINK, 0.10)}
  ${sparkle(1215, 175, 16, RED, 0.08)}
  ${sparkle(1150, 60, 12, PINK, 0.10)}

  <!-- vertical divider between logo and message -->
  <line x1="502" y1="150" x2="502" y2="490" stroke="${BORDER}" stroke-width="2"/>

  <!-- logo (real brand asset) -->
  <image x="${logoX}" y="${logoY}" width="${logoW}" height="${logoH}"
         href="data:image/png;base64,${logoB64}"/>

  <!-- eyebrow -->
  <text x="${rx}" y="108" font-family="Liberation Sans" font-weight="bold"
        font-size="17" letter-spacing="2.5" fill="${RED}">OPEN-SOURCE NL→SQL TOOLKIT  ·  APACHE-2.0</text>

  <!-- headline -->
  <text x="${rx}" y="168" font-family="Liberation Sans" font-weight="bold"
        font-size="50" fill="${INK}">Natural language →</text>
  <text x="${rx}" y="224" font-family="Liberation Sans" font-weight="bold"
        font-size="50" fill="${INK}">validated SQL.</text>

  <!-- subhead -->
  <text x="${rx}" y="266" font-family="Liberation Sans" font-size="23" fill="${SLATE}">Grounded in your schema. Your app runs the query, not us.</text>

  <!-- code card -->
  <g filter="url(#shadow)">
    <rect x="${rx}" y="292" width="676" height="178" rx="16" fill="${CODE_BG}"/>
  </g>
  <circle cx="${rx + 26}" cy="318" r="5.5" fill="#FF5F57"/>
  <circle cx="${rx + 46}" cy="318" r="5.5" fill="#FEBC2E"/>
  <circle cx="${rx + 66}" cy="318" r="5.5" fill="#28C840"/>
  <text x="${rx + 26}" y="364" font-family="DejaVu Sans Mono" font-size="18" fill="${COMMENT}">// "how many orders shipped last week?"</text>
  <text x="${rx + 26}" y="394" font-family="DejaVu Sans Mono" font-size="18"><tspan fill="${KEY}">ask</tspan><tspan fill="${LIGHT}">({ question, schema, model })</tspan></text>
  <text x="${rx + 26}" y="430" font-family="DejaVu Sans Mono" font-size="18" fill="${GREEN}">SELECT count(*) FROM orders</text>
  <text x="${rx + 26}" y="456" font-family="DejaVu Sans Mono" font-size="18" fill="${GREEN}">WHERE shipped_at &gt; now() - interval '7 days';</text>

  <!-- feature pills -->
  ${pillsSvg}

  <!-- footer -->
  <text x="${rx}" y="572" font-family="DejaVu Sans Mono" font-size="20" fill="${INK}" font-weight="bold">github.com/Ygilany/AskDB</text>
  <text x="${rx}" y="600" font-family="DejaVu Sans Mono" font-size="16" fill="${SLATE2}">npm i @askdb/core  ·  Postgres · MySQL · SQLite · SQL Server</text>

  <!-- brand stripe -->
  <rect x="0" y="630" width="1280" height="10" fill="url(#stripe)"/>
</svg>`;

if (OUTPUT_TYPE === "svg") {
  fs.writeFileSync(OUT, svg);
  console.log("Wrote", OUT, Buffer.byteLength(svg), "bytes");
} else if (OUTPUT_TYPE === "png") {
  const { Resvg } = await import("@resvg/resvg-js");
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: 1280 },
    font: { loadSystemFonts: true, defaultFontFamily: "Liberation Sans" },
    background: "#ffffff",
  });
  const png = resvg.render().asPng();
  fs.writeFileSync(OUT, png);
  console.log("Wrote", OUT, png.length, "bytes");
} else {
  throw new Error(`Unsupported OUTPUT_TYPE: ${OUTPUT_TYPE}`);
}
