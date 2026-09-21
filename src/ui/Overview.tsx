import type { AppState } from "../types";
import {
  activeObservedIds,
  computeEpisodes,
  notHomeItems,
  overviewStats,
  pendingReviewItems,
} from "../rules";
import { Badge, Empty, Panel } from "./components";
import { fmtDT, hoursBetween } from "./format";

export function Overview({ state, now, goto }: { state: AppState; now: string; goto: (tab: string) => void }) {
  const stats = overviewStats(state, now);
  const observed = activeObservedIds(state, now);
  const pending = pendingReviewItems(state);
  const notHome = notHomeItems(state);
  const pigeonRing = (id: string) => state.pigeons.find((p) => p.id === id)?.ring ?? id;

  return (
    <div className="stack">
      <section className="metrics">
        <article>
          <small>在册赛鸽</small>
          <strong>{stats.totalPigeons}</strong>
          <em>训放场次 {stats.raceCount}</em>
        </article>
        <article>
          <small>归巢率</small>
          <strong>{stats.homeRate.toFixed(0)}%</strong>
          <em>平均速度 {stats.avgSpeed ? Math.round(stats.avgSpeed) : "—"} m/min</em>
        </article>
        <article className={observed.size ? "metric-alert" : ""}>
          <small>健康观察中</small>
          <strong>{stats.observedNow}</strong>
          <em>解除需两次正常复查且间隔≥12h</em>
        </article>
        <article className={pending.length ? "metric-alert" : ""}>
          <small>待逐羽复核</small>
          <strong>{stats.pendingReview}</strong>
          <em>未归巢 {stats.notHome} 羽</em>
        </article>
      </section>

      <div className="two-col">
        <Panel
          title="健康观察闭环"
          hint="冻结范围"
          extra={<button className="link-btn" onClick={() => goto("health")}>进入健康台</button>}
        >
          {observed.size === 0 ? (
            <Empty>当前没有观察中的赛鸽</Empty>
          ) : (
            <ul className="watch-list">
              {[...observed].map((id) => {
                const episode = computeEpisodes(state, id).find((e) => e.endAt === null)!;
                const checks = episode.normalChecks.length;
                const last = episode.normalChecks[episode.normalChecks.length - 1];
                const nextGapOk = checks === 1 && last ? hoursBetween(last.at, now) : null;
                return (
                  <li key={id}>
                    <div>
                      <b>{pigeonRing(id)}</b>
                      <p>
                        异常始于 {fmtDT(episode.startAt)} · {episode.startRecord.finding}
                      </p>
                    </div>
                    <div className="watch-side">
                      {checks === 0 && <Badge tone="danger">等待首次正常复查</Badge>}
                      {checks === 1 && (
                        <Badge tone={nextGapOk != null && nextGapOk >= 12 ? "warn" : "warn"}>
                          已 1 次正常复查
                          {nextGapOk != null &&
                            (nextGapOk >= 12
                              ? "，可做第二次复查解除"
                              : `，距首次仅 ${nextGapOk.toFixed(1)}h（需满 12h）`)}
                        </Badge>
                      )}
                      <p className="muted">观察期间禁止新增训放与配对</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel
          title="未归巢提醒"
          hint="最新场次在前"
          extra={<button className="link-btn" onClick={() => goto("races")}>成绩排行</button>}
        >
          {notHome.length === 0 ? (
            <Empty>全部归巢，无未归巢记录</Empty>
          ) : (
            <ul className="watch-list">
              {notHome.map(({ race, pigeon }) => (
                <li key={`${race.id}-${pigeon.id}`}>
                  <div>
                    <b>{pigeon.ring}</b>
                    <p>
                      {race.place} · {race.distance}km · 放飞 {fmtDT(race.releaseTime)}
                    </p>
                  </div>
                  <Badge tone="danger">未归巢</Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="待逐羽复核（退出排行）" hint="健康异常鸽的未锁定成绩">
        {pending.length === 0 ? (
          <Empty>没有待复核成绩</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>足环号</th>
                <th>场次</th>
                <th>放飞时间</th>
                <th>归巢/速度</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pending.map(({ race, record }) => (
                <tr key={record.id}>
                  <td>{pigeonRing(record.pigeonId)}</td>
                  <td>{race.place} · {race.distance}km</td>
                  <td>{fmtDT(race.releaseTime)}</td>
                  <td>{record.arrivalTime ? `${fmtDT(record.arrivalTime)} · ${record.speed} m/min` : "未归巢"}</td>
                  <td><button className="link-btn" onClick={() => goto("review")}>去复核</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
