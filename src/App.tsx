import { useState } from "react";
import "./styles.css";
import { OverviewPanel } from "./ui/OverviewPanel";
import { RacesPanel } from "./ui/RacesPanel";
import { HealthPanel } from "./ui/HealthPanel";
import { BirdsPanel } from "./ui/BirdsPanel";
import { ToastHost } from "./ui/components";
import { useApp } from "./ui/useApp";
import { fmtDateTime } from "./ui/format";

const TABS = [
  { id: "overview", label: "鸽棚总览" },
  { id: "races", label: "训放成绩" },
  { id: "health", label: "健康观察" },
  { id: "birds", label: "鸽档案与血统" },
];

function App() {
  const { view, now, toasts, dismissToast, resetDemo } = useApp();
  const [tab, setTab] = useState("overview");

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <p className="kicker">hxyfront-62014 · 赛鸽训放记录</p>
          <h1>健康观察与成绩冻结闭环</h1>
          <span className="tagline">
            同地点同时间只认一场 · 异常退榜、同场逐羽复核 · 两次正常复查且相隔 ≥12 小时解除 ·
            重复/并发提交沿用首次结果
          </span>
        </div>
        <div className="topbar-side">
          <div className="clock">
            <span className="dot" /> 棚内时间 {fmtDateTime(new Date(now).toISOString())}
          </div>
          <div className="topbar-badges">
            {view.stats.frozenBirds > 0 ? (
              <span className="pill pill-red">冻结 {view.stats.frozenBirds} 羽</span>
            ) : null}
            {view.stats.reviewPending > 0 ? (
              <span className="pill pill-amber">
                待复核 {view.stats.reviewPending} 条
              </span>
            ) : null}
            {view.stats.notReturned > 0 ? (
              <span className="pill pill-gray">
                未归巢 {view.stats.notReturned} 羽
              </span>
            ) : null}
          </div>
          <button
            className="ghost-btn"
            onClick={() => {
              if (window.confirm("确认恢复为演示数据？当前修改将被清除。")) resetDemo();
            }}
          >
            重置演示数据
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
          </button>
        ))}
      </nav>

      {tab === "overview" ? <OverviewPanel onGo={setTab} /> : null}
      {tab === "races" ? <RacesPanel /> : null}
      {tab === "health" ? <HealthPanel /> : null}
      {tab === "birds" ? <BirdsPanel /> : null}

      <footer className="footer">
        规则、存储、界面分层：规则层（domain）为唯一裁决者，存储层（data）负责 localStorage
        持久化与幂等台账，界面层（ui）从同一推导视图渲染 —— 列表、统计与刷新后始终一致。
      </footer>

      <ToastHost toasts={toasts} onDismiss={dismissToast} />
    </main>
  );
}

export default App;
