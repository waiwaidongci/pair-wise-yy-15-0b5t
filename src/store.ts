// 存储层：localStorage 持久化 + 提交幂等。
// 所有写操作经过 apply()，重复/并发提交（同一幂等键）沿用首次结果。
import type { AppState, SubmissionResult } from "./types";
import {
  findRace,
  findRaceRecord,
  getPigeon,
  isRecordLocked,
  isUnderObservation,
  pairKey,
  uid,
} from "./rules";

const STORAGE_KEY = "hxyfront-62014:state:v1";

export type Action =
  | { kind: "registerPigeon"; idemKey: string; ring: string; bloodline: string; now: string }
  | {
      kind: "createRace";
      idemKey: string;
      place: string;
      releaseTime: string;
      distance: number;
      weather: string;
      now: string;
    }
  | {
      kind: "addRaceRecords";
      idemKey: string;
      place: string;
      releaseTime: string;
      entries: { pigeonId: string; arrivalTime: string | null; speed: number | null }[];
      now: string;
    }
  | {
      kind: "addHealth";
      idemKey: string;
      pigeonId: string;
      at: string;
      abnormal: boolean;
      finding: string;
      now: string;
    }
  | {
      kind: "correctHealth";
      idemKey: string;
      originalId: string;
      at: string;
      abnormal: boolean;
      finding: string;
      now: string;
    }
  | {
      kind: "addPair";
      idemKey: string;
      pigeonAId: string;
      pigeonBId: string;
      at: string;
      note: string;
      now: string;
    }
  | { kind: "lockRecord"; idemKey: string; raceId: string; recordId: string; note: string; now: string }
  | { kind: "resetSeed" }
  | { kind: "clearAll" };

function commit(
  prev: AppState,
  next: AppState,
  idemKey: string,
  result: SubmissionResult
): { state: AppState; result: SubmissionResult } {
  const state: AppState = {
    ...next,
    idempotency: { ...next.idempotency, [idemKey]: result },
  };
  return { state, result };
}

function fail(prev: AppState, message: string): { state: AppState; result: SubmissionResult } {
  return { state: prev, result: { ok: false, message } };
}

