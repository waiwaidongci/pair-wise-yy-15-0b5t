import { useMemo, useState } from "react";
import { Badge, EmptyState, RESULT_BADGE, SectionTitle } from "./components";
import { useApp } from "./useApp";
import { distanceBand, fmtDateTime, fmtSpeed, toLocalInput } from "./format";
import type { RaceEntryInput } from "../domain/types";

type StatusFilter = "all" | "ranked" | "review" | "withdrawn" | "notreturned";

export function RacesPanel() {
  const { state, view, run, actions } = useApp();
  const [site, setSite] = useState("");
  const [releasedAt, setReleasedAt] = useState(toLocalInput());
  const [distanceKm, setDistanceKm] = useState("80");
  const [weather, setWeather] = useState("晴");
  const [picks, setPicks] = useState<Record<string, { returned: boolean; speed: string }>>(
    {}
  );

  const [bloodline, setBloodline] = useState("all");
  const [eventId, setEventId] = useState("all");
  const [band, setBand] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const frozenIds = new Set(view.freeze.active.keys());
  const bloodlines = useMemo(
    () => [...new Set(state.birds.map((b) => b.bloodline))].sort(),
    [state.birds]
  );

  const togglePick = (birdId: string) => {
    setPicks((p) => {
      const next = { ...p };
      if (next[birdId]) delete next[birdId];
      else next[birdId] = { returned: true, speed: "" };
      return next;
    });
  };

  const updatePick = (birdId: string, patch: Partial<{ returned: boolean; speed: string }>) =>
    setPicks((p) => ({ ...p, [birdId]: { ...p[birdId], ...patch } }));

  const submit = async () => {
    const entries: RaceEntryInput[] = Object.entries(picks).map(([birdId, v]) => ({
      birdId,
      returned: v.returned,
      speed:
        v.returned && v.speed.trim() ? Math.round(Number(v.speed)) : undefined,
    }));
    const res = await run(
      actions.submitRace({
        site,
        releasedAt: new Date(releasedAt).toISOString(),
        distanceKm: Number(distanceKm),
        weather,
        entries,
      })
    );
    if (res.status === "done" && !res.duplicate) {
      setSite("");
      setPicks({});
    }
  };

  const shownEvents = view.events.filter(
    (e) =>
      (eventId === "all" || e.event.id === eventId) &&
      (band === "all" || distanceBand(e.event.distanceKm) === band)
  );

  const rowPasses = (badge: string, birdBloodline: string) =>
    (bloodline === "all" || birdBloodline === bloodline) &&
    (statusFilter === "all" || badge === statusFilter);

  return (
    <div className="panel-stack">
      <section className="panel">
        <SectionTitle
          kicker="训放登记"
          title="新增训放成绩"
          desc="同地点同分钟只认一场；冻结观察期赛鸽禁止参训（已置灰）。重复或并发提交沿用首次结果。"
        />
        <div className="field-grid">
          <label>
            <span>放飞地点</span>
            <input
              value={site}
              onChange={(e) => setSite(e.target.value)}
              placeholder="如：南郊放飞点"
            />
          </label>
          <label>
            <span>放飞时间</span>
            <input
              type="datetime-local"
              value={releasedAt}
              onChange={(e) => setReleasedAt(e.target.value)}
            />
          </label>
          <label>
            <span>放飞距离（km）</span>
            <input
              type="number"
              min={1}
              value={distanceKm}
              onChange={(e) => setDistanceKm(e.target.value)}
            />
          </label>
          <label>
            <span>天气</span>
            <input
              value={weather}
              onChange={(e) => setWeather(e.target.value)}
              placeholder="晴 / 侧风 / 多云"
            />
          </label>
        </div>

        <div className="pick-grid">
          {state.birds.map((b) => {
            const picked = !!picks[b.id];
            const frozen = frozenIds.has(b.id);
            return (
              <div
                key={b.id}
                className={`pick-card${picked ? " picked" : ""}${frozen ? " frozen" : ""}`}
              >
                <label className="pick-line">
                  <input
                    type="checkbox"
                    checked={picked}
                    disabled={frozen}
                    onChange={() => togglePick(b.id)}
                  />
                  <span className="pick-name">
                    {b.ringNo}
                    <small>
                      {b.bloodline} · {b.gender}
                      {b.isBreeder ? " · 种鸽" : ""}
                    </small>
                  </span>
                  {frozen ? <Badge tone="red">冻结禁训</Badge> : null}
                </label>
                {picked ? (
                  <div className="pick-detail">
                    <label className="inline-check">
                      <input
                        type="checkbox"
                        checked={picks[b.id].returned}
                        onChange={(e) =>
                          updatePick(b.id, { returned: e.target.checked })
                        }
                      />
                      已归巢
                    </label>
                    {picks[b.id].returned ? (
                      <label className="speed-box">
                        <span>速度 m/min</span>
                        <input
                          type="number"
                          min={0}
                          value={picks[b.id].speed}
                          onChange={(e) => updatePick(b.id, { speed: e.target.value })}
                          placeholder="如 1180"
                        />
                      </label>
                    ) : (
                      <span className="subtle">列入未归巢提醒</span>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="form-actions">
          <span className="subtle">
            已选 {Object.keys(picks).length} 羽 ·{" "}
            {distanceBand(Number(distanceKm) || 0)}
          </span>
          <button className="primary" onClick={submit}>
            保存训放
          </button>
        </div>
      </section>

      <section className="panel">
        <SectionTitle
          kicker="成绩排行"
          title="训放成绩榜"
          desc="异常鸽未锁定成绩退榜（灰色划线）；同场其余成绩标记待复核，逐羽确认后锁定在榜；已锁定成绩永久保留。"
        />

        <div className="filters">
          <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
            <option value="all">全部场次</option>
            {view.events.map((e) => (
              <option key={e.event.id} value={e.event.id}>
                {e.event.site} · {fmtDateTime(e.event.releasedAt)}
              </option>
            ))}
          </select>
          <select value={band} onChange={(e) => setBand(e.target.value)}>
            <option value="all">全部距离</option>
            <option value="短距离">短距离 (&lt;100km)</option>
            <option value="中距离">中距离 (100–300km)</option>
            <option value="长距离">长距离 (&gt;300km)</option>
          </select>
          <select value={bloodline} onChange={(e) => setBloodline(e.target.value)}>
            <option value="all">全部血统</option>
            {bloodlines.map((bl) => (
              <option key={bl} value={bl}>
                {bl}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="all">全部状态</option>
            <option value="ranked">在榜</option>
            <option value="review">待复核</option>
            <option value="withdrawn">异常退榜</option>
            <option value="notreturned">未归巢</option>
          </select>
        </div>

        {shownEvents.length === 0 ? (
          <EmptyState text="没有符合筛选的场次。" />
        ) : (
          shownEvents.map((ev) => {
            const rows = ev.rows.filter((x) =>
              rowPasses(x.badge, x.bird.bloodline)
            );
            return (
              <div key={ev.event.id} className="event-block">
                <div className="event-head">
                  <div>
                    <h3>
                      {ev.event.site}
                      <span className="record-sub">
                        {" "}
                        {ev.event.distanceKm}km · {ev.event.weather} ·{" "}
                        {fmtDateTime(ev.event.releasedAt)}
                      </span>
                    </h3>
                  </div>
                  <div className="event-badges">
                    {ev.tainted ? <Badge tone="red">同场健康异常</Badge> : null}
                    {ev.reviewPending > 0 ? (
                      <Badge tone="amber">待复核 {ev.reviewPending}</Badge>
                    ) : null}
                    {ev.withdrawn > 0 ? (
                      <Badge tone="gray">退榜 {ev.withdrawn}</Badge>
                    ) : null}
                    <Badge tone="blue">
                      归巢率 {ev.returnRate === null ? "—" : `${ev.returnRate}%`}
                    </Badge>
                    <Badge tone="green">均速 {fmtSpeed(ev.avgSpeed)}</Badge>
                  </div>
                </div>

                {rows.length === 0 ? (
                  <EmptyState text="该场次下无符合筛选的成绩。" />
                ) : (
                  <table className="rank-table">
                    <thead>
                      <tr>
                        <th className="col-rank">名次</th>
                        <th>足环号 / 血统</th>
                        <th>状态</th>
                        <th className="col-num">速度</th>
                        <th>说明</th>
                        <th className="col-action">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((x) => {
                        const meta = RESULT_BADGE[x.badge];
                        return (
                          <tr
                            key={x.result.id}
                            className={`row-${x.badge}${
                              x.rank === null && x.result.returned ? " row-offboard" : ""
                            }`}
                          >
                            <td className="col-rank">
                              {x.rank ? <span className="rank-no">{x.rank}</span> : "—"}
                            </td>
                            <td>
                              <strong>{x.bird.ringNo}</strong>
                              <span className="record-sub">
                                {" "}
                                {x.bird.bloodline}
                              </span>
                            </td>
                            <td>
                              <Badge tone={meta.tone}>{meta.label}</Badge>
                            </td>
                            <td className="col-num">{fmtSpeed(x.result.speed)}</td>
                            <td className="reason-cell">{x.reason}</td>
                            <td className="col-action">
                              {x.badge === "review" ? (
                                <button
                                  className="mini-btn"
                                  onClick={() => run(actions.reviewResult(x.result.id))}
                                >
                                  复核通过并锁定
                                </button>
                              ) : x.result.lockState === "locked" ? (
                                <span className="subtle">已锁定</span>
                              ) : (
                                <span className="subtle">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
