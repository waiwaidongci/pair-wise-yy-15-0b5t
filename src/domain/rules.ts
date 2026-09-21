// 规则层：纯函数，不接触存储与 DOM。
// - 同场唯一键（地点 + 分钟级放飞时间）
// - 健康冻结窗：异常起点，连续两次正常复查且相隔 >=12 小时方可解除
// - 成绩在榜状态：未锁定异常鸽成绩退榜；同场其余未锁定成绩逐羽复核
// - 冻结期间禁止新增训放与配对
import type {
  AppState,
  Bird,
  HealthRecord,
  PairingInput,
  RaceEvent,
  RaceResult,
} from "./types";

export const RECHECK_MIN_GAP_MS = 12 * 60 * 60 * 1000; // 十二小时
export const REQUIRED_NORMAL_RECHECKS = 2;

// ---------- 时间工具 ----------

/** 规整到分钟：同一放飞地点和时间只认一场训放 */
export function canonicalRelease(releasedAt: string): string {
  const d = new Date(releasedAt);
  d.setSeconds(0, 0);
  return d.toISOString();
}

export function eventKey(site: string, releasedAt: string): string {
  return `${site.trim()}@${canonicalRelease(releasedAt)}`;
}

export function minutesBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 60000;
}

export function isFuture(iso: string, now: number): boolean {
  return new Date(iso).getTime() > now + 60 * 1000;
}

// ---------- 健康冻结窗 ----------

export interface FreezeWindow {
  birdId: string;
  startAt: string; // 异常观察时间（冻结起点）
  startRecordId: string;
  /** 达到解除条件的时间；null 表示截至 now 仍在观察中 */
  endAt: string | null;
  /** 解除条件满足后，下一次复查的最早时间（供界面提示） */
  eligibleLiftAt: string | null;
  streak: number; // 截至 now 的连续正常复查次数
}

/**
 * 按时间顺序重放某羽鸽的有效（未作废）健康记录：
 * - 遇到异常：冻结开始（沿用最早一次未恢复的异常时间），正常计数清零
 * - 遇到正常：连续正常 +1；当连续达到 2 次且第一次与本次相隔 >=12h，解除
 * 旧记录更正后重算冻结范围，历史保留由存储层负责，这里只看有效记录。
 */
export function computeFreezeWindows(
  birdId: string,
  health: HealthRecord[],
  now: number
): FreezeWindow[] {
  const recs = health
    .filter((h) => h.birdId === birdId && !h.voided)
    .sort(
      (a, b) =>
        new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime() ||
        a.createdAt.localeCompare(b.createdAt)
    );

  const windows: FreezeWindow[] = [];
  let open: FreezeWindow | null = null;
  let streakTimes: string[] = [];

  for (const rec of recs) {
    if (rec.observedAt && new Date(rec.observedAt).getTime() > now) break; // 未来记录暂不生效

    if (rec.status === "abnormal") {
      if (!open) {
        open = {
          birdId,
          startAt: rec.observedAt,
          startRecordId: rec.id,
          endAt: null,
          eligibleLiftAt: null,
          streak: 0,
        };
      }
      streakTimes = []; // 观察期间再次异常，复查计数重新累计
    } else if (open) {
      streakTimes.push(rec.observedAt);
      const streak = streakTimes.length;
      open.streak = streak;
      // 两次（含）以上正常复查，且本轮首次正常与本次相隔 >=12h 才解除：
      // 期间多做一次正常复查不会让 12 小时观察计时重新开始。
      if (streak >= REQUIRED_NORMAL_RECHECKS) {
        const first = streakTimes[0];
        const gap = new Date(rec.observedAt).getTime() - new Date(first).getTime();
        if (gap >= RECHECK_MIN_GAP_MS) {
          open.endAt = rec.observedAt;
          windows.push(open);
          open = null;
          streakTimes = [];
        }
      }
    }
  }

  if (open) {
    open.streak = streakTimes.length;
    if (streakTimes.length >= 1) {
      const first = streakTimes[0];
      open.eligibleLiftAt = new Date(
        new Date(first).getTime() + RECHECK_MIN_GAP_MS
      ).toISOString();
    } else {
      open.eligibleLiftAt = null;
    }
    windows.push(open);
  }

  return windows;
}

