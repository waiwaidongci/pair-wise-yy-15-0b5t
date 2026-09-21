// 规则层：全部为纯函数，不依赖 React / localStorage。
// 业务规则集中在本文件，界面与存储只做搬运与渲染。
import type {
  AppState,
  HealthRecord,
  PairRecord,
  Pigeon,
  Race,
  RaceRecord,
} from "./types";

// ---------- 通用工具 ----------

export const RECOVERY_GAP_MS = 12 * 60 * 60 * 1000; // 解除观察：两次正常复查至少相隔 12 小时

export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/** 同一场训放的唯一键：同一放飞地点和时间只认一场训放 */
export function raceKey(place: string, releaseTime: string): string {
  return `${place.trim().replace(/\s+/g, "")}|${new Date(releaseTime).getTime()}`;
}

export function raceKeyOf(race: Race): string {
  return raceKey(race.place, race.releaseTime);
}

export function findRace(state: AppState, place: string, releaseTime: string): Race | undefined {
  const key = raceKey(place, releaseTime);
  return state.races.find((r) => raceKeyOf(r) === key);
}

export function getPigeon(state: AppState, id: string): Pigeon | undefined {
  return state.pigeons.find((p) => p.id === id);
}

export function findRaceRecord(
  race: Race,
  pigeonId: string
): RaceRecord | undefined {
  return race.records.find((r) => r.pigeonId === pigeonId);
}

// ---------- 健康时间线：更正记录覆盖原记录，原记录历史保留 ----------

interface EffectiveHealthPoint {
  /** 生效所用的记录（更正后指向更正记录） */
  record: HealthRecord;
  /** 原始记录（未更正时与 record 相同） */
  original: HealthRecord;
  at: string;
  abnormal: boolean;
  finding: string;
}

/**
 * 把健康记录折叠为生效时间线：
 * 被更正的记录被其更正记录取代；原记录仍在 state.health 中作为历史保留。
 * 同一条原记录可被多次更正：以 createdAt 最新的更正为准（更正链）。
 */
export function effectiveTimeline(
  state: AppState,
  pigeonId: string
): EffectiveHealthPoint[] {
  const mine = state.health.filter((h) => h.pigeonId === pigeonId);

  // 归一化出“基础记录”：任一更正记录最终指向的原始（非更正）记录 id。
  // 同一条原记录可被连续多次更正，每次更正都指向同一个根。
  const byId = new Map(mine.map((h) => [h.id, h]));
  const baseOf = new Map<string, string>();
  const resolveRoot = (id: string, seen: Set<string>): string => {
    const rec = byId.get(id);
    if (!rec || !rec.correctionOf || seen.has(rec.correctionOf)) return id;
    return resolveRoot(rec.correctionOf, new Set(seen).add(id));
  };
  for (const h of mine) {
    if (h.correctionOf) baseOf.set(h.id, resolveRoot(h.id, new Set()));
  }

  // 每个基础 id 取最新的一条：有更正则取最新更正，否则为原始记录。
  // createdAt 相同（同一刻连续更正）时，按写入顺序以后者为准——遍历顺序即追加顺序。
  const originals = mine.filter((h) => !h.correctionOf);
  const corrections = mine.filter((h) => h.correctionOf);
  const effectiveByBase = new Map<string, HealthRecord>();
  for (const o of originals) {
    let best: HealthRecord = o;
    for (const c of corrections) {
      if (baseOf.get(c.id) !== o.id) continue;
      if (!best.correctionOf || c.createdAt >= best.createdAt) best = c;
    }
    effectiveByBase.set(o.id, best);
  }

  const points: EffectiveHealthPoint[] = [];
  for (const h of mine) {
    if (h.correctionOf) continue; // 更正记录不作为独立点输出
    const effective = effectiveByBase.get(h.id) ?? h;
    points.push({
      record: effective,
      original: h,
      at: effective.at,
      abnormal: effective.abnormal,
      finding: effective.finding,
    });
  }
  points.sort((a, b) => +new Date(a.at) - +new Date(b.at) || a.record.createdAt.localeCompare(b.record.createdAt));
  return points;
}