export function apply(prev: AppState, action: Action): { state: AppState; result: SubmissionResult } {

  // 幂等：任何提交（含失败提交）都只认首次结果
  if (action.kind !== "resetSeed" && action.kind !== "clearAll") {
    const first = prev.idempotency[action.idemKey];
    if (first) return { state: prev, result: first };
  }

  switch (action.kind) {
    case "resetSeed":
      return { state: seedState(), result: { ok: true, message: "已恢复演示数据" } };

    case "clearAll":
      return { state: emptyState(), result: { ok: true, message: "已清空全部数据" } };

    case "registerPigeon": {
      const ring = action.ring.trim();
      if (!ring) return fail(prev, "请填写足环号");
      if (prev.pigeons.some((p) => p.ring === ring)) return fail(prev, `足环号 ${ring} 已存在`);
      const pigeon = {
        id: uid("pg"),
        ring,
        bloodline: action.bloodline.trim() || "未登记",
        createdAt: action.now,
      };
      return commit(prev, { ...prev, pigeons: [...prev.pigeons, pigeon] }, action.idemKey, {
        ok: true,
        message: `已登记赛鸽 ${ring}`,
        entityId: pigeon.id,
      });
    }

    case "createRace": {
      const place = action.place.trim();
      if (!place || !action.releaseTime) return fail(prev, "请填写放飞地点和放飞时间");
      if (!Number.isFinite(action.distance) || action.distance <= 0) return fail(prev, "放飞距离需为正数");
      const existing = findRace(prev, place, action.releaseTime);
      // 同一放飞地点和时间只认一场训放
      if (existing) {
        return commit(prev, prev, action.idemKey, {
          ok: true,
          message: `同地点同时间的训放已存在（${place}），沿用首次场次`,
          entityId: existing.id,
        });
      }
      const race = {
        id: uid("rc"),
        place,
        releaseTime: new Date(action.releaseTime).toISOString(),
        distance: action.distance,
        weather: action.weather.trim(),
        records: [],
        createdAt: action.now,
      };
      return commit(prev, { ...prev, races: [...prev.races, race] }, action.idemKey, {
        ok: true,
        message: `已创建训放场次：${place}`,
        entityId: race.id,
      });
    }

    case "addRaceRecords": {
      const race = findRace(prev, action.place, action.releaseTime);
      if (!race) return fail(prev, "未找到对应训放场次");
      const blocked: string[] = [];
      const seen = new Set<string>();
      const fresh = action.entries.filter((e) => {
        const pigeon = getPigeon(prev, e.pigeonId);
        if (!pigeon) return false;
        if (isUnderObservation(prev, e.pigeonId, race.releaseTime)) {
          blocked.push(pigeon.ring);
          return false; // 观察期间禁止新增训放成绩
        }
        if (findRaceRecord(race, e.pigeonId) || seen.has(e.pigeonId)) return false;
        seen.add(e.pigeonId);
        return true;
      });
      if (!fresh.length && blocked.length) {
        return fail(prev, `以下赛鸽处于健康观察期，禁止新增训放：${blocked.join("、")}`);
      }
      const newRecords = fresh.map((e) => ({
        id: uid("rr"),
        pigeonId: e.pigeonId,
        arrivalTime: e.arrivalTime ? new Date(e.arrivalTime).toISOString() : null,
        speed: e.arrivalTime && e.speed != null ? e.speed : null,
      }));
      const races = prev.races.map((r) =>
        r.id === race.id ? { ...r, records: [...r.records, ...newRecords] } : r
      );
      const msg = blocked.length
        ? `已登记 ${newRecords.length} 羽；观察期被拦截：${blocked.join("、")}`
        : `已登记 ${newRecords.length} 羽归巢成绩`;
      return commit(prev, { ...prev, races }, action.idemKey, { ok: true, message: msg });
    }

    case "addHealth": {
      if (!getPigeon(prev, action.pigeonId)) return fail(prev, "请选择赛鸽");
      if (!action.at) return fail(prev, "请填写观察/复查时间");
      const duplicate = prev.health.find(
        (h) =>
          h.pigeonId === action.pigeonId &&
          h.at === new Date(action.at).toISOString() &&
          !h.correctionOf
      );
      if (duplicate) return fail(prev, "该时间点已有健康记录，如需修改请使用更正");
      const record = {
        id: uid("hl"),
        pigeonId: action.pigeonId,
        at: new Date(action.at).toISOString(),
        abnormal: action.abnormal,
        finding: action.finding.trim() || (action.abnormal ? "健康异常" : "复查正常"),
        createdAt: action.now,
      };
      return commit(prev, { ...prev, health: [...prev.health, record] }, action.idemKey, {
        ok: true,
        message: action.abnormal
          ? "已登记健康异常，相关未锁定成绩退出排行并进入逐羽复核"
          : "已登记正常复查（解除需连续两次正常且间隔≥12小时）",
        entityId: record.id,
      });
    }

    case "correctHealth": {
      // 旧记录更正：原记录保留为历史，按新值重算冻结范围
      const original = prev.health.find((h) => h.id === action.originalId);
      if (!original) return fail(prev, "待更正的健康记录不存在");
      if (!action.at) return fail(prev, "请填写复查时间");
      const record = {
        id: uid("hl"),
        pigeonId: original.pigeonId,
        at: new Date(action.at).toISOString(),
        abnormal: action.abnormal,
        finding: action.finding.trim() || (action.abnormal ? "更正为异常" : "更正为正常"),
        correctionOf: original.id,
        createdAt: action.now,
      };
      return commit(prev, { ...prev, health: [...prev.health, record] }, action.idemKey, {
        ok: true,
        message: "已更正并保留历史，冻结范围已按更正后的时间线重算",
        entityId: record.id,
      });
    }

    case "addPair": {
      const a = getPigeon(prev, action.pigeonAId);
      const b = getPigeon(prev, action.pigeonBId);
      if (!a || !b) return fail(prev, "请选择配对的两羽赛鸽");
      if (a.id === b.id) return fail(prev, "不能与自身配对");
      // 观察期间禁止配对
      const blocked = [a, b].filter((p) => isUnderObservation(prev, p.id, action.at));
      if (blocked.length) return fail(prev, `${blocked.map((p) => p.ring).join("、")} 处于健康观察期，禁止配对`);
      const pair = {
        id: uid("pr"),
        pigeonAId: a.id,
        pigeonBId: b.id,
        at: new Date(action.at).toISOString(),
        note: action.note.trim(),
      };
      const dup = prev.pairs.find((p) => pairKey(p) === pairKey(pair));
      const message = dup ? "该配对已存在，沿用首次记录" : `已登记配对：${a.ring} × ${b.ring}`;
      return commit(prev, { ...prev, pairs: [...prev.pairs, pair] }, action.idemKey, {
        ok: !dup,
        message,
        entityId: dup?.id ?? pair.id,
      });
    }

    case "lockRecord": {
      const race = prev.races.find((r) => r.id === action.raceId);
      const record = race?.records.find((r) => r.id === action.recordId);
      if (!race || !record) return fail(prev, "待复核成绩不存在");
      if (isRecordLocked(prev, race.id, record.id)) {
        const existing = prev.locks.find((l) => l.raceId === race.id && l.recordId === record.id)!;
        // 已锁定：无新事实产生，直接返回同一状态，沿用首次结果
        return { state: prev, result: { ok: true, message: "该成绩已复核锁定，沿用首次结果", entityId: existing.id } };
      }
      const lock = {
        id: uid("lk"),
        raceId: race.id,
        recordId: record.id,
        pigeonId: record.pigeonId,
        at: action.now,
        note: action.note.trim(),
      };
      return commit(prev, { ...prev, locks: [...prev.locks, lock] }, action.idemKey, {
        ok: true,
        message: "复核完成，成绩已锁定",
        entityId: lock.id,
      });
    }
  }
}

