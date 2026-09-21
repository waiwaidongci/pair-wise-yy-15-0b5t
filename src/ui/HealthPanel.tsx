import { useState } from "react";
import type { AppState, HealthRecord } from "../types";
import {
  computeEpisodes,
  effectiveTimeline,
  isUnderObservation,
  pairsOf,
  recordsUnderFreeze,
  RECOVERY_GAP_MS,
} from "../rules";
import { Badge, Empty, Field, Panel, useIdemSubmit } from "./components";
import { fmtDT, hoursBetween, toLocalInputValue } from "./format";

export function HealthPanel({ state, now }: { state: AppState; now: string }) {
  return (
    <div className="stack">
      <div className="two-col">
        <HealthForm state={state} now={now} />
        <PairForm state={state} now={now} />
      </div>

      <Panel
        title="逐羽健康时间线"
        hint="连续两次正常复查且相隔≥12小时解除；旧记录更正后重算冻结范围，历史保留"
      >
        {state.pigeons.length === 0 && <Empty>还没有赛鸽档案</Empty>}
        <div className="health-cards">
          {state.pigeons
            .slice()
            .sort((a, b) => a.ring.localeCompare(b.ring))
            .map((p) => {
              const timeline = effectiveTimeline(state, p.id);
              const episodes = computeEpisodes(state, p.id);
              const active = episodes.find((e) => e.endAt === null) ?? null;
              const frozenCount = recordsUnderFreeze(state).filter(
                (i) => i.pigeonId === p.id && !i.locked
              ).length;
              const pairs = pairsOf(state, p.id);
              const rawRecords = state.health
                .filter((h) => h.pigeonId === p.id)
                .sort((a, b) => +new Date(b.at) - +new Date(a.at));
              return (
                <article key={p.id} className={`health-card ${active ? "active" : ""}`}>
                  <header>
                    <div>
                      <h3>{p.ring}</h3>
                      <p className="muted">{p.bloodline}</p>
                    </div>
                    {active ? <Badge tone="danger">健康观察中</Badge> : <Badge tone="ok">正常</Badge>}
                  </header>

                  {active && (
                    <div className="episode">
                      <p>
                        异常始于 {fmtDT(active.startAt)}（{active.startRecord.finding}）
                      </p>
                      {active.normalChecks.length === 0 && (
                        <p className="muted">尚无正常复查，登记一次“正常”开始解除流程。</p>
                      )}
                      {active.normalChecks.length === 1 && (
                        <ProgressLine since={active.normalChecks[0].at} now={now} />
                      )}
                      {frozenCount > 0 && (
                        <p>
                          <Badge tone="warn">{frozenCount} 条未锁定成绩在冻结范围</Badge>{" "}
                          <span className="muted">已退出排行，待逐羽复核</span>
                        </p>
                      )}
                      <p className="muted small">观察期间禁止新增训放和配对。</p>
                    </div>
                  )}

                  {episodes.some((e) => e.endAt) && !active && (
                    <p className="muted small">
                      历史观察 {episodes.filter((e) => e.endAt).length} 次，均已按“两次正常且间隔≥12h”解除。
                    </p>
                  )}

                  <ul className="timeline">
                    {timeline
                      .slice()
                      .reverse()
                      .map((pt) => {
                        const isCorrected = pt.record.id !== pt.original.id;
                        return (
                          <li key={pt.original.id} className={pt.abnormal ? "ab" : "ok-row"}>
                            <div>
                              <b>{fmtDT(pt.at)}</b>{" "}
                              {pt.abnormal ? <Badge tone="danger">异常</Badge> : <Badge tone="ok">正常</Badge>}
                              {isCorrected && <Badge tone="info">由更正记录取代</Badge>}
                              <p className={isCorrected ? "struck muted" : "muted"}>{pt.finding}</p>
                            </div>
                            <CorrectButton record={pt.original} />
                          </li>
                        );
                      })}
                    {rawRecords
                      .filter((h) => h.correctionOf)
                      .map((h) => (
                        <li key={h.id} className="correction">
                          <b className="muted">{fmtDT(h.at)}</b>{" "}
                          <Badge tone="muted">更正记录</Badge>
                          {h.abnormal ? <Badge tone="danger">异常</Badge> : <Badge tone="ok">正常</Badge>}
                          <p className="muted small">
                            更正自 {fmtDT(rawRecords.find((r) => r.id === h.correctionOf)?.at ?? null)}：{h.finding}
                          </p>
                        </li>
                      ))}
                  </ul>
                  {timeline.length === 0 && <Empty>暂无健康记录</Empty>}

                  {pairs.length > 0 && (
                    <p className="muted small">
                      配对 {pairs.length} 条，最近：
                      {pairs
                        .slice(0, 2)
                        .map((pr) => {
                          const otherId = pr.pigeonAId === p.id ? pr.pigeonBId : pr.pigeonAId;
                          const other = state.pigeons.find((x) => x.id === otherId);
                          return `${other?.ring ?? otherId}（${fmtDT(pr.at)}）`;
                        })
                        .join("、")}
                    </p>
                  )}
                </article>
              );
            })}
        </div>
      </Panel>
    </div>
  );
}

