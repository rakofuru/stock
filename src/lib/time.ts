export function getJstDayBounds(reference = new Date()) {
  const jstOffsetMs = 9 * 60 * 60 * 1000;
  const jstNow = new Date(reference.getTime() + jstOffsetMs);
  const jstStart = new Date(jstNow);
  jstStart.setUTCHours(0, 0, 0, 0);

  const start = new Date(jstStart.getTime() - jstOffsetMs);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const dayKey = jstStart.toISOString().slice(0, 10);

  return { start, end, dayKey };
}