// ---------- 持久化 ----------

export function emptyState(): AppState {
  return { version: 1, pigeons: [], races: [], health: [], pairs: [], locks: [], idempotency: {} };
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedState();
    const parsed = JSON.parse(raw) as AppState;
    if (parsed.version !== 1) return seedState();
    return { ...emptyState(), ...parsed };
  } catch {
    return seedState();
  }
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存储不可用时静默降级（刷新后回到种子数据）
  }
}

// ---------- 演示数据 ----------

export function seedState(): AppState {
  const now = "2026-09-20T09:00:00.000Z";
  const pigeons = [
    { id: "pg1", ring: "CHN-24-001839", bloodline: "詹森系", createdAt: "2026-09-01T01:00:00.000Z" },
    { id: "pg2", ring: "CHN-24-002114", bloodline: "凡龙系", createdAt: "2026-09-01T01:00:00.000Z" },
    { id: "pg3", ring: "CHN-23-008771", bloodline: "胡本系（种鸽）", createdAt: "2026-09-01T01:00:00.000Z" },
    { id: "pg4", ring: "CHN-24-003322", bloodline: "盖比系", createdAt: "2026-09-01T01:00:00.000Z" },
    { id: "pg5", ring: "CHN-24-004510", bloodline: "詹森系", createdAt: "2026-09-01T01:00:00.000Z" },
  ];
  const races: AppState["races"] = [
    {
      id: "rc1",
      place: "新乡",
      releaseTime: "2026-09-12T07:00:00.000Z",
      distance: 80,
      weather: "晴",
      createdAt: "2026-09-12T06:00:00.000Z",
      records: [
        { id: "rr11", pigeonId: "pg1", arrivalTime: "2026-09-12T08:08:00.000Z", speed: 1176 },
        { id: "rr12", pigeonId: "pg3", arrivalTime: "2026-09-12T08:22:00.000Z", speed: 975 },
        { id: "rr13", pigeonId: "pg5", arrivalTime: "2026-09-12T08:14:00.000Z", speed: 1095 },
      ],
    },
    {
      id: "rc2",
      place: "安阳",
      releaseTime: "2026-09-16T06:30:00.000Z",
      distance: 120,
      weather: "侧风",
      createdAt: "2026-09-16T05:30:00.000Z",
      records: [
        { id: "rr21", pigeonId: "pg1", arrivalTime: "2026-09-16T08:17:00.000Z", speed: 1121 },
        { id: "rr22", pigeonId: "pg4", arrivalTime: "2026-09-16T08:48:00.000Z", speed: 869 },
        { id: "rr23", pigeonId: "pg5", arrivalTime: "2026-09-16T08:30:00.000Z", speed: 1018 },
      ],
    },
    {
      id: "rc3",
      place: "新乡",
      releaseTime: "2026-09-19T07:00:00.000Z",
      distance: 80,
      weather: "晴",
      createdAt: "2026-09-19T06:00:00.000Z",
      records: [
        { id: "rr31", pigeonId: "pg1", arrivalTime: "2026-09-19T08:05:00.000Z", speed: 1230 },
        { id: "rr32", pigeonId: "pg2", arrivalTime: "2026-09-19T08:22:00.000Z", speed: 980 },
        { id: "rr33", pigeonId: "pg4", arrivalTime: null, speed: null },
        { id: "rr34", pigeonId: "pg5", arrivalTime: "2026-09-19T08:12:00.000Z", speed: 1130 },
      ],
    },
  ];
  const health: AppState["health"] = [
    // pg4：09-15 异常，09-16、09-18 两次正常复查，相隔 51 小时 ≥12h → 已解除
    { id: "hl41", pigeonId: "pg4", at: "2026-09-15T07:30:00.000Z", abnormal: true, finding: "水便、消瘦", createdAt: "2026-09-15T08:00:00.000Z" },
    { id: "hl42", pigeonId: "pg4", at: "2026-09-16T08:00:00.000Z", abnormal: false, finding: "用药后粪便成形", createdAt: "2026-09-16T08:05:00.000Z" },
    { id: "hl43", pigeonId: "pg4", at: "2026-09-18T11:30:00.000Z", abnormal: false, finding: "状态恢复，家飞正常", createdAt: "2026-09-18T11:40:00.000Z" },
    // pg2：09-19 放飞前异常（09-18 晚归后），09-19 晚仅一次正常复查 → 仍在观察期，09-19 场次成绩冻结待复核
    { id: "hl21", pigeonId: "pg2", at: "2026-09-18T19:00:00.000Z", abnormal: true, finding: "080 归巢后精神萎靡", createdAt: "2026-09-18T19:30:00.000Z" },
    { id: "hl22", pigeonId: "pg2", at: "2026-09-19T21:00:00.000Z", abnormal: false, finding: "第一次复查：略有好转", createdAt: "2026-09-19T21:10:00.000Z" },
    // pg5：09-19 晚登记疑似异常，次日上午已做第一次正常复查 → 仍观察中，但冻结区间晚于 09-19 场次
    { id: "hl51", pigeonId: "pg5", at: "2026-09-19T20:00:00.000Z", abnormal: true, finding: "疑似单眼伤风", createdAt: "2026-09-19T20:20:00.000Z" },
    { id: "hl52", pigeonId: "pg5", at: "2026-09-20T07:30:00.000Z", abnormal: false, finding: "第一次复查：眼部消肿，观察中", createdAt: "2026-09-20T07:40:00.000Z" },
  ];
  const pairs: AppState["pairs"] = [
    { id: "pr1", pigeonAId: "pg3", pigeonBId: "pg5", at: "2026-09-10T02:00:00.000Z", note: "种鸽配对（观察期前）" },
  ];
  // pg4 在 09-16 场次的成绩虽落在历史冻结区间，已逐羽复核锁定，锁定后仍在榜并标注
  const locks: AppState["locks"] = [
    { id: "lk1", raceId: "rc2", recordId: "rr22", pigeonId: "pg4", at: "2026-09-17T01:00:00.000Z", note: "成绩真实有效，复核锁定" },
  ];
  return { version: 1, pigeons, races, health, pairs, locks, idempotency: {} };
}

// 供界面生成幂等键
export function idemKey(prefix: string): string {
  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
}
