const KST_OFFSET = 9 * 60 * 60 * 1000;

export function expectedKstDataTime(now = new Date()) {
  const shifted = new Date(now.getTime() + KST_OFFSET);
  if (shifted.getUTCMinutes() < 5) shifted.setUTCHours(shifted.getUTCHours() - 1);
  shifted.setUTCMinutes(0, 0, 0);
  return `${shifted.toISOString().slice(0, 19)}+09:00`;
}

export function inspectSnapshotFreshness(snapshot, now = new Date()) {
  const expectedDataTime = expectedKstDataTime(now);
  const snapshotDataTime = snapshot?.data_time || null;
  const snapshotTimestamp = snapshotDataTime ? Date.parse(snapshotDataTime) : Number.NaN;
  const expectedTimestamp = Date.parse(expectedDataTime);
  return {
    fresh: Number.isFinite(snapshotTimestamp) && snapshotTimestamp >= expectedTimestamp,
    snapshotDataTime,
    expectedDataTime,
  };
}
