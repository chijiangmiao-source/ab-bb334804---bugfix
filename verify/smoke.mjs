// HTTP 冒烟：等待健康检查就绪，然后校验 /healthz 与首页 /。
// 仅使用 Node 内置能力，无任何在线依赖。
const BASE_URL = process.env.BASE_URL ?? "http://web:80";

async function waitReady(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/healthz`, { cache: "no-store" });
      if (res.ok) return;
      lastErr = new Error(`status ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`健康端点在 ${timeoutMs}ms 内未就绪: ${lastErr?.message ?? lastErr}`);
}

async function main() {
  await waitReady();

  const health = await fetch(`${BASE_URL}/healthz`, { cache: "no-store" });
  if (health.status !== 200) throw new Error(`GET /healthz 状态码应为 200，实际 ${health.status}`);
  const healthBody = (await health.text()).trim();
  if (healthBody !== "ok") throw new Error(`GET /healthz 响应体应为 ok，实际「${healthBody}」`);
  console.log("  /healthz -> 200 ok");

  const home = await fetch(`${BASE_URL}/`, { cache: "no-store" });
  if (home.status !== 200) throw new Error(`GET / 状态码应为 200，实际 ${home.status}`);
  const html = await home.text();
  for (const marker of ['id="root"', "<title>"]) {
    if (!html.includes(marker)) throw new Error(`首页缺少标记 ${marker}`);
  }
  if (!/<script[^>]+type="module"/.test(html)) {
    throw new Error("首页缺少 module 入口脚本");
  }
  console.log("  / -> 200，首页包含 root 节点与 module 入口");

  console.log("HTTP SMOKE PASSED");
}

main().catch((err) => {
  console.error("HTTP SMOKE FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
