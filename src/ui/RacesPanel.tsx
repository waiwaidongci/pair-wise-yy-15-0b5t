import { useMemo, useState } from "react";
import type { AppState } from "../types";
import { isUnderObservation, raceRanking } from "../rules";
import { Badge, Empty, Field, Panel, useIdemSubmit } from "./components";
import { fmtDT, speedOf, toLocalInputValue } from "./format";

export function RacesPanel({ state, now }: { state: AppState; now: string }) {
  const bloodlines = useMemo(
    () => [...new Set(state.pigeons.map((p) => p.bloodline))].sort(),
    [state.pigeons]
  );
  const [bloodline, setBloodline] = useState<string>("");

  return (
    <div className="stack">
      <div className="two-col">
        <RaceForm state={state} now={now} />
        <RecordForm state={state} now={now} />
      </div>

      <Panel
        title="训放成绩排行"
        hint="同地点同时间只认一场；冻结成绩退出排行"
        extra={
          <select value={bloodline} onChange={(e) => setBloodline(e.target.value)}>
            <option value="">全部血统</option>
            {bloodlines.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        }
      >
        {state.races.length === 0 && <Empty>还没有训放场次</Empty>}
        <div className="race-cards">
          {state.races
            .slice()
            .sort((a, b) => +new Date(b.releaseTime) - +new Date(a.releaseTime))
            .map((race) => {
              const rows = raceRanking(state, race).filter(
                (r) => !bloodline || r.pigeon.bloodline === bloodline
              );
              // 冻结中的鸽（未锁定、落在观察区间）——不在榜
              const frozenRings = race.records
                .filter((rec) => {
                  const pg = state.pigeons.find((p) => p.id === rec.pigeonId);
                  if (bloodline && pg?.bloodline !== bloodline) return false;
                  return isUnderObservation(state, rec.pigeonId, race.releaseTime) &&
                    !state.locks.some((l) => l.raceId === race.id && l.recordId === rec.id);
                })
                .map((rec) => state.pigeons.find((p) => p.id === rec.pigeonId)?.ring);
              return (
                <article key={race.id} className="race-card">
                  <header>
                    <div>
                      <h3>{race.place} · {race.distance}km</h3>
                      <p>
                        放飞 {fmtDT(race.releaseTime)} · 天气 {race.weather || "未记录"} · 参赛{" "}
                        {race.records.length} 羽
                      </p>
                    </div>
                    <Badge tone="muted">同地点同时间仅认本场</Badge>
                  </header>
                  {rows.length === 0 ? (
                    <Empty>当前血统筛选下无在榜成绩</Empty>
                  ) : (
                    <table className="table">
                      <thead>
                        <tr>
                          <th>名次</th>
                          <th>足环号</th>
                          <th>血统</th>
                          <th>归巢时间</th>
                          <th>速度 m/min</th>
                          <th>状态</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, i) => (
                          <tr key={row.record.id}>
                            <td><b>{i + 1}</b></td>
                            <td>{row.pigeon.ring}</td>
                            <td className="muted">{row.pigeon.bloodline}</td>
                            <td>{fmtDT(row.record.arrivalTime)}</td>
                            <td>{row.record.speed}</td>
                            <td>
                              {row.locked ? (
                                <Badge tone="info">已复核锁定</Badge>
                              ) : (
                                <Badge tone="ok">在榜</Badge>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {frozenRings.length > 0 && (
                    <p className="freeze-note">
                      <Badge tone="danger">成绩冻结</Badge>{" "}
                      {frozenRings.join("、")} 的本场成绩未锁定，已退出排行，等待逐羽复核
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

function RaceForm({ state, now }: { state: AppState; now: string }) {
  const { busy, run } = useIdemSubmit();
  const [place, setPlace] = useState("");
  const [releaseTime, setReleaseTime] = useState(toLocalInputValue(now));
  const [distance, setDistance] = useState("80");
  const [weather, setWeather] = useState("晴");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    void run((idem) => ({
      kind: "createRace",
      idemKey: idem,
      place,
      releaseTime: new Date(releaseTime).toISOString(),
      distance: Number(distance),
      weather,
      now: new Date().toISOString(),
    }));
  }

  return (
    <Panel title="新建训放场次" hint="放飞地点 + 放飞时间 唯一">
      <form className="form" onSubmit={submit}>
        <Field label="放飞地点">
          <input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="如：新乡" required />
        </Field>
        <Field label="放飞时间">
          <input type="datetime-local" value={releaseTime} onChange={(e) => setReleaseTime(e.target.value)} required />
        </Field>
        <div className="form-row">
          <Field label="距离 km">
            <input type="number" min="1" step="1" value={distance} onChange={(e) => setDistance(e.target.value)} required />
          </Field>
          <Field label="天气">
            <input value={weather} onChange={(e) => setWeather(e.target.value)} placeholder="晴 / 侧风" />
          </Field>
        </div>
        <button className="primary" disabled={busy || state.pigeons.length === 0}>
          {busy ? "提交中…" : "创建场次（重复提交沿用首次结果）"}
        </button>
      </form>
    </Panel>
  );
}

function RecordForm({ state, now }: { state: AppState; now: string }) {
  const { busy, run } = useIdemSubmit();
  const sortedRaces = state.races.slice().sort((a, b) => +new Date(b.releaseTime) - +new Date(a.releaseTime));
  const [raceId, setRaceId] = useState(sortedRaces[0]?.id ?? "");
  const [pigeonId, setPigeonId] = useState(state.pigeons[0]?.id ?? "");
  const [notHome, setNotHome] = useState(false);
  const [arrival, setArrival] = useState(toLocalInputValue(now));
  const [speed, setSpeed] = useState("");

  const race = state.races.find((r) => r.id === raceId) ?? sortedRaces[0];
  const pigeon = state.pigeons.find((p) => p.id === pigeonId);
  const blocked = !!race && !!pigeon && isUnderObservation(state, pigeon.id, race.releaseTime);
  const already = !!race && !!pigeon && race.records.some((r) => r.pigeonId === pigeon.id);

  function autoSpeed() {
    if (!race || !arrival) return;
    setSpeed(String(speedOf(race.distance, race.releaseTime, new Date(arrival).toISOString())));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!race || !pigeon) return;
    void run((idem) => ({
      kind: "addRaceRecords",
      idemKey: idem,
      place: race.place,
      releaseTime: race.releaseTime,
      entries: [
        {
          pigeonId: pigeon.id,
          arrivalTime: notHome ? null : new Date(arrival).toISOString(),
          speed: notHome ? null : Number(speed) || null,
        },
      ],
      now: new Date().toISOString(),
    }));
  }

  if (state.races.length === 0) {
    return <Panel title="登记归巢成绩" hint="先创建场次"><Empty>请先在左侧创建训放场次</Empty></Panel>;
  }

  return (
    <Panel title="登记归巢成绩" hint="观察期赛鸽禁止新增训放">
      <form className="form" onSubmit={submit}>
        <Field label="训放场次">
          <select value={race?.id} onChange={(e) => setRaceId(e.target.value)}>
            {sortedRaces.map((r) => (
              <option key={r.id} value={r.id}>
                {r.place} · {r.distance}km · {fmtDT(r.releaseTime)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="赛鸽（足环号）">
          <select value={pigeonId} onChange={(e) => setPigeonId(e.target.value)}>
            {state.pigeons.map((p) => (
              <option key={p.id} value={p.id}>{p.ring} · {p.bloodline}</option>
            ))}
          </select>
        </Field>
        {blocked && (
          <p className="inline-err">该鸽处于健康观察期，禁止新增训放；解除后才能登记本场成绩。</p>
        )}
        {already && !blocked && <p className="inline-warn">该鸽已有本场成绩，重复提交将沿用首次结果。</p>}
        <label className="check">
          <input type="checkbox" checked={notHome} onChange={(e) => setNotHome(e.target.checked)} />
          未归巢（不计速度、不入榜）
        </label>
        {!notHome && (
          <>
            <Field label="归巢时间">
              <input type="datetime-local" value={arrival} onChange={(e) => setArrival(e.target.value)} />
            </Field>
            <Field label="飞行速度 m/min" hint="可按距离/时间自动算">
              <div className="input-with-btn">
                <input type="number" min="0" step="1" value={speed} onChange={(e) => setSpeed(e.target.value)} placeholder="如：1180" />
                <button type="button" onClick={autoSpeed}>计算</button>
              </div>
            </Field>
          </>
        )}
        <button className="primary" disabled={busy || blocked}>
          {busy ? "提交中…" : "登记成绩（重复提交沿用首次结果）"}
        </button>
      </form>
    </Panel>
  );
}