export interface HealthEpisode {
  pigeonId: string;
  startAt: string; // 异常发现时间
  /** 解除时间（第二次正常复查时间）；null 表示观察中 */
  endAt: string | null;
  startRecord: HealthRecord;
  /** 解除所依据的复查点（0~2 个） */
  normalChecks: EffectiveHealthPoint[];
}

/**
 * 由生效时间线计算健康观察区间。
 * 解除条件：异常之后连续两次正常复查，且两次间隔至少 12 小时。
 * 两次正常之间再次出现异常，连续计数清零。
 */
export function computeEpisodes(state: AppState, pigeonId: string): HealthEpisode[] {
  const points = effectiveTimeline(state, pigeonId);
  const episodes: HealthEpisode[] = [];
  let current: HealthEpisode | null = null;
  for (const p of points) {
    if (!current) {
      if (p.abnormal) {
        current = {
          pigeonId,
          startAt: p.at,
          endAt: null,
          startRecord: p.record,
          normalChecks: [],
        };
      }
      continue;
    }
    if (p.abnormal) {
      // 复查期内再次异常：正常计数清零，观察起点以最新异常为准
      current = {
        pigeonId,
        startAt: p.at,
        endAt: null,
        startRecord: p.record,
        normalChecks: [],
      };
      continue;
    }
    // 正常复查
    const checks = [...current.normalChecks, p];
    if (checks.length === 1) {
      current.normalChecks = checks;
    } else if (checks.length >= 2) {
      const gap = +new Date(checks[1].at) - +new Date(checks[0].at);
      if (gap >= RECOVERY_GAP_MS) {
        current.normalChecks = [checks[0], checks[1]];
        current.endAt = checks[1].at;
        episodes.push(current);
        current = null;
      } else {
        // 间隔不足 12 小时：第二次不算数，保留第一次，等待新的复查
        current.normalChecks = [checks[0]];
      }
    }
  }
  if (current) episodes.push(current);
  return episodes;
}

export function allEpisodes(state: AppState): HealthEpisode[] {
  return state.pigeons.flatMap((p) => computeEpisodes(state, p.id));
}

/** 某羽鸽在指定时刻是否处于健康观察（冻结）期 */
export function isUnderObservation(
  state: AppState,
  pigeonId: string,
  at: string
): boolean {
  const t = +new Date(at);
  return computeEpisodes(state, pigeonId).some(
    (e) => +new Date(e.startAt) <= t && (e.endAt === null || t <= +new Date(e.endAt))
  );
}

/** 当前（now）仍在观察中的赛鸽 id */
export function activeObservedIds(state: AppState, now: string): Set<string> {
  const set = new Set<string>();
  for (const p of state.pigeons) {
    if (isUnderObservation(state, p.id, now)) set.add(p.id);
  }
  return set;
}

// ---------- 冻结范围与复核 ----------

export interface ReviewItem {
  race: Race;
  record: RaceRecord;
  pigeonId: string;
  locked: boolean;
}

/**
 * 受冻结范围波及的成绩：放飞时间落在任一健康观察区间内的成绩。
 * 区间重算（含旧健康记录更正）后自动反映最新范围。
 */
export function recordsUnderFreeze(state: AppState): ReviewItem[] {
  const episodes = allEpisodes(state);
  const items: ReviewItem[] = [];
  for (const race of state.races) {
    const t = +new Date(race.releaseTime);
    for (const record of race.records) {
      const hit = episodes.some(
        (e) =>
          e.pigeonId === record.pigeonId &&
          +new Date(e.startAt) <= t &&
          (e.endAt === null || t <= +new Date(e.endAt))
      );
      if (!hit) continue;
      items.push({
        race,
        record,
        pigeonId: record.pigeonId,
        locked: isRecordLocked(state, race.id, record.id),
      });
    }
  }
  return items;
}

