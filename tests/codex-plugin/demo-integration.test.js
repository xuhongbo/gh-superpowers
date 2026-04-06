import assert from 'node:assert/strict';
import test from 'node:test';

import * as core from '../../packages/core/src/index.js';
import {
  createCodexActionRouter,
  createSessionStore,
  loadRepoConfig,
  routeNaturalLanguage,
} from '../../packages/codex/src/index.js';

// --- 演示链路完整集成测试 ---
// 模拟设计文档第十三章规定的最小演示链路：
// 1. 绑定 Issue → 2. 发布 plan → 3. 自动抽取 Task →
// 4. 通过 PR 和 check 更新账本 → 5. 识别各任务状态 →
// 6. 人工验收 → 7. 账本随之更新

function createMemorySessionStore(initialState = {}) {
  let state = { ...initialState, actions: [...(initialState.actions ?? [])] };
  return {
    async getState() { return state; },
    async bindIssue(issueNumber) { state = { ...state, issueNumber }; return state; },
    async setPlanVersion(planVersion) { state = { ...state, planVersion }; return state; },
    async recordAction(action, payload) {
      state = { ...state, actions: [...state.actions, { action, payload }] };
      return state;
    },
  };
}

const demoPlan = `
# 示例 Plan：搭建 Codex 插件骨架

### T1 插件骨架
- 目标：建立 .codex-plugin/plugin.json 和 packages/codex 目录
- 验收：Codex 能识别插件入口

### T2 GitHub 事实采集
- 目标：建立 MCP + gh 双通道的 provider 抽象
- 验收：能读取 Issue、comments、PR、check、review

### T3 事实映射与状态推导
- 目标：解析 task-links 并推导每个任务状态
- 验收：sync-ledger 能正确识别 implemented/verified/blocked/todo

### T4 人工控制
- 目标：实现 accept/block/unblock/drop-task
- 验收：人工动作评论回写 Issue 并更新 ledger
`;

test('演示链路 step 1: 自然语言 "绑定到 #42" 映射到 bind-issue', () => {
  const routed = routeNaturalLanguage('绑定到 #42');
  assert.deepStrictEqual(routed, {
    action: 'bind-issue',
    payload: { issueNumber: 42 },
  });
});

test('演示链路 step 2-3: 发布 plan 并自动抽取 Task', async () => {
  const comments = [];
  const provider = {
    async upsertManagedIssueComment(_o, _r, _i, body, tag) {
      comments.push({ body, tag });
      return { id: comments.length, body };
    },
    async listIssueComments() { return []; },
  };

  const store = createMemorySessionStore({ issueNumber: 42 });
  const router = createCodexActionRouter({
    sessionStore: store,
    provider,
    core,
    config: { repository: 'example/demo-repo', requiredChecks: ['test', 'build'] },
  });

  const result = await router.runAction('publish-plan', { planText: demoPlan, planVersion: 'v1' });

  // 验证 Task 被正确抽取
  assert.strictEqual(result.tasks.length, 4);
  assert.strictEqual(result.tasks[0].taskId, 'T1');
  assert.strictEqual(result.tasks[0].title, '插件骨架');
  assert.strictEqual(result.tasks[3].taskId, 'T4');

  // 验证 planVersion
  assert.strictEqual(result.planVersion, 'v1');

  // 验证托管评论被创建
  assert.strictEqual(comments.length, 2);
  assert.strictEqual(comments[0].tag, 'plan:v1');
  assert.strictEqual(comments[1].tag, 'ledger:v1');
  assert(comments[0].body.includes('gh-superpowers:managed-comment'));

  // 验证初始 ledger 中所有任务都是 todo
  const ledgerText = comments[1].body;
  assert(ledgerText.includes('T1 (todo)'));
  assert(ledgerText.includes('T2 (todo)'));
  assert(ledgerText.includes('T3 (todo)'));
  assert(ledgerText.includes('T4 (todo)'));
});

