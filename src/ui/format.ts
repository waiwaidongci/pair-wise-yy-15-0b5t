// 界面层工具：时间格式化与 <input type="datetime-local"> 转换
export function fmtDT(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(+d)) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function hoursBetween(a: string, b: string): number {
  return (+new Date(b) - +new Date(a)) / 3_600_000;
}

export function speedOf(distanceKm: number, releaseTime: string, arrivalTime: string): number {
  const minutes = (+new Date(arrivalTime) - +new Date(releaseTime)) / 60000;
  if (minutes <= 0) return 0;
  return Math.round((distanceKm * 1000) / minutes);
}
