import { useEffect, useState, type ReactNode } from "react";
import type { SubmissionResult } from "../types";
import type { Action } from "../store";
import { dispatch, getLastResult, subscribeResult } from "./useStore";
import { idemKey } from "../store";

// ---------- 全局提交结果提示 ----------

export function Toast() {
  const [item, setItem] = useState<{ result: SubmissionResult; seq: number } | null>(
    getLastResult().result ? { result: getLastResult().result!, seq: getLastResult().seq } : null
  );

  useEffect(() => subscribeResult((result, seq) => setItem({ result, seq })), []);

  useEffect(() => {
    if (!item) return;
    const t = setTimeout(() => setItem(null), 4200);
    return () => clearTimeout(t);
  }, [item?.seq]);

  if (!item) return null;
  return (
    <div className={`toast ${item.result.ok ? "ok" : "err"}`} role="status">
      <strong>{item.result.ok ? "提交成功" : "提交被拒绝"}</strong>
      <span>{item.result.message}</span>
    </div>
  );
}

// ---------- 幂等提交：重复点击/并发提交沿用首次结果 ----------

export function useIdemSubmit() {
  const [busy, setBusy] = useState(false);
  const keyRef = { current: "" };
  // 用 state 持有 key，提交期间不变
  const [key, setKey] = useState(() => idemKey("ui"));
  keyRef.current = key;

  async function run(build: (idem: string) => Action): Promise<SubmissionResult> {
    if (busy) return { ok: false, message: "提交处理中，请勿重复点击" };
    setBusy(true);
    try {
      // 同一轮提交使用同一幂等键：双击/并发都沿用首次结果
      const result = dispatch(build(keyRef.current));
      return result;
    } finally {
      setBusy(false);
      // 成功或失败都换发新键，下一轮是一次全新提交
      setKey(idemKey("ui"));
    }
  }

  return { busy, run };
}

// ---------- 通用容器 ----------

export function Panel({
  title,
  hint,
  extra,
  children,
}: {
  title: string;
  hint?: string;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="heading">
        <div>
          {hint && <p className="panel-hint">{hint}</p>}
          <h2>{title}</h2>
        </div>
        {extra}
      </div>
      {children}
    </section>
  );
}

export function Badge({ tone, children }: { tone: "danger" | "warn" | "ok" | "muted" | "info"; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>
        {label}
        {hint && <em>{hint}</em>}
      </span>
      {children}
    </label>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}
