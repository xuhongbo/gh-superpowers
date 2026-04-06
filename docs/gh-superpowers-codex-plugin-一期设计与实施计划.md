# gh-superpowers 一期：面向 Codex plugin 的交付事实对齐设计与实施计划

## 一、背景与要解决的问题

`gh-superpowers` 以及上游 `Superpowers` 已经有一套很强的工作流能力，包括脑暴、写规范、写计划、执行、评审和收尾。真正的问题不是“不会生成 plan”，而是：

1. 生成出来的 `spec`、`plan` 和真实代码实现之间没有持续对齐机制。
2. 任务做到哪一步、是否真的完成、完成依据是什么，缺少统一账本。
3. `commit`、`PR`、`check`、`review` 和计划项之间没有稳定映射。
4. 本地文档可以不断变化，但 GitHub 上真实发生的事实并不会自动同步到计划结论里。
5. 人无法稳定判断：当前到底做到哪儿、哪些项缺验证、哪些项还没被人工确认。

因此，一期不是重做一套新的“会写计划”的系统，而是要在 `gh-superpowers` 现有流程能力之上，补一层“交付事实对齐系统”。

---

## 二、一期目标

一期优先做成一个可安装到 `Codex` 的 `plugin`，在 `Codex` 会话中直接完成以下事情：

1. 绑定当前业务仓与某个 GitHub `Issue`。
2. 发布当前有效 `plan` 到 GitHub。
3. 从 `plan` 中抽取带稳定编号的 `Task`。
4. 从 GitHub 拉取 `PR`、`commit`、`check`、`review` 等事实。
5. 生成并更新一份托管 `ledger` 评论。
6. 判断每个 `Task` 当前是否处于 `todo`、`in_progress`、`implemented`、`verified`、`accepted`、`blocked`、`dropped`。
7. 允许人在 `Codex` 中执行人工验收、阻塞、解除阻塞、丢弃任务等动作，并回写到账本。

一期只做 `Codex`，暂不处理 `Claude`，也不把 `GitHub Actions` 作为主入口。

---

## 三、系统边界与角色划分

### 1. gh-superpowers

`gh-superpowers` 一期是：

- 一个可安装到 `Codex` 的 `plugin`。
- 一个交付事实对齐内核仓库。
- 一个围绕 GitHub 事实工作的共享能力仓。

它负责：

- 协议定义。
- `Task` 与账本模型。
- 状态流转规则。
- GitHub 事实采集抽象。
- `Codex` 内部动作路由。
- 账本生成与偏差检测。

### 2. 业务仓库

业务仓库是：

- 业务代码实际存在的地方。
- GitHub 事实的真实发生地。
- 项目级配置的承载地。

一期最小接入形态建议为：

```text
business-repo/
  gh-superpowers.config.json
  src/...
```

### 3. GitHub

GitHub 是一期的事实主工作台，真源包括：

- `Issue`
- `PR`
- `commit`
- `check run` / `workflow run`
- `review`
- `issue/pr comments`

本地文档可以继续作为草稿存在，但不再单独代表真实交付状态。

### 4. Codex

`Codex` 是一期的主交互入口，负责：

- 接收自然语言请求。
- 映射为固定动作。
- 调用 GitHub 通道。
- 调用共享内核。
- 输出当前状态和下一步建议。
- 把账本或人工动作回写到 GitHub。

---

## 四、架构分层

建议在 `gh-superpowers` 仓库中采用如下结构：

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
  docs/
