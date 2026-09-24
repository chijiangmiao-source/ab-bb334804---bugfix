import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { App } from "./App";

describe("App 渲染冒烟（无 DOM 副作用）", () => {
  it("默认草稿下组件树可在服务端一次性渲染", () => {
    const html = renderToString(<App />);
    expect(html).toContain("纳米孔分段校准复核台");
    expect(html).toContain("参数录入");
    expect(html).toContain("/healthz");
    // 校验提示等面板结构存在
    expect(html).toContain("目标电平");
    expect(html).toContain("最大补偿 D");
  });
});
