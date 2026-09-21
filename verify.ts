// 规则与存储层验证脚本（不依赖 React）：npx esbuild 打包后用 node 跑
import {
  computeEpisodes,
  isRecordFrozen,
  overviewStats,
  pendingReviewItems,
  raceRanking,
  RECOVERY_GAP_MS,
} from "./src/rules";
import { apply, emptyState, seedState } from "./src/store";
import type { AppState } from "./src/types";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name} ${extra}`);
  }
}

const now = new Date().toISOString();
let s = emptyState();

// ---- 1. 登记赛鸽 + 幂等 ----
let r1 = apply(s, { kind: "registerPigeon", idemKey: "k1", ring: "R-1", bloodline: "詹森", now });
s = r1.state;
const pigeonId = r1.result.entityId!;
const r1b = apply(s, { kind: "registerPigeon", idemKey: "k1", ring: "R-1-AGAIN", bloodline: "x", now });
s = r1b.state;
check("幂等：重复提交沿用首次结果（不新增第二羽）", s.pigeons.length === 1 && r1b.result.entityId === pigeonId);
check("足环号唯一", apply(s, { kind: "registerPigeon", idemKey: "k2", ring: "R-1", bloodline: "b", now }).result.ok === false);

// 登记第二、第三羽
s = apply(s, { kind: "registerPigeon", idemKey: "k3", ring: "R-2", bloodline: "凡龙", now }).state;
s = apply(s, { kind: "registerPigeon", idemKey: "k4", ring: "R-3", bloodline: "盖比", now }).state;
const p2 = s.pigeons.find((p) => p.ring === "R-2")!.id;
const p3 = s.pigeons.find((p) => p.ring === "R-3")!.id;

// ---- 2. 同地点同时间只认一场 ----
const t0 = "2026-10-01T07:00:00.000Z";
s = apply(s, { kind: "createRace", idemKey: "k5", place: "新乡", releaseTime: t0, distance: 80, weather: "晴", now }).state;
const raceDup = apply(s, { kind: "createRace", idemKey: "k6", place: " 新乡 ", releaseTime: t0, distance: 999, weather: "雨", now });
s = raceDup.state;
check("同地点同时间只认一场", s.races.length === 1);
check("重复场次沿用首次结果（返回同一场次 id）", raceDup.result.ok && raceDup.result.entityId === s.races[0].id);
const raceId = s.races[0].id;

// 不同时间不同场
s = apply(s, { kind: "createRace", idemKey: "k7", place: "新乡", releaseTime: "2026-10-02T07:00:00.000Z", distance: 80, weather: "晴", now }).state;
check("同地点不同时间算另一场", s.races.length === 2);

// ---- 3. 成绩登记 ----
const arrive1 = "2026-10-01T08:00:00.000Z";
const arrive2 = "2026-10-01T08:10:00.000Z";
s = apply(s, {
  kind: "addRaceRecords", idemKey: "k8", place: "新乡", releaseTime: t0, now,
  entries: [
    { pigeonId, arrivalTime: arrive1, speed: 1333 },
    { pigeonId: p2, arrivalTime: arrive2, speed: 1142 },
  ],
}).state;
// 同羽同场重复登记沿用首次（不产生第二条）
s = apply(s, {
  kind: "addRaceRecords", idemKey: "k9", place: "新乡", releaseTime: t0, now,
  entries: [{ pigeonId, arrivalTime: arrive1, speed: 999 }],
}).state;
check("同羽同场重复登记不产生新成绩", s.races.find((r) => r.id === raceId)!.records.length === 2);

// ---- 4. 健康异常 → 成绩冻结退出排行，同场其他成绩不受影响 ----
const ab1 = "2026-10-01T06:00:00.000Z"; // 放飞前异常
s = apply(s, { kind: "addHealth", idemKey: "k10", pigeonId, at: ab1, abnormal: true, finding: "水便", now }).state;
const race = s.races.find((r) => r.id === raceId)!;
const rec1 = race.records.find((r) => r.pigeonId === pigeonId)!;
check("异常鸽成绩被冻结", isRecordFrozen(s, race, rec1));
const ranking = raceRanking(s, race);
check("未锁定成绩退出排行（R-1 不在榜）", ranking.every((row) => row.pigeon.id !== pigeonId) && ranking.length === 1);
check("同场其他成绩照常排行（R-2 榜首）", ranking[0]?.pigeon.id === p2);
check("待复核数=1", pendingReviewItems(s).length === 1);

// ---- 5. 观察期禁止新增训放、禁止配对 ----
const laterRace = "2026-10-03T07:00:00.000Z";
s = apply(s, { kind: "createRace", idemKey: "k11", place: "安阳", releaseTime: laterRace, distance: 120, weather: "晴", now }).state;
const blockTrain = apply(s, {
  kind: "addRaceRecords", idemKey: "k12", place: "安阳", releaseTime: laterRace, now,
  entries: [{ pigeonId, arrivalTime: null, speed: null }],
});
check("观察期禁止新增训放", blockTrain.result.ok === false);
const blockPair = apply(s, { kind: "addPair", idemKey: "k13", pigeonAId: pigeonId, pigeonBId: p2, at: laterRace, note: "", now });
check("观察期禁止配对", blockPair.result.ok === false);

// ---- 6. 复核锁定：锁定后回榜 ----
s = apply(s, { kind: "lockRecord", idemKey: "k14", raceId, recordId: rec1.id, note: "核实", now }).state;
check("锁定后不再冻结、回榜", !isRecordFrozen(s, race, rec1) && raceRanking(s, race).length === 2);
check("锁定成绩排在榜首（速度更高）", raceRanking(s, race)[0].pigeon.id === pigeonId);
// 锁定幂等
const lockAgain = apply(s, { kind: "lockRecord", idemKey: "k15", raceId, recordId: rec1.id, note: "再点一次", now });
check("重复锁定沿用首次结果", lockAgain.state === s && lockAgain.result.ok);

// ---- 7. 解除：两次正常、间隔≥12h ----
// 只来一次正常：不解除
s = apply(s, { kind: "addHealth", idemKey: "k16", pigeonId, at: "2026-10-01T18:00:00.000Z", abnormal: false, finding: "好转", now }).state;
check("一次正常复查不解除", computeEpisodes(s, pigeonId).some((e) => e.endAt === null));
// 第二次正常但间隔不足12h：不解除
s = apply(s, { kind: "addHealth", idemKey: "k17", pigeonId, at: "2026-10-01T23:00:00.000Z", abnormal: false, finding: "第二次太近", now }).state;
check("两次正常但间隔<12h 不解除", computeEpisodes(s, pigeonId).some((e) => e.endAt === null));
// 再一次正常，距第一次 ≥12h：解除
s = apply(s, { kind: "addHealth", idemKey: "k18", pigeonId, at: "2026-10-02T07:00:00.000Z", abnormal: false, finding: "康复", now }).state;
const eps = computeEpisodes(s, pigeonId);
check("连续两次正常且间隔≥12h 解除", eps.length === 1 && eps[0].endAt !== null);
// 解除后可配对
const pairOk = apply(s, { kind: "addPair", idemKey: "k19", pigeonAId: pigeonId, pigeonBId: p3, at: "2026-10-02T08:00:00.000Z", note: "恢复配对", now });
check("解除后允许配对", pairOk.result.ok);

// ---- 8. 复查期内再异常：计数清零 ----
let s2 = emptyState();
s2 = apply(s2, { kind: "registerPigeon", idemKey: "a1", ring: "X1", bloodline: "b", now }).state;
const x1 = s2.pigeons[0].id;
s2 = apply(s2, { kind: "addHealth", idemKey: "a2", pigeonId: x1, at: "2026-11-01T08:00:00.000Z", abnormal: true, finding: "病", now }).state;
s2 = apply(s2, { kind: "addHealth", idemKey: "a3", pigeonId: x1, at: "2026-11-02T08:00:00.000Z", abnormal: false, finding: "好", now }).state;
s2 = apply(s2, { kind: "addHealth", idemKey: "a4", pigeonId: x1, at: "2026-11-02T20:00:00.000Z", abnormal: true, finding: "复发", now }).state;
s2 = apply(s2, { kind: "addHealth", idemKey: "a5", pigeonId: x1, at: "2026-11-03T08:00:00.000Z", abnormal: false, finding: "好", now }).state;
s2 = apply(s2, { kind: "addHealth", idemKey: "a6", pigeonId: x1, at: "2026-11-03T21:00:00.000Z", abnormal: false, finding: "好（间隔13h）", now }).state;
const eps2 = computeEpisodes(s2, x1);
check("复查期内再异常计数清零；复发区间 11-02→11-03 解除", eps2.length === 1 && eps2[0].startAt === "2026-11-02T20:00:00.000Z" && eps2[0].endAt === "2026-11-03T21:00:00.000Z");

// ---- 9. 更正旧健康记录：历史保留，冻结范围重算 ----
let s3 = emptyState();
s3 = apply(s3, { kind: "registerPigeon", idemKey: "c1", ring: "Y1", bloodline: "b", now }).state;
const y1 = s3.pigeons[0].id;
s3 = apply(s3, { kind: "createRace", idemKey: "c2", place: "石家庄", releaseTime: "2026-12-05T07:00:00.000Z", distance: 100, weather: "", now }).state;
s3 = apply(s3, { kind: "addRaceRecords", idemKey: "c3", place: "石家庄", releaseTime: "2026-12-05T07:00:00.000Z", now, entries: [{ pigeonId: y1, arrivalTime: "2026-12-05T08:00:00.000Z", speed: 1666 }] }).state;
// 先登记放飞前异常 → 冻结
s3 = apply(s3, { kind: "addHealth", idemKey: "c4", pigeonId: y1, at: "2026-12-04T08:00:00.000Z", abnormal: true, finding: "误报前的异常", now }).state;
const r3 = s3.races[0];
const rr3 = r3.records[0];
check("更正前：成绩冻结", isRecordFrozen(s3, r3, rr3));
// 更正为正常（同时间点）
s3 = apply(s3, { kind: "correctHealth", idemKey: "c5", originalId: s3.health[0].id, at: "2026-12-04T08:00:00.000Z", abnormal: false, finding: "核实为正常，误记", now }).state;
check("更正异常→正常：冻结解除、回榜", !isRecordFrozen(s3, r3, rr3) && raceRanking(s3, r3).length === 1);
check("原健康记录历史保留（含被取代项与更正项共2条）", s3.health.length === 2 && s3.health[0].abnormal === true);
check("待复核归零", pendingReviewItems(s3).length === 0);
// 反向更正：正常 → 异常，重新进入冻结
s3 = apply(s3, { kind: "correctHealth", idemKey: "c6", originalId: s3.health[0].id, at: "2026-12-04T08:00:00.000Z", abnormal: true, finding: "复查确认确有异常", now }).state;
check("再次更正正常→异常：重新冻结", isRecordFrozen(s3, r3, rr3));

// ---- 10. 种子数据自检 + 统计一致性 ----
const seed = seedState();
const st = overviewStats(seed, "2026-09-20T09:00:00.000Z");
check("种子：pg2、pg5 观察中（各 1 次正常复查）", st.observedNow === 2);
const seedPending = pendingReviewItems(seed);
check("种子：pg2 09-19 成绩待复核（1 条）", seedPending.length === 1 && seedPending[0].pigeonId === "pg2");
const seedXx = seed.races.find((r) => r.id === "rc3")!;
const seedRank = raceRanking(seed, seedXx);
check("种子：09-19 新乡场 pg2 退出排行、pg4 未归巢不入榜，按速度剩 pg1/pg5", seedRank.map((x) => x.pigeon.ring).join(",") === "CHN-24-001839,CHN-24-004510");
const rc2 = seed.races.find((r) => r.id === "rc2")!;
check("种子：pg4 09-16 成绩已锁定仍在榜并标注", raceRanking(seed, rc2).some((x) => x.pigeon.id === "pg4" && x.locked));
// 统计与排行同源：归巢率
const total = seed.races.flatMap((r) => r.records).length;
const arrived = seed.races.flatMap((r) => r.records).filter((r) => r.arrivalTime).length;
check("种子：归巢率统计 = 归巢/全部", Math.abs(st.homeRate - (arrived / total) * 100) < 1e-9);

// 常量
check("解除间隔常量=12 小时", RECOVERY_GAP_MS === 12 * 3600 * 1000);

// 类型用 AppState 避免未用告警
const _typed: AppState = s3;
void _typed;

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
