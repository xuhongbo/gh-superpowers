import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createGitHubProvider, GitHubMcpProvider, GhCliGitHubProvider } from '../../packages/github/src/index.js';

class StubRunner {
  constructor(responses = []) {
    this.responses = [...responses];
    this.calls = [];
  }

  async run(args) {
    this.calls.push(args);
    const index = this.responses.findIndex((response) => response.matches(args));
    if (index === -1) {
      throw new Error(`Unexpected gh args: ${JSON.stringify(args)}`);
    }
    const [response] = this.responses.splice(index, 1);
    return response.result;
  }
}

class StubMcpClient {
  constructor(responses = []) {
    this.responses = [...responses];
    this.calls = [];
  }

  async request(params) {
    const call = { method: (params.method ?? 'GET').toUpperCase(), path: params.path, body: params.body };
    this.calls.push(call);
    const index = this.responses.findIndex((response) => response.matches(call));
    if (index === -1) {
      throw new Error(`Unexpected MCP request: ${JSON.stringify(call)}`);
    }
    const [response] = this.responses.splice(index, 1);
    return { status: response.status ?? 200, result: response.result };
  }
}

const matchIssueView = (owner, repo, issueNumber, fields) => (args) => {
  const expected = ['issue', 'view', issueNumber.toString(), '--repo', `${owner}/${repo}`, '--json', fields.join(',')];
  return args.length === expected.length && args.every((value, index) => value === expected[index]);
};

const matchPullRequestView = (owner, repo, pullNumber, fields) => (args) => {
  const expected = ['pr', 'view', pullNumber.toString(), '--repo', `${owner}/${repo}`, '--json', fields.join(',')];
  return args.length === expected.length && args.every((value, index) => value === expected[index]);
};

const matchApi = (path, method) => (args) =>
  args.length >= 4 &&
  args[0] === 'api' &&
  args[1] === path &&
  args.includes('--method') &&
  args.includes(method);

const matchMcpRequest = (path, method = 'GET') => (call) => call.path === path && call.method === method;

describe('GitHub provider detection', () => {
  it('prefers MCP when available', async () => {
    const runner = new StubRunner();
    const mcp = new StubMcpClient([
      {
        matches: matchMcpRequest('/repos/example/proj/issues/5'),
        result: { number: 5, title: 'Plan', body: 'details', state: 'open', url: 'https://github.com/example/proj/issues/5' },
      },
    ]);

    const provider = createGitHubProvider({ runner, mcpClient: mcp });
    assert(provider instanceof GitHubMcpProvider);
    const issue = await provider.getIssue('example', 'proj', 5);

    assert.strictEqual(issue.number, 5);
    assert.strictEqual(runner.calls.length, 0);
    assert.strictEqual(mcp.calls.length, 1);
  });

  it('falls back to gh runner when MCP client missing', async () => {
    const runner = new StubRunner([
      {
        matches: matchIssueView('example', 'proj', 12, ['number', 'title', 'body', 'state', 'url']),
        result: {
          exitCode: 0,
          stdout: JSON.stringify({
            number: 12,
            title: 'Fallback',
            body: 'gh path',
            state: 'open',
            url: 'https://github.com/example/proj/issues/12',
          }),
        },
      },
    ]);

    const provider = createGitHubProvider({ runner });
    assert(provider instanceof GhCliGitHubProvider);
    const issue = await provider.getIssue('example', 'proj', 12);

    assert.strictEqual(issue.number, 12);
    assert.strictEqual(runner.calls.length, 1);
  });
});

