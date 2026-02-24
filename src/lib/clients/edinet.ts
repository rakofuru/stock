import { env, requireEdinetApiKey } from "@/lib/env";

export interface EdinetCompany {
  edinet_code: string;
  sec_code: string | null;
  name: string;
  industry: string | null;
  accounting_standard?: string | null;
  credit_score?: number | null;
  credit_rating?: string | null;
}

export interface EdinetFinancial {
  fiscal_year: number;
  revenue: number | null;
  operating_income: number | null;
  ordinary_income: number | null;
  net_income: number | null;
  total_assets: number | null;
  net_assets: number | null;
  eps: number | null;
  per: number | null;
  roe_official: number | null;
  equity_ratio_official: number | null;
  bps: number | null;
  dividend_per_share: number | null;
  cf_operating: number | null;
  cf_investing: number | null;
  cf_financing: number | null;
  cash: number | null;
  accounting_standard?: string | null;
}

export interface EdinetTextBlock {
  section: string;
  text: string;
}

export class EdinetApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly responseBody: string,
  ) {
    super(message);
    this.name = "EdinetApiError";
  }
}

export class EdinetRateLimitError extends EdinetApiError {
  constructor(
    message: string,
    responseBody: string,
    public readonly limit: string | null,
    public readonly remaining: string | null,
    public readonly reset: string | null,
  ) {
    super(message, 429, responseBody);
    this.name = "EdinetRateLimitError";
  }
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestEdinet<T>(path: string, retries = 3): Promise<T> {
  const url = `${env.EDINET_BASE_URL}${path}`;
  const apiKey = requireEdinetApiKey();
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "X-API-Key": apiKey,
          Accept: "application/json",
        },
      });

      const responseBody = await response.text();

      if (response.status === 429) {
        throw new EdinetRateLimitError(
          "EDINET daily rate limit reached.",
          responseBody,
          response.headers.get("x-ratelimit-limit"),
          response.headers.get("x-ratelimit-remaining"),
          response.headers.get("x-ratelimit-reset"),
        );
      }

      if (response.status >= 500 && attempt < retries) {
        await sleep(500 * Math.pow(2, attempt));
        continue;
      }

      if (!response.ok) {
        throw new EdinetApiError(
          `EDINET request failed with status ${response.status} for ${path}`,
          response.status,
          responseBody,
        );
      }

      return JSON.parse(responseBody) as T;
    } catch (error) {
      lastError = error;
      const isNetworkError = error instanceof TypeError;
      if (isNetworkError && attempt < retries) {
        await sleep(500 * Math.pow(2, attempt));
        continue;
      }
      throw error;
    }
  }

  throw lastError;
}

export async function fetchCompanies(perPage = 5000): Promise<EdinetCompany[]> {
  const payload = await requestEdinet<{ data: EdinetCompany[] }>(`/companies?per_page=${perPage}`);
  return payload.data;
}

export async function fetchFinancials(code: string, years = 5): Promise<EdinetFinancial[]> {
  const payload = await requestEdinet<{ data: EdinetFinancial[] }>(
    `/companies/${encodeURIComponent(code)}/financials?years=${years}`,
  );
  return payload.data;
}

export async function fetchTextBlocks(code: string): Promise<EdinetTextBlock[]> {
  const payload = await requestEdinet<{ data: EdinetTextBlock[] }>(
    `/companies/${encodeURIComponent(code)}/text-blocks`,
  );
  return payload.data;
}

export async function fetchCompany(code: string): Promise<EdinetCompany & { latest_financials?: EdinetFinancial }> {
  const payload = await requestEdinet<{ data: EdinetCompany & { latest_financials?: EdinetFinancial } }>(
    `/companies/${encodeURIComponent(code)}`,
  );
  return payload.data;
}

