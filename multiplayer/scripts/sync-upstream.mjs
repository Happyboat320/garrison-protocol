/** 在 Actions 临时工作区中合并上游。此脚本不推送、不发布、不启动服务。
 * 先生成候选提交，再由工作流执行构建/联机检查；只有全通过才推送该 SHA。
 * 不自动解决任何冲突、不 rebase、不 force push，保留 fork 的正常提交历史。
 */
import {spawnSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

function git(cwd, args, {allowFailure = false} = {}) {
  const result = spawnSync('git', args, {cwd, encoding: 'utf8'});
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return {status: result.status, output: result.stdout.trim(), error: result.stderr.trim()};
}

export function mergeUpstream(cwd, upstreamRef) {
  // 禁止在有本地修改时执行，确保 merge --abort 不会影响用户未提交的工作。
  if (git(cwd, ['status', '--porcelain']).output) throw new Error('工作区不干净，停止自动合并');
  const before = git(cwd, ['rev-parse', 'HEAD']).output;
  const upstream = git(cwd, ['rev-parse', '--verify', `${upstreamRef}^{commit}`]).output;
  const ancestor = git(cwd, ['merge-base', '--is-ancestor', upstream, before], {allowFailure: true});
  if (ancestor.status === 0) return {changed: false, commit: before, upstream};
  if (ancestor.status !== 1) throw new Error(`无法检查提交祖先：${ancestor.error}`);
  // 禁止合并没有共同历史的仓库；上游改写历史时需要人工核对。
  git(cwd, ['merge-base', before, upstream]);
  const merge = git(cwd, ['merge', '--no-ff', '--no-edit', upstream], {allowFailure: true});
  if (merge.status !== 0) {
    const conflicts = git(cwd, ['diff', '--name-only', '--diff-filter=U']).output;
    git(cwd, ['merge', '--abort']);
    throw new Error(`上游合并失败，已撤销合并。冲突文件：\n${conflicts || '(无文件冲突，详见 Git 错误)'}\n${merge.error || merge.output}`);
  }
  return {changed: true, commit: git(cwd, ['rev-parse', 'HEAD']).output, upstream};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const cwd = process.cwd();
    const ref = 'refs/remotes/auto-upstream/main';
    // 固定可信上游及分支，避免工作流输入被作为 Git 参数执行。
    git(cwd, ['fetch', '--no-tags', 'https://github.com/Yilegendoflink/garrison-protocol.git', `+refs/heads/main:${ref}`]);
    const result = mergeUpstream(cwd, ref);
    console.log(JSON.stringify(result, null, 2));
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${result.changed}\ncommit=${result.commit}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `上游提交：\`${result.upstream}\`\n\n${result.changed ? '无冲突合并完成，等待构建与联机检查。' : '上游提交已包含在本仓库中，无需更新或发布。'}\n`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
