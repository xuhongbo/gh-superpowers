const MANAGED_COMMENT_MARKER = (tag) => `<!-- managed:${tag} -->`;

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
  const idValue = typeof payload.databaseId === 'number' ? payload.databaseId : Number(payload.id);
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
    const managedBody = ensureMarker(body, marker);
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
    const data = await this.viewIssue(owner, repo, issueNumber, ['comments']);
    const nodes = (data.comments?.nodes ?? []) || [];
    return nodes.map(normalizeComment);
  }

  async createIssueComment(owner, repo, issueNumber, body) {
    const stdout = await this.runGh([
      'api',
      `repos/${owner}/${repo}/issues/${issueNumber}/comments`,
      '--method',
      'POST',
      '-f',
      `body=${body}`,
    ]);
    return normalizeComment(JSON.parse(stdout));
  }

  async upsertManagedIssueComment(owner, repo, issueNumber, body, uniqueTag) {
    const marker = MANAGED_COMMENT_MARKER(uniqueTag);
    const managedBody = ensureMarker(body, marker);
    const comments = await this.listIssueComments(owner, repo, issueNumber);
    const existing = comments.find((comment) => comment.body.includes(marker));
    if (existing) {
      return this.updateComment(owner, repo, existing.id, managedBody);
    }
    return this.createIssueComment(owner, repo, issueNumber, managedBody);
  }

  async listLinkedPullRequests(owner, repo, issueNumber) {
    const data = await this.viewIssue(owner, repo, issueNumber, ['linkedPullRequests']);
    const nodes = (data.linkedPullRequests?.nodes ?? []) || [];
    return nodes.map((node) => ({
      number: typeof node.number === 'number' ? node.number : Number(node.number),
      title: node.title ?? '',
      url: node.url ?? '',
      state: node.state ?? undefined,
    }));
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
      '-f',
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
