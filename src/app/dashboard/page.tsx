"use client";

import { useEffect, useMemo, useState } from "react";
import { formatNumber, formatPercent } from "@/lib/format";

interface Cycle {
  id: string;
  status: "RUNNING" | "PAUSED" | "COMPLETED" | "FAILED";
  cursor: number;
  totalCompanies: number;
  processedCount: number;
  startedAt: string;
  endedAt: string | null;
  dailyLimit: number;
  lastError: string | null;
  prioritySummary: string | null;
}

interface FailureItem {
  createdAt: string;
  edinetCode: string | null;
  jobType: string;
  errorMessage: string | null;
  httpStatus: number | null;
}

interface CollectionStatus {
  cycle: Cycle | null;
  progressPercent: number;
  todayRequests: number;
  remainingToday: number;
  remainingCompanies: number;
  dailyProcessCapacity: number;
  estimatedDaysLeft: number;
  estimatedCompletionDayJst: string;
  nextResetAt?: string;
  failures: FailureItem[];
}

function getNextJstResetText(nextResetAt?: string) {
  if (nextResetAt) {
    return new Date(nextResetAt).toLocaleString("ja-JP", {
      timeZone: "Asia/Tokyo",
      hour12: false,
    });
  }

  const now = new Date();
  const jstNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  jstNow.setHours(24, 0, 0, 0);
  return jstNow.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour12: false,
  });
}

export default function DashboardPage() {
  const [status, setStatus] = useState<CollectionStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [runningCollection, setRunningCollection] = useState(false);
  const [runningScreening, setRunningScreening] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const cycleStatusClass = useMemo(() => {
    const value = status?.cycle?.status;
    if (value === "COMPLETED") {
      return "status-pill ok";
    }
    if (value === "FAILED") {
      return "status-pill error";
    }
    if (value === "PAUSED") {
      return "status-pill warn";
    }
    return "status-pill";
  }, [status?.cycle?.status]);

  async function fetchStatus() {
    setLoading(true);
    try {
      const response = await fetch("/api/collection/status", { cache: "no-store" });
      const payload = await response.json();
      if (payload.ok) {
        setStatus(payload.data);
      }
    } finally {
      setLoading(false);
    }
  }

  async function runCollection() {
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
        throw new Error(payload.error ?? "収集処理に失敗しました");
      }
      setMessage(`収集処理: ${formatNumber(payload.data.processedThisRun, 0)}件を処理しました`);
      await fetchStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "収集処理に失敗しました");
    } finally {
      setRunningCollection(false);
    }
  }

  async function runScreening() {
    setRunningScreening(true);
    setMessage(null);
    try {
      const response = await fetch("/api/screenings/run", { method: "POST" });
      const payload = await response.json();
      if (!payload.ok) {
        throw new Error(payload.error ?? "スクリーニング実行に失敗しました");
      }
      setMessage(`スクリーニング実行: ${formatNumber(payload.data.totalCompanies, 0)}件`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "スクリーニング実行に失敗しました");
    } finally {
      setRunningScreening(false);
    }
  }

  useEffect(() => {
    void fetchStatus();
    const id = setInterval(() => {
      void fetchStatus();
    }, 20000);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="page-grid">
      <div className="panel">
        <div className="spaced">
          <div>
            <h2>収集ダッシュボード</h2>
            <p className="muted">普段は「絞り込み検索」を使い、ここは収集状態の監視・再開に使ってください。</p>
          </div>
          <div className="row">
            <button className="button secondary" onClick={() => void fetchStatus()} disabled={loading}>
              再読込
            </button>
            <button className="button" onClick={() => void runCollection()} disabled={runningCollection}>
              {runningCollection ? "収集中..." : "収集を再開"}
            </button>
            <button className="button ghost" onClick={() => void runScreening()} disabled={runningScreening}>
              {runningScreening ? "実行中..." : "スクリーニング実行"}
            </button>
          </div>
        </div>

        {status?.cycle ? (
          <div className="page-grid" style={{ marginTop: "0.9rem" }}>
            <div className="row">
              <span className={cycleStatusClass}>{status.cycle.status}</span>
              <span className="muted num">Cycle ID: {status.cycle.id}</span>
            </div>

            <div className="progress-track">
              <div className="progress-bar" style={{ width: `${Math.min(100, status.progressPercent)}%` }} />
            </div>

            <div className="kpi-grid">
              <div className="kpi">
                <div className="kpi-label">進捗</div>
                <div className="kpi-value num">
                  {formatNumber(status.cycle.cursor, 0)} / {formatNumber(status.cycle.totalCompanies, 0)}
                </div>
              </div>
              <div className="kpi">
                <div className="kpi-label">進捗率</div>
                <div className="kpi-value num">{formatPercent(status.progressPercent, 2)}</div>
              </div>
              <div className="kpi">
                <div className="kpi-label">本日のEDINET使用</div>
                <div className="kpi-value num">{formatNumber(status.todayRequests, 0)}</div>
              </div>
              <div className="kpi">
                <div className="kpi-label">本日の残り枠</div>
                <div className="kpi-value num">{formatNumber(status.remainingToday, 0)}</div>
              </div>
              <div className="kpi">
                <div className="kpi-label">完了見込み</div>
                <div className="kpi-value num">{formatNumber(status.estimatedDaysLeft, 0)} 日</div>
                <p className="muted num" style={{ marginTop: "0.3rem" }}>
                  予定日: {status.estimatedCompletionDayJst} (JST)
                </p>
              </div>
              <div className="kpi">
                <div className="kpi-label">残り企業数</div>
                <div className="kpi-value num">{formatNumber(status.remainingCompanies, 0)}</div>
                <p className="muted num" style={{ marginTop: "0.3rem" }}>
                  1日処理能力: {formatNumber(status.dailyProcessCapacity, 0)} 件
                </p>
              </div>
              <div className="kpi">
                <div className="kpi-label">次回リセット (JST)</div>
                <div className="kpi-value num">{getNextJstResetText(status.nextResetAt)}</div>
              </div>
            </div>

            {status.cycle.prioritySummary ? (
              <p className="muted">優先順サマリー: {status.cycle.prioritySummary}</p>
            ) : null}

            {status.cycle.lastError ? <p className="muted">最新メッセージ: {status.cycle.lastError}</p> : null}
          </div>
        ) : (
          <p className="muted" style={{ marginTop: "0.75rem" }}>
            収集サイクルがまだありません。「収集を再開」で初回開始できます。
          </p>
        )}

        {message ? <p style={{ marginTop: "0.85rem" }}>{message}</p> : null}
      </div>

      <div className="panel">
        <h2>直近エラー</h2>
        {status?.failures?.length ? (
          <div className="table-scroll" style={{ marginTop: "0.7rem" }}>
            <table>
              <thead>
                <tr>
                  <th>時刻</th>
                  <th>コード</th>
                  <th>ジョブ</th>
                  <th>HTTP</th>
                  <th>内容</th>
                </tr>
              </thead>
              <tbody>
                {status.failures.map((item, index) => (
                  <tr key={`${item.createdAt}-${index}`}>
                    <td>{new Date(item.createdAt).toLocaleString("ja-JP")}</td>
                    <td className="num">{item.edinetCode ?? "-"}</td>
                    <td>{item.jobType}</td>
                    <td className="num">{item.httpStatus ?? "-"}</td>
                    <td>{item.errorMessage ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">エラーはありません。</p>
        )}
      </div>
    </section>
  );
}
