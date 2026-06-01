#!/usr/bin/env node
// mmx-debug.mjs — 贴 MiniMax API 响应看 cc-hud 会输出什么
// 用法:
//   1. 拿到真实 API 响应:
//        curl -sH "Authorization: Bearer $TOKEN" https://api.minimaxi.com/v1/token_plan/remains > resp.json
//   2. ./scripts/mmx-debug.mjs < resp.json
//      或 ./scripts/mmx-debug.mjs '你的json'
//
// 展示 cc-hud 当前的聚合逻辑输出 (Token Plan Plus: sum usage / max total)

const args = process.argv.slice(2);
let jsonInput = '';

for (const arg of args) {
  if (!arg.startsWith('--')) jsonInput += arg + ' ';
}

if (!jsonInput.trim()) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk.toString());
  jsonInput = chunks.join('');
}

if (!jsonInput.trim()) {
  console.error('用法: mmx-debug.mjs [json | < response.json]');
  process.exit(1);
}

let data;
try {
  data = JSON.parse(jsonInput);
} catch (e) {
  console.error('JSON 解析失败:', e.message);
  process.exit(1);
}

const remains = data.model_remains ?? [];

console.log('\n┌─ API 响应概览 ─────────────────────────────────┐');
console.log(`│  model_remains 数量: ${remains.length}`);
console.log('└────────────────────────────────────────────────┘\n');

if (remains.length === 0) {
  console.log('❌ model_remains 是空数组 — cc-hud 会显示无 rate limit 数据');
  process.exit(0);
}

// Mirror src/mmx.ts aggregatePlan logic
function aggregatePlan(remains) {
  if (remains.length === 0) return null;
  const sumUsage = remains.reduce((a, m) => a + m.current_interval_usage_count, 0);
  const sumWeekly = remains.reduce((a, m) => a + m.current_weekly_usage_count, 0);
  const total5h = Math.max(...remains.map(m => m.current_interval_total_count));
  const total7d = Math.max(...remains.map(m => m.current_weekly_total_count));
  const minRemains = Math.min(...remains.map(m => m.remains_time));
  const minWeekly = Math.min(...remains.map(m => m.weekly_remains_time));
  const now = Date.now();
  const safePct = (u, t) => t > 0 ? Math.round((u / t) * 100) : 0;
  return {
    fiveHourUsedPct: safePct(sumUsage, total5h),
    fiveHourResetsAt: now + minRemains,
    sevenDayUsedPct: safePct(sumWeekly, total7d),
    sevenDayResetsAt: now + minWeekly,
  };
}

// 打印每条记录的概要
console.log('每条记录:');
remains.forEach((m, i) => {
  const fiveHrPct = m.current_interval_total_count > 0
    ? Math.round((m.current_interval_usage_count / m.current_interval_total_count) * 100)
    : 0;
  const weeklyPct = m.current_weekly_total_count > 0
    ? Math.round((m.current_weekly_usage_count / m.current_weekly_total_count) * 100)
    : 0;
  const fiveHrRemH = (m.remains_time / 3600000).toFixed(1);
  const weeklyRemD = (m.weekly_remains_time / 86400000).toFixed(1);
  console.log(`  [${i}] ${m.model_name}`);
  console.log(`      5h:  ${fiveHrPct}%  (${m.current_interval_usage_count}/${m.current_interval_total_count}, ${fiveHrRemH}h left)`);
  console.log(`      7d:  ${weeklyPct}%  (${m.current_weekly_usage_count}/${m.current_weekly_total_count}, ${weeklyRemD}d left)`);
});

const q = aggregatePlan(remains);
if (!q) {
  console.log('\n❌ aggregatePlan 返回 null — cc-hud 显示无 rate limit 数据');
  process.exit(0);
}

const fiveHrRemH = ((q.fiveHourResetsAt - Date.now()) / 3600000).toFixed(1);
const weeklyRemD = ((q.sevenDayResetsAt - Date.now()) / 86400000).toFixed(1);

console.log('\n┌─ cc-hud aggregatePlan 输出 (Token Plan Plus) ──┐');
console.log(`│  5h: ${q.fiveHourUsedPct}%  (${fiveHrRemH}h until reset)`);
console.log(`│  7d: ${q.sevenDayUsedPct}%  (${weeklyRemD}d until reset)`);
console.log('│  算法: sum(usage) / max(total)');
console.log('│  (text/image/voice/music 共享同一 plan quota)');
console.log('└────────────────────────────────────────────────┘\n');

console.log('💡 跟你的 dashboard 对一下:');
console.log('   - 如果 5h % 跟 dashboard 一致 → 修对了');
console.log('   - 如果不一致 → 可能是 per-model 配额 (非 Plus plan), 跑历史版本对比');
