import { useState } from "react";
import { Badge, EmptyState, SectionTitle } from "./components";
import { useApp } from "./useApp";
import {
  fmtCountdown,
  fmtDateTime,
  fmtRelative,
  toLocalInput,
} from "./format";
import type { HealthStatusValue } from "../domain/types";

export function HealthPanel() {
  const { state, view, now, run, actions } = useApp();

  // 健康登记
  const [birdId, setBirdId] = useState(state.birds[0]?.id ?? "");
  const [observedAt, setObservedAt] = useState(toLocalInput());
  const [status, setStatus] = useState<HealthStatusValue>("normal");
  const [note, setNote] = useState("");

  // 配对登记
  const [birdAId, setBirdAId] = useState("");
  const [birdBId, setBirdBId] = useState("");
  const [pairedAt, setPairedAt] = useState(toLocalInput());
  const [pairNote, setPairNote] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [fix, setFix] = useState({ observedAt: "", status: "normal" as HealthStatusValue, note: "" });

  const active = [...view.freeze.active.entries()].map(([id, w]) => ({
    bird: view.birdMap.get(id)!,
    window: w,
  }));

  const submitHealth = async () => {
    const res = await run(
      actions.addHealth({
        birdId,
        observedAt: new Date(observedAt).toISOString(),
        status,
        note,
      })
    );
    if (res.status === "done" && !res.duplicate) setNote("");
  };

  const submitPairing = async () => {
    const res = await run(
      actions.addPairing({
        birdAId,
        birdBId,
        pairedAt: new Date(pairedAt).toISOString(),
        note: pairNote,
      })
    );
    if (res.status === "done" && !res.duplicate) {
      setBirdAId("");
      setBirdBId("");
      setPairNote("");
    }
  };

  const startCorrect = (h: { id: string; observedAt: string; status: HealthStatusValue; note: string }) => {
    setEditingId(h.id);
    setFix({
      observedAt: toLocalInput(h.observedAt),
      status: h.status,
      note: h.note,
    });
  };

  const submitCorrect = async (id: string) => {
    const res = await run(
      actions.correctHealth(id, {
        observedAt: new Date(fix.observedAt).toISOString(),
        status: fix.status,
        note: fix.note,
      })
    );
    if (res.status === "done" && !res.duplicate) setEditingId(null);
  };

  const log = [...state.health].sort(
    (a, b) =>
      new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime() ||
      b.createdAt.localeCompare(a.createdAt)
  );

  const birdName = (id: string) => {
    const b = view.birdMap.get(id);
    return b ? `${b.ringNo}（${b.bloodline}）` : id;
  };

  return (
    <div className="panel-stack">
      <section className="panel">
        <SectionTitle
          kicker="冻结解除条件"
          title="健康观察冻结板"
          desc="连续两次正常复查、且相隔至少 12 小时才解除；期间禁止新增训放与配对。复查时间线可回溯，旧记录可更正并自动重算冻结范围。"
        />
        {active.length === 0 ? (
          <EmptyState text="当前没有处于冻结观察期的赛鸽。" />
        ) : (
          <div className="freeze-list">
            {active.map(({ bird, window: w }) => {
              const firstNormal = state.health
                .filter(
                  (h) =>
                    h.birdId === bird.id &&
                    h.status === "normal" &&
                    !h.voided &&
                    new Date(h.observedAt).getTime() >=
                      new Date(w.startAt).getTime()
                )
                .sort(
                  (x, y) =>
                    new Date(x.observedAt).getTime() -
                    new Date(y.observedAt).getTime()
                )[0];
              return (
              <article key={bird.id} className="freeze-card">
                <div className="freeze-head">
                  <div>
                    <h3>{bird.ringNo}</h3>
                    <p>
                      {bird.bloodline} · {bird.gender}
                    </p>
                  </div>
                  <Badge tone="red">冻结中</Badge>
                </div>
                <ul className="check-steps">
                  <li className={w.streak >= 1 ? "done" : ""}>
                    <span>① 第一次正常复查</span>
                    <small>
                      {firstNormal
                        ? `已于 ${fmtRelative(firstNormal.observedAt, now)}完成`
                        : "待登记"}
                    </small>
                  </li>
                  <li className={w.streak >= 1 ? "waiting" : ""}>
                    <span>② 再次正常复查，且距①满 12 小时</span>
                    <small>
                      {w.streak >= 1 && w.eligibleLiftAt
                        ? new Date(w.eligibleLiftAt).getTime() <= now
                          ? "12 小时间隔已满，现在登记一次正常复查即解除冻结"
                          : `间隔最早 ${fmtDateTime(w.eligibleLiftAt)} 满 12 小时（${fmtCountdown(
                              w.eligibleLiftAt,
                              now
                            )}），届时再复查可解除`
                        : "需先完成第一次复查"}
                    </small>
                  </li>
                </ul>
                <p className="freeze-rule">
                  异常起算：{fmtDateTime(w.startAt)} · 已登记正常复查 {w.streak}
                  次（解除需 2 次且跨度 ≥12 小时）
                </p>
              </article>
              );
            })}
          </div>
        )}
      </section>

      <div className="two-col">
        <section className="panel">
          <SectionTitle kicker="登记观察 / 复查" title="健康记录" />
          <div className="field-grid">
            <label>
              <span>赛鸽</span>
              <select value={birdId} onChange={(e) => setBirdId(e.target.value)}>
                {state.birds.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.ringNo} · {b.bloodline}
                    {view.freeze.active.has(b.id) ? "（冻结中）" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>观察时间</span>
              <input
                type="datetime-local"
                value={observedAt}
                onChange={(e) => setObservedAt(e.target.value)}
              />
            </label>
            <label className="span-2">
              <span>健康判定</span>
              <div className="seg">
                <button
                  type="button"
                  className={status === "normal" ? "seg-on seg-normal" : ""}
                  onClick={() => setStatus("normal")}
                >
                  正常（复查）
                </button>
                <button
                  type="button"
                  className={status === "abnormal" ? "seg-on seg-abnormal" : ""}
                  onClick={() => setStatus("abnormal")}
                >
                  异常（冻结）
                </button>
              </div>
            </label>
            <label className="span-2">
              <span>症状 / 复查结论</span>
              <textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="如：张口呼吸、鼻液情况；或复查恢复情况"
              />
            </label>
          </div>
          <div className="form-actions">
            <span className="subtle">
              登记异常即刻退榜并触发同场复核；两次正常且间隔 ≥12h 自动解除
            </span>
            <button className="primary" onClick={submitHealth}>
              保存健康记录
            </button>
          </div>
        </section>

        <section className="panel">
          <SectionTitle kicker="冻结期受限" title="配对登记" desc="任一方处于冻结期（含配对日期落在冻结窗内）均禁止配对。" />
          <div className="field-grid">
            <label>
              <span>赛鸽 A</span>
              <select value={birdAId} onChange={(e) => setBirdAId(e.target.value)}>
                <option value="">请选择</option>
                {state.birds.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.ringNo} · {b.gender}
                    {view.freeze.active.has(b.id) ? "（冻结禁配）" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>赛鸽 B</span>
              <select value={birdBId} onChange={(e) => setBirdBId(e.target.value)}>
                <option value="">请选择</option>
                {state.birds
                  .filter((b) => b.id !== birdAId)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.ringNo} · {b.gender}
                      {view.freeze.active.has(b.id) ? "（冻结禁配）" : ""}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              <span>配对日期</span>
              <input
                type="datetime-local"
                value={pairedAt}
                onChange={(e) => setPairedAt(e.target.value)}
              />
            </label>
            <label>
              <span>配对说明</span>
              <input
                value={pairNote}
                onChange={(e) => setPairNote(e.target.value)}
                placeholder="如：春季繁育配对"
              />
            </label>
          </div>
          <div className="form-actions">
            <span className="subtle">重复配对或冻结期提交会被规则拦截</span>
            <button className="primary" onClick={submitPairing}>
              保存配对
            </button>
          </div>
        </section>
      </div>

      <section className="panel">
        <SectionTitle
          kicker="历史保留 · 更正重算"
          title="健康记录时间线"
          desc="旧记录更正时仅作废、不删除；冻结范围依据全部有效记录重算，排行与统计随之联动。"
        />
        <div className="health-log">
          {log.map((h) => {
            const correctionOf = h.correctedFromId
              ? state.health.find((x) => x.id === h.correctedFromId)
              : null;
            return (
              <article key={h.id} className={`health-row ${h.voided ? "voided" : ""}`}>
                <div className="health-main">
                  <Badge tone={h.status === "abnormal" ? "red" : "green"}>
                    {h.status === "abnormal" ? "异常" : "正常"}
                  </Badge>
                  <div>
                    <h3>
                      {birdName(h.birdId)}
                      <span className="record-sub"> {fmtDateTime(h.observedAt)}</span>
                    </h3>
                    <p>{h.note}</p>
                    <p className="note">
                      登记于 {fmtDateTime(h.createdAt)}
                      {h.voided ? " · 已被更正作废（历史保留）" : ""}
                      {correctionOf
                        ? ` · 更正自 ${fmtDateTime(correctionOf.observedAt)} 的旧记录`
                        : ""}
                    </p>
                  </div>
                </div>
                {!h.voided && editingId !== h.id ? (
                  <button className="ghost-btn" onClick={() => startCorrect(h)}>
                    更正
                  </button>
                ) : null}
                {editingId === h.id ? (
                  <div className="correct-box">
                    <div className="field-grid">
                      <label>
                        <span>更正后的观察时间</span>
                        <input
                          type="datetime-local"
                          value={fix.observedAt}
                          onChange={(e) => setFix((f) => ({ ...f, observedAt: e.target.value }))}
                        />
                      </label>
                      <label>
                        <span>更正后的判定</span>
                        <select
                          value={fix.status}
                          onChange={(e) =>
                            setFix((f) => ({ ...f, status: e.target.value as HealthStatusValue }))
                          }
                        >
                          <option value="normal">正常</option>
                          <option value="abnormal">异常</option>
                        </select>
                      </label>
                      <label className="span-2">
                        <span>更正说明</span>
                        <textarea
                          rows={2}
                          value={fix.note}
                          onChange={(e) => setFix((f) => ({ ...f, note: e.target.value }))}
                        />
                      </label>
                    </div>
                    <div className="form-actions">
                      <button className="ghost-btn" onClick={() => setEditingId(null)}>
                        取消
                      </button>
                      <button className="primary" onClick={() => submitCorrect(h.id)}>
                        提交更正并重算冻结
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