export function isFrozenAt(windows: FreezeWindow[], at: string): boolean {
  const t = new Date(at).getTime();
  return windows.some(
    (w) =>
      new Date(w.startAt).getTime() <= t &&
      (w.endAt === null || new Date(w.endAt).getTime() >= t)
  );
}

export function activeWindow(
  windows: FreezeWindow[],
  now: number
): FreezeWindow | null {
  const open = windows.find((w) => w.endAt === null);
  if (!open) return null;
  return new Date(open.startAt).getTime() <= now ? open : null;
}

export interface FreezeIndex {
  /** birdId -> 当前开启的冻结窗 */
  active: Map<string, FreezeWindow>;
  /** birdId -> 全部冻结窗（含已解除） */
  all: Map<string, FreezeWindow[]>;
}

export function buildFreezeIndex(
  birds: Bird[],
  health: HealthRecord[],
  now: number
): FreezeIndex {
  const active = new Map<string, FreezeWindow>();
  const all = new Map<string, FreezeWindow[]>();
  for (const bird of birds) {
    const wins = computeFreezeWindows(bird.id, health, now);
    all.set(bird.id, wins);
    const cur = activeWindow(wins, now);
    if (cur) active.set(bird.id, cur);
  }
  return { active, all };
}

// ---------- 成绩状态推导 ----------

export type ResultBadge =
  | "ranked" // 在榜（含锁定）
  | "review" // 同场复核中
  | "withdrawn" // 健康异常退榜
  | "notreturned" // 未归巢（提醒）
  | "locked-ranked"; // 锁定且在榜

export interface DerivedResult {
  result: RaceResult;
  event: RaceEvent;
  bird: Bird;
  rank: number | null; // 名次；未在榜为 null
  badge: ResultBadge;
  reason: string;
}

export interface DerivedEvent {
  event: RaceEvent;
  rows: DerivedResult[];
  rankedRows: DerivedResult[];
  /** 本场是否存在因健康异常退榜的成绩 -> 其余成绩需逐羽复核 */
  tainted: boolean;
  reviewPending: number;
  withdrawn: number;
  notReturned: number;
  avgSpeed: number | null;
  returnRate: number | null;
}

export interface Stats {
  birds: number;
  events: number;
  totalResults: number;
  returnRate: number | null;
  avgSpeed: number | null;
  notReturned: number;
  frozenBirds: number;
  reviewPending: number;
  withdrawn: number;
  rankedCount: number;
  lockedCount: number;
}

export interface DerivedView {
  events: DerivedEvent[];
  rows: DerivedResult[];
  stats: Stats;
  freeze: FreezeIndex;
  birdMap: Map<string, Bird>;
  eventMap: Map<string, RaceEvent>;
}

