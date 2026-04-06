# 一期最小演示链路 walkthrough

本文档描述如何在 Codex 中跑通一期最小演示链路。

## 前置条件

1. 在目标业务仓安装 `gh-superpowers` Codex plugin
2. 确保 `gh auth login` 已认证
3. 目标仓库已有一个 Issue（例如 #42）

## 演示链路

### 步骤 1：绑定 Issue

在 Codex 中输入：

```
绑定到 #42
```

或调用动作：

```js
await router.runAction('bind-issue', { issueNumber: 42 });
```

**预期**：会话状态被记录，后续动作自动关联到 #42。

---

### 步骤 2：发布当前 plan

在 Codex 中输入：

```
发布当前计划
```

或调用动作（需传入 plan 文本）：

```js
await router.runAction('publish-plan', {
  planText: `
### T1 插件骨架
- 目标：建立 Codex plugin 结构
- 验收：存在 .codex-plugin/plugin.json

### T2 账本同步
- 目标：同步 GitHub 事实到账本
- 验收：账本能看到 verified 状态
`,
  planVersion: 'v1',
});
```

**预期**：
- GitHub Issue #42 下出现一条托管 plan 评论（带 `gh-superpowers:managed-comment` 标记）
- 同时出现一条初始 ledger 评论
- T1、T2 均处于 `todo` 状态

---

### 步骤 3：PR 与 check 更新账本

开发者创建 PR 并在 PR body 中绑定任务：

```html
<!-- gh-superpowers:task-links {"tasks":["T1"]} -->
```

CI 跑通过后，在 Codex 中输入：

```
同步任务账本
```

**预期**：
- T1 状态变为 `in_progress` → `implemented` → `verified`（如果 check 通过）
- ledger 评论被更新

---

### 步骤 4：识别各任务状态

在 Codex 中输入：

```
显示账本
```

**预期**：看到类似以下输出：

```
## 任务账本 #42
计划版本：v1
必需校验：test、build

### 任务状态
- T1 (verified) 插件骨架
- T2 (todo) 账本同步

### 偏差
- 有任务暂无事实：T2
```

---

### 步骤 5：人工验收

在 Codex 中输入：

```
验收 T1
```

**预期**：
- Issue #42 下出现一条 `task-action` 评论
- ledger 更新后 T1 变为 `accepted`

---

### 步骤 6：阻塞与解除阻塞

```
阻塞 T2：等待 infra 就绪
```

**预期**：T2 变为 `blocked`，账本中出现阻塞原因。

```
解除阻塞 T2
```

**预期**：阻塞标记被清除，T2 回到之前状态。

---

### 步骤 7：丢弃任务

```
丢弃 T2
```

**预期**：T2 变为 `dropped`。

## 验证清单

- [ ] bind-issue 能正确绑定 Issue
- [ ] publish-plan 能创建托管评论
- [ ] sync-ledger 能拉取 GitHub 事实并推导状态
- [ ] show-ledger 能显示当前账本
- [ ] accept-task 能创建人工动作评论
- [ ] block-task 能标记阻塞及原因
- [ ] unblock-task 能解除阻塞
- [ ] drop-task 能标记丢弃
- [ ] 账本中的偏差告警正确
- [ ] 新旧 plan 版本差异能在偏差中显示
