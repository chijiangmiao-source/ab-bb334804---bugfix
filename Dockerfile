# syntax=docker/dockerfile:1

# ---- 依赖安装 ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --include=dev

# ---- 浏览器端构建（纯静态产物，不含任何后端 / 在线调用） ----
FROM deps AS build
COPY . .
RUN npm run build

# ---- 静态 Web 发布镜像：nginx，内置 /healthz ----
FROM nginx:1.27-alpine AS web
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1

# ---- 一次性验收镜像：单元测试 + 构建检查 + HTTP 冒烟，自行退出并报告退出码 ----
FROM build AS verify
RUN chmod +x /app/verify/verify.sh
ENTRYPOINT ["/bin/sh", "/app/verify/verify.sh"]
