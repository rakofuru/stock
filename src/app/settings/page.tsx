"use client";

import { useEffect, useState } from "react";
import { CRITERIA_LABELS } from "@/lib/defaults";
import { formatNumber } from "@/lib/format";
import type { ScreeningWeights } from "@/lib/types";

interface SamRow {
  id: string;
  industry: string;
  sam: number;
  assumedShare: number;
  futureMultiple: number;
}

interface KeywordRow {
  id: string;
  keyword: string;
  enabled: boolean;
}

interface CollectionMonitor {
  level: "OK" | "WARN" | "ERROR";
  message: string;
  keyCount: number;
  stalled: boolean;
  failuresInWindow: number;
  rateLimitInWindow: number;
  latestSuccessfulAt: string | null;
  latestFailure:
    | {
        createdAt: string;
        edinetCode: string | null;
        jobType: string;
        httpStatus: number | null;
        errorMessage: string | null;
      }
    | null;
}

interface CollectionCycle {
  status: "RUNNING" | "PAUSED" | "COMPLETED" | "FAILED";
  cursor: number;
  totalCompanies: number;
  lastError: string | null;
}

interface CollectionStatusPayload {
  cycle: CollectionCycle | null;
  todayRequests: number;
  remainingToday: number;
  remainingCompanies: number;
  nextResetAt?: string;
  monitor: CollectionMonitor;
}

const EMPTY_WEIGHTS: ScreeningWeights = {
  priceToSalesCheap: 1,
  netCashVsMarketCap: 1,
  samUpside: 1,
  perReasonable: 1,
  pbrUnderOne: 1,
  cashFlowHealth: 1,
  highPriceAvoidance: 1,
  growthConsistency: 1,
  equityStrengthBonus: 1,
  foreignOwnershipCheck: 1,
  textRiskCheck: 1,
};

const WEIGHT_KEYS = Object.keys(EMPTY_WEIGHTS) as Array<keyof ScreeningWeights>;

function formatSamInput(value: number) {
  if (!Number.isFinite(value)) {
    return "";
  }
  return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(value);
}

