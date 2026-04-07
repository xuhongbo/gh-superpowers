// Embed a hidden unique marker in managed comments for upsert detection.
// The marker is placed as an HTML comment that won't render but is searchable.
const MANAGED_COMMENT_MARKER = (tag) => `<!-- sp-tag:${tag} -->`;

function normalizeIssue(payload = {}, fallbackNumber) {
  const numberValue = typeof payload.number === 'number' ? payload.number : Number(payload.number);
  return {
    number: Number.isFinite(numberValue) ? numberValue : fallbackNumber,
    title: payload.title ?? '',
    body: payload.body ?? '',
    state: payload.state ?? undefined,
    url: payload.url ?? payload.html_url ?? '',
  };
}

function normalizeComment(payload = {}) {
  // gh issue view returns string id (node ID) and numeric databaseId.
  // MCP REST API returns numeric id directly.
  const idValue = typeof payload.databaseId === 'number'
    ? payload.databaseId
    : typeof payload.id === 'number'
      ? payload.id
      : Number(payload.id);
  return {
    id: Number.isFinite(idValue) ? idValue : 0,
    body: payload.body ?? payload.body_text ?? '',
    author: payload.author?.login ?? payload.user?.login ?? undefined,
    createdAt: payload.createdAt ?? payload.created_at ?? undefined,
    url: payload.url ?? payload.html_url ?? undefined,
  };
}

function normalizeCheck(payload = {}) {
  return {
    name: payload.name ?? '',
    status: payload.status ?? 'unknown',
    conclusion: payload.conclusion ?? undefined,
    url: payload.html_url ?? payload.htmlUrl ?? undefined,
  };
}

function normalizeReview(payload = {}) {
  const idValue = typeof payload.id === 'number' ? payload.id : Number(payload.id);
  return {
    id: Number.isFinite(idValue) ? idValue : 0,
    author: payload.user?.login ?? undefined,
    state: payload.state ?? undefined,
    body: payload.body ?? '',
    submittedAt: payload.submitted_at ?? payload.submittedAt ?? undefined,
    url: payload.html_url ?? payload.htmlUrl ?? undefined,
  };
}

function normalizeCommit(payload = {}) {
  return {
    sha: payload.sha ?? payload.oid ?? payload.id ?? '',
    message: payload.commit?.message ?? payload.message ?? '',
    author: payload.commit?.author?.name ?? payload.author?.login ?? payload.commit?.author?.name ?? undefined,
    url: payload.html_url ?? payload.url ?? '',
  };
}

function ensureMarker(body, marker) {
  if (body.includes(marker)) {
    return body;
  }
  return `${body}\n${marker}`;
}

export function createGitHubProvider(options = {}) {
  const { runner, mcpClient, type } = options;
  if (type === 'mcp' || (type !== 'gh' && mcpClient)) {
    if (!mcpClient) {
      throw new Error('MCP client is required for MCP provider');
    }
    return new GitHubMcpProvider(mcpClient);
  }
  if (!runner) {
    throw new Error('GitHub runner is required for gh provider');
  }
  return new GhCliGitHubProvider(runner);
}

export class GitHubMcpProvider {
  constructor(client) {
    if (!client || typeof client.request !== 'function') {
      throw new Error('MCP client is required');
    }
    this.client = client;
  }

  async getIssue(owner, repo, issueNumber) {
    const data = await this.call({ path: `/repos/${owner}/${repo}/issues/${issueNumber}` });
    return normalizeIssue(data, issueNumber);
  }

  async listIssueComments(owner, repo, issueNumber) {
    const data = await this.call({ path: `/repos/${owner}/${repo}/issues/${issueNumber}/comments` });
    const comments = Array.isArray(data)
      ? data
      : data?.comments ?? data?.nodes ?? data?.result ?? [];
    return comments.map(normalizeComment);
  }

