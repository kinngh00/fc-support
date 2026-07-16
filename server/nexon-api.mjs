const API_ROOT = "https://open.api.nexon.com";

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class NexonApiError extends Error {
  constructor(message, { status = 0, retryable = false } = {}) {
    super(message);
    this.name = "NexonApiError";
    this.status = status;
    this.retryable = retryable;
  }
}

export async function nexonJson(path, apiKey) {
  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await fetch(`${API_ROOT}${path}`, {
        headers: { accept: "application/json", "x-nxopen-api-key": apiKey },
      });
      if (response.ok) return await response.json();

      const body = await response.text();
      const retryable = response.status === 429 || response.status >= 500;
      const error = new NexonApiError(
        `NEXON API ${response.status}: ${body.slice(0, 300)}`,
        { status: response.status, retryable },
      );
      if (!retryable) throw error;
      lastError = error;
      const retryAfter = Number(response.headers.get("retry-after"));
      await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 750 * 2 ** attempt);
    } catch (error) {
      if (error instanceof NexonApiError && !error.retryable) throw error;
      lastError = error;
      await wait(750 * 2 ** attempt);
    }
  }
  throw lastError;
}

export async function mapWithKeyPool(items, keys, concurrencyPerKey, mapper, { onProgress } = {}) {
  const results = new Array(items.length);
  let cursor = 0;
  let completed = 0;

  async function worker(apiKey) {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        results[index] = { ok: true, value: await mapper(items[index], apiKey, index) };
      } catch (error) {
        results[index] = {
          ok: false,
          error: {
            message: String(error?.message || error),
            status: Number(error?.status || 0),
          },
        };
      }
      completed += 1;
      onProgress?.({ completed, total: items.length });
    }
  }

  const workers = keys.flatMap((key) =>
    Array.from({ length: concurrencyPerKey }, () => worker(key)),
  );
  await Promise.all(workers);
  return results;
}

export function nicknamePath(nickname) {
  return `/fconline/v1/id?nickname=${encodeURIComponent(nickname)}`;
}

export function latestManagerMatchPath(ouid, offset = 0, limit = 1) {
  return `/fconline/v1/user/match?ouid=${encodeURIComponent(ouid)}&matchtype=52&offset=${offset}&limit=${limit}`;
}

export function matchDetailPath(matchId) {
  return `/fconline/v1/match-detail?matchid=${encodeURIComponent(matchId)}`;
}