/** 规则核心：根据当前冻结状态推导每条成绩的在榜情况 */
export function deriveView(state: AppState, now: number): DerivedView {
  const birdMap = new Map(state.birds.map((b) => [b.id, b]));
  const eventMap = new Map(state.events.map((e) => [e.id, e]));
  const freeze = buildFreezeIndex(state.birds, state.health, now);

  // 场次污染：同场出现“冻结鸽的未锁定成绩”，其余未锁定成绩逐羽复核
  const taintedEventIds = new Set<string>();
  for (const r of state.results) {
    if (r.lockState === "unlocked" && freeze.active.has(r.birdId)) {
      taintedEventIds.add(r.eventId);
    }
  }

  const rows: DerivedResult[] = [];

  const deriveRow = (r: RaceResult): DerivedResult => {
    const event = eventMap.get(r.eventId)!;
    const bird = birdMap.get(r.birdId)!;
    const locked = r.lockState === "locked";

    if (!r.returned) {
      return {
        result: r,
        event,
        bird,
        rank: null,
        badge: "notreturned",
        reason: "未归巢提醒",
      };
    }

    if (freeze.active.has(r.birdId)) {
      if (locked) {
        return {
          result: r,
          event,
          bird,
          rank: null, // 名次在排序后统一回填
          badge: "locked-ranked",
          reason: "健康异常观察期，成绩已锁定仍保留排行",
        };
      }
      return {
        result: r,
        event,
        bird,
        rank: null,
        badge: "withdrawn",
        reason: "健康异常观察期，未锁定成绩退出排行",
      };
    }

    if (taintedEventIds.has(r.eventId) && !locked) {
      return {
        result: r,
        event,
        bird,
        rank: null,
        badge: "review",
        reason: "同场有健康异常鸽，待逐羽复核",
      };
    }

    return {
      result: r,
      event,
      bird,
      rank: null,
      badge: locked ? "locked-ranked" : "ranked",
      reason: locked ? "成绩已锁定" : "成绩在榜",
    };
  };

  for (const r of state.results) rows.push(deriveRow(r));

  const derivedEvents: DerivedEvent[] = [];
  for (const event of state.events) {
    const evRows = rows.filter((x) => x.event.id === event.id);
    const inRanking = evRows.filter(
      (x) =>
        x.result.returned &&
        (x.badge === "ranked" || x.badge === "locked-ranked")
    );
    inRanking.sort(
      (a, b) => (b.result.speed ?? 0) - (a.result.speed ?? 0)
    );
    inRanking.forEach((x, i) => (x.rank = i + 1));

    const rankedRows = inRanking;
    const speeds = rankedRows
      .map((x) => x.result.speed)
      .filter((v): v is number => typeof v === "number");
    const returnedCount = evRows.filter((x) => x.result.returned).length;

    derivedEvents.push({
      event,
      rows: evRows.sort((a, b) => {
        // 列表顺序：在榜按名次，其次复核 / 退榜 / 未归巢
        const order = (b: string) =>
          ({
            "locked-ranked": 0,
            ranked: 0,
            review: 1,
            withdrawn: 2,
            notreturned: 3,
          })[b] ?? 9;
        return (
          order(a.badge) - order(b.badge) ||
          (b.result.speed ?? -1) - (a.result.speed ?? -1)
        );
      }),
      rankedRows,
      tainted: taintedEventIds.has(event.id),
      reviewPending: evRows.filter((x) => x.badge === "review").length,
      withdrawn: evRows.filter((x) => x.badge === "withdrawn").length,
      notReturned: evRows.filter((x) => !x.result.returned).length,
      avgSpeed: speeds.length
        ? Math.round(speeds.reduce((s, v) => s + v, 0) / speeds.length)
        : null,
      returnRate: evRows.length
        ? Math.round((returnedCount / evRows.length) * 1000) / 10
        : null,
    });
  }

  derivedEvents.sort(
    (a, b) =>
      new Date(b.event.releasedAt).getTime() -
      new Date(a.event.releasedAt).getTime()
  );

  const allRanked = rows.filter((x) => x.rank !== null);
  const allSpeeds = allRanked
    .map((x) => x.result.speed)
    .filter((v): v is number => typeof v === "number");
  const totalReturned = state.results.filter((r) => r.returned).length;

  const stats: Stats = {
    birds: state.birds.length,
    events: state.events.length,
    totalResults: state.results.length,
    returnRate: state.results.length
      ? Math.round((totalReturned / state.results.length) * 1000) / 10
      : null,
    avgSpeed: allSpeeds.length
      ? Math.round(allSpeeds.reduce((s, v) => s + v, 0) / allSpeeds.length)
      : null,
    notReturned: state.results.filter((r) => !r.returned).length,
    frozenBirds: freeze.active.size,
    reviewPending: rows.filter((x) => x.badge === "review").length,
    withdrawn: rows.filter((x) => x.badge === "withdrawn").length,
    rankedCount: allRanked.length,
    lockedCount: state.results.filter((r) => r.lockState === "locked").length,
  };

  return {
    events: derivedEvents,
    rows,
    stats,
    freeze,
    birdMap,
    eventMap,
  };
}

// ---------- 操作校验（规则） ----------

export class RuleError extends Error {}

