#!/usr/bin/env node
// 端到端入口脚本：把 core / github / codex 三个包串起来
//
// 用法:
//   node packages/codex/src/cli.js <action> [payload...]
//
// 示例:
//   node packages/codex/src/cli.js bind-issue 42
//   node packages/codex/src/cli.js publish-plan '{"planText":"...","planVersion":"v1"}'
//   node packages/codex/src/cli.js sync-ledger
//   node packages/codex/src/cli.js show-ledger
//   node packages/codex/src/cli.js accept-task T1
//   node packages/codex/src/cli.js block-task T2 "等待接口稳定"
//   node packages/codex/src/cli.js unblock-task T2
//   node packages/codex/src/cli.js drop-task T3

import { execSync } from 'node:child_process';
import { createCodexActionRouter, createSessionStore, loadRepoConfig, routeNaturalLanguage } from './index.js';
import * as core from '../../core/src/index.js';
import { createGitHubProvider } from '../../github/src/index.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('用法: node cli.js <action> [payload...]');
    console.error('可用动作: bind-issue, publish-plan, sync-ledger, show-ledger');
    console.error('          accept-task, block-task, unblock-task, drop-task');
    process.exit(1);
  }

  const cwd = process.cwd();
  const config = await loadRepoConfig(cwd);
  const sessionStore = createSessionStore({ cwd });

  // 通过 gh CLI 作为 runner（Codex 环境中走 MCP 通道）
  const runner = {
    async run(cmdArgs) {
      try {
        const stdout = execSync(`gh ${cmdArgs.join(' ')}`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        return { exitCode: 0, stdout, stderr: '' };
      } catch (error) {
        return { exitCode: error.status ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
      }
    },
  };

  const provider = createGitHubProvider({ runner });

  const router = createCodexActionRouter({
    sessionStore,
    provider,
    core,
    config,
    async loadPlanText() {
      // 默认从当前工作目录的 docs/plans 目录下找最新的 plan 文件
      // 使用者可以通过 payload.planText 直接传入
      return undefined;
    },
  });

  const rawAction = args[0];

  // 先尝试自然语言解析
  const routed = routeNaturalLanguage(args.join(' '));
  if (routed) {
    const result = await router.runAction(routed.action, routed.payload);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // 直接动作映射
  const payloadMap = {
    'bind-issue': () => ({ issueNumber: Number(args[1]) }),
    'publish-plan': () => args[1] ? JSON.parse(args[1]) : {},
    'sync-ledger': () => ({}),
    'show-ledger': () => ({}),
    'accept-task': () => ({ taskId: args[1] }),
    'block-task': () => ({ taskId: args[1], reason: args[2] }),
    'unblock-task': () => ({ taskId: args[1] }),
    'drop-task': () => ({ taskId: args[1] }),
  };

  const payloadFn = payloadMap[rawAction];
  if (!payloadFn) {
    console.error(`未知动作: ${rawAction}`);
    process.exit(1);
  }

  const result = await router.runAction(rawAction, payloadFn());
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