describe('GhCliGitHubProvider', () => {
  it('upserts a managed comment by creating when missing', async () => {
    const runner = new StubRunner([
      {
        matches: matchIssueView('example', 'proj', 50, ['comments']),
        result: {
          exitCode: 0,
          stdout: JSON.stringify({ comments: { nodes: [] } }),
        },
      },
      {
        matches: matchApi('repos/example/proj/issues/50/comments', 'POST'),
        result: {
          exitCode: 0,
          stdout: JSON.stringify({ id: 101, body: 'result', created_at: '2026-04-01T00:00:00Z' }),
        },
      },
    ]);

    const provider = new GhCliGitHubProvider(runner);
    const marker = '<!-- managed:foo -->';
    const comment = await provider.upsertManagedIssueComment('example', 'proj', 50, 'hello', 'foo');

    assert.strictEqual(comment.id, 101);
    assert.strictEqual(runner.calls.length, 2);
    const createCall = runner.calls[1];
    const bodyArg = createCall.find((arg) => arg.startsWith('body='));
    assert(bodyArg?.includes(marker));
  });

  it('upserts a managed comment by patching existing entry', async () => {
    const runner = new StubRunner([
      {
        matches: matchIssueView('example', 'proj', 60, ['comments']),
        result: {
          exitCode: 0,
          stdout: JSON.stringify({
            comments: {
              nodes: [
                { databaseId: 200, body: 'old<!-- managed:foo -->', author: { login: 'bot' } },
              ],
            },
          }),
        },
      },
      {
        matches: matchApi('repos/example/proj/issues/comments/200', 'PATCH'),
        result: {
          exitCode: 0,
          stdout: JSON.stringify({ id: 200, body: 'updated', author: { login: 'bot' } }),
        },
      },
    ]);

    const provider = new GhCliGitHubProvider(runner);
    await provider.upsertManagedIssueComment('example', 'proj', 60, 'updated', 'foo');

    const updateCall = runner.calls.find((call) => call.includes('--method') && call.includes('PATCH'));
    assert(updateCall, 'expected PATCH call to run');
    const bodyArg = updateCall?.find((arg) => arg.startsWith('body='));
    assert(bodyArg?.includes('updated'));
    assert(bodyArg?.includes('<!-- managed:foo -->'));
  });

  it('gets full pull request details including body', async () => {
    const runner = new StubRunner([
      {
        matches: matchPullRequestView('example', 'proj', 10, ['number', 'title', 'body', 'state', 'url']),
        result: {
          exitCode: 0,
          stdout: JSON.stringify({
            number: 10,
            title: 'Implement task links',
            body: 'Implementation\n<!-- gh-superpowers:task-links {"tasks":["T1","T2"]} -->',
            state: 'open',
            url: 'https://github.com/example/proj/pull/10',
          }),
        },
      },
    ]);

    const provider = new GhCliGitHubProvider(runner);
    const pr = await provider.getPullRequest('example', 'proj', 10);

    assert.strictEqual(pr.number, 10);
    assert.strictEqual(pr.title, 'Implement task links');
    assert(pr.body.includes('task-links'));
    assert(pr.body.includes('T1'));
    assert(pr.body.includes('T2'));
  });

  it('lists pull request checks with gh pr view + check-runs', async () => {
    const runner = new StubRunner([
      {
        matches: matchPullRequestView('example', 'proj', 8, ['headRefOid']),
        result: {
          exitCode: 0,
          stdout: JSON.stringify({ headRefOid: 'abcdef' }),
        },
      },
      {
        matches: matchApi('repos/example/proj/commits/abcdef/check-runs', 'GET'),
        result: {
          exitCode: 0,
          stdout: JSON.stringify({
            check_runs: [
              { name: 'ci', status: 'completed', conclusion: 'success', html_url: 'https://example.com/run' },
            ],
          }),
        },
      },
    ]);

    const provider = new GhCliGitHubProvider(runner);
    const checks = await provider.listPullRequestChecks('example', 'proj', 8);

    assert.deepStrictEqual(checks, [
      { name: 'ci', status: 'completed', conclusion: 'success', url: 'https://example.com/run' },
    ]);
  });

  it('lists pull request reviews with gh api', async () => {
    const runner = new StubRunner([
      {
        matches: matchApi('repos/example/proj/pulls/9/reviews', 'GET'),
        result: {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              id: 300,
              body: 'Looks good',
              state: 'APPROVED',
              submitted_at: '2026-04-01T00:00:00Z',
              user: { login: 'reviewer' },
              html_url: 'https://github.com/example/proj/pull/9#review-300',
            },
          ]),
        },
      },
    ]);

    const provider = new GhCliGitHubProvider(runner);
    const reviews = await provider.listPullRequestReviews('example', 'proj', 9);

    assert.deepStrictEqual(reviews, [
      {
        id: 300,
        author: 'reviewer',
        state: 'APPROVED',
        body: 'Looks good',
        submittedAt: '2026-04-01T00:00:00Z',
        url: 'https://github.com/example/proj/pull/9#review-300',
      },
    ]);
  });
});

