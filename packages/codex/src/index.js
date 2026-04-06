import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const DEFAULT_REPO_CONFIG = {
  repository: '',
  defaultBranch: 'main',
  requiredChecks: [],
  taskLinkStyle: 'comment-block',
  acceptanceMode: 'manual',
};

async function defaultResolveGitCommonDir({ cwd }) {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--git-common-dir'], { cwd });
    const trimmed = String(stdout).trim();
    if (trimmed) {
      return path.resolve(cwd, trimmed);
    }
  } catch {
    // ignore and fall through
  }

  return path.resolve(cwd, '.git');
}

export async function loadRepoConfig(cwd = process.cwd(), options = {}) {
  const { fs: fsModule = fs } = options;
  const configPath = path.resolve(cwd, 'gh-superpowers.config.json');
  try {
    const raw = await fsModule.readFile(configPath, 'utf8');
    return {
      ...DEFAULT_REPO_CONFIG,
      ...JSON.parse(raw),
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { ...DEFAULT_REPO_CONFIG };
    }
    throw error;
  }
}

export function createSessionStore({
  cwd = process.cwd(),
  resolveGitCommonDir = defaultResolveGitCommonDir,
  fs: fsModule = fs,
} = {}) {
  let cachedPaths = null;

  async function resolvePaths() {
    if (cachedPaths) {
      return cachedPaths;
    }

    const gitCommonDir = await resolveGitCommonDir({ cwd });
    cachedPaths = {
      dir: path.join(gitCommonDir, 'gh-superpowers'),
      file: path.join(gitCommonDir, 'gh-superpowers', 'gh-superpowers-session.json'),
    };
    return cachedPaths;
  }

  async function readState() {
    const { file } = await resolvePaths();
    try {
      const raw = await fsModule.readFile(file, 'utf8');
      return JSON.parse(raw);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return {};
      }
      throw error;
    }
  }

  async function writeState(state) {
    const { dir, file } = await resolvePaths();
    await fsModule.mkdir(dir, { recursive: true });
    await fsModule.writeFile(file, JSON.stringify(state, null, 2), 'utf8');
    return state;
  }

  async function updateState(mutator) {
    const current = await readState();
    return writeState(mutator(current));
  }

  return {
    async getState() {
      return readState();
    },
    async bindIssue(issueNumber) {
      return updateState((state) => ({
        ...state,
        issueNumber: Number(issueNumber),
        lastBoundIssueAt: new Date().toISOString(),
      }));
    },
    async setPlanVersion(planVersion) {
      return updateState((state) => ({
        ...state,
        planVersion,
      }));
    },
    async recordAction(action, payload = {}) {
      return updateState((state) => ({
        ...state,
        actions: [
          ...(Array.isArray(state.actions) ? state.actions : []),
          {
            action,
            payload,
            timestamp: new Date().toISOString(),
          },
        ],
      }));
    },
  };
}

const NATURAL_LANGUAGE_PATTERNS = [
  {
    pattern: /^绑定(?:到)?\s*#(\d+)$/,
    action: 'bind-issue',
    payload: (match) => ({ issueNumber: Number(match[1]) }),
  },
  { pattern: /^发布当前计划$/, action: 'publish-plan', payload: () => ({}) },
  { pattern: /^同步(?:任务)?账本$/, action: 'sync-ledger', payload: () => ({}) },
  { pattern: /^显示账本$/, action: 'show-ledger', payload: () => ({}) },
  {
    pattern: /^验收\s+(T\d+)$/i,
    action: 'accept-task',
    payload: (match) => ({ taskId: match[1].toUpperCase() }),
  },
  {
    pattern: /^阻塞\s+(T\d+)(?:[:：]\s*(.+))?$/i,
    action: 'block-task',
    payload: (match) => ({
      taskId: match[1].toUpperCase(),
      reason: match[2] ? match[2].trim() : undefined,
    }),
  },
  {
    pattern: /^解除阻塞\s+(T\d+)$/i,
    action: 'unblock-task',
    payload: (match) => ({ taskId: match[1].toUpperCase() }),
  },
  {
    pattern: /^丢弃\s+(T\d+)$/i,
    action: 'drop-task',
    payload: (match) => ({ taskId: match[1].toUpperCase() }),
  },
];

