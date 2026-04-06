import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildLedgerSnapshot,
  detectPlanVersionDrift,
  extractTasksFromPlan,
  inferTaskStates,
  parseManagedComment,
  parseTaskActions,
  parseTaskLinks,
  renderLedger,
  renderManagedComment,
} from '../../packages/core/src/index.js';

const samplePlan = `
### T1 项目结构准备
- 目标：搭建插件骨架
- 验收：存在 packages/core 和 tests 结构

### T2 计划解析
- 目标：将 plan 内容解析为任务
- 验收：所有 taskId 都被抽取
`;

const canonicalTasks = [
  { taskId: 'T1', title: '项目结构准备', description: '搭建插件骨架', acceptanceCriteria: '存在 packages/core 和 tests 结构' },
  { taskId: 'T2', title: '计划解析', description: '将 plan 内容解析为任务', acceptanceCriteria: '所有 taskId 都被抽取' },
];

const planBindings = `
主动缩写
<!-- gh-superpowers:task-links {"tasks":["T1","T2"]} -->
提交详细
<!-- gh-superpowers:task-links {"tasks":["T3"]} -->
`;

const actionBlocks = `
提前准备
<!-- gh-superpowers:task-action {"action":"accept","task":"T1"} -->
<!-- gh-superpowers:task-action {"action":"block","task":"T2","reason":"等待评审"} -->
`;

const comprehensiveTasks = [
  { taskId: 'T1', title: '已验收任务', description: '完成 A 步骤', acceptanceCriteria: 'A 步骤验证通过' },
  { taskId: 'T2', title: '阻塞任务', description: '完成 B 步骤', acceptanceCriteria: 'B 步骤验证通过' },
  { taskId: 'T3', title: '已实现未验证', description: '完成 C 步骤', acceptanceCriteria: 'C 验收' },
  { taskId: 'T4', title: '丢弃任务', description: '完成 D 步骤', acceptanceCriteria: 'D 验收' },
  { taskId: 'T5', title: '待办任务', description: '完成 E 步骤', acceptanceCriteria: 'E 验收' },
  { taskId: 'T6', title: '已验证未验收', description: '完成 F 步骤', acceptanceCriteria: 'F 验收' },
  { taskId: 'T7', title: '进行中任务', description: '完成 G 步骤', acceptanceCriteria: 'G 验收' },
];

const comprehensiveFacts = [
  { kind: 'binding', taskId: 'T99', description: '未知任务的绑定' },
  { kind: 'binding', taskId: 'T1', description: 'PR #1' },
  { kind: 'implementation', taskId: 'T1', description: 'PR #1 已合并' },
  { kind: 'check', taskId: 'T1', checkName: 'build', status: 'success' },
  { kind: 'check', taskId: 'T1', checkName: 'test', status: 'success' },
  { kind: 'action', action: 'accept', taskId: 'T1' },
  { kind: 'implementation', taskId: 'T2', description: 'PR #2 已合并' },
  { kind: 'action', action: 'block', taskId: 'T2', reason: '等待 infra' },
  { kind: 'work', taskId: 'T2', description: '继续开发' },
  { kind: 'implementation', taskId: 'T3', description: 'PR #3 已合并' },
  { kind: 'work', taskId: 'T3', description: '完成开发' },
  { kind: 'action', action: 'drop', taskId: 'T4' },
  { kind: 'check', taskId: 'T6', checkName: 'build', status: 'success' },
  { kind: 'check', taskId: 'T6', checkName: 'test', status: 'success' },
  { kind: 'implementation', taskId: 'T6', description: 'PR #6 已合并' },
  { kind: 'work', taskId: 'T7', description: '开始开发' },
];

const requiredChecks = ['build', 'test'];

const ledgerContext = {
  issueNumber: 42,
  planVersion: 'v1',
  tasks: comprehensiveTasks,
  facts: comprehensiveFacts,
  requiredChecks,
};

