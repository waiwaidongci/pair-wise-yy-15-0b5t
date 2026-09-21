// 领域模型：赛鸽、训放场次、成绩、健康记录、配对
// 规则层与存储层共用的类型定义，界面层只消费推导后的视图模型。

export type HealthStatusValue = "normal" | "abnormal";

export interface Bird {
  id: string;
  ringNo: string;
  bloodline: string;
  gender: "雄" | "雌";
  bornYear: number;
  isBreeder?: boolean;
}

export interface RaceEvent {
  /** 同一放飞地点 + 同一放飞时间（精确到分钟）只允许存在一场 */
  id: string;
  site: string;
  releasedAt: string; // ISO 时间，分钟精度
  distanceKm: number;
  weather: string;
  createdAt: string;
}

export interface RaceResult {
  id: string;
  eventId: string;
  birdId: string;
  returned: boolean;
  homedAt?: string;
  speed?: number; // 米/分钟
  /** 锁定后永久在榜（黏滞）；未锁定成绩受健康冻结、同场复核影响 */
  lockState: "locked" | "unlocked";
  note?: string;
}

export interface HealthRecord {
  id: string;
  birdId: string;
  observedAt: string; // ISO
  status: HealthStatusValue;
  note: string;
  createdAt: string;
  /** 更正记录：旧记录仅作废不删除，新记录指向旧记录，历史保留 */
  voided?: boolean;
  correctedFromId?: string;
}

export interface Pairing {
  id: string;
  birdAId: string;
  birdBId: string;
  pairedAt: string;
  note?: string;
}

export type IdemStatus = "pending" | "done" | "error";

export interface IdemEntry {
  key: string;
  status: IdemStatus;
  resultId?: string;
  message?: string;
  at: string;
}

export interface AppState {
  version: number;
  birds: Bird[];
  events: RaceEvent[];
  results: RaceResult[];
  health: HealthRecord[];
  pairings: Pairing[];
  /** 幂等台账：重复 / 并发提交一律沿用首次结果 */
  idempotency: Record<string, IdemEntry>;
}

export interface RaceEntryInput {
  birdId: string;
  returned: boolean;
  speed?: number;
}

export interface RaceInput {
  site: string;
  releasedAt: string; // ISO
  distanceKm: number;
  weather: string;
  entries: RaceEntryInput[];
}

export interface HealthInput {
  birdId: string;
  observedAt: string;
  status: HealthStatusValue;
  note: string;
}

export interface PairingInput {
  birdAId: string;
  birdBId: string;
  pairedAt: string;
  note: string;
}
