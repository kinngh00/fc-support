import { config } from "./config.mjs";
import { runCollection } from "./collector.mjs";
import { logger } from "./logger.mjs";

const KST_OFFSET = 9 * 60 * 60 * 1000;

export function nextKstRun(now = new Date()) {
  const shifted = new Date(now.getTime() + KST_OFFSET);
  let target = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
    shifted.getUTCHours(),
    5,
    0,
    0,
  ) - KST_OFFSET;
  if (target <= now.getTime()) target += 60 * 60 * 1000;
  return new Date(target);
}

export function startScheduler() {
  if (!config.schedulerEnabled) {
    logger.info("스케줄러", "정기 집계가 비활성화되어 있습니다.");
    return () => {};
  }
  if (config.nexonApiKeys.length === 0) {
    logger.warn("스케줄러", "API 키가 없어 정기 집계를 시작하지 못했습니다.");
    return () => {};
  }

  let timer;
  const schedule = () => {
    const next = nextKstRun();
    logger.info("스케줄러", "다음 자동 집계 시간을 예약했습니다.", {
      nextRunAt: next.toISOString(),
      nextRunKst: new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "medium" }).format(next),
    });
    timer = setTimeout(async () => {
      try {
        await runCollection();
      } catch (error) {
        logger.error("스케줄러", "예약된 자동 집계가 실패했습니다.", { error: String(error?.message || error) });
      } finally {
        schedule();
      }
    }, next.getTime() - Date.now());
  };
  schedule();
  return () => clearTimeout(timer);
}
