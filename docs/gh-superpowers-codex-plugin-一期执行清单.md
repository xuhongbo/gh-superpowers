# gh-superpowers Codex plugin 一期执行清单

## 目标

把 `gh-superpowers` 做成一个可安装到 `Codex` 的 `plugin`，让它在会话里直接完成：

- 绑定 GitHub `Issue`
- 发布当前 `plan`
- 抽取 `Task`
- 同步 `PR / commit / check / review` 事实
- 生成并更新 `ledger`
- 执行人工验收与阻塞操作

---

## 一期范围

### 要做
- `Codex plugin` 清单
- 项目级配置读取
- `plan -> Task` 抽取
- 托管 `plan` 评论
- 托管 `ledger` 评论
- `GitHub MCP / gh` provider 抽象
- `bind-issue`
- `publish-plan`
- `sync-ledger`
- `show-ledger`
- `accept-task`
- `block-task`
- `unblock-task`
- `drop-task`

### 不做
- `Claude` 适配
- 后台常驻服务
- `GitHub Actions` 主编排
- 多 `Issue` 编排
- 子模块主接入
- 代码与 `spec` 的深度语义比对

---

## 仓库结构

建议目标结构：

```text
gh-superpowers/
  .codex-plugin/
  .codex/
  skills/
  packages/
    core/
    github/
    codex/
  templates/
    repo-config/
  tests/
    codex-plugin/
```

---

## 关键协议

### Task 标题格式

```markdown
### T1 平台骨架初始化
- 目标：建立 Codex plugin 基础包结构
- 验收：存在 plugin 清单与基础包目录
```

### 托管评论头

```html
<!-- gh-superpowers:managed-comment {"kind":"plan","issue":42,"version":"v1"} -->
<!-- gh-superpowers:managed-comment {"kind":"ledger","issue":42,"planVersion":"v1"} -->
```

### Task 绑定块

```html
<!-- gh-superpowers:task-links {"tasks":["T2","T3"]} -->
```

### 人工动作块

```html
<!-- gh-superpowers:task-action {"action":"accept","task":"T2"} -->
<!-- gh-superpowers:task-action {"action":"block","task":"T3","reason":"等待接口稳定"} -->
```

---

## Task 状态

使用以下状态：

- `todo`
- `in_progress`
- `blocked`
- `implemented`
- `verified`
- `accepted`
- `dropped`

### 基本判断
- 有任务定义，无事实：`todo`
- 有绑定的 `PR/commit`：`implemented` 候选
- 必需 `check` 全绿：`verified`
- 人工确认：`accepted`
- 人工或 review 阻断：`blocked`

---

## 最小动作集

- `bind-issue`
- `publish-plan`
- `sync-ledger`
- `show-ledger`
- `accept-task`
- `block-task`
- `unblock-task`
- `drop-task`

---

## 分阶段执行

### 阶段 0：约束 plan 格式
- 固定 `Task` 编号格式：`T1/T2/...`
- 只认：`### Tn 标题`、`- 目标：`、`- 验收：`

### 阶段 1：插件骨架
- 增加 `.codex-plugin/plugin.json`
- 增加 `packages/codex`
- 增加 `tests/codex-plugin`
- 增加 `package.json` 测试脚本

### 阶段 2：core
- `TaskRecord`
- `extractTasksFromPlan`
- 托管评论解析/渲染
- `ledger` 渲染
- `task-links` 解析

### 阶段 3：github provider
- 统一 `GitHubProvider` 接口
- `GitHub MCP` 优先
- `gh` 兜底
- 最少支持：
  - `getIssue`
  - `listIssueComments`
  - `createIssueComment`
  - `upsertManagedIssueComment`
  - `listLinkedPullRequests`
  - `listPullRequestChecks`

### 阶段 4：codex 动作
- `bind-issue`
- `publish-plan`
- `sync-ledger`
- `show-ledger`
- `accept-task`
- `block-task`
- `unblock-task`
- `drop-task`

### 阶段 5：自然语言映射
- “绑定到 #42” -> `bind-issue`
- “发布当前计划” -> `publish-plan`
- “同步任务账本” -> `sync-ledger`
- “验收 T2” -> `accept-task`
- “阻塞 T3：等待接口稳定” -> `block-task`

### 阶段 6：演示
- 绑定一个 `Issue`
- 发布 `plan`
- 抽取 `Task`
- 基于 `PR + checks` 更新账本
- 人工验收一个任务
- 确认 `ledger` 评论更新

---

## 偏差检测最小清单

一期至少检测：

- 有 `Task` 无事实
- 有事实无 `Task`
- 已实现未验证
- 已验证未验收
- 阻塞后主线仍错误推进

---

## 项目级配置最小样例

```json
{
  "repository": "owner/repo",
  "defaultBranch": "main",
  "requiredChecks": ["test", "build"],
  "taskLinkStyle": "comment-block",
  "acceptanceMode": "manual"
}
```

---

## 一期验收标准

满足以下链路即可算一期成立：

1. 在 `Codex` 中绑定一个 `Issue`
2. 发布当前 `plan`
3. 自动抽取 `Task`
4. 同步 `GitHub` 事实
5. 更新 `ledger`
6. 能明确看到哪些任务是 `todo / implemented / verified / blocked`
7. 人工验收一个 `Task`
8. `ledger` 评论正确回写

---

## 当前推荐顺序

1. 插件骨架
2. core
3. github provider
4. codex 动作
5. 自然语言映射
6. 演示与测试
