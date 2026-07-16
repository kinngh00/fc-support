import { config } from "./config.mjs";
import { fetchAllRankings } from "./ranking-source.mjs";

const rankings = await fetchAllRankings(config.rankingConcurrency);
console.log(JSON.stringify({ count: rankings.length, first: rankings[0], last: rankings.at(-1) }, null, 2));