export function routeNaturalLanguage(text = '') {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) {
    return null;
  }

  for (const entry of NATURAL_LANGUAGE_PATTERNS) {
    const match = trimmed.match(entry.pattern);
    if (match) {
      return {
        action: entry.action,
        payload: entry.payload(match),
      };
    }
  }

  return null;
}

export function createCodexActionRouter({
  sessionStore,
  provider,
  core,
  config = {},
  loadPlanText,
  now = () => new Date(),
} = {}) {
  if (!sessionStore) {
    throw new Error('sessionStore is required');
  }
  if (!provider) {
    throw new Error('provider is required');
  }
  if (!core) {
    throw new Error('core is required');
  }

  async function resolveIssueNumber(explicitIssueNumber) {
    if (explicitIssueNumber) {
      return Number(explicitIssueNumber);
    }
    const state = await sessionStore.getState();
    if (!state.issueNumber) {
      throw new Error('当前还没有绑定 Issue');
    }
    return Number(state.issueNumber);
  }

  async function resolvePlanVersion(explicitPlanVersion) {
    if (explicitPlanVersion) {
      return explicitPlanVersion;
    }
    const state = await sessionStore.getState();
    if (!state.planVersion) {
      throw new Error('当前还没有 planVersion');
    }
    return state.planVersion;
  }

  function parseRepository() {
    const [owner, repo] = String(config.repository ?? '').split('/');
    if (!owner || !repo) {
      throw new Error('repository 配置缺失或无效');
    }
    return { owner, repo };
  }

  async function resolvePlanText(payload, issueNumber, planVersion) {
    if (payload?.planText) {
      return payload.planText;
    }
    if (typeof loadPlanText === 'function') {
      return await loadPlanText();
    }

    const { owner, repo } = parseRepository();
    const comments = await provider.listIssueComments(owner, repo, issueNumber);
    const planComment = comments
      .map((comment) => core.parseManagedComment(comment.body))
      .find((parsed) => parsed?.metadata.kind === 'plan' && parsed.metadata.version === planVersion);

    if (!planComment) {
      throw new Error('找不到当前 plan 评论');
    }
    return planComment.body;
  }

  function buildFactsFromGitHub(comments, pullRequests) {
    const facts = [];

    for (const comment of comments) {
      const actions = core.parseTaskActions(comment.body);
      for (const action of actions) {
        facts.push({
          kind: 'action',
          action: action.action,
          taskId: action.task,
          description: action.reason || 'issue comment action',
        });
      }

      const links = core.parseTaskLinks(comment.body);
      for (const link of links) {
        for (const taskId of link.tasks ?? []) {
          facts.push({
            kind: 'work',
            taskId,
            description: 'issue comment link',
          });
        }
      }
    }

    for (const pullRequest of pullRequests) {
      const links = new Set(pullRequest.tasks ?? []);
      for (const taskId of links) {
        facts.push({
          kind: 'binding',
          taskId,
          description: `PR #${pullRequest.number}`,
        });
        facts.push({
          kind: 'implementation',
          taskId,
          description: `PR #${pullRequest.number} ${pullRequest.title}`,
        });
      }

      // 从 PR 的 commits 中提取 task-links
      for (const commit of pullRequest.commits ?? []) {
        const commitLinks = core.parseTaskLinks(commit.message);
        for (const link of commitLinks) {
          for (const taskId of link.tasks ?? []) {
            links.add(taskId);
            facts.push({
              kind: 'commit',
              taskId,
              description: `commit ${commit.sha.slice(0, 7)} ${commit.message.split('\n')[0]}`,
            });
          }
        }
      }

      for (const check of pullRequest.checks ?? []) {
        for (const taskId of links.size > 0 ? links : check.tasks ?? []) {
          facts.push({
            kind: 'check',
            taskId,
            checkName: check.name,
            status: check.conclusion || check.status,
            description: check.name,
          });
        }
      }

      for (const review of pullRequest.reviews ?? []) {
        // Extract task-links from review body (Section 六.3)
        const reviewLinks = core.parseTaskLinks(review.body ?? '');
        for (const link of reviewLinks) {
          for (const taskId of link.tasks ?? []) {
            links.add(taskId);
            facts.push({
              kind: 'binding',
              taskId,
              description: `review #${review.id}`,
            });
          }
        }

        const blocking = ['CHANGES_REQUESTED', 'REQUEST_CHANGES', 'BLOCKED'].includes(
          String(review.state ?? '').toUpperCase(),
        );
        if (!blocking) {
          continue;
        }
        for (const taskId of links.size > 0 ? links : review.tasks ?? []) {
          facts.push({
            kind: 'action',
            action: 'block',
            taskId,
            description: review.body || 'review blocked',
          });
        }
      }

      // Extract task-links from individual review comments (line-level)
      for (const reviewComment of pullRequest.reviewComments ?? []) {
        const rcLinks = core.parseTaskLinks(reviewComment.body ?? '');
        for (const link of rcLinks) {
          for (const taskId of link.tasks ?? []) {
            links.add(taskId);
            facts.push({
              kind: 'binding',
              taskId,
              description: `review-comment #${reviewComment.id}`,
            });
          }
        }
      }
    }

    return facts;
  }

  async function publishPlan(payload = {}) {
    const issueNumber = await resolveIssueNumber(payload.issueNumber);
    const planText = await resolvePlanText(payload, issueNumber, null);
    const tasks = core.extractTasksFromPlan(planText);
    const planVersion = payload.planVersion ?? createPlanVersion(now());
    const { owner, repo } = parseRepository();
    const planComment = core.renderManagedComment({ kind: 'plan', issue: issueNumber, version: planVersion }, planText);
    await provider.upsertManagedIssueComment(owner, repo, issueNumber, planComment, `plan:${planVersion}`);

    const snapshot = core.buildLedgerSnapshot({
      issueNumber,
      planVersion,
      tasks,
      facts: [],
      requiredChecks: config.requiredChecks ?? [],
    });
    const ledgerComment = core.renderManagedComment(
      { kind: 'ledger', issue: issueNumber, planVersion },
      core.renderLedger(snapshot),
    );
    await provider.upsertManagedIssueComment(owner, repo, issueNumber, ledgerComment, `ledger:${planVersion}`);
    await sessionStore.setPlanVersion(planVersion);

    return {
      issueNumber,
      planVersion,
      tasks,
      snapshot,
    };
  }

  async function syncLedger(payload = {}) {
    const issueNumber = await resolveIssueNumber(payload.issueNumber);
    const planVersion = await resolvePlanVersion(payload.planVersion);
    const planText = await resolvePlanText(payload, issueNumber, planVersion);
    const tasks = core.extractTasksFromPlan(planText);
    const { owner, repo } = parseRepository();
    const comments = await provider.listIssueComments(owner, repo, issueNumber);
    const linkedPullRequests = await provider.listLinkedPullRequests(owner, repo, issueNumber);
    const pullRequests = await Promise.all(
      linkedPullRequests.map(async (pullRequest) => {
        const prDetail = await provider.getPullRequest(owner, repo, pullRequest.number);
        const prBodyTasks = new Set();
        const bodyLinks = core.parseTaskLinks(prDetail.body ?? '');
        for (const link of bodyLinks) {
          for (const taskId of link.tasks ?? []) {
            prBodyTasks.add(taskId);
          }
        }
        const reviewComments = provider.listPullRequestReviewComments
          ? await provider.listPullRequestReviewComments(owner, repo, pullRequest.number)
          : [];
        return {
          ...pullRequest,
          tasks: [...prBodyTasks],
          body: prDetail.body ?? '',
          commits: await provider.listPullRequestCommits(owner, repo, pullRequest.number),
          checks: await provider.listPullRequestChecks(owner, repo, pullRequest.number),
          reviews: await provider.listPullRequestReviews(owner, repo, pullRequest.number),
          reviewComments,
        };
      }),
    );

    const facts = buildFactsFromGitHub(comments, pullRequests);
    const snapshot = core.buildLedgerSnapshot({
      issueNumber,
      planVersion,
      tasks,
      facts,
      requiredChecks: config.requiredChecks ?? [],
    });
    const ledgerComment = core.renderManagedComment(
      { kind: 'ledger', issue: issueNumber, planVersion },
      core.renderLedger(snapshot),
    );
    await provider.upsertManagedIssueComment(owner, repo, issueNumber, ledgerComment, `ledger:${planVersion}`);

    return snapshot;
  }

  async function showLedger(payload = {}) {
    const issueNumber = await resolveIssueNumber(payload.issueNumber);
    const planVersion = await resolvePlanVersion(payload.planVersion);
    const { owner, repo } = parseRepository();
    const comments = await provider.listIssueComments(owner, repo, issueNumber);
    const ledgerComment = comments
      .map((comment) => core.parseManagedComment(comment.body))
      .find((parsed) => parsed?.metadata.kind === 'ledger' && parsed.metadata.planVersion === planVersion);

    return ledgerComment?.body ?? null;
  }

  async function writeTaskAction(action, payload = {}) {
    if (!payload.taskId) {
      throw new Error(`${action} requires taskId`);
    }

    const issueNumber = await resolveIssueNumber(payload.issueNumber);
    const { owner, repo } = parseRepository();
    const comment = renderTaskActionComment(action, payload.taskId, payload.reason);
    await sessionStore.recordAction(action, payload);
    await provider.createIssueComment(owner, repo, issueNumber, comment);

    // After writing the action, update the ledger to reflect the new state
    try {
      const planVersion = await resolvePlanVersion(payload.planVersion);
      const planText = await resolvePlanText({ issueNumber, planVersion }, issueNumber, planVersion);
      const tasks = core.extractTasksFromPlan(planText);
      const comments = await provider.listIssueComments(owner, repo, issueNumber);
      const linkedPullRequests = await provider.listLinkedPullRequests(owner, repo, issueNumber);
      const pullRequests = await Promise.all(
        linkedPullRequests.map(async (pullRequest) => {
          const prDetail = await provider.getPullRequest(owner, repo, pullRequest.number);
          const prBodyTasks = new Set();
          const bodyLinks = core.parseTaskLinks(prDetail.body ?? '');
          for (const link of bodyLinks) {
            for (const taskId of link.tasks ?? []) {
              prBodyTasks.add(taskId);
            }
          }
          const reviewComments = provider.listPullRequestReviewComments
            ? await provider.listPullRequestReviewComments(owner, repo, pullRequest.number)
            : [];
          return {
            ...pullRequest,
            tasks: [...prBodyTasks],
            body: prDetail.body ?? '',
            commits: await provider.listPullRequestCommits(owner, repo, pullRequest.number),
            checks: await provider.listPullRequestChecks(owner, repo, pullRequest.number),
            reviews: await provider.listPullRequestReviews(owner, repo, pullRequest.number),
            reviewComments,
          };
        }),
      );
      const facts = buildFactsFromGitHub(comments, pullRequests);
      const snapshot = core.buildLedgerSnapshot({
        issueNumber,
        planVersion,
        tasks,
        facts,
        requiredChecks: config.requiredChecks ?? [],
      });
      const ledgerComment = core.renderManagedComment(
        { kind: 'ledger', issue: issueNumber, planVersion },
        core.renderLedger(snapshot),
      );
      await provider.upsertManagedIssueComment(owner, repo, issueNumber, ledgerComment, `ledger:${planVersion}`);
    } catch {
      // If ledger update fails, the action comment is still written
    }
  }

  return {
    async runAction(actionOrRequest, payload = {}) {
      const request =
        typeof actionOrRequest === 'string' ? { action: actionOrRequest, payload } : actionOrRequest;

      switch (request.action) {
        case 'bind-issue':
          return sessionStore.bindIssue(request.payload.issueNumber);
        case 'publish-plan':
          return publishPlan(request.payload);
        case 'sync-ledger':
          return syncLedger(request.payload);
        case 'show-ledger':
          return showLedger(request.payload);
        case 'accept-task':
        case 'block-task':
        case 'unblock-task':
        case 'drop-task':
          return writeTaskAction(request.action, request.payload);
        default:
          throw new Error(`unsupported action ${request.action}`);
      }
    },
  };
}

function createPlanVersion(date) {
  return `v${date.toISOString().replace(/[-:]/g, '').replace('.000', '')}`;
}

function renderTaskActionComment(action, taskId, reason) {
  const normalizedAction = action.replace('-task', '');
  const payload = {
    action: normalizedAction,
    task: taskId,
    ...(reason ? { reason } : {}),
  };

  const lines = [`<!-- gh-superpowers:task-action ${JSON.stringify(payload)} -->`];
  if (reason) {
    lines.push(reason);
  }
  return lines.join('\n');
}
