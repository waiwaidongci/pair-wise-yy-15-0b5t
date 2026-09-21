// 演示数据：时间均以首次加载时刻为基准偏移，保证冻结/复查状态可见。
import type { AppState } from "../domain/types";

const H = 60 * 60 * 1000;
const D = 24 * H;

function iso(base: number, offset: number): string {
  return new Date(base + offset).toISOString();
}

export function buildSeed(now: number = Date.now()): AppState {
  const birds = [
    { id: "b1", ringNo: "CHN-24-001839", bloodline: "詹森系", gender: "雄" as const, bornYear: 2024 },
    { id: "b2", ringNo: "CHN-24-002114", bloodline: "凡龙系", gender: "雌" as const, bornYear: 2024 },
    { id: "b3", ringNo: "CHN-24-003307", bloodline: "詹森系", gender: "雄" as const, bornYear: 2024 },
    { id: "b4", ringNo: "CHN-23-008771", bloodline: "胡本系", gender: "雌" as const, bornYear: 2023, isBreeder: true },
    { id: "b5", ringNo: "CHN-24-005662", bloodline: "凡龙系", gender: "雌" as const, bornYear: 2024 },
    { id: "b6", ringNo: "CHN-23-009018", bloodline: "盖比系", gender: "雄" as const, bornYear: 2023 },
  ];

  // 场次（时间偏移：越早负得越多）
  const e1Release = iso(now, -26 * H);
  const e2Release = iso(now, -8 * H);
  const e3Release = iso(now, -4 * D);

  const events = [
    {
      id: "e1",
      site: "南郊放飞点",
      releasedAt: e1Release,
      distanceKm: 80,
      weather: "晴",
      createdAt: iso(now, -27 * H),
    },
    {
      id: "e2",
      site: "西河大桥",
      releasedAt: e2Release,
      distanceKm: 120,
      weather: "侧风",
      createdAt: iso(now, -9 * H),
    },
    {
      id: "e3",
      site: "北郊放飞点",
      releasedAt: e3Release,
      distanceKm: 50,
      weather: "多云",
      createdAt: iso(now, -5 * D),
    },
  ];

  const results = [
    // 80km：b2 健康异常 -> 未锁定成绩退榜；其余未锁定成绩逐羽复核；b1 已锁定黏滞在榜
    { id: "r1", eventId: "e1", birdId: "b1", returned: true, homedAt: iso(now, -25 * H + 62 * 60 * 1000), speed: 1290, lockState: "locked" as const, note: "状态稳定，已锁定" },
    { id: "r2", eventId: "e1", birdId: "b2", returned: true, homedAt: iso(now, -25 * H + 70 * 60 * 1000), speed: 1142, lockState: "unlocked" as const },
    { id: "r3", eventId: "e1", birdId: "b3", returned: true, homedAt: iso(now, -25 * H + 66 * 60 * 1000), speed: 1212, lockState: "unlocked" as const },
    { id: "r4", eventId: "e1", birdId: "b5", returned: false, lockState: "unlocked" as const, note: "超时未归，列入未归巢提醒" },

    // 120km：b2 冻结期不能参训，无其成绩；本场无污染
    { id: "r5", eventId: "e2", birdId: "b1", returned: true, homedAt: iso(now, -8 * H + 96 * 60 * 1000), speed: 1250, lockState: "unlocked" as const },
    { id: "r6", eventId: "e2", birdId: "b3", returned: true, homedAt: iso(now, -8 * H + 101 * 60 * 1000), speed: 1188, lockState: "unlocked" as const },
    { id: "r7", eventId: "e2", birdId: "b6", returned: true, homedAt: iso(now, -8 * H + 110 * 60 * 1000), speed: 1090, lockState: "unlocked" as const },

    // 50km：历史场，b2 当时正常，成绩已锁定 -> 如今异常也不退出（黏滞）
    { id: "r8", eventId: "e3", birdId: "b2", returned: true, homedAt: iso(now, -4 * D + 40 * 60 * 1000), speed: 1250, lockState: "locked" as const },
    { id: "r9", eventId: "e3", birdId: "b1", returned: true, homedAt: iso(now, -4 * D + 43 * 60 * 1000), speed: 1162, lockState: "locked" as const },
    { id: "r10", eventId: "e3", birdId: "b4", returned: true, homedAt: iso(now, -4 * D + 48 * 60 * 1000), speed: 1041, lockState: "locked" as const },
    { id: "r11", eventId: "e3", birdId: "b6", returned: true, homedAt: iso(now, -4 * D + 52 * 60 * 1000), speed: 962, lockState: "unlocked" as const },
  ];

  // b2 健康时间线：归巢后发现异常；8h 前、3h 前各一次正常复查（相隔仅 5h < 12h）
  // -> 冻结仍开启；首次复查 +12h（约 4h 后）再做一次正常复查即可解除。
  const health = [
    {
      id: "h1",
      birdId: "b2",
      observedAt: iso(now, -23.5 * H),
      status: "abnormal" as const,
      note: "归巢后张口呼吸、鼻瘤发白，疑似呼吸道感染",
      createdAt: iso(now, -23.5 * H + 10 * 60 * 1000),
    },
    {
      id: "h2",
      birdId: "b2",
      observedAt: iso(now, -8 * H),
      status: "normal" as const,
      note: "用药后第一次复查：精神好转，仍有少量鼻液",
      createdAt: iso(now, -8 * H + 5 * 60 * 1000),
    },
    {
      id: "h3",
      birdId: "b2",
      observedAt: iso(now, -3 * H),
      status: "normal" as const,
      note: "第二次复查：采食量恢复（距首次复查仅 5 小时，未满 12 小时间隔）",
      createdAt: iso(now, -3 * H + 4 * 60 * 1000),
    },
    // b1 常规体检正常
    {
      id: "h4",
      birdId: "b1",
      observedAt: iso(now, -2 * D),
      status: "normal" as const,
      note: "例行体检正常",
      createdAt: iso(now, -2 * D + 20 * 60 * 1000),
    },
  ];

  const pairings = [
    {
      id: "p1",
      birdAId: "b4",
      birdBId: "b6",
      pairedAt: iso(now, -30 * D),
      note: "胡本 × 盖比 春季繁育配对",
    },
  ];

  return {
    version: 1,
    birds,
    events,
    results,
    health,
    pairings,
    idempotency: {},
  };
}
