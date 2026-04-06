# gh-superpowers Codex plugin 一期实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development（若可用）或 superpowers:executing-plans 执行本计划。步骤使用 checkbox（`- [ ]`）语法跟踪。

**Goal:** 为 `gh-superpowers` 增加一个可安装到 `Codex` 的一期插件骨架，支持 `plan -> Task` 抽取、GitHub 事实读取、账本生成与最小动作路由。

**Architecture:** 采用 `packages/core`、`packages/github`、`packages/codex` 三层结构。`core` 负责协议与状态推导，`github` 负责统一 provider 抽象与通道选择，`codex` 负责配置、会话绑定、动作与自然语言映射；`.codex-plugin/plugin.json` 作为插件入口元数据。

**Tech Stack:** 原生 `Node.js` ESM、`node:test`、零第三方运行时依赖、`gh` 命令兜底、面向 `GitHub MCP` 的抽象适配。

---

## Chunk 1: 插件骨架与核心协议

### Task 1: 建立一期目录结构与测试入口

**Files:**
- Create: `.codex-plugin/plugin.json`
- Create: `packages/core/src/index.js`
- Create: `packages/github/src/index.js`
- Create: `packages/codex/src/index.js`
- Create: `tests/codex-plugin/core.test.js`
- Create: `tests/codex-plugin/github-provider.test.js`
- Create: `tests/codex-plugin/codex-actions.test.js`
- Modify: `package.json`

- [ ] **Step 1: 先写测试文件骨架**
- [ ] **Step 2: 运行单测确认缺模块失败**
- [ ] **Step 3: 补最小导出与脚本**
- [ ] **Step 4: 运行测试确认骨架可加载**

### Task 2: 定义计划解析与协议模型

**Files:**
- Modify: `packages/core/src/index.js`
- Modify: `tests/codex-plugin/core.test.js`

- [ ] **Step 1: 写 `extractTasksFromPlan`、托管评论、绑定块、人工动作块的失败用例**
- [ ] **Step 2: 运行 `node --test tests/codex-plugin/core.test.js` 确认失败**
- [ ] **Step 3: 实现最小解析与渲染逻辑**
- [ ] **Step 4: 再跑核心测试确认通过**

## Chunk 2: GitHub provider 与账本推导

### Task 3: 建立统一 GitHub provider 抽象

**Files:**
- Modify: `packages/github/src/index.js`
- Modify: `tests/codex-plugin/github-provider.test.js`

- [ ] **Step 1: 写 provider 选择、`gh` 命令构造、托管评论 upsert 的失败测试**
- [ ] **Step 2: 运行 `node --test tests/codex-plugin/github-provider.test.js` 确认失败**
- [ ] **Step 3: 实现 `GitHub MCP` 优先与 `gh` 回退**
- [ ] **Step 4: 再跑 provider 测试确认通过**

### Task 4: 实现状态推导与账本文本生成

**Files:**
- Modify: `packages/core/src/index.js`
- Modify: `tests/codex-plugin/core.test.js`

- [ ] **Step 1: 写 `sync-ledger` 所需状态推导失败测试**
- [ ] **Step 2: 运行核心测试确认失败**
- [ ] **Step 3: 实现 `todo / in_progress / implemented / verified / accepted / blocked / dropped` 推导与偏差检测**
- [ ] **Step 4: 运行核心测试确认通过**

## Chunk 3: Codex 动作与自然语言映射

### Task 5: 实现配置、绑定与动作处理

**Files:**
- Modify: `packages/codex/src/index.js`
- Modify: `tests/codex-plugin/codex-actions.test.js`
- Create: `templates/repo-config/gh-superpowers.config.json`

- [ ] **Step 1: 写配置读取、Issue 绑定、发布 plan、同步 ledger 的失败测试**
- [ ] **Step 2: 运行 `node --test tests/codex-plugin/codex-actions.test.js` 确认失败**
- [ ] **Step 3: 实现最小动作处理与会话状态存储**
- [ ] **Step 4: 再跑动作测试确认通过**

### Task 6: 实现自然语言映射与人工动作回写

**Files:**
- Modify: `packages/codex/src/index.js`
- Modify: `tests/codex-plugin/codex-actions.test.js`

- [ ] **Step 1: 写中文动作映射、人工验收/阻塞/解除阻塞/丢弃的失败测试**
- [ ] **Step 2: 运行动作测试确认失败**
- [ ] **Step 3: 实现映射与评论生成**
- [ ] **Step 4: 运行动作测试确认通过**

## Chunk 4: 集成验证

### Task 7: 一次性集成与总体验证

**Files:**
- Modify: `package.json`
- Modify: `tests/codex-plugin/*.test.js`

- [ ] **Step 1: 运行 `node --test tests/codex-plugin/*.test.js`**
- [ ] **Step 2: 修复跨模块导出与接口拼接问题**
- [ ] **Step 3: 再次运行全部一期测试**
- [ ] **Step 4: 整理可演示的最小链路**
