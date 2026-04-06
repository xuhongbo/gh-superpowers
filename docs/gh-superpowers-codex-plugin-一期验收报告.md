# gh-superpowers 一期验收报告

## 验收日期

2026-04-06

## 一期目标回顾

在 `gh-superpowers` 现有流程能力之上，补一层"交付事实对齐系统"，以 Codex plugin 形式交付：

1. 绑定当前业务仓与某个 GitHub Issue
2. 发布当前有效 plan 到 GitHub
3. 从 plan 中抽取带稳定编号的 Task
4. 从 GitHub 拉取 PR、commit、check、review 等事实
5. 生成并更新一份托管 ledger 评论
6. 判断每个 Task 当前状态
7. 允许人在 Codex 中执行人工验收、阻塞、解除阻塞、丢弃任务等动作

## 已完成功能清单

### packages/core — 共享内核

| 功能 | 导出函数 | 说明 |
|------|----------|------|
| Plan 解析 | `extractTasksFromPlan` | 从 plan 文本中抽取 `T1`、`T2` 等稳定编号任务 |
| 托管评论渲染 | `renderManagedComment` | 生成带 `gh-superpowers:managed-comment` 标记的评论 |
| 托管评论解析 | `parseManagedComment` | 解析托管评论，提取 metadata 和 body |
| 任务绑定解析 | `parseTaskLinks` | 解析 `task-links` 块 |
| 人工动作解析 | `parseTaskActions` | 解析 `task-action` 块 |
| 状态推导 | `inferTaskStates` | 根据事实推导每个任务状态 + 偏差检测 |
| 账本快照 | `buildLedgerSnapshot` | 构建完整账本快照 |
| 账本渲染 | `renderLedger` | 将快照渲染为可读 Markdown |

### packages/github — GitHub 事实采集

| 功能 | 实现 | 说明 |
|------|------|------|
| Provider 抽象 | `createGitHubProvider` | MCP 优先，gh 回退 |
| MCP 通道 | `GitHubMcpProvider` | 通过 MCP client 调用 GitHub API |
| gh CLI 通道 | `GhCliGitHubProvider` | 通过 `gh` 命令行调用 |
| 读取 Issue | `getIssue` | |
| 读取评论 | `listIssueComments` | |
| 创建评论 | `createIssueComment` | |
| 更新评论 | `updateIssueComment` / `updateComment` | |
| 托管评论 CRUD | `upsertManagedIssueComment` | 自动创建或更新 |
| 关联 PR | `listLinkedPullRequests` | gh 走 GraphQL，MCP 走 search API |
| PR 检查 | `listPullRequestChecks` | |
| PR 审查 | `listPullRequestReviews` | |
| PR 提交 | `listPullRequestCommits` | MCP 走 REST API，gh 走 `gh api` |

### packages/codex — Codex 动作路由

| 动作 | 说明 |
|------|------|
| `bind-issue` | 绑定 Issue 到当前会话 |
| `publish-plan` | 发布 plan 评论 + 初始 ledger 评论 |
| `sync-ledger` | 拉取 GitHub 事实、推导状态、更新 ledger |
| `show-ledger` | 展示当前 ledger |
| `accept-task` | 人工验收 |
| `block-task` | 标记阻塞 |
| `unblock-task` | 解除阻塞 |
| `drop-task` | 丢弃任务 |

| 辅助功能 | 说明 |
|----------|------|
| `loadRepoConfig` | 读取业务仓 `gh-superpowers.config.json` |
| `createSessionStore` | 基于 git-common-dir 的持久化会话存储 |
| `routeNaturalLanguage` | 中文自然语言到动作的映射 |
| `createCodexActionRouter` | 统一动作路由器 |
| `cli.js` | 命令行入口脚本，串起三个包 |

### 协议与配置

- 托管评论标记：`<!-- gh-superpowers:managed-comment {"kind":"plan","issue":42,"version":"v1"} -->`
- 任务绑定块：`<!-- gh-superpowers:task-links {"tasks":["T2","T3"]} -->`
- 人工动作块：`<!-- gh-superpowers:task-action {"action":"accept","task":"T2"} -->`
- 项目级配置模板：`templates/repo-config/gh-superpowers.config.json`
- Plugin 入口：`.codex-plugin/plugin.json`

