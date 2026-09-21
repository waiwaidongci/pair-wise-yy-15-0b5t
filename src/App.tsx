import { useState } from "react";
import "./styles.css";
import { dispatch, useAppState } from "./ui/useStore";
import { Toast } from "./ui/components";
import { Overview } from "./ui/Overview";
import { RacesPanel } from "./ui/RacesPanel";
import { ReviewPanel } from "./ui/ReviewPanel";
import { HealthPanel } from "./ui/HealthPanel";
import { ArchivePanel } from "./ui/ArchivePanel";
import { overviewStats } from "./rules";

const TABS = [
  { id: "overview", label: "鸽棚总览" },
  { id: "races", label: "训放与排行" },
  { id: "review", label: "逐羽复核" },
  { id: "health", label: "健康观察" },
  { id: "archive", label: "赛鸽档案" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function App() {
  const state = useAppState();
  const [tab, setTab] = useState<TabId>("overview");
  // “现在”取自最新健康记录时间之后的演示时钟：便于演示 12h 倒计时。
  // 真实使用以系统时间为准；这里取 max(当前时间, 最后记录时间)。
  const now = (() => {
    const sys = Date.now();
    const lastHealth = state.health.reduce((m, h) => Math.max(m, +new Date(h.at)), 0);
    return new Date(Math.max(sys, lastHealth)).toISOString();
  })();
  const stats = overviewStats(state, now);

  return (
    <main className="app">
      <Toast />
      <header className="topbar">
        <div>
          <p className="brand-line">hxyfront-62014 · 赛鸽训放记录</p>
          <h1>健康观察 × 成绩冻结闭环</h1>
          <p className="rules-line">
            同地点同时间只认一场 · 异常未锁定成绩退出排行并逐羽复核 · 两次正常复查且间隔≥12h解除 ·
            更正重算冻结范围、历史保留 · 重复提交沿用首次结果
          </p>
        </div>
        <div className="top-actions">
          <button
            onClick={() => {
              if (confirm("恢复演示数据？当前数据将被覆盖。")) dispatch({ kind: "resetSeed" });
            }}
          >
            恢复演示数据
          </button>
          <button
            onClick={() => {
              if (confirm("清空全部本地数据？")) dispatch({ kind: "clearAll" });
            }}
          >
            清空
          </button>
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "tab-on" : ""}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === "review" && stats.pendingReview > 0 && <span className="tab-dot">{stats.pendingReview}</span>}
            {t.id === "health" && stats.observedNow > 0 && <span className="tab-dot warn">{stats.observedNow}</span>}
          </button>
        ))}
      </nav>

      {tab === "overview" && <Overview state={state} now={now} goto={(t) => setTab(t as TabId)} />}
      {tab === "races" && <RacesPanel state={state} now={now} />}
      {tab === "review" && <ReviewPanel state={state} />}
      {tab === "health" && <HealthPanel state={state} now={now} />}
      {tab === "archive" && <ArchivePanel state={state} />}

      <footer className="foot">
        规则引擎（src/rules.ts）、存储与幂等（src/store.ts，localStorage）、界面（src/ui）三层分离；
        列表、统计、排行、档案均由同一份状态派生，刷新页面后保持一致。
      </footer>
    </main>
  );
}

export default App;