describe('GitHubMcpProvider', () => {
  it('lists pull request checks via MCP client', async () => {
    const client = new StubMcpClient([
      {
        matches: matchMcpRequest('/repos/example/proj/pulls/8'),
        result: { head: { sha: 'abcdef' } },
      },
      {
        matches: matchMcpRequest('/repos/example/proj/commits/abcdef/check-runs'),
        result: {
          check_runs: [
            { name: 'ci', status: 'completed', conclusion: 'success', html_url: 'https://example.com/run' },
          ],
        },
      },
      {
        matches: matchMcpRequest('/repos/example/proj/pulls/8/reviews'),
        result: [
          {
            id: 301,
            body: 'LGTM',
            state: 'COMMENTED',
            submitted_at: '2026-04-02T00:00:00Z',
            user: { login: 'mcp-reviewer' },
            html_url: 'https://github.com/example/proj/pull/8#review-301',
          },
        ],
      },
    ]);

    const provider = new GitHubMcpProvider(client);
    const checks = await provider.listPullRequestChecks('example', 'proj', 8);
    const reviews = await provider.listPullRequestReviews('example', 'proj', 8);

    assert.deepStrictEqual(checks, [
      { name: 'ci', status: 'completed', conclusion: 'success', url: 'https://example.com/run' },
    ]);
    assert.deepStrictEqual(reviews, [
      {
        id: 301,
        author: 'mcp-reviewer',
        state: 'COMMENTED',
        body: 'LGTM',
        submittedAt: '2026-04-02T00:00:00Z',
        url: 'https://github.com/example/proj/pull/8#review-301',
      },
    ]);
    assert.strictEqual(client.calls.length, 3);
  });

  it('lists linked pull requests via MCP search API', async () => {
    const client = new StubMcpClient([
      {
        matches: (call) => call.path.startsWith('/search/issues?q=is%3Apr'),
        result: {
          items: [
            { number: 15, title: 'Fix auth bug', html_url: 'https://github.com/example/proj/pull/15', state: 'open' },
            { number: 20, title: 'Add tests', html_url: 'https://github.com/example/proj/pull/20', state: 'closed' },
          ],
        },
      },
    ]);

    const provider = new GitHubMcpProvider(client);
    const prs = await provider.listLinkedPullRequests('example', 'proj', 42);

    assert.strictEqual(prs.length, 2);
    assert.strictEqual(prs[0].number, 15);
    assert.strictEqual(prs[0].title, 'Fix auth bug');
    assert.strictEqual(prs[1].number, 20);
  });

  it('creates and lists issue comments via MCP', async () => {
    const client = new StubMcpClient([
      {
        matches: matchMcpRequest('/repos/example/proj/issues/10/comments', 'GET'),
        result: [],
      },
      {
        matches: matchMcpRequest('/repos/example/proj/issues/10/comments', 'POST'),
        result: { id: 500, body: 'hello comment', created_at: '2026-04-06T00:00:00Z' },
      },
    ]);

    const provider = new GitHubMcpProvider(client);
    const comments = await provider.listIssueComments('example', 'proj', 10);
    assert.deepStrictEqual(comments, []);

    const created = await provider.createIssueComment('example', 'proj', 10, 'hello comment');
    assert.strictEqual(created.id, 500);
    assert.strictEqual(created.body, 'hello comment');
  });

  it('lists pull request commits via MCP', async () => {
    const client = new StubMcpClient([
      {
        matches: matchMcpRequest('/repos/example/proj/pulls/5/commits'),
        result: [
          {
            sha: 'abc1234',
            commit: { message: 'fix: resolve auth bug\n<!-- gh-superpowers:task-links {"tasks":["T1"]} -->', author: { name: 'dev' } },
            html_url: 'https://github.com/example/proj/commit/abc1234',
          },
        ],
      },
    ]);

    const provider = new GitHubMcpProvider(client);
    const commits = await provider.listPullRequestCommits('example', 'proj', 5);

    assert.strictEqual(commits.length, 1);
    assert.strictEqual(commits[0].sha, 'abc1234');
    assert(commits[0].message.includes('auth bug'));
  });

  it('gets full pull request details including body', async () => {
    const client = new StubMcpClient([
      {
        matches: matchMcpRequest('/repos/example/proj/pulls/10'),
        result: {
          number: 10,
          title: 'Implement task links',
          body: 'Implementation details\n<!-- gh-superpowers:task-links {"tasks":["T1","T2"]} -->',
          state: 'open',
          html_url: 'https://github.com/example/proj/pull/10',
        },
      },
    ]);

    const provider = new GitHubMcpProvider(client);
    const pr = await provider.getPullRequest('example', 'proj', 10);

    assert.strictEqual(pr.number, 10);
    assert.strictEqual(pr.title, 'Implement task links');
    assert(pr.body.includes('task-links'));
    assert(pr.body.includes('T1'));
    assert(pr.body.includes('T2'));
  });
});
