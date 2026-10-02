/** 用隔离的真实 Git 仓库验证同步行为，测试不访问 GitHub、不改变项目历史。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {mergeUpstream} from '../scripts/sync-upstream.mjs';

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'garrison-sync-'));
  t.after(() => rmSync(cwd, {recursive: true, force: true}));
  const git = (...args) => execFileSync('git', args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'Sync test');
  git('config', 'user.email', 'sync-test@example.invalid');
  const commit = (file, text) => {
    writeFileSync(join(cwd, file), text);
    git('add', file);
    git('commit', '-m', file);
    return git('rev-parse', 'HEAD');
  };
  commit('native.js', 'base\n');
  git('branch', 'upstream');
  return {cwd, git, commit};
}

test('上游已包含时不生成提交，重复运行保持幂等', t => {
  const {cwd, git, commit} = fixture(t);
  const before = commit('multiplayer.js', 'fork extension\n');
  for (let i = 0; i < 2; i++) {
    assert.equal(mergeUpstream(cwd, 'upstream').changed, false);
    assert.equal(git('rev-parse', 'HEAD'), before);
    assert.equal(git('status', '--porcelain'), '');
  }
});

test('无冲突合并保留联机扩展及完整双亲历史', t => {
  const {cwd, git, commit} = fixture(t);
  const fork = commit('multiplayer.js', 'fork extension\n');
  git('switch', 'upstream');
  const upstream = commit('native.js', 'upstream bug fix\n');
  git('switch', 'main');
  const result = mergeUpstream(cwd, 'upstream');
  assert.equal(result.changed, true);
  assert.equal(git('show', `${result.commit}:native.js`), 'upstream bug fix');
  assert.equal(git('show', `${result.commit}:multiplayer.js`), 'fork extension');
  assert.equal(git('rev-parse', 'HEAD^1'), fork);
  assert.equal(git('rev-parse', 'HEAD^2'), upstream);
  assert.equal(mergeUpstream(cwd, 'upstream').changed, false);
});

test('发生冲突时自动撤销，分支与文件仍为原版本', t => {
  const {cwd, git, commit} = fixture(t);
  const before = commit('native.js', 'fork edit\n');
  git('switch', 'upstream');
  commit('native.js', 'upstream edit\n');
  git('switch', 'main');
  assert.throws(() => mergeUpstream(cwd, 'upstream'), /native\.js/);
  assert.equal(git('rev-parse', 'HEAD'), before);
  assert.equal(readFileSync(join(cwd, 'native.js'), 'utf8'), 'fork edit\n');
  assert.equal(git('status', '--porcelain'), '');
});

test('本地修改未提交时拒绝合并并保留修改', t => {
  const {cwd, git} = fixture(t);
  writeFileSync(join(cwd, 'native.js'), 'unsaved work\n');
  const before = git('rev-parse', 'HEAD');
  assert.throws(() => mergeUpstream(cwd, 'upstream'), /工作区不干净/);
  assert.equal(git('rev-parse', 'HEAD'), before);
  assert.equal(readFileSync(join(cwd, 'native.js'), 'utf8'), 'unsaved work\n');
});

test('无共同历史的上游不能被自动合并', t => {
  const {cwd, git, commit} = fixture(t);
  const before = git('rev-parse', 'HEAD');
  git('switch', '--orphan', 'unrelated');
  commit('other.js', 'different repository\n');
  git('switch', 'main');
  assert.throws(() => mergeUpstream(cwd, 'unrelated'), /merge-base/);
  assert.equal(git('rev-parse', 'HEAD'), before);
  assert.equal(git('status', '--porcelain'), '');
});

test('检查期间 main 被别人更新时，普通 push 拒绝覆盖', t => {
  const {cwd, git, commit} = fixture(t);
  const remote = join(cwd, 'remote.git');
  git('init', '--bare', remote);
  git('remote', 'add', 'origin', remote);
  git('push', 'origin', 'main');
  const fork = commit('multiplayer.js', 'candidate\n');
  git('switch', 'upstream');
  const other = commit('native.js', 'someone else pushed\n');
  git('push', 'origin', `${other}:refs/heads/main`);
  git('switch', 'main');
  const push = spawnSync('git', ['push', 'origin', `${fork}:refs/heads/main`], {cwd, encoding: 'utf8'});
  assert.notEqual(push.status, 0);
  assert.match(push.stderr, /rejected/);
  assert.equal(git('ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0], other);
});
