const RANKING_ENDPOINT = "https://fconline.nexon.com/datacenter/rank_inner";

function decodeHtml(value = "") {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function numberMatch(source, pattern, fallback = null) {
  const match = source.match(pattern);
  if (!match) return fallback;
  const value = Number(String(match[1]).replaceAll(",", ""));
  return Number.isFinite(value) ? value : fallback;
}

function gradeCode(source = "") {
  const match = source.match(/ico_rank(\d+)\.png/i);
  return match ? `rank${match[1]}` : null;
}

export function parseRankingHtml(html) {
  const parts = html.split(/(?=<div class="tr">\s*<span class="td rank_no">)/i);
  const rows = [];

  for (const part of parts) {
    const rank = numberMatch(part, /<span class="td rank_no">\s*(\d+)\s*<\/span>/i);
    if (rank == null) continue;

    const nextRow = part.indexOf('<div class="tr">', 1);
    const row = nextRow > 0 ? part.slice(0, nextRow) : part;
    const identity = row.match(/<span class="name profile_pointer" data-sn="([^"]+)">([^<]+)<\/span>/i);
    if (!identity) throw new Error(`Ranking row ${rank} has no manager identity.`);

    const teamSection = row.match(/<span class="td team_color">([\s\S]*?)<span class="td formation">/i)?.[1] || "";
    const teamImages = [...teamSection.matchAll(/<img\s+src="([^"]+)"/gi)].map((match) => match[1]);
    const teamColors = [];
    const colorPattern = /<span class="inner">([\s\S]*?)<small>\((\d+)명\)<\/small>/gi;
    for (const match of teamSection.matchAll(colorPattern)) {
      teamColors.push({
        name: decodeHtml(match[1]),
        count: Number(match[2]),
        image: teamImages[teamColors.length] || null,
      });
    }

    const record = row.match(/<span class="bottom">\s*(\d+)\s*<em>\|<\/em>\s*(\d+)\s*<em>\|<\/em>\s*(\d+)/i);
    const bestSection = row.match(/<span class="td rank_best">([\s\S]*?)<\/span>\s*<\/div>/i)?.[1] || "";
    const bestIcons = [...bestSection.matchAll(/ico_rank(\d+)\.png/gi)].map((match) => `rank${match[1]}`);

    rows.push({
      rank,
      nexonSn: identity[1],
      nickname: decodeHtml(identity[2]),
      level: numberMatch(row, /<span class="txt">\s*(\d+)\s*<\/span>/i),
      levelGauge: numberMatch(row, /class="gage" style="width:([\d.]+)%/i),
      clubValue: numberMatch(row, /<span class="price" alt="([\d,]+)"/i),
      elo: numberMatch(row, /<span class="td rank_r_win_point">\s*([\d.]+)\s*<\/span>/i),
      winRate: numberMatch(row, /<span class="top">\s*([\d.]+)%\s*<\/span>/i),
      wins: record ? Number(record[1]) : null,
      draws: record ? Number(record[2]) : null,
      losses: record ? Number(record[3]) : null,
      teamColors,
      primaryTeamColor: teamColors[0]?.name || null,
      teamColorCount: teamColors[0]?.count || null,
      formation: decodeHtml(row.match(/<span class="td formation">([\s\S]*?)<\/span>/i)?.[1] || "") || null,
      currentGrade: gradeCode(row.match(/<span class="td rank_coach">([\s\S]*?)<span class="td rank_r_win_point">/i)?.[1] || ""),
      bestGrade: bestIcons[0] || null,
      previousGrade: bestIcons[1] || null,
    });
  }
  return rows;
}

function rankingUrl(page) {
  const query = new URLSearchParams({
    rt: "manager",
    n4seasonno: "0",
    n4pageno: String(page),
    tc_01: "0",
    tc_02: "0",
    tc_l_01: "0",
    tc_l_02: "0",
    tc_c_01: "0",
    tc_c_02: "0",
    tc_01_cnt_s: "1",
    tc_01_cnt_e: "11",
    tc_02_cnt_s: "1",
    tc_02_cnt_e: "11",
    formation_01: "-",
    formation_02: "-",
    cv_s: "0",
    cv_e: "9000000000000000000",
    tier_s: "3100",
    tier_e: "800",
    rank_s: "1",
    rank_e: "10000",
  });
  return `${RANKING_ENDPOINT}?${query}`;
}

async function fetchRankingPage(page) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(rankingUrl(page), {
        headers: {
          accept: "text/html, */*; q=0.01",
          "accept-language": "ko-KR,ko;q=0.9",
          referer: "https://fconline.nexon.com/datacenter/rank?rt=manager",
          "user-agent": "FC-SUPPORT/1.0",
          "x-requested-with": "XMLHttpRequest",
        },
      });
      if (!response.ok) throw new Error(`Ranking page ${page} returned ${response.status}.`);
      const rows = parseRankingHtml(await response.text());
      if (rows.length !== 20) throw new Error(`Ranking page ${page} returned ${rows.length} rows.`);
      return rows;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw lastError;
}

export async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function fetchAllRankings(concurrency = 5, onProgress = null) {
  const pages = Array.from({ length: 500 }, (_, index) => index + 1);
  let completed = 0;
  const rows = (await mapLimit(pages, concurrency, async (page) => {
    const result = await fetchRankingPage(page);
    completed += 1;
    onProgress?.({ completed, total: pages.length });
    return result;
  })).flat();
  rows.sort((a, b) => a.rank - b.rank);

  if (rows.length !== 10000) throw new Error(`Expected 10000 rankings, received ${rows.length}.`);
  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index].rank !== index + 1) {
      throw new Error(`Ranking sequence is invalid at index ${index}: ${rows[index].rank}.`);
    }
  }
  return rows;
}
