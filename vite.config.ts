/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 纯浏览器端应用：不配置任何代理或在线服务。
// /healthz 在开发服务器直接返回；生产由 nginx 提供同名端点。
export default defineConfig({
  plugins: [
    react(),
    {
      name: "dev-healthz",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.split("?")[0] === "/healthz") {
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/plain");
            res.end("ok\n");
            return;
          }
          next();
        });
      },
    },
  ],
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
