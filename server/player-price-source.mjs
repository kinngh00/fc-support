const PLAYER_PRICE_ENDPOINT = "https://fconline.nexon.com/datacenter/PlayerPriceGraph";

export const PRICE_SOURCE_KIND = "player-price-graph-last-record";

export function playerPriceRequestBody(spid, grade) {
  return new URLSearchParams({
    spid: String(spid),
    n1Strong: String(grade),
  }).toString();
}

export function parseLastRecordedPrice(html) {
  const valuesBlock = String(html).match(/["']value["']\s*:\s*\[([\s\S]*?)\]/i)?.[1] || "";
  const values = [...valuesBlock.matchAll(/["'](\d+)["']/g)].map((match) => match[1]);
  return values.at(-1) || null;
}

export async function fetchPlayerLastRecordedPrice(spid, grade) {
  const body = playerPriceRequestBody(spid, grade);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(PLAYER_PRICE_ENDPOINT, {
        method: "POST",
        headers: {
          accept: "*/*",
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
          "x-requested-with": "XMLHttpRequest",
        },
        body,
      });
      if (!response.ok) throw new Error(`PlayerPriceGraph returned ${response.status}.`);
      return parseLastRecordedPrice(await response.text());
    } catch {
      if (attempt === 3) return null;
      await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
    }
  }
  return null;
}
