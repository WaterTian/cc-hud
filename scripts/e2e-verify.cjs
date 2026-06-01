// e2e-verify.cjs — 本地 mock MiniMax API, 跑真实 cc-hud 渲染
// 证明数据获取路径 (fetch → aggregatePlan → render) 完整工作

const http = require('http');
const { spawn } = require('node:child_process');

// 1. 启动 mock HTTP server 模拟 MiniMax 响应
const mockPayload = {
  model_remains: [
    { model_name: 'MiniMax-M3', current_interval_total_count: 100, current_interval_usage_count: 0, current_weekly_total_count: 100, current_weekly_usage_count: 0, remains_time: 15420000, weekly_remains_time: 554400000 },
    { model_name: 'MiniMax-Text-01', current_interval_total_count: 100, current_interval_usage_count: 8, current_weekly_total_count: 100, current_weekly_usage_count: 2, remains_time: 15420000, weekly_remains_time: 554400000 },
    { model_name: 'MiniMax-Image', current_interval_total_count: 100, current_interval_usage_count: 2, current_weekly_total_count: 100, current_weekly_usage_count: 1, remains_time: 15420000, weekly_remains_time: 554400000 },
    { model_name: 'MiniMax-Voice', current_interval_total_count: 100, current_interval_usage_count: 0, current_weekly_total_count: 100, current_weekly_usage_count: 0, remains_time: 15420000, weekly_remains_time: 554400000 },
    { model_name: 'MiniMax-Music', current_interval_total_count: 100, current_interval_usage_count: 0, current_weekly_total_count: 100, current_weekly_usage_count: 0, remains_time: 15420000, weekly_remains_time: 554400000 },
  ],
};

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(mockPayload));
  console.log(`  [mock-server] ${req.method} ${req.url} → 200 (model_remains: ${mockPayload.model_remains.length})`);
});

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  const mockUrl = `http://127.0.0.1:${port}/v1/token_plan/remains`;
  console.log(`\n┌─ Mock MiniMax API 启动 ──────────────────────────────┐`);
  console.log(`│  URL: ${mockUrl}`);
  console.log(`│  模型数: ${mockPayload.model_remains.length}`);
  console.log(`│  5h sum: ${mockPayload.model_remains.reduce((a, m) => a + m.current_interval_usage_count, 0)} / 100 (期望 10%)`);
  console.log(`│  7d sum: ${mockPayload.model_remains.reduce((a, m) => a + m.current_weekly_usage_count, 0)} / 100 (期望 3%)`);
  console.log('└────────────────────────────────────────────────────┘\n');

  // 2. 写 wrapper 脚本: 启动 cc-hud 但用 mock fetch
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  // 用独立 tmpHome 避免污染真实 cache
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-hud-e2e-'));
  const stdinPath = path.join(tmpHome, 'stdin.json');
  fs.writeFileSync(stdinPath, JSON.stringify({
    model: { id: 'MiniMax-M3', display_name: 'MiniMax M3' },
    context_window: { used_percentage: 41 },
    rate_limits: null,
    transcript_path: '',
  }));

  // 包装脚本: 拦截 fetch, 重定向到 mock
  // 用 JSON.stringify 安全转义 Windows 路径
  const cwd = process.cwd();
  const stdinPathJson = JSON.stringify(stdinPath);
  const tmpHomeJson = JSON.stringify(tmpHome);
  const portJson = JSON.stringify(port);
  const cwdJson = JSON.stringify(cwd);

  const wrapperCode = `
    const fs = require('fs');
    const http = require('http');

    const TMP_HOME = ${tmpHomeJson};
    const STDIN_PATH = ${stdinPathJson};
    const MOCK_PORT = ${portJson};
    const CWD = ${cwdJson};

    process.env.HOME = TMP_HOME;
    process.env.USERPROFILE = TMP_HOME;
    process.env.ANTHROPIC_BASE_URL = 'https://api.minimaxi.com/anthropic';
    process.env.ANTHROPIC_AUTH_TOKEN = 'sk-fake-for-e2e';

    // 拦截 fetch: minimaxi.com / minimax.io 重定向到 mock
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const u = new URL(url);
      if (u.hostname === 'api.minimaxi.com' || u.hostname === 'api.minimax.io') {
        return new Promise((resolve, reject) => {
          const req = http.request({
            hostname: '127.0.0.1',
            port: MOCK_PORT,
            path: u.pathname,
            method: 'GET',
            headers: { 'Authorization': 'Bearer sk-fake-for-e2e' },
          }, (res) => {
            let body = '';
            res.on('data', (c) => body += c);
            res.on('end', () => resolve(new Response(body, { status: res.statusCode })));
          });
          req.on('error', reject);
          req.end();
        });
      }
      return realFetch(url, init);
    };

    const stdinObj = JSON.parse(fs.readFileSync(STDIN_PATH, 'utf8'));

    const { parseAgents } = require(CWD + '\\\\dist\\\\transcript.js');
    const { render } = require(CWD + '\\\\dist\\\\render.js');
    const { shortModelName } = require(CWD + '\\\\dist\\\\model.js');
    const { getMmxQuota } = require(CWD + '\\\\dist\\\\mmx.js');

    (async () => {
      const agents = await parseAgents(stdinObj.transcript_path);
      const contextPercent = stdinObj.context_window?.used_percentage ?? 0;
      const modelName = shortModelName(stdinObj.model?.display_name, stdinObj.model?.id);

      console.log('  [wrapper] 调用 getMmxQuota()...');
      const mmQuota = await getMmxQuota();
      console.log('  [wrapper] mmQuota =', JSON.stringify(mmQuota));

      const out = render({
        model: modelName.name,
        modelVariant: modelName.variant,
        contextPercent: Math.round(contextPercent),
        agents,
        fiveHourPercent: mmQuota?.fiveHourUsedPct ?? null,
        sevenDayPercent: mmQuota?.sevenDayUsedPct ?? null,
        fiveHourResetsAt: mmQuota?.fiveHourResetsAt ?? null,
        sevenDayResetsAt: mmQuota?.sevenDayResetsAt ?? null,
        extra: null,
      });
      process.stdout.write(out);
    })().catch((e) => {
      console.error('  [wrapper] ERROR:', e.message);
      process.exit(1);
    });
  `;

  const wrapperPath = path.join(tmpHome, 'wrapper.cjs');
  fs.writeFileSync(wrapperPath, wrapperCode);

  console.log('  [e2e] 启动 wrapper, 模拟完整 Claude Code → cc-hud → mock API 流程\n');

  // 3. 跑 wrapper
  const child = spawn(process.execPath, [wrapperPath], { stdio: 'inherit', env: { ...process.env } });
  child.on('exit', (code) => {
    server.close();
    fs.rmSync(tmpHome, { recursive: true, force: true });
    console.log(`\n\n[e2e] wrapper exit code: ${code}`);
    if (code === 0) {
      console.log('✅ 数据获取路径完整工作: stdin → getMmxQuota → fetch → mock API → aggregatePlan → render → stdout');
    } else {
      console.log('❌ 流程有错误, 看上面输出');
    }
    process.exit(code);
  });
});
