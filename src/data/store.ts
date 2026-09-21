// 存储层：localStorage 持久化 + 幂等/并发提交台账。
// 规则在 domain/rules 中，这里只负责存取与提交去重；界面通过订阅拿到同一份状态。
import type {
  AppState,
  HealthInput,
  HealthStatusValue,
  IdemEntry,
  PairingInput,
  RaceInput,
} from "../domain/types";
import {
  RuleError,
  canonicalRelease,
  eventKey,
  validateHealthInput,
  validatePairing,
  validateRaceInput,
} from "../domain/rules";
import { buildSeed } from "./seed";

const STORAGE_KEY = "hxyfront-62014:state:v1";
const PENDING_TTL_MS = 60 * 1000; // 进行中台账超过 60 秒视为失联，允许重试
const LATENCY_MS = 250; // 模拟服务端处理耗时，便于演示并发去重

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function canonicalMinute(iso: string): string {
  const d = new Date(iso);
  d.setSeconds(0, 0);
  return d.toISOString();
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      // 清理上次会话遗留的“进行中”台账
      const now = Date.now();
      for (const [k, entry] of Object.entries(parsed.idempotency)) {
        if (
          entry.status === "pending" &&
          now - new Date(entry.at).getTime() > PENDING_TTL_MS
        ) {
          delete parsed.idempotency[k];
        }
      }
      return parsed;
    }
  } catch {
    // 存储损坏时回退演示数据
  }
  const seed = buildSeed();
  persist(seed);
  return seed;
}

function persist(state: AppState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ---------- 订阅式状态容器 ----------

let state: AppState = loadState();
const listeners = new Set<() => void>();

function emit(): void {
  persist(state);
  for (const l of listeners) l();
}

export const store = {
  getState(): AppState {
    return state;
  },
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          state = JSON.parse(e.newValue) as AppState;
          cb();
        } catch {
          /* 忽略无法解析的跨页消息 */
        }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(cb);
      window.removeEventListener("storage", onStorage);
    };
  },
  resetDemo(): void {
    state = buildSeed();
    emit();
  },
};

// ---------- 幂等提交 ----------