```

### packages/core

负责：

- `Task` 模型。
- `plan` 解析。
- 托管评论解析与渲染。
- `task-links` 绑定块解析。
- `ledger` 文本渲染。
- 状态推导。
- 偏差检测。

### packages/github

负责：

- GitHub 访问接口。
- 优先走 `GitHub MCP`。
- 回退到 `gh`。
- 读取与写入：
  - `Issue`
  - comments
  - `PR`
  - `check`
  - `review`

### packages/codex

负责：

- `Codex` 内部动作定义。
- 自然语言到动作的映射。
- 配置读取。
- `bind-issue`
- `publish-plan`
- `sync-ledger`
- `show-ledger`
- `accept-task`
- `block-task`
- `unblock-task`
- `drop-task`

---

## 五、核心模型

### 1. 主线对象

一期固定：

- 一个 GitHub `Issue` = 一条交付主线。

### 2. 最小跟踪单位

一期固定：

- `plan` 里的每个 `Task` = 最小事实跟踪单位。

每个 `Task` 至少包含：

- `taskId`
- `title`
- `description`
- `acceptanceCriteria`
- `status`

### 3. Task 状态

一期使用以下状态：

- `todo`
- `in_progress`
- `blocked`
- `implemented`
- `verified`
- `accepted`
- `dropped`

### 4. 当前有效 plan

当前有效 `plan` 的真源是一条 GitHub 托管评论，不是本地草稿。

每次发布 `plan` 时生成一个 `planVersion`，账本始终针对当前 `planVersion` 对齐。

---

## 六、协议设计

### 1. Task 编号

每个 `Task` 必须带稳定编号，例如：

- `T1`
- `T2`
- `T3`

### 2. 托管评论标记

托管评论统一用机器可读头，例如：

```html
<!-- gh-superpowers:managed-comment {"kind":"plan","issue":42,"version":"v1"} -->
```

账本评论：

```html
<!-- gh-superpowers:managed-comment {"kind":"ledger","issue":42,"planVersion":"v1"} -->
```

### 3. 任务绑定块

显式绑定统一使用：

```html
<!-- gh-superpowers:task-links {"tasks":["T2","T3"]} -->
```

允许出现在：

- `Issue comment`
- `PR body`
- `commit message`
- `review comment`

### 4. 人工动作块

例如验收：

```html
<!-- gh-superpowers:task-action {"action":"accept","task":"T2"} -->
```

例如阻塞：

```html
<!-- gh-superpowers:task-action {"action":"block","task":"T3","reason":"等待接口稳定"} -->
```

---

## 七、最小动作集

一期在 `Codex` 中对外暴露的最小动作如下：

1. `bind-issue`
2. `publish-plan`
3. `sync-ledger`
4. `show-ledger`
5. `accept-task`
6. `block-task`
7. `unblock-task`
8. `drop-task`

这些动作既可以由自然语言触发，也可以在内部被固定映射。

---

## 八、状态推导规则

### 1. 初始

`Task` 被从 `plan` 成功抽出后，默认进入 `todo`。

### 2. todo -> in_progress

满足任一项：

- 有显式绑定该 `Task` 的开始评论。
- 有显式绑定该 `Task` 的 `PR`。
- 有显式绑定该 `Task` 的 `commit`。
- 代理执行记录声明正在处理该任务。

### 3. in_progress -> implemented

满足全部：

- 至少存在一个绑定该任务的 `PR` 或 `commit`。
- 有实现说明。
- 当前没有被阻塞。

### 4. implemented -> verified

满足全部：

- 相关必需 `check` / `workflow` 成功。
- 没有未解决的阻断性 review。
- 没有关键证据缺失。

### 5. verified -> accepted

只能人工触发。

### 6. 任意状态 -> blocked

满足任一项：

- 人工标记阻塞。
- review 阻断。
- 关键 `check` 持续失败。
- 代理显式声明阻塞。

### 7. 任意状态 -> dropped

只能人工触发。

---

## 九、偏差检测

一期最少需要检测这些问题：

1. 有 `Task` 无事实。
2. 有事实无 `Task`。
3. 已实现未验证。
4. 已验证未验收。
5. 阻塞后主线仍错误推进。
6. 新旧 `plan` 版本中的 `Task` 对不上。

这些偏差必须能直接显示在账本里。

---

## 十、GitHub 通道策略

一期采用双通道策略：

### 第一优先
- `GitHub MCP`

### 第二优先
- `gh`

对上层只暴露统一 provider 接口，不让 `Codex` 层感知底层差异。

---

## 十一、项目级配置

业务仓里的 `gh-superpowers.config.json` 一期建议支持：

```json
{
  "repository": "owner/repo",
  "defaultBranch": "main",
  "requiredChecks": ["test", "build"],
  "taskLinkStyle": "comment-block",
  "acceptanceMode": "manual"
}
```

含义：

- `repository`：默认仓库。
- `defaultBranch`：默认主分支。
- `requiredChecks`：进入 `verified` 需要通过的检查项。
- `taskLinkStyle`：一期固定为统一绑定块。
- `acceptanceMode`：一期固定人工验收。

---

## 十二、一期实施计划

### 阶段 0：补 plan 结构约束

目标：保证 `Task` 可稳定抽取。

工作：

- 约束 `plan` 必须带稳定 `Task` 编号。
- 每个任务最少包含标题、目标、验收条件。

### 阶段 1：Codex plugin 骨架

目标：插件在 `Codex` 中可被识别。

工作：

- 增加 `.codex-plugin/plugin.json`
- 增加 `packages/codex`
- 增加测试入口
- 增加项目级配置读取

### 阶段 2：只读 GitHub 事实采集

目标：能看到当前事实。

工作：

- 建立 GitHub provider 接口。
- 优先支持 `GitHub MCP`，回退到 `gh`。
- 能读取：`Issue`、comments、`PR`、`check`、`review`。

### 阶段 3：发布 plan 与初始化 ledger

目标：建立账本基线。

工作：

- 发布托管 `plan` 评论。
- 抽取 `Task`。
- 发布初始 `ledger` 评论。
- 写入 `planVersion`。

### 阶段 4：事实映射与状态推导

目标：能回答“做到哪儿了”。

工作：

- 解析 `task-links`。
- 建立 `Task -> PR / commit / check / review` 映射。
- 实现 `sync-ledger`。
- 输出偏差告警。

### 阶段 5：人工控制

目标：把最终验收权交回给人。

工作：

- 实现 `accept-task`。
- 实现 `block-task`。
- 实现 `unblock-task`。
- 实现 `drop-task`。
- 回写人工动作评论。

### 阶段 6：打磨与演示

目标：证明计划与事实已经对齐。

工作：

- 准备示例业务仓。
- 准备示例 `Issue`。
- 准备示例 `plan`。
- 跑通完整演示流程。
- 补测试和失败场景说明。

---

## 十三、一期最小演示链路

一期验收以这条链路为准：

1. 在 `Codex` 中绑定一个 `Issue`。
2. 发布当前 `plan`。
3. 自动抽取 `Task`。
4. 通过 `PR` 和 `check` 更新账本。
5. 识别出哪些任务是 `implemented`、`verified`、`blocked`、`todo`。
6. 人工验收某个 `Task`。
7. 账本评论随之更新。

只要这条链路成立，你最关心的“计划和 GitHub 事实脱节”问题就开始被真正解决。

---

## 十四、一期明确不做

为了收敛，一期先不做：

- `Claude` 适配
- 后台常驻服务
- `GitHub Actions` 全自动主编排
- 多 `Issue` 编排
- 子模块主接入
- 语义级代码与 `spec` 深度比对

这些都可以放到后续阶段。

---

## 十五、当前推进建议

下一步推荐实施顺序：

1. 插件骨架与配置读取
2. GitHub provider 抽象与最小 `gh` / `MCP` 通道
3. `plan -> Task` 解析
4. 托管 `plan` / `ledger` 评论
5. `sync-ledger`
6. 人工动作
7. 演示与收尾

这样每一步都可以独立验证，也方便并行开发。