test('演示链路 step 4-5: 通过 PR 和 check 更新账本，识别各任务状态', async () => {
  const upserts = [];
  const planComment = core.renderManagedComment({ kind: 'plan', issue: 42, version: 'v1' }, demoPlan);

  const provider = {
    async listIssueComments() {
      return [
        { id: 1, body: planComment },
        { id: 2, body: '<!-- gh-superpowers:task-action {"action":"accept","task":"T1"} -->' },
        { id: 3, body: '<!-- gh-superpowers:task-action {"action":"block","task":"T3","reason":"等待 API"} -->' },
      ];
    },
    async listLinkedPullRequests() {
      return [
        { number: 10, title: '实现插件骨架', tasks: ['T1'], body: '<!-- gh-superpowers:task-links {"tasks":["T1"]} -->' },
        { number: 11, title: '事实采集', tasks: ['T2'], body: '<!-- gh-superpowers:task-links {"tasks":["T2"]} -->' },
        { number: 12, title: '状态推导', tasks: ['T3'], body: '<!-- gh-superpowers:task-links {"tasks":["T3"]} -->' },
      ];
    },
    async getPullRequest(_o, _r, num) {
      const bodies = { 10: '<!-- gh-superpowers:task-links {"tasks":["T1"]} -->', 11: '<!-- gh-superpowers:task-links {"tasks":["T2"]} -->', 12: '<!-- gh-superpowers:task-links {"tasks":["T3"]} -->' };
      return { number: num, title: '', body: bodies[num] ?? '' };
    },
    async listPullRequestCommits() {
      return [];
    },
    async listPullRequestChecks(_o, _r, num) {
      if (num === 10) return [
        { name: 'test', conclusion: 'success', status: 'completed' },
        { name: 'build', conclusion: 'success', status: 'completed' },
      ];
      if (num === 11) return [
        { name: 'test', conclusion: 'success', status: 'completed' },
        { name: 'build', conclusion: 'success', status: 'completed' },
      ];
      return [];
    },
    async listPullRequestReviews() {
      return [];
    },
    async upsertManagedIssueComment(_o, _r, _i, body, tag) {
      upserts.push({ body, tag });
      return { id: 100, body };
    },
  };

  const store = createMemorySessionStore({ issueNumber: 42, planVersion: 'v1' });
  const router = createCodexActionRouter({
    sessionStore: store,
    provider,
    core,
    config: { repository: 'example/demo-repo', requiredChecks: ['test', 'build'] },
  });

  const snapshot = await router.runAction('sync-ledger');

  // 验证各任务状态
  const states = Object.fromEntries(snapshot.tasks.map(t => [t.taskId, t.state]));

  // T1: 已验收（人工 accept）
  assert.strictEqual(states.T1, 'accepted', `T1 应为 accepted，实际 ${states.T1}`);
  // T2: 已验证（PR + check 全部通过）
  assert.strictEqual(states.T2, 'verified', `T2 应为 verified，实际 ${states.T2}`);
  // T3: 被阻塞（人工 block）
  assert.strictEqual(states.T3, 'blocked', `T3 应为 blocked，实际 ${states.T3}`);
  // T4: 待办（无任何事实）
  assert.strictEqual(states.T4, 'todo', `T4 应为 todo，实际 ${states.T4}`);

  // 验证账本评论被更新
  assert.strictEqual(upserts.length, 1);
  assert.strictEqual(upserts[0].tag, 'ledger:v1');
  const ledgerText = upserts[0].body;
  assert(ledgerText.includes('T1 (accepted)'));
  assert(ledgerText.includes('T2 (verified)'));
  assert(ledgerText.includes('T3 (blocked)'));
  assert(ledgerText.includes('T4 (todo)'));

  // 验证偏差检测
  assert(snapshot.deviations.some(d => d.includes('T4')), '应检测到 T4 无事实');
});

test('演示链路 step 6-7: 人工验收 T2 并更新账本', async () => {
  const comments = [];
  const store = createMemorySessionStore({ issueNumber: 42 });

  const router = createCodexActionRouter({
    sessionStore: store,
    provider: {
      async createIssueComment(_o, _r, _i, body) {
        comments.push({ body });
        return { id: comments.length, body };
      },
    },
    core,
    config: { repository: 'example/demo-repo' },
  });

  await router.runAction('accept-task', { taskId: 'T2' });

  // 验证人工动作评论包含正确的 task-action 块
  assert.strictEqual(comments.length, 1);
  assert(comments[0].body.includes('gh-superpowers:task-action'));
  assert(comments[0].body.includes('"action":"accept"'));
  assert(comments[0].body.includes('"task":"T2"'));
});

test('演示链路: 阻塞与解除阻塞', async () => {
  const comments = [];
  const store = createMemorySessionStore({ issueNumber: 42 });

  const router = createCodexActionRouter({
    sessionStore: store,
    provider: {
      async createIssueComment(_o, _r, _i, body) {
        comments.push({ body });
        return { id: comments.length, body };
      },
    },
    core,
    config: { repository: 'example/demo-repo' },
  });

  // 阻塞
  await router.runAction('block-task', { taskId: 'T2', reason: '等待 API 稳定' });
  assert(comments[0].body.includes('"action":"block"'));
  assert(comments[0].body.includes('等待 API 稳定'));

  // 解除阻塞
  await router.runAction('unblock-task', { taskId: 'T2' });
  assert(comments[1].body.includes('"action":"unblock"'));

  // 丢弃
  await router.runAction('drop-task', { taskId: 'T3' });
  assert(comments[2].body.includes('"action":"drop"'));
});

