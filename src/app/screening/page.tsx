"use client";

import { useEffect, useMemo, useState } from "react";
import { formatNumber, formatPercent, signedClass } from "@/lib/format";
import type { CriterionEvaluation, ScreeningMetrics } from "@/lib/types";

const PER_PAGE_OPTIONS = [30, 50, 100, 300, 500] as const;

interface ScreeningRow {
  id: string;
  edinetCode: string;
  gatePassed: boolean;
  score: number;
  coverage: number;
  pendingCount: number;
  criteriaJson: CriterionEvaluation[];
  metricsJson: ScreeningMetrics;
  company: {
    name: string;
    industry: string | null;
    secCode: string | null;
  };
}

interface ScreeningPayload {
  run: {
    id: string;
    startedAt: string;
    endedAt: string | null;
  } | null;
  pagination: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
  };
  data: ScreeningRow[];
}

function buildQuery(params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") {
      continue;
    }
    query.set(key, String(value));
  }
  return query.toString();
}

function badgeClass(status: CriterionEvaluation["status"]) {
  if (status === "PASS") {
    return "status-pill ok";
  }
  if (status === "FAIL") {
    return "status-pill error";
  }
  return "status-pill warn";
}

function formatCriterionField(value: number | string | null | undefined) {
  if (value == null) {
    return "-";
  }
  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      return formatNumber(value, 0);
    }
    return formatNumber(value, 3);
  }
  return value;
}

