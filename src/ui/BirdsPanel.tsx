import { useMemo, useState } from "react";
import { Badge, EmptyState, RESULT_BADGE, SectionTitle, StatCard } from "./components";
import { useApp } from "./useApp";
import { distanceBand, fmtDateTime, fmtSpeed } from "./format";

export function BirdsPanel() {
  const { state, view, run, actions } = useApp();
  const [bloodline, setBloodline] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(
    state.birds[0]?.id ?? null
  );
  const [breederOnly, setBreederOnly] = useState(false);

  // 建档表单
  const [ringNo, setRingNo] = useState("");
  const [bl, setBl] = useState("");
  const [gender, setGender] = useState<"雄" | "雌">("雄");
  const [bornYear, setBornYear] = useState(String(new Date().getFullYear()));
  const [isBreeder, setIsBreeder] = useState(false);

  const bloodlines = useMemo(
    () => [...new Set(state.birds.map((b) => b.bloodline))].sort(),
    [state.birds]
  );

  const filtered = state.birds.filter(
    (b) =>
      (bloodline === "all" || b.bloodline === bloodline) &&
      (!breederOnly || b.isBreeder)
  );

  const selected = selectedId ? view.birdMap.get(selectedId) : null;
  const selectedRows = selected
    ? view.rows
        .filter((x) => x.bird.id === selected.id)
        .sort(
          (a, b) =>
            new Date(b.event.releasedAt).getTime() -
            new Date(a.event.releasedAt).getTime()
        )
    : [];
  const selectedHealth = selected
    ? state.health
        .filter((h) => h.birdId === selected.id)
        .sort(
          (a, b) =>
            new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime()
        )
    : [];
  const selectedPairings = selected
    ? state.pairings.filter(
        (p) => p.birdAId === selected.id || p.birdBId === selected.id
      )
    : [];

  const addBird = async () => {
    const res = await run(
      actions.addBird({
        ringNo,
        bloodline: bl,
        gender,
        bornYear: Number(bornYear),
        isBreeder,
      })
    );
    if (res.status === "done" && !res.duplicate) {
      setRingNo("");
      setBl("");
      setIsBreeder(false);
      if (res.id) setSelectedId(res.id);
    }
  };

  return (
    <div className="panel-stack">
      <section className="metrics metrics-flex">
        <StatCard label="在棚羽数" value={state.birds.length} hint="全部档案" />
        <StatCard
          label="血统数"
          value={bloodlines.length}
          hint="可按血统筛选历史成绩"
          tone="blue"
        />
        <StatCard
          label="冻结观察"
          value={view.freeze.active.size}
          hint="羽（档案中红色标识）"
          tone={view.freeze.active.size > 0 ? "red" : "default"}
        />
        <StatCard
          label="种鸽"
          value={state.birds.filter((b) => b.isBreeder).length}
          hint="纳入配对管理"
          tone="green"
        />
      </section>

      <div className="two-col birds-layout">
        <section className="panel">
          <SectionTitle kicker="鸽棚总览" title="赛鸽档案" />
          <div className="filters">
            <select value={bloodline} onChange={(e) => setBloodline(e.target.value)}>
              <option value="all">全部血统</option>
              {bloodlines.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
            <label className="inline-check filter-check">
              <input
                type="checkbox"
                checked={breederOnly}
                onChange={(e) => setBreederOnly(e.target.checked)}
              />
              只看种鸽
            </label>
          </div>
          <div className="bird-list">
            {filtered.map((b) => {
              const frozen = view.freeze.active.has(b.id);
              return (
                <button
                  key={b.id}
                  className={`bird-item${selectedId === b.id ? " active" : ""}${
                    frozen ? " frozen" : ""
                  }`}
                  onClick={() => setSelectedId(b.id)}
                >
                  <div>
                    <strong>{b.ringNo}</strong>
                    <small>
                      {b.bloodline} · {b.gender} · {b.bornYear}
                      {b.isBreeder ? " · 种鸽" : ""}
                    </small>
                  </div>
                  {frozen ? <Badge tone="red">冻结中</Badge> : null}
                </button>
              );
            })}
            {filtered.length === 0 ? <EmptyState text="没有符合条件的赛鸽。" /> : null}
          </div>

          <div className="add-bird">
            <h3>建立新档案</h3>
            <div className="field-grid">
              <label>
                <span>足环号</span>
                <input
                  value={ringNo}
                  onChange={(e) => setRingNo(e.target.value)}
                  placeholder="CHN-24-xxxxxx"
                />
              </label>
              <label>
                <span>血统</span>
                <input
                  value={bl}
                  onChange={(e) => setBl(e.target.value)}
                  placeholder="如：詹森系"
                />
              </label>
              <label>
                <span>性别</span>
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value as "雄" | "雌")}
                >
                  <option value="雄">雄</option>
                  <option value="雌">雌</option>
                </select>
              </label>
              <label>
                <span>出生年份</span>
                <input
                  type="number"
                  value={bornYear}
                  onChange={(e) => setBornYear(e.target.value)}
                />
              </label>
              <label className="inline-check span-2">
                <input
                  type="checkbox"
                  checked={isBreeder}
                  onChange={(e) => setIsBreeder(e.target.checked)}
                />
                标记为种鸽（配对管理）
              </label>
            </div>
            <div className="form-actions">
              <span className="subtle">足环号重复将沿用首次建档结果</span>
              <button className="primary" onClick={addBird}>
                建立档案
              </button>
            </div>
          </div>
        </section>

        <section className="panel">
          {!selected ? (
            <EmptyState text="请选择一羽赛鸽查看单羽档案。" />
          ) : (
            <>
              <SectionTitle
                kicker="单羽赛鸽档案"
                title={`${selected.ringNo}`}
                desc={`${selected.bloodline} · ${selected.gender} · ${selected.bornYear} 年生${
                  selected.isBreeder ? " · 种鸽" : ""
                }`}
              />
              {view.freeze.active.has(selected.id) ? (
                <div className="alert-bar">
                  该鸽正处于健康观察冻结期：禁止新增训放与配对，未锁定成绩已退出排行。
                </div>
              ) : null}

              <h3 className="sub-head">历史成绩（按血统筛选已联动）</h3>
              {selectedRows.length === 0 ? (
                <EmptyState text="暂无训放成绩。" />
              ) : (
                <table className="rank-table">
                  <thead>
                    <tr>
                      <th>场次</th>
                      <th>距离</th>
                      <th>状态</th>
                      <th className="col-num">速度</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedRows.map((x) => (
                      <tr key={x.result.id} className={`row-${x.badge}`}>
                        <td>
                          {x.event.site}
                          <span className="record-sub">
                            {" "}
                            {fmtDateTime(x.event.releasedAt)}
                          </span>
                        </td>
                        <td>
                          {x.event.distanceKm}km
                          <span className="record-sub">
                            {" "}
                            {distanceBand(x.event.distanceKm)}
                          </span>
                        </td>
                        <td>
                          <Badge tone={RESULT_BADGE[x.badge].tone}>
                            {RESULT_BADGE[x.badge].label}
                          </Badge>
                        </td>
                        <td className="col-num">{fmtSpeed(x.result.speed)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <h3 className="sub-head">健康记录</h3>
              {selectedHealth.length === 0 ? (
                <EmptyState text="暂无健康记录。" />
              ) : (
                <ul className="bird-health">
                  {selectedHealth.map((h) => (
                    <li key={h.id} className={h.voided ? "voided" : ""}>
                      <Badge tone={h.status === "abnormal" ? "red" : "green"}>
                        {h.status === "abnormal" ? "异常" : "正常"}
                      </Badge>
                      <span>{fmtDateTime(h.observedAt)}</span>
                      <span className="subtle">{h.note}</span>
                      {h.voided ? <Badge tone="gray">已更正作废</Badge> : null}
                      {h.correctedFromId ? <Badge tone="blue">更正记录</Badge> : null}
                    </li>
                  ))}
                </ul>
              )}

              <h3 className="sub-head">配对记录</h3>
              {selectedPairings.length === 0 ? (
                <EmptyState text="暂无配对记录。" />
              ) : (
                <ul className="bird-pairings">
                  {selectedPairings.map((p) => {
                    const otherId =
                      p.birdAId === selected.id ? p.birdBId : p.birdAId;
                    const other = view.birdMap.get(otherId);
                    return (
                      <li key={p.id}>
                        <strong>{other?.ringNo ?? otherId}</strong>
                        <span className="subtle">
                          {" "}
                          {other?.bloodline} · {fmtDateTime(p.pairedAt)} · {p.note}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