  async createIssueComment(owner, repo, issueNumber, body) {
    const data = await this.call({
      path: `/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
      method: 'POST',
      body: { body },
    });
    return normalizeComment(data);
  }

  async updateIssueComment(owner, repo, commentId, body) {
    const data = await this.call({
      path: `/repos/${owner}/${repo}/issues/comments/${commentId}`,
      method: 'PATCH',
      body: { body },
    });
    return normalizeComment(data);
  }

  async upsertManagedIssueComment(owner, repo, issueNumber, body, uniqueTag) {
    const marker = MANAGED_COMMENT_MARKER(uniqueTag);
    const managedBody = `${marker}\n${body}`;
    const comments = await this.listIssueComments(owner, repo, issueNumber);
    const existing = comments.find((comment) => comment.body.includes(marker));
    if (existing) {
      return this.updateIssueComment(owner, repo, existing.id, managedBody);
    }
    return this.createIssueComment(owner, repo, issueNumber, managedBody);
  }

  async listLinkedPullRequests(owner, repo, issueNumber) {
    const query = `is:pr repo:${owner}/${repo} #${issueNumber}`;
    const data = await this.call({
      path: `/search/issues?q=${encodeURIComponent(query)}&per_page=100`,
    });
    const items = Array.isArray(data) ? data : data?.items ?? [];
    return items.map((item) => ({
      number: item.number,
      title: item.title ?? '',
      url: item.html_url ?? item.url ?? '',
      state: item.state ?? undefined,
    }));
  }

  async getPullRequest(owner, repo, pullNumber) {
    const data = await this.call({ path: `/repos/${owner}/${repo}/pulls/${pullNumber}` });
    return {
      number: data.number,
      title: data.title ?? '',
      body: data.body ?? '',
      state: data.state ?? undefined,
      url: data.html_url ?? data.url ?? '',
    };
  }

  async listPullRequestChecks(owner, repo, pullNumber) {
    const pr = await this.call({ path: `/repos/${owner}/${repo}/pulls/${pullNumber}` });
    const sha = pr?.head?.sha;
    if (!sha) {
      return [];
    }
    const data = await this.call({ path: `/repos/${owner}/${repo}/commits/${sha}/check-runs` });
    const runs = Array.isArray(data) ? data : data?.check_runs ?? [];
    return runs.map(normalizeCheck);
  }

  async listPullRequestReviews(owner, repo, pullNumber) {
    const data = await this.call({ path: `/repos/${owner}/${repo}/pulls/${pullNumber}/reviews` });
    const reviews = Array.isArray(data) ? data : data?.reviews ?? [];
    return reviews.map(normalizeReview);
  }

  async listPullRequestReviewComments(owner, repo, pullNumber) {
    const data = await this.call({ path: `/repos/${owner}/${repo}/pulls/${pullNumber}/comments` });
    const comments = Array.isArray(data) ? data : [];
    return comments.map((c) => ({
      id: c.id ?? 0,
      body: c.body ?? '',
      path: c.path ?? '',
      author: c.user?.login ?? undefined,
    }));
  }

  async listPullRequestCommits(owner, repo, pullNumber) {
    const data = await this.call({ path: `/repos/${owner}/${repo}/pulls/${pullNumber}/commits` });
    const commits = Array.isArray(data) ? data : data?.commits ?? data?.nodes ?? [];
    return commits.map(normalizeCommit);
  }

  async call({ path, method = 'GET', body }) {
    const normalizedMethod = method.toUpperCase();
    const response = await this.client.request({ method: normalizedMethod, path, body });
    if (response.status && response.status >= 400) {
      throw new Error(`MCP request failed: ${normalizedMethod} ${path} -> ${response.status}`);
    }
    return response.result;
  }
}

export class GhCliGitHubProvider {
  constructor(runner) {
    if (!runner || typeof runner.run !== 'function') {
      throw new Error('GitHub runner is required');
    }
    this.runner = runner;
  }

  async getIssue(owner, repo, issueNumber) {
    const data = await this.viewIssue(owner, repo, issueNumber, ['number', 'title', 'body', 'state', 'url']);
    return normalizeIssue(data, issueNumber);
  }

  async listIssueComments(owner, repo, issueNumber) {
    // Use REST API instead of gh issue view --json comments to get proper numeric IDs
    const stdout = await this.runGh([
      'api',
      `repos/${owner}/${repo}/issues/${issueNumber}/comments`,
      '--method',
      'GET',
    ]);
    const data = JSON.parse(stdout);
    const items = Array.isArray(data) ? data : [];
    return items.map(normalizeComment);
  }

  async createIssueComment(owner, repo, issueNumber, body) {
    const stdout = await this.runGh([
      'api',
      `repos/${owner}/${repo}/issues/${issueNumber}/comments`,
      '--method',
      'POST',
      '--field',
      `body=${body}`,
    ]);
    return normalizeComment(JSON.parse(stdout));
  }

  async upsertManagedIssueComment(owner, repo, issueNumber, body, uniqueTag) {
    const marker = MANAGED_COMMENT_MARKER(uniqueTag);
    const managedBody = `${marker}\n${body}`;
    const comments = await this.listIssueComments(owner, repo, issueNumber);
    const existing = comments.find((comment) => comment.body.includes(marker));
    if (existing) {
      return this.updateComment(owner, repo, existing.id, managedBody);
    }
    return this.createIssueComment(owner, repo, issueNumber, managedBody);
  }

  async listLinkedPullRequests(owner, repo, issueNumber) {
    // gh issue view doesn't support linkedPullRequests, so use the GraphQL API
    const query = `query($owner:String!,$repo:String!,$num:Int!){
      repository(owner:$owner,name:$repo){
        issue(number:$num){
          timelineItems(first:20, itemTypes:CONNECTED_EVENT){
            nodes{
              ...on ConnectedEvent{
                subject{
                  ...on PullRequest{number,title,state,url}
                }
              }
            }
          }
        }
      }
    }`;
    try {
      const stdout = await this.runGh([
        'api', 'graphql',
        '-f', `query=${query}`,
        '-F', `owner=${owner}`,
        '-F', `repo=${repo}`,
        '-F', `num=${issueNumber}`,
      ]);
      const data = JSON.parse(stdout);
      const nodes = data?.data?.repository?.issue?.timelineItems?.nodes ?? [];
      return nodes
        .map((node) => node?.subject)
        .filter(Boolean)
        .map((pr) => ({
          number: typeof pr.number === 'number' ? pr.number : Number(pr.number),
          title: pr.title ?? '',
          url: pr.url ?? '',
          state: pr.state ?? undefined,
        }));
    } catch {
      // Fallback: search for PRs mentioning the issue number
      const stdout = await this.runGh([
        'pr', 'list', '--repo', `${owner}/${repo}`,
        '--search', `#${issueNumber}`, '--state', 'all', '--json', 'number,title,state,url',
      ]);
      const data = JSON.parse(stdout);
      return (Array.isArray(data) ? data : []).map((pr) => ({
        number: typeof pr.number === 'number' ? pr.number : Number(pr.number),
        title: pr.title ?? '',
        url: pr.url ?? '',
        state: pr.state ?? undefined,
      }));
    }
  }

  async getPullRequest(owner, repo, pullNumber) {
    const stdout = await this.runGh([
      'pr',
      'view',
      pullNumber.toString(),
      '--repo',
      `${owner}/${repo}`,
      '--json',
      'number,title,body,state,url',
    ]);
    const data = JSON.parse(stdout);
    return {
      number: typeof data.number === 'number' ? data.number : Number(data.number),
      title: data.title ?? '',
      body: data.body ?? '',
      state: data.state ?? undefined,
      url: data.url ?? '',
    };
  }

  async listPullRequestChecks(owner, repo, pullNumber) {
    const prJson = await this.runGh([
      'pr',
      'view',
      pullNumber.toString(),
      '--repo',
      `${owner}/${repo}`,
      '--json',
      'headRefOid',
    ]);
    const { headRefOid } = JSON.parse(prJson);
    if (!headRefOid) {
      return [];
    }
    const checksJson = await this.runGh([
      'api',
      `repos/${owner}/${repo}/commits/${headRefOid}/check-runs`,
      '--method',
      'GET',
    ]);
    const data = JSON.parse(checksJson);
    const runs = Array.isArray(data) ? data : data.check_runs ?? [];
    return runs.map(normalizeCheck);
  }

  async listPullRequestReviews(owner, repo, pullNumber) {
    const stdout = await this.runGh([
      'api',
      `repos/${owner}/${repo}/pulls/${pullNumber}/reviews`,
      '--method',
      'GET',
    ]);
    const data = JSON.parse(stdout);
    const reviews = Array.isArray(data) ? data : data.reviews ?? [];
    return reviews.map(normalizeReview);
  }

  async listPullRequestReviewComments(owner, repo, pullNumber) {
    const stdout = await this.runGh([
      'api',
      `repos/${owner}/${repo}/pulls/${pullNumber}/comments`,
      '--method',
      'GET',
    ]);
    const data = JSON.parse(stdout);
    const comments = Array.isArray(data) ? data : [];
    return comments.map((c) => ({
      id: c.id ?? 0,
      body: c.body ?? '',
      path: c.path ?? '',
      author: c.user?.login ?? undefined,
    }));
  }

  async listPullRequestCommits(owner, repo, pullNumber) {
    const stdout = await this.runGh([
      'api',
      `repos/${owner}/${repo}/pulls/${pullNumber}/commits`,
      '--method',
      'GET',
    ]);
    const data = JSON.parse(stdout);
    const commits = Array.isArray(data) ? data : [];
    return commits.map(normalizeCommit);
  }

  async updateComment(owner, repo, commentId, body) {
    const stdout = await this.runGh([
      'api',
      `repos/${owner}/${repo}/issues/comments/${commentId}`,
      '--method',
      'PATCH',
      '--field',
      `body=${body}`,
    ]);
    return normalizeComment(JSON.parse(stdout));
  }

  async viewIssue(owner, repo, issueNumber, fields) {
    const stdout = await this.runGh([
      'issue',
      'view',
      issueNumber.toString(),
      '--repo',
      `${owner}/${repo}`,
      '--json',
      fields.join(','),
    ]);
    return JSON.parse(stdout);
  }

  async runGh(args) {
    const result = await this.runner.run(args);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr ?? result.stdout ?? 'gh command failed');
    }
    return result.stdout.trim();
  }
}
