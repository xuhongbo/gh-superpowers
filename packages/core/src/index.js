const MANAGED_COMMENT_REGEX = /<!-- gh-superpowers:managed-comment\s+({[\s\S]*?})\s*-->/;
const TASK_LINK_REGEX = /<!-- gh-superpowers:task-links\s+({[\s\S]*?})\s*-->/g;
const TASK_ACTION_REGEX = /<!-- gh-superpowers:task-action\s+({[\s\S]*?})\s*-->/g;

export function extractTasksFromPlan(planText) {
  if (!planText) {
    return [];
  }

  const tasks = [];
  const lines = planText.split(/\r?\n/);
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const headerMatch = line.match(/^###\s*(T\d+)\s+(.*)$/);
    if (headerMatch) {
      if (current) {
        tasks.push(current);
      }
      current = {
        taskId: headerMatch[1],
        title: headerMatch[2].trim(),
        description: '',
        acceptanceCriteria: '',
      };
      continue;
    }

    if (!current) {
      continue;
    }

    const goalMatch = line.match(/^-+\s*目标：\s*(.*)$/);
    if (goalMatch) {
      current.description = goalMatch[1].trim();
      continue;
    }

    const acceptanceMatch = line.match(/^-+\s*验收：\s*(.*)$/);
    if (acceptanceMatch) {
      current.acceptanceCriteria = acceptanceMatch[1].trim();
    }
  }

  if (current) {
    tasks.push(current);
  }

  return tasks;
}

export function renderManagedComment(metadata, body = '') {
  const serialized = JSON.stringify(metadata);
  const head = `<!-- gh-superpowers:managed-comment ${serialized} -->`;
  return body ? `${head}\n${body}` : `${head}\n`;
}

export function parseManagedComment(text) {
  if (!text) {
    return null;
  }
  const match = text.match(MANAGED_COMMENT_REGEX);
  if (!match) {
    return null;
  }
  const metadata = JSON.parse(match[1]);
  const body = text.slice(match.index + match[0].length).replace(/^\s*\n?/, '');
  return { metadata, body };
}

export function parseTaskLinks(text) {
  if (!text) {
    return [];
  }
  const links = [];
  let match;
  while ((match = TASK_LINK_REGEX.exec(text))) {
    try {
      const parsed = JSON.parse(match[1]);
      links.push(parsed);
    } catch (error) {
      // ignore invalid JSON blocks
    }
  }
  return links;
}

export function parseTaskActions(text) {
  if (!text) {
    return [];
  }
  const actions = [];
  let match;
  while ((match = TASK_ACTION_REGEX.exec(text))) {
    try {
      const parsed = JSON.parse(match[1]);
      actions.push(parsed);
    } catch (error) {
      // skip invalid payloads
    }
  }
  return actions;
}

export function inferTaskStates({ tasks = [], facts = [], requiredChecks = [] } = {}) {
  const everyTask = new Map();
  for (const task of tasks) {
    everyTask.set(task.taskId, { ...task, facts: [] });
  }

  const orphanFacts = [];
  for (const fact of facts) {
    const taskId = fact.taskId;
    if (taskId && everyTask.has(taskId)) {
      everyTask.get(taskId).facts.push(fact);
    } else {
      orphanFacts.push(fact);
    }
  }

  const normalizedRequiredChecks = Array.isArray(requiredChecks) ? requiredChecks.slice() : [];
  const results = [];

  for (const task of tasks) {
    const record = everyTask.get(task.taskId);
    const taskFacts = record ? record.facts : [];
    const actions = taskFacts.filter((item) => item.kind === 'action');
    const hasImplementation = taskFacts.some((item) => item.kind === 'implementation');
    const hasWork = taskFacts.some((item) => item.kind === 'work' || item.kind === 'binding');
    const hasStart = taskFacts.some((item) => item.kind === 'start');
    const hasCommit = taskFacts.some((item) => item.kind === 'commit');
    const hasPr = taskFacts.some((item) => item.kind === 'binding' || item.kind === 'implementation');
    const checkResults = {};
    for (const fact of taskFacts) {
      if (fact.kind === 'check') {
        if (fact.checkName) {
          checkResults[fact.checkName] = fact.status;
        }
      }
    }

    const hasDrop = actions.some((action) => action.action === 'drop');
    const hasBlock = actions.some((action) => action.action === 'block');
    const hasAccept = actions.some((action) => action.action === 'accept');
    const hasBlockingReview = taskFacts.some(
      (item) => item.kind === 'blocking-review',
    );
    const hasFailingRequiredCheck = normalizedRequiredChecks.some(
      (checkName) => {
        const status = checkResults[checkName];
        return status && status !== 'success';
      },
    );

    const allChecksPass = normalizedRequiredChecks.every(
      (checkName) => checkResults[checkName] === 'success',
    );

    const hasAnyChecks = normalizedRequiredChecks.length > 0 && normalizedRequiredChecks.some(
      (checkName) => checkResults[checkName],
    );

    let state = 'todo';
    if (hasDrop) {
      state = 'dropped';
    } else if (hasBlock || hasBlockingReview || hasFailingRequiredCheck) {
      state = 'blocked';
    } else if (hasAccept) {
      state = 'accepted';
    } else if (hasImplementation && allChecksPass) {
      state = 'verified';
    } else if (hasImplementation) {
      state = 'implemented';
    } else if (hasWork || hasStart || hasCommit || hasPr) {
      state = 'in_progress';
    }

    results.push({
      ...task,
      state,
      facts: taskFacts,
      actions,
      hasImplementation,
      hasWork,
      checkResults,
      hasAnyChecks,
    });
  }

  const deviations = [];
  const tasksWithoutFacts = results.filter((task) => task.facts.length === 0).map((task) => task.taskId);
  if (tasksWithoutFacts.length) {
    deviations.push(`有任务暂无事实：${tasksWithoutFacts.join('、')}`);
  }

  const orphanIds = [...new Set(orphanFacts.map((fact) => fact.taskId || 'unknown'))];
  if (orphanIds.length) {
    deviations.push(`存在事实未归档到任务：${orphanIds.join('、')}`);
  }

  const implementedWithoutVerification = results
    .filter((task) => task.state === 'implemented')
    .map((task) => task.taskId);
  if (implementedWithoutVerification.length) {
    deviations.push(`已实现但未验证：${implementedWithoutVerification.join('、')}`);
  }

  const verifiedWithoutAcceptance = results
    .filter((task) => task.state === 'verified')
    .map((task) => task.taskId);
  if (verifiedWithoutAcceptance.length) {
    deviations.push(`已验证但未验收：${verifiedWithoutAcceptance.join('、')}`);
  }

  const blockedThenProgressed = results
    .filter((task) => {
      const blockAction = task.actions.some((action) => action.action === 'block');
      const progressed = task.hasImplementation || task.hasWork || Object.keys(task.checkResults).length > 0;
      return blockAction && progressed;
    })
    .map((task) => task.taskId);
  if (blockedThenProgressed.length) {
    deviations.push(`阻塞后仍有事实推进：${blockedThenProgressed.join('、')}`);
  }

  return {
    tasks: results,
    deviations,
    orphanFacts,
  };
}

