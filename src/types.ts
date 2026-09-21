// 领域模型：赛鸽、训放场次、成绩、健康记录、配对记录

export type Health = "normal" | "abnormal";

export interface Pigeon {
  id: string;
  ring: string;
  bloodline: string;
  createdAt: string;
}

export interface RaceRecord {
  id: string;
  pigeonId: string;
  arrivalTime: string | null; // null 表示未归巢
  speed: number | null; // 米/分
}

export interface Race {
  id: string;
  place: string;
  releaseTime: string; // ISO
  distance: number; // km
  weather: string;
  records: RaceRecord[];
  createdAt: string;
}

export interface HealthRecord {
  id: string;
  pigeonId: string;
  at: string; // ISO，观察/复查时间
  abnormal: boolean;
  finding: string;
  correctionOf?: string; // 若为更正记录，指向被更正的原记录
  createdAt: string;
}

export interface PairRecord {
  id: string;
  pigeonAId: string;
  pigeonBId: string;
  at: string;
  note: string;
}

export interface SubmissionResult {
  ok: boolean;
  message: string;
  /** 新建主体 id（场次/赛鸽/健康记录/配对/锁定记录），便于界面跳转与核对 */
  entityId?: string;
}

export interface AppState {
  version: 1;
  pigeons: Pigeon[];
  races: Race[];
  health: HealthRecord[];
  pairs: PairRecord[];
  /** 成绩锁定记录：某羽鸽在某场的成绩经复核后锁定 */
  locks: { id: string; raceId: string; recordId: string; pigeonId: string; at: string; note: string }[];
  /** 幂等键 -> 首次提交结果（成功与失败都沿用首次） */
  idempotency: Record<string, SubmissionResult>;
}