function ProgressLine({ since, now }: { since: string; now: string }) {
  const elapsed = hoursBetween(since, now);
  const need = RECOVERY_GAP_MS / 3_600_000;
  const ready = elapsed >= need;
  return (
    <p>
      <Badge tone={ready ? "ok" : "warn"}>
        {ready
          ? `距首次正常复查已 ${elapsed.toFixed(1)}h，可做第二次复查解除观察`
          : `首次正常复查后仅 ${elapsed.toFixed(1)}h，第二次复查需再等 ${(need - elapsed).toFixed(1)}h`}
      </Badge>
    </p>
  );
}

function CorrectButton({ record }: { record: HealthRecord }) {
  const [open, setOpen] = useState(false);
  const { busy, run } = useIdemSubmit();
  const [at, setAt] = useState(toLocalInputValue(record.at));
  const [abnormal, setAbnormal] = useState(record.abnormal);
  const [finding, setFinding] = useState("");

  if (!open) {
    return (
      <button className="link-btn" onClick={() => setOpen(true)}>更正</button>
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    void run((idem) => ({
      kind: "correctHealth",
      idemKey: idem,
      originalId: record.id,
      at: new Date(at).toISOString(),
      abnormal,
      finding,
      now: new Date().toISOString(),
    })).then((r) => {
      if (r.ok) setOpen(false);
    });
  }

  return (
    <form className="correct-form" onSubmit={submit}>
      <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
      <select value={abnormal ? "1" : "0"} onChange={(e) => setAbnormal(e.target.value === "1")}>
        <option value="0">更正为正常</option>
        <option value="1">更正为异常</option>
      </select>
      <input value={finding} onChange={(e) => setFinding(e.target.value)} placeholder="更正说明（必填情形留空自动补）" />
      <div className="form-row">
        <button className="primary small-btn" disabled={busy}>{busy ? "提交中…" : "确认更正"}</button>
        <button type="button" onClick={() => setOpen(false)}>取消</button>
      </div>
      <p className="muted small">原记录保留为历史；冻结范围立即按更正重算。</p>
    </form>
  );
}

function HealthForm({ state, now }: { state: AppState; now: string }) {
  const { busy, run } = useIdemSubmit();
  const [pigeonId, setPigeonId] = useState(state.pigeons[0]?.id ?? "");
  const [at, setAt] = useState(toLocalInputValue(now));
  const [abnormal, setAbnormal] = useState(true);
  const [finding, setFinding] = useState("");

  const observed = pigeonId ? isUnderObservation(state, pigeonId, new Date(at).toISOString()) : false;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!pigeonId) return;
    void run((idem) => ({
      kind: "addHealth",
      idemKey: idem,
      pigeonId,
      at: new Date(at).toISOString(),
      abnormal,
      finding,
      now: new Date().toISOString(),
    }));
  }

  return (
    <Panel title="登记健康观察 / 复查" hint="异常冻结、两次正常解除">
      {state.pigeons.length === 0 ? (
        <Empty>请先在“赛鸽档案”登记赛鸽</Empty>
      ) : (
        <form className="form" onSubmit={submit}>
          <Field label="赛鸽（足环号）">
            <select value={pigeonId} onChange={(e) => setPigeonId(e.target.value)}>
              {state.pigeons.map((p) => (
                <option key={p.id} value={p.id}>{p.ring} · {p.bloodline}</option>
              ))}
            </select>
          </Field>
          <Field label="观察/复查时间">
            <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} required />
          </Field>
          <div className="seg">
            <button type="button" className={abnormal ? "seg-on seg-ab" : ""} onClick={() => setAbnormal(true)}>
              健康异常
            </button>
            <button type="button" className={!abnormal ? "seg-on seg-ok" : ""} onClick={() => setAbnormal(false)}>
              复查正常
            </button>
          </div>
          <Field label="情况描述">
            <input value={finding} onChange={(e) => setFinding(e.target.value)} placeholder={abnormal ? "如：水便、精神萎靡" : "如：粪便成形、家飞正常"} />
          </Field>
          {observed && abnormal && (
            <p className="inline-warn">该鸽已在观察期：再次登记异常会使正常复查计数清零。</p>
          )}
          {observed && !abnormal && (
            <p className="inline-warn">该鸽观察中：本次为正常复查，解除需连续两次且间隔≥12小时。</p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "提交中…" : "提交健康记录（重复提交沿用首次结果）"}
          </button>
        </form>
      )}
    </Panel>
  );
}