test('演示链路: 计划版本漂移检测', () => {
  const previousTasks = [
    { taskId: 'T1', title: '旧任务1' },
    { taskId: 'T2', title: '被移除的任务' },
    { taskId: 'T3', title: '保留任务' },
  ];
  const currentTasks = [
    { taskId: 'T1', title: '旧任务1' },
    { taskId: 'T3', title: '保留任务' },
    { taskId: 'T4', title: '新增任务' },
  ];

  const snapshot = core.buildLedgerSnapshot({
    issueNumber: 42,
    planVersion: 'v2',
    tasks: currentTasks,
    facts: [],
    requiredChecks: ['test'],
    previousTasks,
  });

  assert(snapshot.deviations.some(d => d.includes('已移除') && d.includes('T2')));
  assert(snapshot.deviations.some(d => d.includes('新增') && d.includes('T4')));
});

test('演示链路: commit 中的 task-links 被正确提取并推导为 in_progress', async () => {
  const upserts = [];
  const planComment = core.renderManagedComment({ kind: 'plan', issue: 42, version: 'v1' }, demoPlan);

  const provider = {
    async listIssueComments() {
      return [{ id: 1, body: planComment }];
    },
    async listLinkedPullRequests() {
      return [
        {
          number: 20,
          title: '通过 commit 绑定任务',
          tasks: [],
          body: '',
        },
      ];
    },
    async getPullRequest() {
      return { number: 20, title: '通过 commit 绑定任务', body: '' };
    },
    async listPullRequestCommits() {
      return [
        {
          sha: 'def5678',
          message: 'feat: 实现插件骨架\n<!-- gh-superpowers:task-links {"tasks":["T1"]} -->',
          author: 'dev',
          url: 'https://github.com/example/proj/commit/def5678',
        },
      ];
    },
    async listPullRequestChecks() { return []; },
    async listPullRequestReviews() { return []; },
    async upsertManagedIssueComment(_o, _r, _i, body, tag) {
      upserts.push({ body, tag });
      return { id: 100, body };
    },
  };

  const store = createMemorySessionStore({ issueNumber: 42, planVersion: 'v1' });
  const router = createCodexActionRouter({
    sessionStore: store,
    provider,
    core,
    config: { repository: 'example/demo-repo' },
  });

  const snapshot = await router.runAction('sync-ledger');

  // T1 通过 commit 绑定应变为 in_progress
  const states = Object.fromEntries(snapshot.tasks.map(t => [t.taskId, t.state]));
  assert.strictEqual(states.T1, 'in_progress', `T1 应为 in_progress（commit 绑定），实际 ${states.T1}`);

  // 验证事实中包含 commit kind
  assert(snapshot.facts.some(f => f.kind === 'commit' && f.taskId === 'T1'), '应包含 commit 事实');
});

test('演示链路: PR body 中的 task-links 被正确提取并推导为 in_progress', async () => {
  const upserts = [];
  const planComment = core.renderManagedComment({ kind: 'plan', issue: 42, version: 'v1' }, demoPlan);

  const provider = {
    async listIssueComments() {
      return [{ id: 1, body: planComment }];
    },
    async listLinkedPullRequests() {
      return [
        { number: 30, title: 'PR with body task-links', tasks: [] },
      ];
    },
    async getPullRequest() {
      return {
        number: 30,
        title: 'PR with body task-links',
        body: '实现 T1 和 T2\n<!-- gh-superpowers:task-links {"tasks":["T1","T2"]} -->',
      };
    },
    async listPullRequestCommits() {
      return [];
    },
    async listPullRequestChecks() { return []; },
    async listPullRequestReviews() { return []; },
    async upsertManagedIssueComment(_o, _r, _i, body, tag) {
      upserts.push({ body, tag });
      return { id: 100, body };
    },
  };

  const store = createMemorySessionStore({ issueNumber: 42, planVersion: 'v1' });
  const router = createCodexActionRouter({
    sessionStore: store,
    provider,
    core,
    config: { repository: 'example/demo-repo', requiredChecks: ['build', 'test'] },
  });

  const snapshot = await router.runAction('sync-ledger');

  // T1, T2 通过 PR body task-links 变为 implemented（有 PR 绑定但无 check 结果）
  const states = Object.fromEntries(snapshot.tasks.map(t => [t.taskId, t.state]));
  assert.strictEqual(states.T1, 'implemented', `T1 应为 implemented（PR body 绑定），实际 ${states.T1}`);
  assert.strictEqual(states.T2, 'implemented', `T2 应为 implemented（PR body 绑定），实际 ${states.T2}`);
  assert.strictEqual(states.T3, 'todo', `T3 应为 todo，实际 ${states.T3}`);
  assert.strictEqual(states.T4, 'todo', `T4 应为 todo，实际 ${states.T4}`);

  // 验证事实中包含 binding 和 implementation
  assert(snapshot.facts.some(f => f.kind === 'binding' && f.taskId === 'T1'), '应包含 binding 事实');
  assert(snapshot.facts.some(f => f.kind === 'implementation' && f.taskId === 'T1'), '应包含 implementation 事实');
});
