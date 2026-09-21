import { useState } from "react";
import type { AppState } from "../types";
import { pendingReviewItems, recordsUnderFreeze } from "../rules";
import { Badge, Empty, Panel, useIdemSubmit } from "./components";
import { fmtDT } from "./format";

export function ReviewPanel({ state }: { state: AppState }) {
  const pending = pendingReviewItems(state);
  const all = recordsUnderFreeze(state);
  const ring = (id: string) => state.pigeons.find((p) => p.id === id)?.ring ?? id;

  return (
    <div className="stack">
      <Panel
        title="待逐羽复核"
        hint={`${pending.length} 条未锁定成绩在冻结范围内、已退出排行`}
      >
        {pending.length === 0 ? (
          <Empty>全部冻结成绩已逐羽复核完毕</Empty>
        ) : (
          <div className="review-grid">
            {pending.map(({ race, record }) => (
              <ReviewCard
                key={record.id}
                state={state}
                raceId={race.id}
                recordId={record.id}
                ring={ring(record.pigeonId)}
                place={`${race.place} · ${race.distance}km`}
                releaseTime={race.releaseTime}
                arrival={record.arrivalTime}
                speed={record.speed}
              />
            ))}
          </div>
        )}
      </Panel>

      <Panel title="已复核锁定（历史保留）" hint="锁定成绩回榜并标注，冻结范围重算不影响锁">
        {all.filter((i) => i.locked).length === 0 ? (
          <Empty>暂无锁定记录</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>足环号</th>
                <th>场次</th>
                <th>放飞时间</th>
                <th>归巢/速度</th>
                <th>锁定时间</th>
                <th>复核意见</th>
              </tr>
            </thead>
            <tbody>
              {all
                .filter((i) => i.locked)
                .map(({ race, record }) => {
                  const lock = state.locks.find((l) => l.raceId === race.id && l.recordId === record.id)!;
                  return (
                    <tr key={record.id}>
                      <td>{ring(record.pigeonId)}</td>
                      <td>{race.place} · {race.distance}km</td>
                      <td>{fmtDT(race.releaseTime)}</td>
                      <td>{record.arrivalTime ? `${fmtDT(record.arrivalTime)} · ${record.speed}` : "未归巢"}</td>
                      <td>{fmtDT(lock.at)}</td>
                      <td className="muted">{lock.note || "—"}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

function ReviewCard(props: {
  state: AppState;
  raceId: string;
  recordId: string;
  ring: string;
  place: string;
  releaseTime: string;
  arrival: string | null;
  speed: number | null;
}) {
  const { busy, run } = useIdemSubmit();
  const [note, setNote] = useState("");

  function lock() {
    void run((idem) => ({
      kind: "lockRecord",
      idemKey: idem,
      raceId: props.raceId,
      recordId: props.recordId,
      note,
      now: new Date().toISOString(),
    }));
  }

  return (
    <article className="review-card">
      <header>
        <Badge tone="danger">冻结 · 退出排行</Badge>
        <h3>{props.ring}</h3>
      </header>
      <p>{props.place}</p>
      <p className="muted">放飞 {fmtDT(props.releaseTime)}</p>
      <p>{props.arrival ? `${fmtDT(props.arrival)} · ${props.speed} m/min` : "未归巢"}</p>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="复核意见（如：成绩真实有效）"
      />
      <button className="primary" disabled={busy} onClick={lock}>
        {busy ? "提交中…" : "复核通过并锁定"}
      </button>
      <p className="muted small">同场其他鸽的成绩不在冻结范围，照常排行，无需复核。</p>
    </article>
  );
}
