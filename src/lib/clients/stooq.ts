export interface StooqDailyRow {
  date: Date;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: bigint | null;
}

const STOOQ_BASE = "https://stooq.com";

function toNullableNumber(value: string): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function toStooqSymbol(secCode: string | null | undefined): string | null {
  if (!secCode) {
    return null;
  }
  const compact = secCode.replace(/\s+/g, "").toUpperCase();
  const noSuffixZero = compact.length === 5 && compact.endsWith("0") ? compact.slice(0, -1) : compact;

  if (!/^[0-9A-Z]{4,5}$/.test(noSuffixZero)) {
    return null;
  }
  return `${noSuffixZero}.JP`;
}

export async function fetchStooqDaily(symbol: string): Promise<StooqDailyRow[]> {
  const url = `${STOOQ_BASE}/q/d/l/?s=${encodeURIComponent(symbol.toLowerCase())}&i=d`;
  const response = await fetch(url, {
    headers: {
      Accept: "text/plain",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Stooq data: HTTP ${response.status}`);
  }

  const csv = await response.text();
  if (!csv.includes("Date,Open,High,Low,Close,Volume")) {
    return [];
  }

  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const rows: StooqDailyRow[] = [];

  for (const line of lines.slice(1)) {
    const [dateStr, openStr, highStr, lowStr, closeStr, volumeStr] = line.split(",");
    if (!dateStr || !closeStr) {
      continue;
    }

    const close = Number(closeStr);
    if (!Number.isFinite(close)) {
      continue;
    }

    const date = new Date(`${dateStr}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) {
      continue;
    }

    const volumeNumber = Number(volumeStr);
    const volume = Number.isFinite(volumeNumber) ? BigInt(Math.trunc(volumeNumber)) : null;

    rows.push({
      date,
      open: toNullableNumber(openStr),
      high: toNullableNumber(highStr),
      low: toNullableNumber(lowStr),
      close,
      volume,
    });
  }

  return rows;
}

