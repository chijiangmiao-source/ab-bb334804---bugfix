# 纳米孔分段校准复核台

纯浏览器运行的 TypeScript + React 单页应用：对纳米孔电流轨迹做**驻留长度约束下的有序分段**与**整数基线补偿**的两级优化，并列出全部前两级同优方案中每个边界、每个补偿的完整可达集合。

- 无后端、无任何在线服务调用；求解在浏览器 **Web Worker** 内完成，不阻塞 UI。
- 静态文件由多阶段 Dockerfile 构建，nginx 发布；宿主机端口可配置。
- Compose 内置一次性 `verify` 验收服务：单元测试 + 构建检查 + HTTP 冒烟，自行退出并以退出码报告结果。

## 1. 问题模型

输入：

| 输入 | 约束 |
| --- | --- |
| 整数电流样本 x₀…x_{N-1} | 6 ≤ N ≤ 600 |
| 有序唯一符号 s₀…s_{K-1} | 3 ≤ K ≤ 80 |
| 每符号目标电平 ℓᵢ（整数） | 与符号一一对应 |
| 统一驻留下限 / 上限 L / U | 1 ≤ L ≤ U |
| 最大补偿 D | 0 ≤ D ≤ 8 的整数 |

决策：

- 每段结束下标 e_i（段 i 覆盖样本 `[起点_i, e_i]`，段间相邻无重叠，e_{K-1} ≡ N−1），每段长度 ∈ [L, U]；
- 每符号整数基线补偿 c_i ∈ [−D, D]，**c₀ ≡ 0**，且 **|c_i − c_{i−1}| ≤ 1**。

段内绝对误差按「目标电平 + 补偿」计算：

```
E = Σ_i Σ_{t ∈ 段 i} |x_t − (ℓ_i + c_i)|
```

优化按字典优先级依次执行：

1. 最小化总绝对误差 E；
2. 在 E = E* 的方案中最小化补偿变化总量 V = Σ_{i≥1} |c_i − c_{i−1}|；
3. 在 (E*, V*) 的方案中，使**交错向量**
   `(e₀, c₁, e₁, c₂, …, e_{K-2}, c_{K-1})`
   字典序最小 —— 该唯一解即页面高亮的**规范路径**。

同时枚举统计意义上的「同优集合」：在**全部**满足 E = E*、V = V* 的完整方案中

- 每个内部边界 e_i 的完整可达下标集合；
- 每个补偿 c_i 的完整可达整数集合（c₀ 恒为 {0}）；
- 同优方案总数（任意精度整数，以字符串显示）。

算法（`src/core/solver.ts`）：按 (段, 结束下标, 补偿) 的动态规划，单调队列维护驻留滑动窗口最优转移，交错向量经倍增祖先表做 O(log K) 字典序比较；同优集合用反向键值可达 + 正向 BigInt 路径计数求得。误差用 BigInt 累加避免溢出。

## 2. 页面行为

- 左侧录入：样本、符号、目标电平（空白 / 逗号 / 分号分隔）、驻留上下限、D。
- 输入合法后自动防抖求解；**非法或无解时草稿原样保留**，顶部与字段下方列出全部问题并定位**首因**（自动聚焦首个出错字段）。
- 右侧联动：
  - 指标卡：E*、V*、同优方案总数；
  - 轨迹图：样本折线、规范分段电平（ℓᵢ+cᵢ）、规范边界竖线；紫色三角为该边界的全部同优可达位置，淡色虚线为同优可达补偿电平；
  - 规范解交错向量；
  - 规范路径表（区间、驻留、目标、补偿、规范电平）；
  - 每个边界 / 补偿的完整可达集合表。
- 健康状态徽标周期性请求 `GET /healthz`（HTTP 200 `ok`）。

## 3. 本地开发

```bash
npm ci
npm test        # vitest 单元测试（含对穷举参照实现的随机一致性测试）
npm run dev     # 开发服务器（自带 /healthz）
npm run build   # tsc 类型检查 + vite 生产构建到 dist/
```

## 4. Docker 发布

```bash
# 构建并后台启动（默认宿主机 8080 端口）
docker compose up -d --build web
# 自定义宿主机端口
WEB_PORT=9090 docker compose up -d --build web
# 或复制 .env.example 为 .env 后修改 WEB_PORT
curl http://localhost:8080/healthz   # -> ok
```

镜像为纯静态 nginx，`/healthz` 返回 200，容器同样配置了 HEALTHCHECK。

## 5. 一次性验收服务

```bash
docker compose run --build --rm verify
echo $?
```

依次执行：单元测试 → 规范裁决回归（同优边界场景，报告 `CANONICAL_OK`）→ 构建检查（tsc + vite build）→ 对运行中的 web 服务做 HTTP 冒烟（`/healthz` 200 `ok`、首页含 root 节点与 module 入口）。

退出码：`0` 全部通过；`1` 规范裁决回归失败（报告 `CANONICAL_MISMATCH`）；`10` 单元测试失败；`20` 构建检查失败；`30` HTTP 冒烟失败。

## 6. 目录结构

```
src/
  core/            # 纯函数核心（无 DOM 依赖，可独立测试）
    types.ts       # 输入 / 结果类型
    parse.ts       # 草稿解析与校验（首因定位）
    solver.ts      # 两级优化 DP + 同优集合 / 计数
    bruteforce.ts  # 穷举参照（测试用）
    solver.test.ts
  worker/          # Web Worker 协议与求解线程
  components/      # SVG 轨迹联动图
  App.tsx          # 录入、首因定位、联动展示
nginx/             # 静态发布与 /healthz
verify/            # verify.sh 与 HTTP 冒烟脚本
Dockerfile         # deps / build / web / verify 多阶段
docker-compose.yml # web（端口可配置）+ 一次性 verify
```
