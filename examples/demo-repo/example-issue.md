# 示例 Issue：搭建 Codex 插件骨架

**标签：** `phase-1` `codex-plugin`

## 描述

搭建 gh-superpowers 的 Codex plugin 基础结构，使插件可被 Codex 识别和加载。

## 任务分解

### T1 插件骨架
- 目标：建立 `.codex-plugin/plugin.json` 和 `packages/codex` 目录
- 验收：Codex 能识别插件入口，列出可用动作

### T2 配置读取
- 目标：从业务仓读取 `gh-superpowers.config.json`
- 验收：能正确合并默认值和项目级配置

### T3 会话存储
- 目标：绑定 Issue 到当前会话并持久化
- 验收：重启会话后仍能恢复绑定的 Issue 和 planVersion

### T4 自然语言路由
- 目标：将中文请求映射到动作
- 验收："绑定到 #42" → bind-issue，"显示账本" → show-ledger
