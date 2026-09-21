import type { ReactNode } from "react";
import type { Toast } from "./useApp";
import type { ResultBadge } from "../domain/rules";

export function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export const RESULT_BADGE: Record<
  ResultBadge,
  { label: string; tone: string }
> = {
  ranked: { label: "在榜", tone: "green" },
  "locked-ranked": { label: "锁定在榜", tone: "blue" },
  review: { label: "待复核", tone: "amber" },
  withdrawn: { label: "异常退榜", tone: "red" },
  notreturned: { label: "未归巢", tone: "gray" },
};

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "default" | "red" | "amber" | "blue" | "green";
}) {
  return (
    <article className={`stat-card stat-${tone}`}>
      <small>{label}</small>
      <strong>{value}</strong>
      {hint ? <p>{hint}</p> : null}
    </article>
  );
}

export function ToastHost({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="toast-host">
      {toasts.map((t) => (
        <button
          key={t.id}
          className={`toast toast-${t.kind}`}
          onClick={() => onDismiss(t.id)}
        >
          <b>{t.kind === "success" ? "✓" : t.kind === "error" ? "✕" : "⧗"}</b>
          <span>{t.text}</span>
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>;
}

export function SectionTitle({
  kicker,
  title,
  desc,
}: {
  kicker: string;
  title: string;
  desc?: string;
}) {
  return (
    <div className="section-title">
      <p>{kicker}</p>
      <h2>{title}</h2>
      {desc ? <span>{desc}</span> : null}
    </div>
  );
}