export function buildLedgerSnapshot({
  issueNumber,
  planVersion,
  tasks = [],
  facts = [],
  requiredChecks = [],
  previousTasks = [],
} = {}) {
  const inference = inferTaskStates({ tasks, facts, requiredChecks });

  const planDeviations = detectPlanVersionDrift(previousTasks, tasks);

  return {
    issueNumber,
    planVersion,
    requiredChecks: Array.isArray(requiredChecks) ? requiredChecks.slice() : [],
    tasks: inference.tasks,
    facts: facts.slice(),
    deviations: [...inference.deviations, ...planDeviations],
    orphanFacts: inference.orphanFacts,
  };
}

export function detectPlanVersionDrift(previousTasks = [], currentTasks = []) {
  if (!previousTasks.length || !currentTasks.length) {
    return [];
  }

  const previousIds = new Set(previousTasks.map((t) => t.taskId));
  const currentIds = new Set(currentTasks.map((t) => t.taskId));

  const deviations = [];

  const removed = [...previousIds].filter((id) => !currentIds.has(id));
  if (removed.length) {
    deviations.push(`新旧 plan 版本差异：以下任务在当前版本已移除 ${removed.join('、')}`);
  }

  const added = [...currentIds].filter((id) => !previousIds.has(id));
  if (added.length) {
    deviations.push(`新旧 plan 版本差异：以下任务在当前版本新增 ${added.join('、')}`);
  }

  return deviations;
}

export function renderLedger(snapshot) {
  const issueLine = `## 任务账本 #${snapshot.issueNumber}`;
  const planLine = `计划版本：${snapshot.planVersion}`;
  const checkLine = snapshot.requiredChecks && snapshot.requiredChecks.length
    ? `必需校验：${snapshot.requiredChecks.join('、')}`
    : '必需校验：无';

  const taskLines = snapshot.tasks.map((task) => `- ${task.taskId} (${task.state}) ${task.title}`);
  const deviations = snapshot.deviations.length
    ? snapshot.deviations
    : ['无偏差'];
  const deviationLines = deviations.map((item) => `- ${item}`);
  const factLines = (snapshot.facts && snapshot.facts.length)
    ? snapshot.facts.map((fact) => {
      const details = [];
      if (fact.status) {
        details.push(fact.status);
      }
      if (fact.description) {
        details.push(fact.description);
      }
      const descriptor = fact.checkName ?? fact.taskId ?? 'unknown';
      const tail = details.length ? ` ${details.join(' ')}` : '';
      return `- [${fact.kind}] ${descriptor}${tail}`.trim();
    })
    : ['- 无事实记录'];

  return [
    issueLine,
    planLine,
    checkLine,
    '',
    '### 任务状态',
    ...taskLines,
    '',
    '### 偏差',
    ...deviationLines,
    '',
    '### 核心事实',
    ...factLines,
  ].join('\n');
}
