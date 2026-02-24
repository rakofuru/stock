import { env, requireEdinetApiKeys } from "@/lib/env";
import { getJstDayBounds } from "@/lib/time";

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

interface ApiKeyState {
  blockedUntilMs: number | null;
}

const keyStates = new Map<string, ApiKeyState>();
let nextKeyCursor = 0;

function toResetTimeMs(resetHeader: string | null): number | null {
  if (!resetHeader) {
    return null;
  }

  const numeric = Number(resetHeader);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
  }

  const parsed = Date.parse(resetHeader);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return parsed;
}

function fallbackResetMs() {
  return getJstDayBounds().end.getTime();
}

function ensureKeyState(key: string): ApiKeyState {
  const state = keyStates.get(key);
  if (state) {
    return state;
  }
  const created = { blockedUntilMs: null };
  keyStates.set(key, created);
  return created;
}

function markKeyRateLimited(key: string, resetHeader: string | null) {
  const state = ensureKeyState(key);
  state.blockedUntilMs = toResetTimeMs(resetHeader) ?? fallbackResetMs();
}

function clearExpiredKeyBlocks(keys: string[]) {
  const now = Date.now();
  for (const key of keys) {
    const state = ensureKeyState(key);
    if (state.blockedUntilMs != null && now >= state.blockedUntilMs) {
      state.blockedUntilMs = null;
    }
  }
}

function isKeyBlocked(key: string) {
  const state = ensureKeyState(key);
  return state.blockedUntilMs != null && Date.now() < state.blockedUntilMs;
}

function orderKeysRoundRobin(keys: string[]) {
  if (keys.length <= 1) {
    return keys;
  }

  const start = nextKeyCursor % keys.length;
  return [...keys.slice(start), ...keys.slice(0, start)];
}

function advanceKeyCursor(keys: string[], usedKey: string) {
  const index = keys.indexOf(usedKey);
  if (index >= 0) {
    nextKeyCursor = (index + 1) % keys.length;
  }
}

async function requestEdinet<T>(path: string, retries = 3): Promise<T> {
  const url = `${env.EDINET_BASE_URL}${path}`;
  const apiKeys = requireEdinetApiKeys();
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    clearExpiredKeyBlocks(apiKeys);
    const orderedKeys = orderKeysRoundRobin(apiKeys).filter((key) => !isKeyBlocked(key));

    if (orderedKeys.length === 0) {
      const resetCandidates = apiKeys
        .map((key) => ensureKeyState(key).blockedUntilMs)
        .filter((value): value is number => value != null);
      const nearestResetMs =
        resetCandidates.length > 0 ? Math.min(...resetCandidates) : getJstDayBounds().end.getTime();
      throw new EdinetRateLimitError(
        "All configured EDINET API keys are rate-limited.",
        "",
        String(apiKeys.length * 1000),
        "0",
        String(Math.floor(nearestResetMs / 1000)),
      );
    }

    let hadTransientFailure = false;

    for (const apiKey of orderedKeys) {
      try {
        const response = await fetch(url, {
          headers: {
            "X-API-Key": apiKey,
            Accept: "application/json",
          },
        });

        const responseBody = await response.text();

        if (response.status === 429) {
          markKeyRateLimited(apiKey, response.headers.get("x-ratelimit-reset"));
          lastError = new EdinetRateLimitError(
            "EDINET daily rate limit reached.",
            responseBody,
            response.headers.get("x-ratelimit-limit"),
            response.headers.get("x-ratelimit-remaining"),
            response.headers.get("x-ratelimit-reset"),
          );
          continue;
        }

        if (response.status >= 500) {
          hadTransientFailure = true;
          lastError = new EdinetApiError(
            `EDINET request failed with status ${response.status} for ${path}`,
            response.status,
            responseBody,
          );
          continue;
        }

        if (!response.ok) {
          throw new EdinetApiError(
            `EDINET request failed with status ${response.status} for ${path}`,
            response.status,
            responseBody,
          );
        }

        advanceKeyCursor(apiKeys, apiKey);
        return JSON.parse(responseBody) as T;
      } catch (error) {
        const isNetworkError = error instanceof TypeError;
        if (isNetworkError) {
          hadTransientFailure = true;
          lastError = error;
          continue;
        }
        throw error;
      }
    }

    if (lastError instanceof EdinetRateLimitError) {
      clearExpiredKeyBlocks(apiKeys);
      const stillBlocked = apiKeys.every((key) => isKeyBlocked(key));
      if (stillBlocked) {
        throw lastError;
      }
    }

    if (hadTransientFailure && attempt < retries) {
      await sleep(500 * Math.pow(2, attempt));
      continue;
    }

    if (lastError) {
      throw lastError;
    }

    await sleep(250);
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

