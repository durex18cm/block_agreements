"use strict";

// Serves /record (rewritten here from vercel.json) with a localized, dynamic
// social-share card. Link-preview crawlers (WeChat / Twitter / Facebook / …)
// read the static <meta> and DO NOT run JavaScript, so the page's client-side
// i18n can't reach them. This function reads the sharer's language (`lg`) and
// score from the `?d=` payload and rewrites the <head> before the crawler sees
// it — the page <body>/<script> is served verbatim and still localizes itself
// for the human viewer.
//
// Step 1 (this file): localized + score-bearing text card.
// Step 2 (api/og.js): a rendered poster image referenced as og:image.

const fs = require("fs");
const path = require("path");

// Head/meta strings per language. Keep in sync with record.html's I18N (only
// the head is localized here; the body localizes itself from `lg`).
const L = {
  "zh-CN": {
    lang: "zh-CN",
    title: "对局战报 · 呀方块",
    desc: "呀方块 · 一局精彩对战报告",
    ogTitleScore: (s) => `我在呀方块砌出了 ${s} 分!`,
    ogTitlePlain: "呀方块 · 对局战报",
    ogDesc: "来看看我这局的战报,你也来挑战一局!",
  },
  "zh-TW": {
    lang: "zh-TW",
    title: "對局戰報 · 呀方塊",
    desc: "呀方塊 · 一局精彩對戰報告",
    ogTitleScore: (s) => `我在呀方塊砌出了 ${s} 分!`,
    ogTitlePlain: "呀方塊 · 對局戰報",
    ogDesc: "來看看我這局的戰報,你也來挑戰一局!",
  },
  en: {
    lang: "en",
    title: "Match Report · Yah Blocks",
    desc: "Yah Blocks · A highlight report of one match",
    ogTitleScore: (s) => `I scored ${s} in Yah Blocks!`,
    ogTitlePlain: "Yah Blocks · Match Report",
    ogDesc: "Check out my match report — can you beat it?",
  },
};

// Sharer's `lg` wins; otherwise fall back to the crawler's Accept-Language,
// then English — mirroring record.html's detectLang().
function pickLang(hint, acceptLanguage) {
  if (hint && L[hint]) return hint;
  for (const raw of String(acceptLanguage || "").split(",")) {
    const t = raw.trim().toLowerCase();
    if (t.startsWith("zh")) {
      return t.includes("tw") ||
        t.includes("hk") ||
        t.includes("mo") ||
        t.includes("hant")
        ? "zh-TW"
        : "zh-CN";
    }
    if (t.startsWith("en")) return "en";
  }
  return "en";
}

function decodePayload(d) {
  if (!d) return null;
  try {
    let s = d.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    return JSON.parse(Buffer.from(s, "base64").toString("utf8"));
  } catch (e) {
    return null;
  }
}

// Thousands separators, matching record.html's formatGroupedInt / the app.
function groupInt(n) {
  const neg = n < 0;
  const raw = Math.abs(Math.trunc(n)).toString();
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const remaining = raw.length - i;
    out += raw[i];
    if (remaining > 1 && remaining % 3 === 1) out += ",";
  }
  return neg ? "-" + out : out;
}

// The payload is user-supplied — escape before it lands in an HTML attribute.
function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        c
      ])
  );
}

let TEMPLATE = null;
function template() {
  if (TEMPLATE == null) {
    TEMPLATE = fs.readFileSync(
      path.join(__dirname, "..", "record.html"),
      "utf8"
    );
  }
  return TEMPLATE;
}

/** Injects the localized head into the record.html template. Exported for tests. */
function renderRecordHtml(d, acceptLanguage, ogImageUrl) {
  const payload = decodePayload(d);
  const t = L[pickLang(payload && payload.lg, acceptLanguage)];
  const score =
    payload && typeof payload.s === "number" ? groupInt(payload.s) : null;
  const ogTitle = score != null ? t.ogTitleScore(score) : t.ogTitlePlain;

  const lines = [
    `<title>${esc(t.title)}</title>`,
    `<meta name="description" content="${esc(t.desc)}" />`,
    `<meta property="og:title" content="${esc(ogTitle)}" />`,
    `<meta property="og:description" content="${esc(t.ogDesc)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta name="twitter:title" content="${esc(ogTitle)}" />`,
    `<meta name="twitter:description" content="${esc(t.ogDesc)}" />`,
  ];
  if (ogImageUrl) {
    // Dynamic poster rendered by api/og.mjs (@vercel/og).
    lines.push(
      `<meta property="og:image" content="${esc(ogImageUrl)}" />`,
      `<meta property="og:image:width" content="1200" />`,
      `<meta property="og:image:height" content="630" />`,
      `<meta name="twitter:card" content="summary_large_image" />`,
      `<meta name="twitter:image" content="${esc(ogImageUrl)}" />`
    );
  }

  return template()
    .replace(
      /<!-- OG:START[\s\S]*?OG:END -->/,
      `<!-- OG:START -->\n  ${lines.join("\n  ")}\n  <!-- OG:END -->`
    )
    .replace(/<html lang="[^"]*">/, `<html lang="${t.lang}">`);
}

module.exports = (req, res) => {
  const d =
    (req.query && req.query.d) ||
    new URL(req.url, "http://localhost").searchParams.get("d") ||
    "";
  const host = (req.headers && req.headers.host) || "";
  // `d` is URL-safe base64url (no +/=), so it needs no extra encoding.
  const ogImageUrl = d && host ? `https://${host}/api/og?d=${d}` : null;
  let html;
  try {
    html = renderRecordHtml(
      d,
      req.headers && req.headers["accept-language"],
      ogImageUrl
    );
  } catch (e) {
    res.statusCode = 500;
    res.end("record template unavailable");
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Cache-Control",
    "public, s-maxage=3600, stale-while-revalidate=86400"
  );
  res.statusCode = 200;
  res.end(html);
};

// Exposed for local unit testing (see api/record.test.js).
module.exports.renderRecordHtml = renderRecordHtml;
module.exports.pickLang = pickLang;