### Task 状态机

```
todo → in_progress → implemented → verified → accepted
任意状态 → blocked
任意状态 → dropped
```

### 偏差检测

1. 有 Task 无事实
2. 有事实无 Task
3. 已实现未验证
4. 已验证未验收
5. 阻塞后主线仍错误推进
6. 新旧 plan 版本 Task 对不上（新增/移除）

## 测试覆盖

| 文件 | 测试数 | 覆盖范围 |
|------|--------|----------|
| `core.test.js` | 16 | Plan 解析、托管评论、任务绑定、状态推导、账本生成、计划版本漂移检测、边界情况 |
| `codex-actions.test.js` | 14 | 配置加载、会话存储、自然语言路由、publish-plan、sync-ledger、show-ledger、人工动作、参数校验 |
| `github-provider.test.js` | 9 | MCP/gh 通道选择、评论 CRUD、PR checks、PR reviews、MCP 关联 PR 搜索、边界情况 |
| `demo-integration.test.js` | 8 | 完整演示链路端到端验证：绑定→发布→同步→识别→验收→漂移→commit 绑定 |

**总计：47 个测试，全部通过。**

## 一期最小演示链路

1. 在 Codex 中输入 `绑定到 #42` → `bind-issue` 执行，Issue 绑定到会话
2. 输入 `发布当前计划` → `publish-plan` 执行，托管 plan 评论 + ledger 评论写入 GitHub
3. 自动从 plan 中抽取 Task（T1、T2...）
4. 通过 PR body 中的 `task-links` 块 + check 结果更新账本
5. `sync-ledger` 识别哪些任务是 implemented/verified/blocked/todo
6. 输入 `验收 T2` → `accept-task` 执行，人工动作评论写入 GitHub
7. 账本评论随之更新

## 一期明确不做（已遵守）

- Claude 适配
- 后台常驻服务
- GitHub Actions 全自动主编排
- 多 Issue 编排
- 子模块主接入
- 语义级代码与 spec 深度比对

## 结论

一期设计与实施计划中定义的全部阶段（阶段 0 ~ 阶段 6）已完成。

### 本次补充内容

| 模块 | 新增内容 |
|------|----------|
| `packages/core` | `detectPlanVersionDrift` — 偏差检测 #6 |
| `packages/core` | `buildLedgerSnapshot` 支持 `previousTasks` 版本对比 |
| `packages/core` | `inferTaskStates` 支持 `start`/`commit`/`blocking-review` 事实类型 |
| `packages/github` | `listPullRequestCommits` — MCP + gh 双通道的 PR commit 列表 |
| `packages/codex` | `buildFactsFromGitHub` 中的 commit task-links 解析 |
| `packages/codex` | `cli.js` — 命令行入口脚本 |
| `hooks/hooks.json` | PreCommit hook 注册 |
| `hooks/pre-commit-check` | 提交前检查 + 自动账本同步 |
| `examples/demo-repo/` | 示例业务仓：配置 + Issue + Plan + 自动化演示脚本 |
| `templates/repo-config/` | 示例配置模板 |
| `docs/一期失败场景说明.md` | 13 种失败场景及恢复方案 |
| `docs/一期演示链路-walkthrough.md` | 端到端演示步骤 |
| `tests/codex-plugin/demo-integration.test.js` | 6 个端到端集成测试，完整模拟设计文档演示链路 |

### 阶段完成情况

| 阶段 | 目标 | 状态 |
|------|------|------|
| 阶段 0 | Plan 结构约束（Task 稳定编号） | ✅ |
| 阶段 1 | Codex plugin 骨架 | ✅ |
| 阶段 2 | 只读 GitHub 事实采集（MCP + gh 双通道） | ✅ |
| 阶段 3 | 发布 plan 与初始化 ledger | ✅ |
| 阶段 4 | 事实映射与状态推导 | ✅ |
| 阶段 5 | 人工控制（accept/block/unblock/drop） | ✅ |
| 阶段 6 | 打磨与演示（示例、脚本、失败场景、测试） | ✅ |

核心功能、协议定义、7 种状态推导规则、6 种偏差检测、人工控制、PreCommit 检查点、测试覆盖、自动化演示均已到位。
