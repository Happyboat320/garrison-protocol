/**
 * 单机规则的联机适配边界。
 * 不修改原模块、不写全局 prototype 补丁；只有联机会话使用以下两个子类。
 * 商店/技能/伤害/地形仍由上游模块处理，这里只接管跨玩家结算与可恢复账本。
 */
import {NativeSession} from '../generated/native-session.js';
import {NativeBattle} from '../generated/native-battle.js';


export class MultiplayerBattle extends NativeBattle {
  finish(reason = 'manual') {
    // 单机“累计漏失 >= 当前生命”会结束本道中。联机必须等队友救援，
    // 因此只允许清场或超时结束，不能让临时的漏怪提前淘汰玩家。
    if (!this.s.finalBossId && reason === 'complete' && this.s.time < this.s.limit &&
      (this.s.queue.some(q => this.isPrimaryEnemy(q.id)) || this.s.enemies.some(e => e.hp > 0 && !e.nonPrimary) ||
       this.s.pendingEnemySpawns?.some(row => this.isPrimaryEnemy(row.q.id)))) return;
    // 超时的活怪和未出场敌人也必须交入可靠账本，不能只传结果中的计数。
    if (!this.s.finished && !this.s.finalBossId) {
      for (const e of this.s.enemies) if (e.hp > 0) this.captureRemaining(e);
      for (const q of this.s.queue) this.captureRemaining(this.recordForQueue(q));
      for (const row of this.s.pendingEnemySpawns || []) this.captureRemaining(this.recordForQueue(row.q));
    }
    super.finish(reason);
  }
  recordForQueue(q) {
    const raw = this.enemyRaw(q.id);
    return {id: q.id, leak: raw?.lifePointReduce ?? 1, bountyReward: q.bountyReward,
      derived: !!q.derived, onlineEnemy: q.onlineEnemy || this.newIdentity(q.id)};
  }
  newIdentity(id, parent = null) {
    const state = this.economy.online;
    return {key: `${state.taskId}:${this.economy.s.playerId}:${++state.enemySeq}`,
      sourcePlayerId: parent?.sourcePlayerId || this.economy.s.playerId,
      rootKey: parent?.supportRootKey || parent?.rootKey || parent?.key || null,
      supportRootKey: parent?.supportRootKey || null, id};
  }
  bindEnemyOrigin(enemy) {
    let route = enemy.route;
    // 传送/形态切换可能整体替换路径数组。给本局实例的 route 写入加上来源，
    // 让之后 structuredClone(route) 的召唤/再生路径仍携带正确的原始玩家。
    Object.defineProperty(enemy, 'route', {enumerable: true, configurable: true,
      get: () => route,
      set: value => { route = value; if (Array.isArray(route)) route.onlineOrigin = enemy.onlineEnemy; }});
    enemy.route = route;
  }
  path(route, flying) {
    const result = super.path(route, flying);
    if (this.spawningIdentity) result.onlineOrigin = this.spawningIdentity;
    return result;
  }
  spawn(q, placement = null) {
    q.onlineEnemy ??= this.newIdentity(q.id);
    const previous = new Set(this.s.enemies.map(e => e.uid));
    const originalScale = this.combatScale;
    if (q.onlineScale) this.combatScale = q.onlineScale;
    let result; this.spawningIdentity = q.onlineEnemy;
    try { result = super.spawn(q, placement); } finally { this.combatScale = originalScale; this.spawningIdentity = null; }
    for (const e of this.s.enemies) if (!previous.has(e.uid)) { e.onlineEnemy = structuredClone(q.onlineEnemy); this.bindEnemyOrigin(e); }
    return result;
  }
  onActorExit(target, info) {
    if (target.onlineEnemy) {
      if (info.reason === 'leak') this.captureRemaining(target);
      else if (Number.isFinite(target.bountyReward)) {
        this.economy.online.killedBounties[target.onlineEnemy.key] = this.enemyRecord(target);
      }
    }
    super.onActorExit(target, info);
  }
  enemyRecord(enemy) {
    return {...enemy.onlineEnemy, id: enemy.id, leak: Number(enemy.leak) || 0,
      bountyReward: Number.isFinite(enemy.bountyReward) ? enemy.bountyReward : null,
      derived: !!enemy.derived, scale: {...this.combatScale}};
  }
  captureRemaining(enemy) {
    if (!enemy.onlineEnemy) enemy.onlineEnemy = this.newIdentity(enemy.id);
    this.economy.online.remaining[enemy.onlineEnemy.key] = this.enemyRecord(enemy);
  }
  onEnemyDeath(enemy, info) {
    // 死亡生成（解压缩等）有明确的产生者：跨多次联防仍继承原来源。
    this.onlineParent = enemy.onlineEnemy;
    try { return super.onEnemyDeath(enemy, info); } finally { this.onlineParent = null; }
  }
  queueEnemySpawn(q, placement, delay = 0) {
    // 活体召唤没有 source 参数，沿用上游给出的路线与出生坐标定位产生者。
    // 死亡/再生路径优先使用上面的明确上下文；只在缺少上下文时按位置和路线匹配。
    const actors = this.s.enemies.filter(e => e.onlineEnemy && e.route?.length === placement?.route?.length);
    const parent = this.onlineParent || placement?.route?.onlineOrigin || actors.sort((a, b) =>
      Math.hypot(a.x - placement.x, a.y - placement.y) - Math.hypot(b.x - placement.x, b.y - placement.y))[0]?.onlineEnemy;
    q.onlineEnemy ??= this.newIdentity(q.id, parent);
    return super.queueEnemySpawn(q, placement, delay);
  }
}