function PairForm({ state, now }: { state: AppState; now: string }) {
  const { busy, run } = useIdemSubmit();
  const [aId, setAId] = useState(state.pigeons[0]?.id ?? "");
  const [bId, setBId] = useState(state.pigeons[1]?.id ?? state.pigeons[0]?.id ?? "");
  const [at, setAt] = useState(toLocalInputValue(now));
  const [note, setNote] = useState("");

  const atIso = new Date(at).toISOString();
  const blockedA = aId ? isUnderObservation(state, aId, atIso) : false;
  const blockedB = bId ? isUnderObservation(state, bId, atIso) : false;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    void run((idem) => ({
      kind: "addPair",
      idemKey: idem,
      pigeonAId: aId,
      pigeonBId: bId,
      at: atIso,
      note,
      now: new Date().toISOString(),
    }));
  }

  return (
    <Panel title="配对登记" hint="观察期任一方均禁止配对">
      {state.pigeons.length < 2 ? (
        <Empty>至少两羽赛鸽才能登记配对</Empty>
      ) : (
        <form className="form" onSubmit={submit}>
          <div className="form-row">
            <Field label="赛鸽 A">
              <select value={aId} onChange={(e) => setAId(e.target.value)}>
                {state.pigeons.map((p) => <option key={p.id} value={p.id}>{p.ring}</option>)}
              </select>
            </Field>
            <Field label="赛鸽 B">
              <select value={bId} onChange={(e) => setBId(e.target.value)}>
                {state.pigeons.map((p) => <option key={p.id} value={p.id}>{p.ring}</option>)}
              </select>
            </Field>
          </div>
          <Field label="配对时间">
            <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} required />
          </Field>
          <Field label="备注">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="如：种鸽配对" />
          </Field>
          {(blockedA || blockedB) && (
            <p className="inline-err">
              {[blockedA && state.pigeons.find((p) => p.id === aId)?.ring, blockedB && state.pigeons.find((p) => p.id === bId)?.ring]
                .filter(Boolean)
                .join("、")}{" "}
              处于健康观察期，禁止配对。
            </p>
          )}
          {aId === bId && <p className="inline-err">不能选择同一羽赛鸽。</p>}
          <button className="primary" disabled={busy || blockedA || blockedB || aId === bId}>
            {busy ? "提交中…" : "登记配对（重复提交沿用首次结果）"}
          </button>
        </form>
      )}
    </Panel>
  );
}
