import * as XLSX from "xlsx";

const JPX_LISTING_URL =
  "https://www.jpx.co.jp/markets/statistics-equities/misc/tvdivq0000001vg2-att/data_j.xls";

export type MarketSegment = "PRIME" | "STANDARD" | "GROWTH" | "OTHER" | "UNKNOWN";

export interface JpxListingInfo {
  code4: string;
  marketSegment: MarketSegment;
  marketPriority: number;
  marketProductCategory: string;
}

function classifyMarketSegment(productCategory: string): {
  marketSegment: MarketSegment;
  marketPriority: number;
} {
  if (productCategory.includes("プライム")) {
    return { marketSegment: "PRIME", marketPriority: 0 };
  }
  if (productCategory.includes("スタンダード")) {
    return { marketSegment: "STANDARD", marketPriority: 1 };
  }
  if (productCategory.includes("グロース")) {
    return { marketSegment: "GROWTH", marketPriority: 2 };
  }
  if (productCategory.includes("内国株式") || productCategory.includes("PRO Market")) {
    return { marketSegment: "OTHER", marketPriority: 3 };
  }
  return { marketSegment: "UNKNOWN", marketPriority: 9 };
}

export function normalizeSecCode(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }

  const digits = raw.replace(/\D/g, "");
  if (!digits) {
    return null;
  }

  if (digits.length === 5 && digits.endsWith("0")) {
    return digits.slice(0, 4);
  }

  if (digits.length === 4) {
    return digits;
  }

  if (digits.length > 5) {
    return digits.slice(0, 4);
  }

  return null;
}

export async function fetchJpxListingMap(): Promise<Map<string, JpxListingInfo>> {
  const response = await fetch(JPX_LISTING_URL, {
    headers: {
      Accept: "application/vnd.ms-excel",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch JPX listing data: HTTP ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const workbook = XLSX.read(bytes, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as string[][];

  const listingMap = new Map<string, JpxListingInfo>();

  for (const row of rows.slice(1)) {
    const code4 = (row[1] ?? "").toString().trim();
    const productCategory = (row[3] ?? "").toString().trim();

    if (!/^\d{4}$/.test(code4) || !productCategory) {
      continue;
    }

    const { marketSegment, marketPriority } = classifyMarketSegment(productCategory);

    listingMap.set(code4, {
      code4,
      marketSegment,
      marketPriority,
      marketProductCategory: productCategory,
    });
  }

  return listingMap;
}
