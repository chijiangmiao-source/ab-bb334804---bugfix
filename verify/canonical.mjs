// 规范裁决回归：单独运行同优分段场景的回归断言（src/core/canonical.test.ts）。
// 该场景在修复前会裁决出错误的分段路径（ends=[2,5,6]/comps=[0,0,-1]），
// 本进程因此以退出码 1 结束并报告 CANONICAL_MISMATCH；
// 修复后断言核对两级目标值与完整规范路径，报告 CANONICAL_OK 并以 0 退出。
//
// 仅使用 Node 内置能力；vitest 由仓库依赖提供。
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vitest = resolve(repoRoot, "node_modules/vitest/vitest.mjs");
if (!existsSync(vitest)) {
  console.error("CANONICAL_MISMATCH: 未找到 vitest，无法运行规范裁决回归");
  process.exit(1);
}

const res = spawnSync(process.execPath, [vitest, "run", "src/core/canonical.test.ts"], {
  cwd: repoRoot,
  stdio: "inherit",
});

if (res.status === 0) {
  console.log("CANONICAL_OK: 两级目标同优时规范分段路径裁决正确");
  process.exit(0);
}
console.error(`CANONICAL_MISMATCH: 规范路径回归断言失败（vitest 退出码 ${res.status ?? "未知"}）`);
process.exit(1);