export default function SettingsPage() {
  const [weights, setWeights] = useState<ScreeningWeights>(EMPTY_WEIGHTS);
  const [samRows, setSamRows] = useState<SamRow[]>([]);
  const [samMultiplier, setSamMultiplier] = useState(10);
  const [keywords, setKeywords] = useState<KeywordRow[]>([]);
  const [collectionStatus, setCollectionStatus] = useState<CollectionStatusPayload | null>(null);
  const [keywordInput, setKeywordInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [runningCollection, setRunningCollection] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const monitorPillClass =
    collectionStatus?.monitor.level === "ERROR"
      ? "status-pill error"
      : collectionStatus?.monitor.level === "WARN"
        ? "status-pill warn"
        : "status-pill ok";

  function toJst(value?: string | null) {
    if (!value) {
      return "-";
    }
    return new Date(value).toLocaleString("ja-JP", {
      timeZone: "Asia/Tokyo",
      hour12: false,
    });
  }

  async function loadAll() {
    setLoading(true);
    setMessage(null);
    try {
      const [weightsRes, samRes, keywordRes, collectionRes] = await Promise.all([
        fetch("/api/settings/weights", { cache: "no-store" }),
        fetch("/api/settings/sam", { cache: "no-store" }),
        fetch("/api/settings/risk-keywords", { cache: "no-store" }),
        fetch("/api/collection/status", { cache: "no-store" }),
      ]);

      const [weightsJson, samJson, keywordJson, collectionJson] = await Promise.all([
        weightsRes.json(),
        samRes.json(),
        keywordRes.json(),
        collectionRes.json(),
      ]);

      if (weightsJson.ok) {
        setWeights(weightsJson.data);
      }
      if (samJson.ok) {
        setSamRows(samJson.data);
      }
      if (keywordJson.ok) {
        setKeywords(keywordJson.data);
      }
      if (collectionJson.ok) {
        setCollectionStatus(collectionJson.data);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "設定の読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  async function refreshCollectionStatus() {
    try {
      const response = await fetch("/api/collection/status", { cache: "no-store" });
      const payload = await response.json();
      if (payload.ok) {
        setCollectionStatus(payload.data);
      }
    } catch {
      // ignore and keep latest panel state
    }
  }

  async function runCollectionOnce() {
    setRunningCollection(true);
    setMessage(null);
    try {
      const response = await fetch("/api/collection/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = await response.json();
      if (!payload.ok) {
        throw new Error(payload.error ?? "収集実行に失敗しました");
      }
      setMessage(
        `収集実行: ${formatNumber(payload.data.processedThisRun, 0)}件処理 / 状態 ${payload.data.status}`,
      );
      await refreshCollectionStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "収集実行に失敗しました");
    } finally {
      setRunningCollection(false);
    }
  }

  async function saveWeights() {
    setMessage(null);
    const response = await fetch("/api/settings/weights", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weights }),
    });
    const payload = await response.json();
    setMessage(payload.ok ? "重み設定を保存しました" : `保存失敗: ${payload.error}`);
  }

  async function saveSam() {
    setMessage(null);
    const response = await fetch("/api/settings/sam", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: samRows.map((row) => ({
          industry: row.industry,
          sam: Number(row.sam),
          assumedShare: Number(row.assumedShare),
          futureMultiple: Number(row.futureMultiple),
        })),
      }),
    });
    const payload = await response.json();
    if (payload.ok) {
      setSamRows(payload.data);
      setMessage("SAM設定を保存しました");
    } else {
      setMessage(`保存失敗: ${payload.error}`);
    }
  }

  async function recalculateSamByMedianRevenue() {
    setMessage(null);
    const response = await fetch("/api/settings/sam", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        revenueMultiplier: Number(samMultiplier),
        roundUnit: 100000000,
      }),
    });
    const payload = await response.json();
    if (payload.ok) {
      setSamRows(payload.data);
      const summary = payload.summary as
        | {
            revenueMultiplier?: number;
            sampledCompanies?: number;
            updatedIndustries?: number;
          }
        | undefined;
      setMessage(
        `SAM再計算完了: 倍率 ${formatNumber(summary?.revenueMultiplier ?? samMultiplier, 2)}x / ` +
          `対象企業 ${formatNumber(summary?.sampledCompanies ?? 0, 0)} 社 / ` +
          `更新業種 ${formatNumber(summary?.updatedIndustries ?? 0, 0)} 件`,
      );
    } else {
      setMessage(`再計算失敗: ${payload.error}`);
    }
  }

  async function saveKeywords() {
    setMessage(null);
    const response = await fetch("/api/settings/risk-keywords", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: keywords.map((row) => ({
          keyword: row.keyword,
          enabled: row.enabled,
        })),
      }),
    });
    const payload = await response.json();
    if (payload.ok) {
      setKeywords(payload.data);
      setMessage("危険ワード辞書を保存しました");
    } else {
      setMessage(`保存失敗: ${payload.error}`);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  return (
    <section className="page-grid">
      <div className="panel">
        <div className="spaced">
          <div>
            <h2>収集監視</h2>
            <p className="muted">UI上で収集停止/429/失敗状況を確認できます。</p>
          </div>
          <div className="row">
            <button className="button secondary" onClick={() => void refreshCollectionStatus()}>
              状態更新
            </button>
            <button className="button" onClick={() => void runCollectionOnce()} disabled={runningCollection}>
              {runningCollection ? "収集中..." : "収集を1回実行"}
            </button>
          </div>
        </div>

        <div className="kpi-grid" style={{ marginTop: "0.75rem" }}>
          <div className="kpi">
            <div className="kpi-label">監視レベル</div>
            <div className="kpi-value">
              <span className={monitorPillClass}>{collectionStatus?.monitor.level ?? "-"}</span>
            </div>
            <p className="muted" style={{ marginTop: "0.3rem" }}>
              {collectionStatus?.monitor.message ?? "-"}
            </p>
          </div>
          <div className="kpi">
            <div className="kpi-label">本日のEDINET使用</div>
            <div className="kpi-value num">{formatNumber(collectionStatus?.todayRequests ?? 0, 0)}</div>
            <p className="muted num" style={{ marginTop: "0.3rem" }}>
              残り: {formatNumber(collectionStatus?.remainingToday ?? 0, 0)}
            </p>
          </div>
          <div className="kpi">
            <div className="kpi-label">失敗(24h) / 429(24h)</div>
            <div className="kpi-value num">
              {formatNumber(collectionStatus?.monitor.failuresInWindow ?? 0, 0)} /{" "}
              {formatNumber(collectionStatus?.monitor.rateLimitInWindow ?? 0, 0)}
            </div>
            <p className="muted num" style={{ marginTop: "0.3rem" }}>
              キー数: {formatNumber(collectionStatus?.monitor.keyCount ?? 0, 0)}
            </p>
          </div>
          <div className="kpi">
            <div className="kpi-label">最新成功 / 次回リセット(JST)</div>
            <div className="kpi-value num">{toJst(collectionStatus?.monitor.latestSuccessfulAt ?? null)}</div>
            <p className="muted num" style={{ marginTop: "0.3rem" }}>
              {toJst(collectionStatus?.nextResetAt)}
            </p>
          </div>
        </div>

        {collectionStatus?.monitor.latestFailure ? (
          <p className="muted break-word" style={{ marginTop: "0.55rem" }}>
            直近失敗: {toJst(collectionStatus.monitor.latestFailure.createdAt)} /{" "}
            {collectionStatus.monitor.latestFailure.jobType} /{" "}
            {collectionStatus.monitor.latestFailure.edinetCode ?? "-"} / HTTP{" "}
            {collectionStatus.monitor.latestFailure.httpStatus ?? "-"} /{" "}
            {collectionStatus.monitor.latestFailure.errorMessage ?? "-"}
          </p>
        ) : null}
      </div>

      {message ? (
        <div className="panel" style={{ padding: "0.75rem 0.9rem" }}>
          <p className="muted break-word">{message}</p>
        </div>
      ) : null}

      <div className="panel">
        <div className="spaced">
          <div>
            <h2>重み設定</h2>
            <p className="muted">判定ごとの重み。0で無効化できます。</p>
          </div>
          <div className="row">
            <button className="button secondary" onClick={() => void loadAll()} disabled={loading}>
              再読込
            </button>
            <button className="button" onClick={() => void saveWeights()}>
              重みを保存
            </button>
          </div>
        </div>

        <div className="settings-weight-grid" style={{ marginTop: "0.75rem" }}>
          {WEIGHT_KEYS.map((key) => (
            <label key={key} className="settings-weight-item">
              <span className="settings-weight-label">{CRITERIA_LABELS[key]}</span>
              <span className="settings-weight-key num">{key}</span>
              <input
                type="number"
                step={0.1}
                min={0}
                max={5}
                value={weights[key]}
                onChange={(event) =>
                  setWeights((prev) => ({
                    ...prev,
                    [key]: Number(event.target.value),
                  }))
                }
              />
            </label>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="spaced">
          <div>
            <h2>SAM設定</h2>
            <p className="muted">業種ごとの SAM / 想定シェア / 将来倍率（中央値ベース再計算対応）。</p>
          </div>
          <div className="row">
            <button className="button secondary" onClick={() => void recalculateSamByMedianRevenue()}>
              実データ中央値で再計算
            </button>
            <button className="button" onClick={() => void saveSam()}>
              SAMを保存
            </button>
          </div>
        </div>

        <div className="row" style={{ marginTop: "0.65rem" }}>
          <label style={{ minWidth: "220px", maxWidth: "320px" }}>
            中央値売上倍率（SAM = 業種売上中央値 × 倍率）
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={samMultiplier}
              onChange={(event) => setSamMultiplier(Number(event.target.value))}
            />
          </label>
          <p className="muted">各社の最新年度売上を業種ごとに集計し、平均ではなく中央値で算出します。</p>
        </div>

        <div className="table-scroll" style={{ marginTop: "0.75rem", maxHeight: "45vh" }}>
          <table>
            <thead>
              <tr>
                <th>業種</th>
                <th>SAM</th>
                <th>想定シェア</th>
                <th>倍率</th>
              </tr>
            </thead>
            <tbody>
              {samRows.map((row) => (
                <tr key={row.id}>
                  <td className="break-word">{row.industry}</td>
                  <td>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={formatSamInput(row.sam)}
                      onChange={(event) => {
                        const normalized = event.target.value.replaceAll(",", "").trim();
                        if (normalized === "") {
                          setSamRows((prev) =>
                            prev.map((item) => (item.id === row.id ? { ...item, sam: 0 } : item)),
                          );
                          return;
                        }
                        if (!/^\d+$/.test(normalized)) {
                          return;
                        }
                        const nextSam = Number(normalized);
                        if (!Number.isFinite(nextSam)) {
                          return;
                        }
                        setSamRows((prev) =>
                          prev.map((item) => (item.id === row.id ? { ...item, sam: nextSam } : item)),
                        );
                      }}
                    />
                    <p className="muted num" style={{ marginTop: "0.3rem" }}>
                      現在値: {formatNumber(row.sam, 0)}
                    </p>
                  </td>
                  <td>
                    <input
                      type="number"
                      step={0.001}
                      value={row.assumedShare}
                      onChange={(event) =>
                        setSamRows((prev) =>
                          prev.map((item) =>
                            item.id === row.id
                              ? {
                                  ...item,
                                  assumedShare: Number(event.target.value),
                                }
                              : item,
                          ),
                        )
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step={0.1}
                      value={row.futureMultiple}
                      onChange={(event) =>
                        setSamRows((prev) =>
                          prev.map((item) =>
                            item.id === row.id
                              ? {
                                  ...item,
                                  futureMultiple: Number(event.target.value),
                                }
                              : item,
                          ),
                        )
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </div>

      <div className="panel">
        <div className="spaced">
          <div>
            <h2>危険ワード辞書</h2>
            <p className="muted">テキスト判定で使うキーワード辞書です。</p>
          </div>
          <button className="button" onClick={() => void saveKeywords()}>
            ワードを保存
          </button>
        </div>

        <div className="row" style={{ marginTop: "0.7rem" }}>
          <input
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            placeholder="追加する危険ワード"
          />
          <button
            className="button secondary"
            onClick={() => {
              const keyword = keywordInput.trim();
              if (!keyword) {
                return;
              }
              setKeywords((prev) => {
                if (prev.some((row) => row.keyword === keyword)) {
                  return prev;
                }
                return [
                  ...prev,
                  {
                    id: `local-${Date.now()}`,
                    keyword,
                    enabled: true,
                  },
                ];
              });
              setKeywordInput("");
            }}
          >
            追加
          </button>
        </div>

        <div className="table-scroll" style={{ marginTop: "0.7rem", maxHeight: "35vh" }}>
          <table>
            <thead>
              <tr>
                <th>有効</th>
                <th>キーワード</th>
              </tr>
            </thead>
            <tbody>
              {keywords.map((row, idx) => (
                <tr key={`${row.id}-${idx}`}>
                  <td>
                    <input
                      type="checkbox"
                      checked={row.enabled}
                      onChange={(event) =>
                        setKeywords((prev) =>
                          prev.map((item) =>
                            item.id === row.id
                              ? {
                                  ...item,
                                  enabled: event.target.checked,
                                }
                              : item,
                          ),
                        )
                      }
                    />
                  </td>
                  <td className="break-word">{row.keyword}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </div>
    </section>
  );
}
