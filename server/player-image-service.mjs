import { db } from "./database.mjs";

const PLAYER_ABILITY_URL = "https://fconline.nexon.com/datacenter/PlayerAbility";
const FALLBACK_RETRY_MS = 24 * 60 * 60 * 1000;
const pending = new Map();

function decodeHtml(value) {
  return value.replaceAll("&amp;", "&").replaceAll("&#39;", "'").replaceAll("&quot;", '"');
}

function trustedImageUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(decodeHtml(value));
    if (url.protocol !== "https:") return null;
    if (!new Set(["fo4.dn.nexoncdn.co.kr", "fco.dn.nexoncdn.co.kr"]).has(url.hostname)) return null;
    if (!url.pathname.includes("/live/externalAssets/common/playersAction")) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function parsePlayerAbilityImage(html) {
  const highResolution = html.match(/<img\b[^>]*\bsrc=["']([^"']*\/playersActionHigh\/[^"']+)["']/i)?.[1];
  const selectedImage = html.match(/\bname=["']hidPlayerCustImg["'][^>]*\bvalue=["']([^"']+)["']/i)?.[1]
    ?? html.match(/\bvalue=["']([^"']+)["'][^>]*\bname=["']hidPlayerCustImg["']/i)?.[1];
  return trustedImageUrl(highResolution) ?? trustedImageUrl(selectedImage);
}

function fallbackUrl(spid) {
  return `https://fco.dn.nexoncdn.co.kr/live/externalAssets/common/playersAction/p${spid}.png`;
}

async function requestOfficialImage(spid) {
  const body = new URLSearchParams({
    spid: String(spid),
    n1Strong: "1",
    n1Grow: "0",
    n1TeamColor: "0",
    n1TeamColor2: "0",
    n1TeamColor3: "0",
    n1TeamColor4: "0",
    strPlayerImg: "",
    rd: String(Date.now()),
  });
  const response = await fetch(PLAYER_ABILITY_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
      referer: `https://fconline.nexon.com/DataCenter/PlayerInfo?spid=${spid}&n1Strong=1`,
      "user-agent": "Mozilla/5.0 (compatible; FC-SUPPORT/1.0)",
    },
    body,
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`PlayerAbility returned ${response.status}.`);
  return parsePlayerAbilityImage(await response.text());
}

async function resolveAndCache(spid) {
  let imageUrl = null;
  try {
    imageUrl = await requestOfficialImage(spid);
  } catch {
    // A failed unofficial page request must never prevent the standard CDN fallback.
  }
  db.prepare(`
    UPDATE player_metadata
    SET image_url = ?, image_checked_at = ?
    WHERE spid = ?
  `).run(imageUrl, new Date().toISOString(), spid);
  return imageUrl ?? fallbackUrl(spid);
}

export async function getPlayerImageUrl(spid) {
  const player = db.prepare(`
    SELECT image_url, image_checked_at
    FROM player_metadata
    WHERE spid = ?
  `).get(spid);
  if (!player) return fallbackUrl(spid);
  if (player.image_url) return player.image_url;
  if (player.image_checked_at && Date.now() - Date.parse(player.image_checked_at) < FALLBACK_RETRY_MS) {
    return fallbackUrl(spid);
  }
  if (!pending.has(spid)) {
    pending.set(spid, resolveAndCache(spid).finally(() => pending.delete(spid)));
  }
  return pending.get(spid);
}