function ScreeningDetailContent({ selected }: { selected: ScreeningRow }) {
  return (
    <div className="page-grid">
      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-label">企業名</div>
          <div className="kpi-value break-word">{selected.company.name}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">スコア</div>
          <div className="kpi-value num">{formatNumber(selected.score, 2)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">評価率</div>
          <div className="kpi-value num">{formatPercent(selected.coverage, 2)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">最大ドローダウン</div>
          <div className={`kpi-value num ${signedClass(selected.metricsJson.maxDrawdownPct ?? 0)}`}>
            {selected.metricsJson.maxDrawdownPct == null
              ? "PENDING"
              : `${formatNumber(selected.metricsJson.maxDrawdownPct, 2)}%`}
          </div>
        </div>
      </div>

      <div className="table-scroll">
        <table className="screening-detail-table">
          <thead>
            <tr>
              <th>指標</th>
              <th>値</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="metric-label">推計時価総額</td>
              <td className={`num metric-value ${signedClass(selected.metricsJson.marketCapEst)}`}>
                {formatNumber(selected.metricsJson.marketCapEst, 0)}
              </td>
            </tr>
            <tr>
              <td className="metric-label">PBR推計</td>
              <td className={`num metric-value ${signedClass(selected.metricsJson.pbrEst)}`}>
                {formatNumber(selected.metricsJson.pbrEst, 2)}
              </td>
            </tr>
            <tr>
              <td className="metric-label">PSR（時価総額/売上）</td>
              <td className={`num metric-value ${signedClass(selected.metricsJson.priceToSales)}`}>
                {formatNumber(selected.metricsJson.priceToSales, 3)}
              </td>
            </tr>
            <tr>
              <td className="metric-label">総負債推計</td>
              <td className={`num metric-value ${signedClass(selected.metricsJson.totalLiabilities)}`}>
                {formatNumber(selected.metricsJson.totalLiabilities, 0)}
              </td>
            </tr>
            <tr>
              <td className="metric-label">ネットキャッシュ</td>
              <td className={`num metric-value ${signedClass(selected.metricsJson.netCash)}`}>
                {formatNumber(selected.metricsJson.netCash, 0)}
              </td>
            </tr>
            <tr>
              <td className="metric-label">現在価格位置（現在値/5年高値）</td>
              <td className={`num metric-value ${signedClass(selected.metricsJson.highPositionRatio)}`}>
                {formatNumber(selected.metricsJson.highPositionRatio, 3)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div>
        <h3 style={{ marginBottom: "0.5rem" }}>判定内訳</h3>
        <div className="criterion-list">
          {selected.criteriaJson.map((criterion) => (
            <div key={criterion.key} className="criterion-row">
              <div className="spaced">
                <strong className="break-word">{criterion.label}</strong>
                <span className={badgeClass(criterion.status)}>{criterion.status}</span>
              </div>
              <p className="muted num break-word">
                重み: {formatNumber(criterion.weight, 1)} / 値: {formatCriterionField(criterion.value)} / 基準:{" "}
                {formatCriterionField(criterion.threshold)}
              </p>
              {criterion.note ? <p className="muted break-word">{criterion.note}</p> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ScreeningPage() {
  const [rows, setRows] = useState<ScreeningRow[]>([]);
  const [payload, setPayload] = useState<ScreeningPayload | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileExpandedId, setMobileExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [filters, setFilters] = useState({
    minScore: 0,
    perPage: 30,
    q: "",
    industry: "",
    gate: "all" as "all" | "true" | "false",
  });

  const [applied, setApplied] = useState({
    page: 1,
    minScore: 0,
    perPage: 30,
    q: "",
    industry: "",
    gate: "all" as "all" | "true" | "false",
  });

  const selected = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? rows[0] ?? null,
    [rows, selectedId],
  );

  async function fetchLatest() {
    setLoading(true);
    setMessage(null);
    try {
      const query = buildQuery({
        page: applied.page,
        perPage: applied.perPage,
        minScore: applied.minScore,
        q: applied.q,
        industry: applied.industry,
        gatePassed: applied.gate === "all" ? undefined : applied.gate,
      });

      const response = await fetch(`/api/screenings/latest?${query}`, { cache: "no-store" });
      const json = await response.json();
      if (!json.ok) {
        throw new Error(json.error ?? "スクリーニング結果の取得に失敗しました");
      }

      const data = json.data as ScreeningPayload;
      setPayload(data);
      setRows(data.data);
      setSelectedId((prev) => {
        if (prev && data.data.some((row) => row.id === prev)) {
          return prev;
        }
        return data.data.length > 0 ? data.data[0].id : null;
      });
      setMobileExpandedId((prev) => {
        if (prev && data.data.some((row) => row.id === prev)) {
          return prev;
        }
        return null;
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "スクリーニング結果の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  async function runScreeningNow() {
    setRunning(true);
    setMessage(null);
    try {
      const response = await fetch("/api/screenings/run", { method: "POST" });
      const json = await response.json();
      if (!json.ok) {
        throw new Error(json.error ?? "スクリーニング実行に失敗しました");
      }
      setMessage(`再計算完了: ${formatNumber(json.data.totalCompanies, 0)} 件`);
      await fetchLatest();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "スクリーニング実行に失敗しました");
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    void fetchLatest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied]);

  const pageStart =
    payload && payload.pagination.total > 0
      ? (payload.pagination.page - 1) * payload.pagination.perPage + 1
      : 0;
  const pageEnd =
    payload && payload.pagination.total > 0
      ? Math.min(payload.pagination.page * payload.pagination.perPage, payload.pagination.total)
      : 0;
  const totalPages = payload?.pagination.totalPages ?? 0;

  return (
    <section className="three-pane">
      <aside className="panel">
        <h2>絞り込み検索</h2>
        <p className="muted" style={{ marginBottom: "0.6rem" }}>
          スコア・業種・企業名・必須ゲートで候補を絞り込みます。
        </p>

        <div className="page-grid">
          <label>
            最低スコア
            <input
              type="number"
              min={0}
              max={100}
              value={filters.minScore}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  minScore: Number(e.target.value),
                }))
              }
            />
          </label>

          <label>
            1ページ表示件数
            <select
              value={filters.perPage}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  perPage: Number(e.target.value),
                }))
              }
            >
              {PER_PAGE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {formatNumber(option, 0)} 件
                </option>
              ))}
            </select>
          </label>

          <label>
            企業名キーワード
            <input
              value={filters.q}
              onChange={(e) => setFilters((prev) => ({ ...prev, q: e.target.value }))}
              placeholder="例: 任天堂"
            />
          </label>

          <label>
            業種
            <input
              value={filters.industry}
              onChange={(e) => setFilters((prev) => ({ ...prev, industry: e.target.value }))}
              placeholder="例: 情報・通信業"
            />
          </label>

          <label>
            必須ゲート
            <select
              value={filters.gate}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  gate: e.target.value as "all" | "true" | "false",
                }))
              }
            >
              <option value="all">すべて</option>
              <option value="true">通過のみ</option>
              <option value="false">未通過のみ</option>
            </select>
          </label>

          <div className="row">
            <button
              className="button"
              onClick={() =>
                setApplied({
                  page: 1,
                  minScore: filters.minScore,
                  perPage: filters.perPage,
                  q: filters.q,
                  industry: filters.industry,
                  gate: filters.gate,
                })
              }
            >
              条件を適用
            </button>
            <button className="button secondary" onClick={() => void fetchLatest()} disabled={loading}>
              再読込
            </button>
          </div>

          <button className="button ghost" onClick={() => void runScreeningNow()} disabled={running}>
            {running ? "再計算中..." : "スクリーニング再計算"}
          </button>

          {message ? <p className="muted break-word">{message}</p> : null}
        </div>
      </aside>

      <section className="panel">
        <div className="spaced">
          <h2>候補一覧</h2>
          <span className="muted num">
            {formatNumber(payload?.pagination.total ?? 0, 0)} 件中 {formatNumber(pageStart, 0)}-
            {formatNumber(pageEnd, 0)} 件 / {formatNumber(payload?.pagination.page ?? 1, 0)} /{" "}
            {formatNumber(totalPages, 0)} ページ
          </span>
        </div>

        <div className="screening-table table-scroll" style={{ marginTop: "0.65rem", maxHeight: "78vh" }}>
          <table>
            <thead>
              <tr>
                <th>企業</th>
                <th>業種</th>
                <th>ゲート</th>
                <th>スコア</th>
                <th>評価率</th>
                <th>未評価</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className={`screening-row ${selected?.id === row.id ? "active" : ""}`}
                  onClick={() => setSelectedId(row.id)}
                >
                  <td>
                    <div className="break-word">{row.company.name}</div>
                    <div className="muted num">
                      {row.edinetCode}
                      {row.company.secCode ? ` / ${row.company.secCode}` : ""}
                    </div>
                  </td>
                  <td className="break-word">{row.company.industry ?? "-"}</td>
                  <td>
                    <span className={row.gatePassed ? "status-pill ok" : "status-pill error"}>
                      {row.gatePassed ? "PASS" : "FAIL"}
                    </span>
                  </td>
                  <td className="num">{formatNumber(row.score, 1)}</td>
                  <td className="num">{formatPercent(row.coverage, 1)}</td>
                  <td className="num">{formatNumber(row.pendingCount, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="screening-mobile-list" style={{ marginTop: "0.65rem" }}>
          {rows.map((row) => {
            const isExpanded = mobileExpandedId === row.id;

            return (
              <button
                key={row.id}
                type="button"
                className={`screening-mobile-card ${selected?.id === row.id ? "active" : ""}`}
                onClick={() => {
                  setSelectedId(row.id);
                  setMobileExpandedId((prev) => (prev === row.id ? null : row.id));
                }}
              >
                <div className="screening-mobile-head">
                  <strong className="break-word">{row.company.name}</strong>
                  <span className={row.gatePassed ? "status-pill ok" : "status-pill error"}>
                    {row.gatePassed ? "PASS" : "FAIL"}
                  </span>
                </div>

                <div className="screening-mobile-inline-detail">
                  <p className="muted num break-word screening-mobile-meta">
                    {row.edinetCode}
                    {row.company.secCode ? ` / ${row.company.secCode}` : ""}
                    {row.company.industry ? ` / ${row.company.industry}` : ""}
                  </p>

                  <div className="screening-mobile-metrics">
                    <span className="chip num">Score {formatNumber(row.score, 1)}</span>
                    <span className="chip num">Coverage {formatPercent(row.coverage, 1)}</span>
                    <span className="chip num">Pending {formatNumber(row.pendingCount, 0)}</span>
                  </div>

                  <span className="screening-mobile-expand-hint">{isExpanded ? "詳細を閉じる" : "詳細を表示"}</span>

                  {isExpanded ? (
                    <div className="screening-mobile-expanded">
                      <div className="screening-mobile-detail-grid">
                        <div className="screening-mobile-detail-item">
                          <span className="screening-mobile-detail-label">推計時価総額</span>
                          <strong className={`num ${signedClass(row.metricsJson.marketCapEst)}`}>
                            {formatNumber(row.metricsJson.marketCapEst, 0)}
                          </strong>
                        </div>
                        <div className="screening-mobile-detail-item">
                          <span className="screening-mobile-detail-label">PBR推計</span>
                          <strong className={`num ${signedClass(row.metricsJson.pbrEst)}`}>
                            {formatNumber(row.metricsJson.pbrEst, 2)}
                          </strong>
                        </div>
                        <div className="screening-mobile-detail-item">
                          <span className="screening-mobile-detail-label">PSR</span>
                          <strong className={`num ${signedClass(row.metricsJson.priceToSales)}`}>
                            {formatNumber(row.metricsJson.priceToSales, 3)}
                          </strong>
                        </div>
                        <div className="screening-mobile-detail-item">
                          <span className="screening-mobile-detail-label">ネットキャッシュ</span>
                          <strong className={`num ${signedClass(row.metricsJson.netCash)}`}>
                            {formatNumber(row.metricsJson.netCash, 0)}
                          </strong>
                        </div>
                        <div className="screening-mobile-detail-item">
                          <span className="screening-mobile-detail-label">価格位置</span>
                          <strong className={`num ${signedClass(row.metricsJson.highPositionRatio)}`}>
                            {formatNumber(row.metricsJson.highPositionRatio, 3)}
                          </strong>
                        </div>
                        <div className="screening-mobile-detail-item">
                          <span className="screening-mobile-detail-label">最大ドローダウン</span>
                          <strong className={`num ${signedClass(row.metricsJson.maxDrawdownPct ?? 0)}`}>
                            {row.metricsJson.maxDrawdownPct == null
                              ? "PENDING"
                              : `${formatNumber(row.metricsJson.maxDrawdownPct, 2)}%`}
                          </strong>
                        </div>
                      </div>

                      <div className="screening-mobile-criteria">
                        {row.criteriaJson.map((criterion) => (
                          <span key={`${row.id}-${criterion.key}`} className={badgeClass(criterion.status)}>
                            {criterion.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>

        <div className="row" style={{ marginTop: "0.7rem" }}>
          <button
            className="button secondary"
            disabled={!payload || payload.pagination.page <= 1}
            onClick={() =>
              setApplied((prev) => ({
                ...prev,
                page: 1,
              }))
            }
          >
            先頭
          </button>
          <button
            className="button secondary"
            disabled={!payload || payload.pagination.page <= 1}
            onClick={() =>
              setApplied((prev) => ({
                ...prev,
                page: Math.max(1, prev.page - 1),
              }))
            }
          >
            前のページ
          </button>
          <button
            className="button secondary"
            disabled={!payload || payload.pagination.page >= payload.pagination.totalPages}
            onClick={() =>
              setApplied((prev) => ({
                ...prev,
                page: prev.page + 1,
              }))
            }
          >
            次のページ
          </button>
          <button
            className="button secondary"
            disabled={!payload || payload.pagination.page >= payload.pagination.totalPages}
            onClick={() =>
              setApplied((prev) => ({
                ...prev,
                page: payload?.pagination.totalPages ?? prev.page,
              }))
            }
          >
            末尾
          </button>
        </div>
      </section>

      <aside className="panel desktop-detail-panel">
        <h2>詳細</h2>
        {selected ? <ScreeningDetailContent selected={selected} /> : <p className="muted">表示対象がありません。</p>}
      </aside>
    </section>
  );
}
