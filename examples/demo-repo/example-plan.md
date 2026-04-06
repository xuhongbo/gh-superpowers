# 示例 Plan：搭建 Codex 插件骨架

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

### T5 GitHub 事实采集
- 目标：建立 MCP + gh 双通道的 provider 抽象
- 验收：能读取 Issue、comments、PR、check、review

### T6 发布 plan 与初始化 ledger
- 目标：向 GitHub 发布托管 plan 评论和初始 ledger
- 验收：Issue 下出现 plan 和 ledger 两条托管评论

### T7 事实映射与状态推导
- 目标：解析 task-links 并推导每个任务状态
- 验收：sync-ledger 能正确识别 implemented/verified/blocked/todo

### T8 人工控制
- 目标：实现 accept/block/unblock/drop-task
- 验收：人工动作评论回写 Issue 并更新 ledger
