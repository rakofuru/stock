import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

describe("edinet client", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.EDINET_API_KEY = "test_key";
    process.env.EDINET_BASE_URL = "https://example.com/v1";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("throws rate-limit specific error on HTTP 429", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("{\"error\":\"limit\"}", {
          status: 429,
          headers: {
            "x-ratelimit-limit": "1000",
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": "2026-02-22",
          },
        }),
      ),
    );

    const client = await import("@/lib/clients/edinet");
    await expect(client.fetchCompanies(1)).rejects.toBeInstanceOf(client.EdinetRateLimitError);
  });

  test("retries on 5xx and succeeds", async () => {
    vi.useFakeTimers();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("server error", { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    vi.stubGlobal("fetch", fetchMock);

    const client = await import("@/lib/clients/edinet");
    const promise = client.fetchCompanies(1);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