export type IdemOutcome =
  | { status: "done"; id?: string; duplicate?: boolean; message?: string }
  | { status: "error"; message: string }
  | { status: "busy"; message: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 提交统一入口：
 * - 相同 key 已成功 -> 直接沿用首次结果（重复提交）
 * - 相同 key 进行中 -> 并发提交，沿用首次结果，不重复执行
 * - 相同 key 曾失败 -> 沿用首次失败结论
 * - 失联（pending 超 TTL）-> 允许重新提交
 */
async function idemRun(
  key: string,
  producer: (draft: AppState) => { id?: string; message?: string }
): Promise<IdemOutcome> {
  const now = Date.now();
  const existing = state.idempotency[key];
  if (existing) {
    const age = now - new Date(existing.at).getTime();
    if (existing.status === "pending" && age < PENDING_TTL_MS) {
      return {
        status: "busy",
        message: "相同提交正在处理中，已沿用首次结果，请勿重复提交",
      };
    }
    if (existing.status === "done" && age >= PENDING_TTL_MS) {
      return {
        status: "done",
        id: existing.resultId,
        duplicate: true,
        message: existing.message ?? "重复提交，已沿用首次结果",
      };
    }
    if (existing.status === "done") {
      return {
        status: "done",
        id: existing.resultId,
        duplicate: true,
        message: existing.message ?? "重复提交，已沿用首次结果",
      };
    }
    if (existing.status === "error") {
      return { status: "error", message: existing.message ?? "首次提交已失败" };
    }
  }

  // 首次提交：先落“进行中”台账并持久化，拦截并发
  const startedAt = new Date(now).toISOString();
  const pending: IdemEntry = { key, status: "pending", at: startedAt };
  state = {
    ...state,
    idempotency: { ...state.idempotency, [key]: pending },
  };
  persist(state);
  for (const l of listeners) l();

  await sleep(LATENCY_MS);

  // 校验 + 产生变更（await 后必须基于最新状态出草稿，避免与其他提交互相覆盖；规则层是唯一裁决者）
  try {
    // 等待期间若已有其他提交完成落库，则不允许本次草稿整体覆盖
    const latest = state;
    const draft: AppState = structuredClone(latest);
    delete draft.idempotency[key]; // producer 不关心台账
    const res = producer(draft);

    // 再兜底：等待期间若台账被其他处理替换，沿用既有结果
    if (
      latest.idempotency[key]?.status !== "pending" ||
      latest.idempotency[key]?.at !== startedAt
    ) {
      const cur = latest.idempotency[key];
      return cur?.status === "done"
        ? { status: "done", id: cur.resultId, duplicate: true, message: cur.message ?? "重复提交，已沿用首次结果" }
        : { status: "busy", message: "提交已被其他请求处理，沿用首次结果" };
    }

    const done: IdemEntry = {
      key,
      status: "done",
      resultId: res.id,
      message: res.message,
      at: new Date().toISOString(),
    };
    draft.idempotency[key] = done;
    state = draft;
    emit();
    return { status: "done", id: res.id, message: res.message };
  } catch (err) {
    const message = err instanceof RuleError ? err.message : "提交失败，请重试";
    const failed: IdemEntry = {
      key,
      status: "error",
      message,
      at: new Date().toISOString(),
    };
    state = {
      ...state,
      idempotency: { ...state.idempotency, [key]: failed },
    };
    emit();
    return { status: "error", message };
  }
}

// ---------- 业务动作 ----------

export const actions = {
  /** 新增训放（同地点同分钟只认一场；冻结鸽禁止参训） */
  submitRace(input: RaceInput): Promise<IdemOutcome> {
    const now = Date.now();
    const key = `race:${eventKey(input.site, input.releasedAt)}`;
    return idemRun(key, (draft) => {
      validateRaceInput(
        {
          site: input.site,
          releasedAt: input.releasedAt,
          distanceKm: input.distanceKm,
          entries: input.entries,
        },
        draft,
        now
      );
      const eventId = genId("e");
      draft.events.push({
        id: eventId,
        site: input.site.trim(),
        releasedAt: canonicalRelease(input.releasedAt),
        distanceKm: input.distanceKm,
        weather: input.weather.trim(),
        createdAt: new Date().toISOString(),
      });
      for (const entry of input.entries) {
        draft.results.push({
          id: genId("r"),
          eventId,
          birdId: entry.birdId,
          returned: entry.returned,
          homedAt: entry.returned ? new Date().toISOString() : undefined,
          speed: entry.returned ? entry.speed : undefined,
          lockState: "unlocked",
        });
      }
      return { id: eventId, message: "训放成绩已登记" };
    });
  },

  /** 新增健康观察 / 复查（冻结条件由规则层根据记录自动重算） */
  addHealth(input: HealthInput): Promise<IdemOutcome> {
    const now = Date.now();
    const key = `health:${input.birdId}:${canonicalMinute(
      input.observedAt
    )}:${input.status}`;
    return idemRun(key, (draft) => {
      validateHealthInput(input, now);
      const rec = {
        id: genId("h"),
        birdId: input.birdId,
        observedAt: canonicalMinute(input.observedAt),
        status: input.status,
        note: input.note.trim(),
        createdAt: new Date().toISOString(),
      };
      draft.health.push(rec);
      return {
        id: rec.id,
        message:
          input.status === "abnormal"
            ? "健康异常已登记：未锁定成绩退出排行，同场逐羽复核"
            : "正常复查已登记（冻结解除需连续两次正常且相隔 ≥12 小时）",
      };
    });
  },

  /**
   * 更正旧健康记录：旧记录仅作废保留（历史保留），写入一条新记录；
   * 冻结范围由规则层基于有效记录重算。
   */
  correctHealth(
    recordId: string,
    patch: { observedAt: string; status: HealthStatusValue; note: string }
  ): Promise<IdemOutcome> {
    const now = Date.now();
    const key = `correct:${recordId}:${canonicalMinute(
      patch.observedAt
    )}:${patch.status}`;
    return idemRun(key, (draft) => {
      const old = draft.health.find((h) => h.id === recordId);
      if (!old) throw new RuleError("原始健康记录不存在");
      if (old.voided) throw new RuleError("已作废的记录不能再次更正");
      validateHealthInput(
        {
          birdId: old.birdId,
          observedAt: patch.observedAt,
          note: patch.note,
        },
        now
      );
      old.voided = true;
      const rec = {
        id: genId("h"),
        birdId: old.birdId,
        observedAt: canonicalMinute(patch.observedAt),
        status: patch.status,
        note: patch.note.trim(),
        createdAt: new Date().toISOString(),
        correctedFromId: old.id,
      };
      draft.health.push(rec);
      return {
        id: rec.id,
        message: "健康记录已更正，冻结范围已重算（旧记录保留可查）",
      };
    });
  },

  addPairing(input: PairingInput): Promise<IdemOutcome> {
    const now = Date.now();
    const key = `pairing:${[input.birdAId, input.birdBId].sort().join("|")}:${canonicalMinute(
      input.pairedAt
    )}`;
    return idemRun(key, (draft) => {
      validatePairing(input, draft, now);
      const pairing = {
        id: genId("p"),
        birdAId: input.birdAId,
        birdBId: input.birdBId,
        pairedAt: canonicalMinute(input.pairedAt),
        note: input.note.trim(),
      };
      draft.pairings.push(pairing);
      return { id: pairing.id, message: "配对记录已保存" };
    });
  },

  /** 逐羽复核：确认无误后锁定，永久在榜（黏滞） */
  reviewResult(resultId: string): Promise<IdemOutcome> {
    const key = `review:${resultId}`;
    return idemRun(key, (draft) => {
      const r = draft.results.find((x) => x.id === resultId);
      if (!r) throw new RuleError("成绩不存在");
      if (r.lockState === "locked")
        return { id: resultId, message: "该成绩此前已复核锁定" };
      r.lockState = "locked";
      r.note = r.note ? r.note : "同场逐羽复核确认，已锁定";
      return { id: resultId, message: "复核通过，成绩已锁定" };
    });
  },

  addBird(input: {
    ringNo: string;
    bloodline: string;
    gender: "雄" | "雌";
    bornYear: number;
    isBreeder: boolean;
  }): Promise<IdemOutcome> {
    const key = `bird:${input.ringNo.trim()}`;
    return idemRun(key, (draft) => {
      if (!input.ringNo.trim()) throw new RuleError("请填写足环号");
      if (
        draft.birds.some(
          (b) => b.ringNo.toLowerCase() === input.ringNo.trim().toLowerCase()
        )
      )
        throw new RuleError("该足环号已建档");
      const bird = {
        id: genId("b"),
        ringNo: input.ringNo.trim(),
        bloodline: input.bloodline.trim() || "未登记血统",
        gender: input.gender,
        bornYear: input.bornYear,
        isBreeder: input.isBreeder,
      };
      draft.birds.push(bird);
      return { id: bird.id, message: "赛鸽档案已建立" };
    });
  },
};
