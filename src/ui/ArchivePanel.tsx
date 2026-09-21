import { useMemo, useState } from "react";
import type { AppState } from "../types";
import {
  computeEpisodes,
  isRecordFrozen,
  isRecordLocked,
  pairsOf,
} from "../rules";
import { Badge, Empty, Field, Panel, useIdemSubmit } from "./components";
import { fmtDT } from "./format";

export function ArchivePanel({ state }: { state: AppState }) {
  const bloodlines = useMemo(
    () => [...new Set(state.pigeons.map((p) => p.bloodline))].sort(),
    [state.pigeons]
  );
  const [bloodline, setBloodline] = useState("");
  const [selected, setSelected] = useState<string | null>(state.pigeons[0]?.id ?? null);

  const list = state.pigeons.filter((p) => !bloodline || p.bloodline === bloodline);
  const pigeon = state.pigeons.find((p) => p.id === selected) ?? list[0] ?? null;

  return (
    <div className="stack">
      <div className="two-col">
        <RegisterForm state={state} />
        <Panel
          title="按血统筛选历史成绩"
          hint="与排行、档案同源"
          extra={
            <select value={bloodline} onChange={(e) => setBloodline(e.target.value)}>
              <option value="">全部血统</option>
              {bloodlines.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          }
        >
          {list.length === 0 ? (
            <Empty>该血统下暂无赛鸽</Empty>
          ) : (
            <div className="pigeon-chips">
              {list.map((p) => (
                <button
                  key={p.id}
                  className={pigeon?.id === p.id ? "chip-on" : ""}
                  onClick={() => setSelected(p.id)}
                >
                  {p.ring}
                  <small>{p.bloodline}</small>
                </button>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {pigeon && <PigeonDetail state={state} pigeonId={pigeon.id} />}
      {!pigeon && <Panel title="单羽赛鸽档案"><Empty>请先登记赛鸽</Empty></Panel>}
    </div>
  );
}

function RegisterForm({ state }: { state: AppState }) {
  const { busy, run } = useIdemSubmit();
  const [ring, setRing] = useState("");
  const [bloodline, setBloodline] = useState("詹森系");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    void run((idem) => ({
      kind: "registerPigeon",
      idemKey: idem,
      ring,
      bloodline,
      now: new Date().toISOString(),
    })).then((r) => {
      if (r.ok) {
        setRing("");
      }
    });
  }

  return (
    <Panel title="赛鸽登记" hint={`鸽棚在册 ${state.pigeons.length} 羽`}>
      <form className="form" onSubmit={submit}>
        <Field label="足环号">
          <input value={ring} onChange={(e) => setRing(e.target.value)} placeholder="如：CHN-24-009999" required />
        </Field>
        <Field label="血统">
          <input value={bloodline} onChange={(e) => setBloodline(e.target.value)} list="bloodline-list" required />
          <datalist id="bloodline-list">
            {[...new Set(state.pigeons.map((p) => p.bloodline))].map((b) => (
              <option key={b} value={b} />
            ))}
            <option value="詹森系" />
            <option value="凡龙系" />
            <option value="盖比系" />
            <option value="胡本系（种鸽）" />
          </datalist>
        </Field>
        <button className="primary" disabled={busy}>
          {busy ? "提交中…" : "登记赛鸽（重复提交沿用首次结果）"}
        </button>
      </form>
    </Panel>
  );
}

function PigeonDetail({ state, pigeonId }: { state: AppState; pigeonId: string }) {
  const pigeon = state.pigeons.find((p) => p.id === pigeonId);
  if (!pigeon) return null;
  const episodes = computeEpisodes(state, pigeonId);
  const active = episodes.find((e) => e.endAt === null);
  const pairs = pairsOf(state, pigeonId);

  const history = state.races
    .filter((race) => race.records.some((r) => r.pigeonId === pigeonId))
    .sort((a, b) => +new Date(b.releaseTime) - +new Date(a.releaseTime))
    .map((race) => ({ race, record: race.records.find((r) => r.pigeonId === pigeonId)! }));

  return (
    <Panel
      title={`单羽档案 · ${pigeon.ring}`}
      hint={pigeon.bloodline}
      extra={active ? <Badge tone="danger">健康观察中</Badge> : <Badge tone="ok">健康正常</Badge>}
    >
      <div className="detail-grid">
        <div>
          <h3>训放历史</h3>
          {history.length === 0 ? (
            <Empty>暂无训放成绩</Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>场次</th>
                  <th>放飞时间</th>
                  <th>归巢</th>
                  <th>速度</th>
                  <th>成绩状态</th>
                </tr>
              </thead>
              <tbody>
                {history.map(({ race, record }) => {
                  const frozen = isRecordFrozen(state, race, record);
                  const locked = isRecordLocked(state, race.id, record.id);
                  return (
                    <tr key={race.id} className={frozen ? "row-frozen" : ""}>
                      <td>{race.place} · {race.distance}km</td>
                      <td>{fmtDT(race.releaseTime)}</td>
                      <td>{record.arrivalTime ? fmtDT(record.arrivalTime) : <Badge tone="danger">未归巢</Badge>}</td>
                      <td>{record.speed ?? "—"}</td>
                      <td>
                        {frozen ? (
                          <Badge tone="danger">冻结·退出排行·待复核</Badge>
                        ) : locked ? (
                          <Badge tone="info">已复核锁定</Badge>
                        ) : (
                          <Badge tone="ok">正常在榜</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div>
          <h3>健康观察区间</h3>
          {episodes.length === 0 ? (
            <Empty>无异常记录</Empty>
          ) : (
            <ul className="episode-list">
              {episodes
                .slice()
                .sort((a, b) => +new Date(b.startAt) - +new Date(a.startAt))
                .map((e) => (
                  <li key={e.startRecord.id + e.startAt}>
                    {e.endAt ? (
                      <Badge tone="ok">已解除 {fmtDT(e.endAt)}</Badge>
                    ) : (
                      <Badge tone="danger">观察中</Badge>
                    )}
                    <p>
                      异常 {fmtDT(e.startAt)}
                      {e.endAt ? ` → 解除 ${fmtDT(e.endAt)}` : " 起"}
                    </p>
                    <p className="muted small">
                      解除依据：{e.normalChecks.length === 2
                        ? `两次正常复查 ${fmtDT(e.normalChecks[0].at)}、${fmtDT(e.normalChecks[1].at)}，间隔满足≥12h`
                        : "尚未完成两次正常复查"}
                    </p>
                  </li>
                ))}
            </ul>
          )}

          <h3>配对记录</h3>
          {pairs.length === 0 ? (
            <Empty>暂无配对</Empty>
          ) : (
            <ul className="episode-list">
              {pairs.map((pr) => {
                const otherId = pr.pigeonAId === pigeonId ? pr.pigeonBId : pr.pigeonAId;
                const other = state.pigeons.find((p) => p.id === otherId);
                return (
                  <li key={pr.id}>
                    <p><b>{other?.ring ?? otherId}</b> <span className="muted">· {other?.bloodline}</span></p>
                    <p className="muted small">{fmtDT(pr.at)} {pr.note ? `· ${pr.note}` : ""}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}
