import { Badge, EmptyState, SectionTitle, StatCard } from "./components";
import { useApp } from "./useApp";
import { fmtCountdown, fmtDateTime } from "./format";

export function OverviewPanel({ onGo }: { onGo: (tab: string) => void }) {
  const { view, now } = useApp();
  const { stats, freeze } = view;

  const notReturned = view.rows.filter((x) => !x.result.returned);
  const activeFreezes = [...freeze.active.entries()].map(([birdId, w]) => {
    const bird = view.birdMap.get(birdId)!;
    return { bird, window: w };
  });

  return (
    <div className="panel-stack">
      <section className="metrics metrics-flex">
        <StatCard
          label="归巢率"
          value={stats.returnRate === null ? "—" : `${stats.returnRate}%`}
          hint={`${stats.totalResults} 条成绩 / ${stats.events} 场训放`}
          tone="green"
        />
        <StatCard
          label="在榜平均速度"
          value={stats.avgSpeed === null ? "—" : `${stats.avgSpeed}`}
          hint="米/分钟，仅统计在榜成绩"
          tone="blue"
        />
        <StatCard
          label="健康冻结"
          value={stats.frozenBirds}
          hint="羽观察中，禁训放禁配对"
          tone={stats.frozenBirds > 0 ? "red" : "default"}
        />
        <StatCard
          label="待逐羽复核"
          value={stats.reviewPending}
          hint="同场健康异常，复核后锁定"
          tone={stats.reviewPending > 0 ? "amber" : "default"}
        />
        <StatCard
          label="异常退榜"
          value={stats.withdrawn}
          hint="条未锁定成绩退出排行"
          tone={stats.withdrawn > 0 ? "red" : "default"}
        />
        <StatCard
          label="未归巢"
          value={stats.notReturned}
          hint="超时未归，需跟进"
          tone={stats.notReturned > 0 ? "amber" : "default"}
        />
      </section>

      <div className="two-col">
        <section className="panel">
          <SectionTitle
            kicker="闭环第一步"
            title="健康观察冻结板"
            desc="异常即冻结：未锁定成绩退榜、同场逐羽复核；连续两次正常复查且相隔 ≥12 小时自动解除。"
          />
          {activeFreezes.length === 0 ? (
            <EmptyState text="当前没有观察中的赛鸽，全部成绩正常流转。" />
          ) : (
            <div className="freeze-list">
              {activeFreezes.map(({ bird, window: w }) => (
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
                  <dl className="freeze-meta">
                    <div>
                      <dt>异常起算</dt>
                      <dd>{fmtDateTime(w.startAt)}</dd>
                    </div>
                    <div>
                      <dt>已登记正常复查</dt>
                      <dd>
                        {w.streak} 次（需 2 次且跨度 ≥12h）
                        {w.streak >= 1 && w.eligibleLiftAt ? (
                          <span className="subtle">
                            {" "}
                            · 距满足间隔{fmtCountdown(w.eligibleLiftAt, now)}
                          </span>
                        ) : (
                          <span className="subtle"> · 请先安排第一次正常复查</span>
                        )}
                      </dd>
                    </div>
                  </dl>
                  <p className="freeze-rule">
                    冻结期间禁止新增训放与配对；其未锁定成绩退出排行，同场其他成绩逐羽复核。
                  </p>
                  <button className="link-btn" onClick={() => onGo("health")}>
                    去登记复查 →
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <SectionTitle
            kicker="需要跟进"
            title="未归巢提醒"
            desc="超时未归赛鸽单独提醒，不计入归巢率与速度统计。"
          />
          {notReturned.length === 0 ? (
            <EmptyState text="近期训放全部归巢。" />
          ) : (
            <div className="records">
              {notReturned.map((x) => (
                <article key={x.result.id} className="record-row">
                  <b>!</b>
                  <div>
                    <h3>
                      {x.bird.ringNo}
                      <span className="record-sub"> {x.bird.bloodline}</span>
                    </h3>
                    <p>
                      {x.event.site} · {x.event.distanceKm}km · 放飞于{" "}
                      {fmtDateTime(x.event.releasedAt)}
                    </p>
                    {x.result.note ? <p className="note">{x.result.note}</p> : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="panel">
        <SectionTitle kicker="规则速览" title="健康观察与成绩冻结闭环" />
        <ol className="rule-list">
          <li>同一放飞地点、同一时间（分钟级）只认一场训放，重复/并发提交沿用首次结果。</li>
          <li>登记健康异常后：该鸽未锁定成绩立即退出排行；同一场次其他未锁定成绩逐羽复核，复核通过即锁定在榜。</li>
          <li>连续两次正常复查、且两次相隔至少十二小时，冻结自动解除；冻结期禁止新增训放与配对。</li>
          <li>已锁定成绩黏滞在榜，不因后续健康异常退出；旧健康记录更正后重算冻结范围，原始记录保留。</li>
          <li>排行、统计、提醒均由同一套规则从持久化状态推导，刷新页面后保持一致。</li>
        </ol>
      </section>
    </div>
  );
}