export class MultiplayerSession extends NativeSession {
  constructor(data, config, player, peers = []) {
    // 上游构造函数会生成商店并触发策略：先提供完整策略与独立商店种子。
    super(data, {modeId: config.modeId, bandId: player.bandId, mapId: config.mapId,
      seed: (config.seed ^ player.seat * 0x45d9f3b) >>> 0, waveRoster: config.waveRoster,
      bondBan: config.bondBan, finalBossId: config.bossId, finalBossHpMultiplier: .75 * config.bossMultiplier,
      playerId: player.id, teamPeers: peers});
    this.online = {config, taskId: null, kind: null, enemySeq: 0, remaining: {}, killedBounties: {},
      report: null, damage: 0, healing: 0, acknowledgedDamage: 0, acknowledgedHealing: 0,
      bossHp: 0, choices: {}, settlementRound: 0};
  }
  perform(type,...args){
    if(this.commandAllowed&&!this.commandAllowed(type))return false;
    return super.perform(type,...args);
  }
  get waveTable() { return this.online?.config.waveTable; }
  addLayers(...args) {
    if (this.online?.kind === 'support') return 0;
    return super.addLayers(...args);
  }
  prepareRoundDecision() {
    // 公共决策由房间给出六候选；不在各网页独立随机三候选。
    this.s.roundDecisions = []; this.s.roundDecisionStage = 'reward';
  }
  chooseShared(offer) {
    // 原 chooseDecision 执行奖励数值；这里仅让它识别服务器已锁定的单项。
    this.s.phase = 'decision'; this.s.roundDecisionStage = 'reward'; this.s.roundDecisions = [offer];
    return super.chooseDecision(offer.id);
  }
  startBattle() { return false; } // 原 UI 的自动开战入口在联机中禁用，只有房间 task 可开战。
  prepareOnlineReady() {
    if (this.s.rewardPending || this.s.phase !== 'prep') return false;
    if (this.s.prepApplied) return true;
    // 原 startBattle 处理布局检查、S.E.E.S.、卫戍、盟约与策略奖励。
    // 联机只停在 prep；共享任务下发后再由同一 startBattle 转换阶段。
    const ok=super.startBattle({prepareOnly:true});
    this.ensureRewards();return !!ok&&!this.s.rewardPending;
  }
  createBattle(turn) {
    // 原 startBattle 负责布局、资金、开战事件；这里只选择联机战斗子类。
    if (turn.finalBossId) turn.finalBoss = {...turn.finalBoss, hp:this.online.config.bossMaxHp};
    return new MultiplayerBattle(this.data,this,this.map,turn);
  }
  startOnlineBattle(task) {
    if (this.online.taskId === task.id) return true;
    if (this.s.phase !== 'prep' || this.s.rewardPending) return false;
    if (!this.s.prepApplied && !this.prepareOnlineReady()) return false;
    this.online.taskId=task.id;this.online.kind=task.kind;this.online.supportStartTime=0;
    this.online.remaining={};this.online.killedBounties={};this.online.report=null;
    if (!super.startBattle() || this.s.phase !== 'battle') {this.online.taskId=null;return false;}
    if (this.battle.s.finalBossId) this.attachBossLedger(task.bossMaxHp);
    return true;
  }
  startSupport(task) {
    if (this.online.taskId === task.id) return true;
    if (!this.battle?.s.finished) throw Error('联防必须在本人道中结束后展开');
    const b = this.battle;
    this.online.supportStartTime = b.s.time;
    this.online.taskId = task.id; this.online.kind = 'support';
    this.online.remaining = {}; this.online.killedBounties = {}; this.online.report = null;
    // 保留整个战斗对象和原模拟时间：HP/SP/技能持续/再部署/召唤物与到期时间不会被重置。
    // 仅清理上一阶段的敌方队列，重新从当前地图的入口刷新联防敌人。
    b.s.finished = false; b.s.result = null; b.s.leaks = 0;
    b.s.enemies = []; b.s.pendingEnemySpawns = []; b.s.enemyProjectiles = [];
    b.s.limit = b.s.time + b.turn.normalPhaseTime;
    b.s.queue = task.input.map((record, index) => {
      const raw = b.enemyRaw(record.id);
      const motion = raw?.motion === 'FLY' ? 'FLY' : 'WALK';
      const route = b.level.routes.findIndex(row => row.motionMode === motion);
      return {id: record.id, route: Math.max(0, route), at: b.s.time + 1 + index * .8,
        bountyReward: record.bountyReward ?? undefined, derived: record.derived,
        onlineEnemy: {key: record.key, id: record.id, sourcePlayerId: record.sourcePlayerId, rootKey: record.rootKey, supportRootKey: record.key},
        onlineScale: record.scale};
    });
    b.s.total = task.input.length; this.s.phase = 'battle';
    // 联防敌人统一采用本轮难度倍率，状态由 spawn 从资料重新初始化。
    return true;
  }
  tick() {
    if (this.s.phase !== 'battle' || !this.battle || this.battle.s.finished) return;
    const frozenLayers = this.online.kind === 'support' ? structuredClone(this.s.bondLayers) : null;
    const earnedBefore = this.battle.s.bountyEarned || 0;
    this.battle.step();
    // 原击倒路由仍做技能/死亡效果，但公共悬赏款由服务器统一结算一次。
    // 只撤销明确的 bountyEarned 增量，保留鸭爵等独立策略的资金奖励。
    this.s.nextRoundBonus -= (this.battle.s.bountyEarned || 0) - earnedBefore;
    if (frozenLayers) {
      Object.assign(this.s.bondLayers, frozenLayers);
      for (const key of Object.keys(this.s.bondLayers)) if (!(key in frozenLayers)) delete this.s.bondLayers[key];
    }
    if (this.battle.s.finished) this.online.report = {
      taskId: this.online.taskId, elapsed: this.battle.s.time - (this.online.supportStartTime || 0),
      perfect: this.online.kind === 'main' && !Object.keys(this.online.remaining).length && this.battle.s.time < this.battle.s.limit,
      remaining: Object.values(this.online.remaining), killedBounties: Object.values(this.online.killedBounties),
      result: structuredClone(this.battle.s.result)};
  }
  attachBossLedger(maxHp, saved = false) {
    const actor = this.battle.s.enemies.find(e => e.uid === this.battle.s.finalBossUid);
    if (!actor) return;
    if (!saved) Object.assign(this.online, {damage: 0, healing: 0, acknowledgedDamage: 0, acknowledgedHealing: 0, bossHp: maxHp});
    let predictedHp = actor.hp;
    // 捕获所有 HP 写入，包括 DOT/真实伤害/生命流失，避免仅钩普通攻击而漏算。
    // 公共击破前保持正值，禁止单网页自行 commitExit 或判胜；最终由 room.finished 驱动。
    Object.defineProperty(actor, 'hp', {enumerable: true, configurable: true,
      get: () => predictedHp,
      set: value => {
        if (!Number.isFinite(value)) return;
        const bounded = Math.max(0, Math.min(maxHp, value));
        if (bounded < predictedHp) this.online.damage += predictedHp - bounded;
        else this.online.healing += bounded - predictedHp;
        predictedHp = Math.max(.000001, bounded);
      }});
    this.setBossPrediction = hp => { predictedHp = Math.max(.000001, hp); };
  }
  updateBoss(boss) {
    if (!this.setBossPrediction || !boss) return;
    const own = boss.contributions[this.s.playerId] || {damage: 0, healing: 0};
    // 服务端可能已确认了比上一次本地恢复点更新的累计报告，恢复时不能把累计值倒退。
    this.online.damage = Math.max(this.online.damage, own.damage);
    this.online.healing = Math.max(this.online.healing, own.healing);
    this.online.acknowledgedDamage = own.damage; this.online.acknowledgedHealing = own.healing;
    this.online.bossHp = boss.hp;
    this.setBossPrediction(Math.min(boss.maxHp, boss.hp - (this.online.damage - own.damage) + (this.online.healing - own.healing)));
  }
  settle(room, player) {
    if (this.online.settlementRound === room.round) return;
    this.online.settlementRound = room.round;
    this.s.hp = player.hp;
    this.s.nextRoundBonus += room.rewards?.[player.id] || 0;
    if (this.battle) {
      const result = structuredClone(this.battle.s.result || {});
      result.loss = room.losses?.[player.id] || 0;
      result.finalBondLayers = this.bondLayerSnapshot();
      this.s.history.push(result);
    }
    this.s.lastBattle = {success: player.hp > 0, leaks: room.losses?.[player.id] || 0, loss: room.losses?.[player.id] || 0};
    this.s.phase = player.hp > 0 ? 'intermission' : 'finished';
    this.applyPostBattleTransforms();
    this.online.kind = null;
  }
  checkpoint() {
    return structuredClone({version: 1, native: this.snapshot(), online: this.online});
  }
  static restoreOnline(data, record) {
    if (record?.version !== 1 || !record.native || !record.online?.config) return null;
    const original = structuredClone(record.native);
    // 原存档只允许三个决策候选：联机封套独立保留阶段，借原恢复验证棋子与战斗主体。
    const phase = original.s.phase, decisions = original.s.roundDecisions;
    original.s.phase = phase === 'decision' ? 'prep' : phase;
    original.s.roundDecisions = [];
    const session = NativeSession.restore(data, original);
    if (!session) return null;
    Object.setPrototypeOf(session, MultiplayerSession.prototype);
    session.online = structuredClone(record.online); session.s.phase = phase; session.s.roundDecisions = decisions;
    if (session.battle) {
      Object.setPrototypeOf(session.battle, MultiplayerBattle.prototype);
      for (const e of session.battle.s.enemies) if (e.onlineEnemy && e.route) session.battle.bindEnemyOrigin(e);
    }
    if (session.battle?.s.finalBossId) {
      session.battle.turn.finalBoss = {...session.battle.turn.finalBoss, hp: session.online.config.bossMaxHp};
      session.attachBossLedger(session.online.config.bossMaxHp, true);
    }
    return session;
  }
}