export function validateRaceInput(
  input: { site: string; releasedAt: string; distanceKm: number; entries: { birdId: string }[] },
  state: AppState,
  now: number
): void {
  if (!input.site.trim()) throw new RuleError("请填写放飞地点");
  if (!input.releasedAt || Number.isNaN(new Date(input.releasedAt).getTime()))
    throw new RuleError("请选择有效的放飞时间");
  if (new Date(input.releasedAt).getTime() > now + 5 * 60 * 1000)
    throw new RuleError("放飞时间不能晚于当前时间");
  if (!(input.distanceKm > 0)) throw new RuleError("放飞距离需大于 0");
  if (input.entries.length === 0)
    throw new RuleError("至少登记一羽参训赛鸽");
  const ids = input.entries.map((e) => e.birdId);
  if (new Set(ids).size !== ids.length)
    throw new RuleError("同一场训放中一羽鸽只能登记一次");

  const key = eventKey(input.site, input.releasedAt);
  const dup = state.events.find((e) => eventKey(e.site, e.releasedAt) === key);
  if (dup) throw new RuleError("该地点与放飞时间已存在一场训放，同场不重复登记");

  // 冻结期间禁止新增训放
  const frozen = input.entries
    .map((e) => state.birds.find((b) => b.id === e.birdId))
    .filter((b): b is Bird => !!b)
    .filter((b) => activeWindow(computeFreezeWindows(b.id, state.health, now), now));
  if (frozen.length)
    throw new RuleError(
      `健康观察冻结期禁止新增训放：${frozen.map((b) => b.ringNo).join("、")}`
    );
}

export function validateHealthInput(
  input: { birdId: string; observedAt: string; note: string },
  now: number
): void {
  if (!input.birdId) throw new RuleError("请选择赛鸽");
  if (!input.observedAt || Number.isNaN(new Date(input.observedAt).getTime()))
    throw new RuleError("请选择观察时间");
  if (new Date(input.observedAt).getTime() > now + 60 * 1000)
    throw new RuleError("观察时间不能晚于当前时间");
  if (!input.note.trim()) throw new RuleError("请填写观察说明（症状 / 复查结论）");
}

export function validatePairing(
  input: PairingInput,
  state: AppState,
  now: number
): void {
  if (!input.birdAId || !input.birdBId)
    throw new RuleError("请选择配对的两羽赛鸽");
  if (input.birdAId === input.birdBId)
    throw new RuleError("不能与自身配对");
  if (!input.pairedAt || Number.isNaN(new Date(input.pairedAt).getTime()))
    throw new RuleError("请选择配对日期");
  if (new Date(input.pairedAt).getTime() > now + 60 * 1000)
    throw new RuleError("配对日期不能晚于当前时间");
  if (!input.note.trim()) throw new RuleError("请填写配对说明");

  const a = state.birds.find((b) => b.id === input.birdAId)!;
  const b = state.birds.find((x) => x.id === input.birdBId)!;
  const blocked = [a, b].filter((bird) =>
    activeWindow(computeFreezeWindows(bird.id, state.health, now), now)
  );
  if (blocked.length)
    throw new RuleError(
      `健康观察冻结期禁止配对：${blocked.map((x) => x.ringNo).join("、")}`
    );

  // 配对时间落在任一方任一冻结窗内同样禁止（历史时间也要挡）
  for (const bird of [a, b]) {
    const wins = computeFreezeWindows(bird.id, state.health, now);
    if (isFrozenAt(wins, input.pairedAt))
      throw new RuleError(`${bird.ringNo} 在该日期处于健康冻结期，禁止配对`);
  }

  const dup = state.pairings.find(
    (p) =>
      [p.birdAId, p.birdBId].sort().join("|") ===
        [input.birdAId, input.birdBId].sort().join("|")
  );
  if (dup) throw new RuleError("这两羽赛鸽已有配对记录");
}

export function canReview(result: RaceResult, view: DerivedView): boolean {
  if (result.lockState === "locked") return false;
  const dr = view.rows.find((x) => x.result.id === result.id);
  return dr?.badge === "review";
}