describe('core helpers', () => {
  describe('extractTasksFromPlan', () => {
    it('能正确抽取 taskId、标题与目标', () => {
      const tasks = extractTasksFromPlan(samplePlan);
      assert.deepStrictEqual(tasks, canonicalTasks);
    });

    it('空输入返回空数组', () => {
      assert.deepStrictEqual(extractTasksFromPlan(''), []);
      assert.deepStrictEqual(extractTasksFromPlan(null), []);
      assert.deepStrictEqual(extractTasksFromPlan(undefined), []);
    });

    it('没有匹配到任务标题的行会被跳过', () => {
      const tasks = extractTasksFromPlan('只是一段普通文字\n没有任务标记');
      assert.deepStrictEqual(tasks, []);
    });

    it('只含标题不含目标和验收的任务也能抽取', () => {
      const tasks = extractTasksFromPlan('### T1 只有标题');
      assert.deepStrictEqual(tasks, [{ taskId: 'T1', title: '只有标题', description: '', acceptanceCriteria: '' }]);
    });
  });

  describe('托管评论辅助', () => {
    it('renderManagedComment 与 parseManagedComment 相互可用', () => {
      const comment = renderManagedComment({ kind: 'plan', issue: 7 }, '计划正文');
      const parsed = parseManagedComment(comment);
      assert.strictEqual(parsed.metadata.kind, 'plan');
      assert.strictEqual(parsed.metadata.issue, 7);
      assert.strictEqual(parsed.body.trim(), '计划正文');
    });

    it('parseManagedComment 对不含标记的文本返回 null', () => {
      assert.strictEqual(parseManagedComment(null), null);
      assert.strictEqual(parseManagedComment(''), null);
      assert.strictEqual(parseManagedComment('普通文本'), null);
    });

    it('parseManagedComment 对无效 JSON 抛出异常', () => {
      assert.throws(
        () => parseManagedComment('<!-- gh-superpowers:managed-comment {invalid} -->'),
        SyntaxError,
      );
    });
  });

  describe('任务绑定/人工动作解析', () => {
    it('parseTaskLinks 能提取所有绑定块中的任务列表', () => {
      const links = parseTaskLinks(planBindings);
      assert.deepStrictEqual(links, [
        { tasks: ['T1', 'T2'] },
        { tasks: ['T3'] },
      ]);
    });

    it('parseTaskActions 能读取所有动作', () => {
      const actions = parseTaskActions(actionBlocks);
      assert.deepStrictEqual(actions, [
        { action: 'accept', task: 'T1' },
        { action: 'block', task: 'T2', reason: '等待评审' },
      ]);
    });
  });

  describe('状态推导与账本生成', () => {
    it('inferTaskStates 能输出每个任务状态与偏差说明', () => {
      const inference = inferTaskStates({
        tasks: comprehensiveTasks,
        facts: comprehensiveFacts,
        requiredChecks,
      });

      const states = Object.fromEntries(inference.tasks.map((item) => [item.taskId, item.state]));
      assert.deepStrictEqual(states, {
        T1: 'accepted',
        T2: 'blocked',
        T3: 'implemented',
        T4: 'dropped',
        T5: 'todo',
        T6: 'verified',
        T7: 'in_progress',
      });

      assert.deepStrictEqual(inference.deviations, [
        '有任务暂无事实：T5',
        '存在事实未归档到任务：T99',
        '已实现但未验证：T3',
        '已验证但未验收：T6',
        '阻塞后仍有事实推进：T2',
      ]);
    });

    it('buildLedgerSnapshot + renderLedger 生成可读账本', () => {
      const snapshot = buildLedgerSnapshot(ledgerContext);
      assert.strictEqual(snapshot.issueNumber, 42);
      assert.strictEqual(snapshot.planVersion, 'v1');
      assert.strictEqual(snapshot.requiredChecks.join(','), 'build,test');
      assert(snapshot.tasks.length === comprehensiveTasks.length);
      assert(snapshot.deviations.length === 5);

      const ledgerText = renderLedger(snapshot);
      assert(ledgerText.includes('## 任务账本 #42'));
      assert(ledgerText.includes('计划版本：v1'));
      assert(ledgerText.includes('必需校验：build、test'));
      assert(ledgerText.includes('- T1 (accepted)')); // 确保状态行存在
      assert(ledgerText.includes('- T6 (verified)'));
      assert(ledgerText.includes('### 偏差'));
      assert(ledgerText.includes('有任务暂无事实：T5'));
      assert(ledgerText.includes('存在事实未归档到任务：T99'));
      assert(ledgerText.includes('阻塞后仍有事实推进：T2'));
      assert(ledgerText.includes('### 核心事实'));
      assert(ledgerText.includes('[check] build'));
    });

    it('detectPlanVersionDrift 检测新增和移除的任务', () => {
      const previous = [
        { taskId: 'T1', title: '旧任务1' },
        { taskId: 'T2', title: '旧任务2' },
        { taskId: 'T3', title: '被移除的任务' },
      ];
      const current = [
        { taskId: 'T1', title: '旧任务1' },
        { taskId: 'T2', title: '旧任务2' },
        { taskId: 'T4', title: '新增任务' },
      ];

      const deviations = detectPlanVersionDrift(previous, current);
      assert.strictEqual(deviations.length, 2);
      assert(deviations[0].includes('T3'));
      assert(deviations[0].includes('已移除'));
      assert(deviations[1].includes('T4'));
      assert(deviations[1].includes('新增'));
    });

    it('detectPlanVersionDrift 无差异返回空', () => {
      const tasks = [{ taskId: 'T1', title: '任务1' }];
      assert.deepStrictEqual(detectPlanVersionDrift(tasks, tasks), []);
    });

    it('detectPlanVersionDrift 任一为空返回空', () => {
      const tasks = [{ taskId: 'T1', title: '任务1' }];
      assert.deepStrictEqual(detectPlanVersionDrift([], tasks), []);
      assert.deepStrictEqual(detectPlanVersionDrift(tasks, []), []);
    });

    it('buildLedgerSnapshot 能合并 plan 版本偏差', () => {
      const snapshot = buildLedgerSnapshot({
        ...ledgerContext,
        previousTasks: [
          { taskId: 'T1', title: 'T1' },
          { taskId: 'T99', title: '旧任务' },
        ],
      });
      assert(snapshot.deviations.some((d) => d.includes('已移除')));
      assert(snapshot.deviations.some((d) => d.includes('新增')));
    });
  });
});
