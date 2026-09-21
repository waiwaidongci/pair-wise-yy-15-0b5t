// 界面层共用的时间/数字格式化（不含任何业务规则）。

const pad = (n: number) => String(n).padStart(2, "0");

/** 适合 datetime-local 输入框的本地时间值 */
export function toLocalInput(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export function fmtClock(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 相对时间，如 “3小时前 / 20分钟后” */
export function fmtRelative(iso: string, now: number): string {
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  if (mins < 1) return "刚刚";
  const value =
    mins < 60
      ? `${mins} 分钟`
      : mins < 60 * 24
      ? `${Math.round(mins / 60)} 小时`
      : `${Math.round(mins / (60 * 24))} 天`;
  return diff >= 0 ? `${value}后` : `${value}前`;
}

/** 到目标时间的正倒计时，如 “3小时40分后可复查解除” */
export function fmtCountdown(targetIso: string, now: number): string {
  let ms = new Date(targetIso).getTime() - now;
  const future = ms >= 0;
  ms = Math.abs(ms);
  const h = Math.floor(ms / 3600000);
  const m = Math.round((ms % 3600000) / 60000);
  const text = h > 0 ? `${h}小时${m > 0 ? `${m}分` : ""}` : `${m}分钟`;
  return future ? `${text}后` : `${text}前`;
}

export function fmtSpeed(v?: number | null): string {
  return typeof v === "number" ? `${v.toLocaleString()} m/min` : "—";
}

export function distanceBand(km: number): string {
  if (km < 100) return "短距离";
  if (km <= 300) return "中距离";
  return "长距离";
}
