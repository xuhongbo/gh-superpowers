import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import * as core from '../../packages/core/src/index.js';
import {
  createCodexActionRouter,
  createSessionStore,
  DEFAULT_REPO_CONFIG,
  loadRepoConfig,
  routeNaturalLanguage,
} from '../../packages/codex/src/index.js';

const samplePlan = `
### T1 插件骨架
- 目标：建立 Codex plugin 结构
- 验收：存在 .codex-plugin/plugin.json

### T2 账本同步
- 目标：同步 GitHub 事实到账本
- 验收：账本能看到 verified 状态
`;

test('loadRepoConfig merges defaults with repo file', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-config-'));
  try {
    await fs.writeFile(
      path.join(tmp, 'gh-superpowers.config.json'),
      JSON.stringify({
        repository: 'owner/repo',
        defaultBranch: 'develop',
        requiredChecks: ['unit'],
      }),
      'utf8',
    );

    const config = await loadRepoConfig(tmp);
    assert.strictEqual(config.repository, 'owner/repo');
    assert.strictEqual(config.defaultBranch, 'develop');
    assert.deepStrictEqual(config.requiredChecks, ['unit']);
    assert.strictEqual(config.taskLinkStyle, DEFAULT_REPO_CONFIG.taskLinkStyle);
    assert.strictEqual(config.acceptanceMode, DEFAULT_REPO_CONFIG.acceptanceMode);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('loadRepoConfig returns defaults when file missing', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-config-'));
  try {
    const config = await loadRepoConfig(tmp);
    assert.deepStrictEqual(config, DEFAULT_REPO_CONFIG);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('createSessionStore writes session state when binding issue', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'session-store-'));
  try {
    const gitCommon = path.join(tmp, 'git-common-dir');
    await fs.mkdir(gitCommon, { recursive: true });
    const store = createSessionStore({
      cwd: tmp,
      resolveGitCommonDir: async () => gitCommon,
      fs,
    });

    const state = await store.bindIssue(42);
    assert.strictEqual(state.issueNumber, 42);

    const persisted = JSON.parse(
      await fs.readFile(path.join(gitCommon, 'gh-superpowers', 'gh-superpowers-session.json'), 'utf8'),
    );
    assert.strictEqual(persisted.issueNumber, 42);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('routeNaturalLanguage understands supported commands', () => {
  assert.deepStrictEqual(routeNaturalLanguage('绑定到 #42'), {
    action: 'bind-issue',
    payload: { issueNumber: 42 },
  });
  assert.deepStrictEqual(routeNaturalLanguage('发布当前计划'), {
    action: 'publish-plan',
    payload: {},
  });
  assert.deepStrictEqual(routeNaturalLanguage('同步任务账本'), {
    action: 'sync-ledger',
    payload: {},
  });
  assert.deepStrictEqual(routeNaturalLanguage('显示账本'), {
    action: 'show-ledger',
    payload: {},
  });
  assert.deepStrictEqual(routeNaturalLanguage('验收 T2'), {
    action: 'accept-task',
    payload: { taskId: 'T2' },
  });
  assert.deepStrictEqual(routeNaturalLanguage('阻塞 T3：等待接口稳定'), {
    action: 'block-task',
    payload: { taskId: 'T3', reason: '等待接口稳定' },
  });
  assert.deepStrictEqual(routeNaturalLanguage('解除阻塞 T3'), {
    action: 'unblock-task',
    payload: { taskId: 'T3' },
  });
  assert.deepStrictEqual(routeNaturalLanguage('丢弃 T4'), {
    action: 'drop-task',
    payload: { taskId: 'T4' },
  });
});

test('publish-plan writes managed plan and ledger comments', async () => {
  const comments = [];
  const provider = {
    async upsertManagedIssueComment(owner, repo, issueNumber, body, tag) {
      comments.push({ owner, repo, issueNumber, body, tag });
      return { id: comments.length, body };
    },
    async listIssueComments() {
      return [];
    },
  };

  const sessionStore = createMemorySessionStore({ issueNumber: 42 });
  const router = createCodexActionRouter({
    sessionStore,
    provider,
    core,
    config: { repository: 'owner/repo', requiredChecks: ['build', 'test'] },
  });

  const result = await router.runAction('publish-plan', { planText: samplePlan, planVersion: 'v1' });
  assert.strictEqual(result.planVersion, 'v1');
  assert.strictEqual(result.tasks.length, 2);
  assert.strictEqual(comments.length, 2);
  assert.strictEqual(comments[0].tag, 'plan:v1');
  assert.strictEqual(comments[1].tag, 'ledger:v1');
  assert.match(comments[0].body, /gh-superpowers:managed-comment/);
  assert.match(comments[1].body, /交付任务账本|任务账本/);

  const state = await sessionStore.getState();
  assert.strictEqual(state.planVersion, 'v1');
});

test('sync-ledger builds snapshot from GitHub facts and updates ledger comment', async () => {
  const upserts = [];
  const planComment = core.renderManagedComment({ kind: 'plan', issue: 42, version: 'v1' }, samplePlan);
  const provider = {
    async listIssueComments() {
      return [
        { id: 1, body: planComment },
        {
          id: 2,
          body: '<!-- gh-superpowers:task-action {"action":"accept","task":"T1"} -->',
        },
      ];
    },
    async listLinkedPullRequests() {
      return [
        {
          number: 7,
          title: '实现账本同步',
          body: '<!-- gh-superpowers:task-links {"tasks":["T2"]} -->',
          tasks: ['T2'],
        },
      ];
    },
    async getPullRequest() {
      return { number: 7, title: '实现账本同步', body: '<!-- gh-superpowers:task-links {"tasks":["T2"]} -->' };
    },
    async listPullRequestCommits() {
      return [];
    },
    async listPullRequestChecks() {
      return [
        { name: 'build', conclusion: 'success', status: 'completed' },
        { name: 'test', conclusion: 'success', status: 'completed' },
      ];
    },
    async listPullRequestReviews() {
      return [];
    },
    async upsertManagedIssueComment(owner, repo, issueNumber, body, tag) {
      upserts.push({ owner, repo, issueNumber, body, tag });
      return { id: 3, body };
    },
  };

  const sessionStore = createMemorySessionStore({ issueNumber: 42, planVersion: 'v1' });
  const router = createCodexActionRouter({
    sessionStore,
    provider,
    core,
    config: { repository: 'owner/repo', requiredChecks: ['build', 'test'] },
  });

  const snapshot = await router.runAction('sync-ledger');
  const states = Object.fromEntries(snapshot.tasks.map((task) => [task.taskId, task.state]));
  assert.deepStrictEqual(states, {
    T1: 'accepted',
    T2: 'verified',
  });
  assert.strictEqual(upserts.length, 1);
  assert.strictEqual(upserts[0].tag, 'ledger:v1');
  assert.match(upserts[0].body, /T2 \(verified\)|T2 \|/);
});

test('show-ledger returns the current ledger body', async () => {
  const ledgerComment = core.renderManagedComment({ kind: 'ledger', issue: 42, planVersion: 'v1' }, 'ledger body');
  const provider = {
    async listIssueComments() {
      return [{ id: 1, body: ledgerComment }];
    },
  };

  const router = createCodexActionRouter({
    sessionStore: createMemorySessionStore({ issueNumber: 42, planVersion: 'v1' }),
    provider,
    core,
    config: { repository: 'owner/repo' },
  });

  const ledger = await router.runAction('show-ledger');
  assert.strictEqual(ledger, 'ledger body');
});

test('manual task actions create issue comments and record session actions', async () => {
  const comments = [];
  const sessionStore = createMemorySessionStore({ issueNumber: 42, planVersion: 'v1' });
  const planComment = core.renderManagedComment(
    { kind: 'plan', issue: 42, version: 'v1' },
    '### T2 测试\n- 目标：测试\n- 验收：通过',
  );
  const provider = {
    async listIssueComments() {
      return [{ id: 1, body: planComment }];
    },
    async listLinkedPullRequests() { return []; },
    async getPullRequest() { return { body: '', tasks: [] }; },
    async listPullRequestCommits() { return []; },
    async listPullRequestChecks() { return []; },
    async listPullRequestReviews() { return []; },
    async createIssueComment(owner, repo, issueNumber, body) {
      comments.push({ owner, repo, issueNumber, body });
      return { id: comments.length, body };
    },
    async upsertManagedIssueComment(owner, repo, issueNumber, body, tag) {
      comments.push({ owner, repo, issueNumber, body, tag });
      return { id: comments.length, body };
    },
  };

  const router = createCodexActionRouter({
    sessionStore,
    provider,
    core,
    config: { repository: 'owner/repo' },
  });

  await router.runAction('accept-task', { taskId: 'T2' });

  // Action comment + ledger update = 2 comments
  assert.strictEqual(comments.length, 2);
  assert.match(comments[0].body, /"action":"accept"/);
  assert.match(comments[1].body, /T2 \(accepted\)|交付任务账本|任务账本/);
  assert.strictEqual(comments[1].tag, 'ledger:v1');

  const state = await sessionStore.getState();
  assert.strictEqual(state.actions.length, 1);
});

function createMemorySessionStore(initialState = {}) {
  let state = { ...initialState, actions: [...(initialState.actions ?? [])] };

  return {
    async getState() {
      return state;
    },
    async bindIssue(issueNumber) {
      state = { ...state, issueNumber };
      return state;
    },
    async setPlanVersion(planVersion) {
      state = { ...state, planVersion };
      return state;
    },
    async recordAction(action, payload) {
      state = {
        ...state,
        actions: [...state.actions, { action, payload }],
      };
      return state;
    },
  };
}

test('routeNaturalLanguage returns null for unrecognized input', () => {
  assert.strictEqual(routeNaturalLanguage(''), null);
  assert.strictEqual(routeNaturalLanguage(null), null);
  assert.strictEqual(routeNaturalLanguage('随便说点什么'), null);
});

test('createCodexActionRouter requires sessionStore', () => {
  assert.throws(() => createCodexActionRouter({}), /sessionStore is required/);
});

test('createCodexActionRouter requires provider', () => {
  assert.throws(() => createCodexActionRouter({ sessionStore: {} }), /provider is required/);
});

test('createCodexActionRouter requires core', () => {
  assert.throws(
    () => createCodexActionRouter({ sessionStore: {}, provider: {} }),
    /core is required/,
  );
});

test('runAction throws on unknown issue when not bound', async () => {
  const store = createMemorySessionStore({});
  const provider = { async listIssueComments() { return []; } };
  const router = createCodexActionRouter({
    sessionStore: store,
    provider,
    core,
    config: { repository: 'owner/repo' },
  });

  try {
    await router.runAction('sync-ledger');
    assert.fail('expected error');
  } catch (error) {
    assert.match(error.message, /当前还没有绑定 Issue/);
  }
});

test('runAction throws on unsupported action', async () => {
  const router = createCodexActionRouter({
    sessionStore: createMemorySessionStore({ issueNumber: 1 }),
    provider: {},
    core,
    config: { repository: 'owner/repo' },
  });

  try {
    await router.runAction('unknown-action');
    assert.fail('expected error');
  } catch (error) {
    assert.match(error.message, /unsupported action/);
  }
});

test('writeTaskAction throws without taskId', async () => {
  const comments = [];
  const router = createCodexActionRouter({
    sessionStore: createMemorySessionStore({ issueNumber: 1 }),
    provider: {
      async createIssueComment(owner, repo, issueNumber, body) {
        comments.push({ body });
        return { id: 1 };
      },
    },
    core,
    config: { repository: 'owner/repo' },
  });

  try {
    await router.runAction('accept-task', {});
    assert.fail('expected error');
  } catch (error) {
    assert.match(error.message, /requires taskId/);
  }
});