/** 未锁定（待逐羽复核）的成绩——退出排行 */
export function pendingReviewItems(state: AppState): ReviewItem[] {
  return recordsUnderFreeze(state).filter((i) => !i.locked);
}

export function isRecordLocked(state: AppState, raceId: string, recordId: string): boolean {
  return state.locks.some((l) => l.raceId === raceId && l.recordId === recordId);
}

/** 某条成绩是否被冻结（处于冻结范围且尚未复核锁定） */
export function isRecordFrozen(state: AppState, race: Race, record: RaceRecord): boolean {
  if (isRecordLocked(state, race.id, record.id)) return false;
  const t = +new Date(race.releaseTime);
  return computeEpisodes(state, record.pigeonId).some(
    (e) =>
      +new Date(e.startAt) <= t &&
      (e.endAt === null || t <= +new Date(e.endAt))
  );
}

// ---------- 排行（冻结的未锁定成绩退出排行） ----------

export interface RankingRow {
  race: Race;
  record: RaceRecord;
  pigeon: Pigeon;
  frozen: boolean;
  locked: boolean;
}

export function raceRanking(state: AppState, race: Race): RankingRow[] {
  return race.records
    .filter((r) => r.arrivalTime && r.speed != null)
    .map((record) => ({
      race,
      record,
      pigeon: getPigeon(state, record.pigeonId)!,
      frozen: isRecordFrozen(state, race, record),
      locked: isRecordLocked(state, race.id, record.id),
    }))
    .filter((row) => !row.frozen) // 健康异常鸽的未锁定成绩退出排行
    .sort((a, b) => (b.record.speed ?? 0) - (a.record.speed ?? 0));
}

export function allRankings(state: AppState): RankingRow[] {
  return state.races
    .slice()
    .sort((a, b) => +new Date(a.releaseTime) - +new Date(b.releaseTime))
    .flatMap((race) => raceRanking(state, race).map((row, i) => ({ ...row, rank: i + 1 })));
}

// ---------- 未归巢 ----------

export interface NotHomeItem {
  race: Race;
  record: RaceRecord;
  pigeon: Pigeon;
}

export function notHomeItems(state: AppState): NotHomeItem[] {
  return state.races
    .slice()
    .sort((a, b) => +new Date(b.releaseTime) - +new Date(a.releaseTime))
    .flatMap((race) =>
      race.records
        .filter((r) => !r.arrivalTime)
        .map((record) => ({ race, record, pigeon: getPigeon(state, record.pigeonId)! }))
    );
}

// ---------- 统计（与列表、排行同源，保证一致） ----------

export interface OverviewStats {
  totalPigeons: number;
  observedNow: number;
  pendingReview: number;
  notHome: number;
  homeRate: number; // 百分比
  avgSpeed: number | null; // 米/分（按全部已归巢成绩）
  raceCount: number;
}

export function overviewStats(state: AppState, now: string): OverviewStats {
  const allRecords = state.races.flatMap((r) => r.records);
  const arrived = allRecords.filter((r) => r.arrivalTime && r.speed != null);
  const avgSpeed = arrived.length
    ? arrived.reduce((s, r) => s + (r.speed ?? 0), 0) / arrived.length
    : null;
  return {
    totalPigeons: state.pigeons.length,
    observedNow: activeObservedIds(state, now).size,
    pendingReview: pendingReviewItems(state).length,
    notHome: allRecords.filter((r) => !r.arrivalTime).length,
    homeRate: allRecords.length ? (arrived.length / allRecords.length) * 100 : 0,
    avgSpeed,
    raceCount: state.races.length,
  };
}

// ---------- 配对 ----------

export function pairKey(pair: Pick<PairRecord, "pigeonAId" | "pigeonBId">): string {
  return ["pair", [pair.pigeonAId, pair.pigeonBId].sort().join("~")].join(":");
}

export function pairsOf(state: AppState, pigeonId: string): PairRecord[] {
  return state.pairs
    .filter((p) => p.pigeonAId === pigeonId || p.pigeonBId === pigeonId)
    .sort((a, b) => +new Date(b.at) - +new Date(a.at));
}
