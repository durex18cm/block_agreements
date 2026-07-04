// Renders the match-report share IMAGE (og:image) on Vercel's edge runtime.
//
// Localized (simplified / traditional / English, from the payload's `lg`) and
// dynamic (real score / duration / nickname from `?d=`). The CJK font is loaded
// per request as a Google Fonts SUBSET covering exactly the glyphs this poster
// uses — including the user's nickname — so nothing large is bundled and no
// character renders as tofu. Overseas (Vercel) only; Google Fonts is reachable
// there.

import { ImageResponse } from "@vercel/og";

export const config = { runtime: "edge" };

const L = {
  "zh-CN": {
    report: "对局战报",
    scoreLabel: "本局得分",
    duration: "游戏时长",
    rows: "消除行数",
    best: "个人最佳",
    app: "呀方块",
    font: "Noto+Sans+SC",
  },
  "zh-TW": {
    report: "對局戰報",
    scoreLabel: "本局得分",
    duration: "遊戲時長",
    rows: "消除行數",
    best: "個人最佳",
    app: "呀方塊",
    font: "Noto+Sans+TC",
  },
  en: {
    report: "Match Report",
    scoreLabel: "SCORE",
    duration: "Play Time",
    rows: "Lines",
    best: "Personal Best",
    app: "Yah Blocks",
    font: "Noto+Sans",
  },
};

// Palette mirrors lib/core/theme/app_colors.dart.
const C = {
  gradTop: "#3A4FA8",
  gradBottom: "#1E2D6A",
  gold: "#FFD54F",
  white: "#FFFFFF",
  muted: "rgba(255,255,255,0.62)",
  tile: "rgba(255,255,255,0.07)",
  tileBorder: "rgba(255,255,255,0.12)",
};

function pickLang(hint, acceptLanguage) {
  if (hint && L[hint]) return hint;
  for (const raw of String(acceptLanguage || "").split(",")) {
    const s = raw.trim().toLowerCase();
    if (s.startsWith("zh")) {
      return s.includes("tw") ||
        s.includes("hk") ||
        s.includes("mo") ||
        s.includes("hant")
        ? "zh-TW"
        : "zh-CN";
    }
    if (s.startsWith("en")) return "en";
  }
  return "en";
}

function decodePayload(d) {
  if (!d) return null;
  try {
    let s = d.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    const bytes = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    return null;
  }
}

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

const two = (n) => String(n).padStart(2, "0");

// Mirrors record.html formatDuration: prefer active durationMs, else et − st.
function formatDuration(dm, st, et) {
  let total;
  if (typeof dm === "number" && dm > 0) total = Math.floor(dm / 1000);
  else if (st && et) total = Math.floor((et - st) / 1000);
  else return "";
  if (total < 0) return "";
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

// Fetch a Google Fonts subset (ttf) covering exactly [text]. No User-Agent →
// Google serves truetype, which Satori accepts (it can't read woff2).
async function loadFont(family, text) {
  const api = `https://fonts.googleapis.com/css2?family=${family}:wght@700&text=${encodeURIComponent(
    text
  )}`;
  const css = await (await fetch(api)).text();
  const m = css.match(/src:\s*url\((.+?)\)\s*format\('(?:opentype|truetype)'\)/);
  if (!m) throw new Error("could not resolve subset font url");
  return await (await fetch(m[1])).arrayBuffer();
}

// Minimal React-element factory (no JSX / no react dependency).
const el = (type, style, children) => ({ type, props: { style, children } });

export default async function handler(req) {
  const url = new URL(req.url);
  const payload = decodePayload(url.searchParams.get("d"));
  const t = L[pickLang(payload && payload.lg, req.headers.get("accept-language"))];

  const score =
    payload && typeof payload.s === "number" ? groupInt(payload.s) : "0";
  const dur = payload ? formatDuration(payload.dm, payload.st, payload.et) : "";
  const rows =
    payload && payload.er != null && payload.er !== undefined
      ? String(payload.er)
      : "";
  const nick =
    payload && typeof payload.n === "string" ? payload.n.trim().slice(0, 16) : "";
  const isBest = payload && (payload.pb === 1 || payload.pb === true);

  const tiles = [];
  if (dur) tiles.push([t.duration, dur]);
  if (rows) tiles.push([t.rows, rows]);

  // Every glyph that appears must be in the subset (plus digits/punctuation).
  const glyphs =
    [t.report, t.scoreLabel, t.duration, t.rows, t.best, t.app, score, dur, rows, nick]
      .join("") + "0123456789:,.· ";
  const fontData = await loadFont(t.font, glyphs);

  // Build the vertical stack as a filtered list (no empty placeholder divs,
  // which confuse Satori's flex spacing). Each entry owns its top margin.
  const rows_ = [];
  // header: report word · app name
  rows_.push(
    el(
      "div",
      { display: "flex", fontSize: 30, color: C.muted, letterSpacing: 2 },
      `${t.report}  ·  ${t.app}`
    )
  );
  if (nick) {
    rows_.push(
      el(
        "div",
        { display: "flex", fontSize: 34, color: C.white, marginTop: 10 },
        nick
      )
    );
  }
  // score (fixed-height box so the label below always clears the glyphs)
  rows_.push(
    el(
      "div",
      {
        display: "flex",
        height: 150,
        alignItems: "center",
        justifyContent: "center",
        marginTop: 12,
      },
      el(
        "div",
        {
          display: "flex",
          fontSize: 132,
          fontWeight: 700,
          color: C.gold,
          lineHeight: 1,
        },
        score
      )
    )
  );
  rows_.push(
    el(
      "div",
      {
        display: "flex",
        fontSize: 28,
        color: C.muted,
        letterSpacing: 4,
        marginTop: 14,
      },
      t.scoreLabel
    )
  );
  if (isBest) {
    rows_.push(
      el(
        "div",
        {
          display: "flex",
          marginTop: 18,
          padding: "7px 22px",
          borderRadius: 999,
          backgroundColor: C.gold,
          color: C.gradBottom,
          fontSize: 25,
          fontWeight: 700,
        },
        t.best
      )
    );
  }
  if (tiles.length) {
    rows_.push(
      el(
        "div",
        { display: "flex", marginTop: 30, gap: 20 },
        tiles.map(([label, value]) =>
          el(
            "div",
            {
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              padding: "18px 34px",
              borderRadius: 18,
              backgroundColor: C.tile,
              border: `1px solid ${C.tileBorder}`,
            },
            [
              el(
                "div",
                {
                  display: "flex",
                  fontSize: 40,
                  fontWeight: 700,
                  color: C.white,
                },
                value
              ),
              el(
                "div",
                { display: "flex", fontSize: 24, color: C.muted, marginTop: 6 },
                label
              ),
            ]
          )
        )
      )
    );
  }

  const tree = el(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      alignItems: "center",
      justifyContent: "center",
      backgroundImage: `linear-gradient(135deg, ${C.gradTop} 0%, ${C.gradBottom} 100%)`,
      color: C.white,
      fontFamily: "poster",
      padding: "44px",
    },
    rows_
  );

  // @vercel/og already sets a long immutable Cache-Control by default, which is
  // exactly right here — the same payload always renders the same poster.
  return new ImageResponse(tree, {
    width: 1200,
    height: 630,
    fonts: [{ name: "poster", data: fontData, weight: 700, style: "normal" }],
  });
}
