/**
 * 房间是跨玩家规则的唯一账本。它不模拟干员攻击；它验证报告的身份/阶段/任务，
 * 保存去重记录，统一决定何时联防、谁扣生命、谁领赏金和公共 Boss 何时击破。
 */
import {randomBytes} from 'node:crypto';
import {PROTOCOL_VERSION, EMOTES, MAX_PLAYERS, MODES, BOSS_MULTIPLIERS,
  roundPlan, rotateOrder, decisionForRound, lossesBySource} from '../shared/rules.js';
import {requireValue, finite, validId, profileOf, helloValid, RECONNECT_WINDOW_MS} from '../shared/protocol.js';
import {waveRng, createWaveRoster} from '../../dist/native-wave-random.js';
import {normalizeWaveTable, defaultWaveTable} from '../../dist/native-wave-fill.js';
import {normalizeBondBan, bondBanIds} from '../../dist/native-bond-ban.js';
import {resolveMapId} from '../../dist/protocol.js';
import {rollFinalBoss, finalBossConfig} from '../../dist/native-final-boss.js';
import {positiveInteger} from './limits.js';

const token = () => randomBytes(24).toString('hex');
export class RoomManager {
  constructor(data, rulesHash, {now = Date.now, maxRooms = 10} = {}) {
    this.data = data; this.rulesHash = rulesHash; this.now = now; this.rooms = new Map();
    this.maxRooms = positiveInteger(maxRooms, 'maxRooms');
  }
  send(connection, message) {
    if (!connection || connection.readyState !== undefined && connection.readyState !== 1) return;
    // 慢接收者的发送队列不能无限增长；断开后仍保留正常的短期重连窗口。
    if (connection.bufferedAmount > 4 * 1024 * 1024) { connection.terminate(); return; }
    connection.send(JSON.stringify(message));
  }
  publicRoom(room) {
    return {id: room.id, protocol: PROTOCOL_VERSION, rulesHash: this.rulesHash, revision: room.revision,
      phase: room.phase, hostId: room.hostId, round: room.round, config: room.config,
      players: room.players.map(p => ({id: p.id, seat: p.seat, ...p.profile, connected: !!p.connection,
        bandId: p.bandId, hp: p.hp, maxHp: p.maxHp, ready: p.ready, next: p.next, eliminated: p.eliminated,
        flags: p.flags, briefingSeen: !!p.briefingSeen})),
      strategyOrder: room.strategyOrder, choice: room.choice, picked: room.picked,
      task: room.task, supportPlayers: room.supportPlayers, losses: room.losses, rewards: room.rewards,
      boss: room.boss, lastSettlement: room.lastSettlement, success: room.success, log: room.log.slice(-30)};
  }
  broadcast(room) {
    room.revision++;
    const message = {type: 'room', room: this.publicRoom(room), serverTime: this.now()};
    for (const p of room.players) this.send(p.connection, message);
  }
  log(room, text) { room.log.push({at: this.now(), text}); if (room.log.length > 100) room.log.splice(0, room.log.length - 100); }
  alive(room) { return room.players.filter(p => !p.eliminated); }
  async handle(connection, message) {
    requireValue(message && typeof message.type === 'string', '消息格式错误');
    if (message.type === 'hello') return this.hello(connection, message);
    const room = this.rooms.get(connection.roomId), player = room?.players.find(p => p.id === connection.playerId);
    requireValue(player?.connection === connection, '请先进入房间');
    if (message.type === 'emote') {
      requireValue(EMOTES.includes(message.emote), '未知表情');
      requireValue(this.now() - (player.lastEmote || 0) >= 800, '表情发送太快'); player.lastEmote = this.now();
      for (const p of room.players) this.send(p.connection, {type: 'emote', playerId: player.id, emote: message.emote, at: this.now()});
    } else if (message.type === 'profile') { player.profile = profileOf(message.profile); this.broadcast(room); }
    else if (message.type === 'start') {
      requireValue(room.phase === 'waiting' && room.hostId === player.id, '只有房主可开始');
      requireValue(room.players.length >= 2 && room.players.every(p => p.connection), '需要2–4名在线玩家');
      room.config = this.makeConfig(message.config, room.players.length);
      room.phase = 'briefing'; room.strategyOrder = rotateOrder(room.players.map(p => p.id), 1);
      this.log(room, '查看本局盟约禁用'); this.broadcast(room);
    } else if (message.type === 'briefing-ready') {
      // 每位玩家都确认同一份开局禁用记录之后，才允许轮流选策略。
      requireValue(room.phase === 'briefing', '当前不在禁用预览阶段');
      player.briefingSeen = true;
      if (room.players.every(p => p.briefingSeen)) {
        room.phase = 'strategy'; this.log(room, '开始选择策略');
      }
      this.broadcast(room);
    } else if (message.type === 'strategy') {
      requireValue(room.phase === 'strategy' && room.strategyOrder[0] === player.id, '还未轮到你选择策略');
      requireValue(this.data.season.bandDataListDict[message.bandId] && !room.players.some(p => p.bandId === message.bandId), '策略无效或已被选择');
      requireValue(message.bandId !== 'band_sees' || player.flags.sees, '尚未解锁 S.E.E.S.');
      player.bandId = message.bandId; player.hp = player.maxHp = this.data.season.bandDataListDict[message.bandId].totalHp;
      room.strategyOrder.shift();
      if (!room.strategyOrder.length) room.phase = 'prep';
      this.broadcast(room);
    } else if (message.type === 'ready') {
      requireValue(room.phase === 'prep' && !player.eliminated, '当前不能准备');
      player.ready = message.ready === true;
      if (this.alive(room).every(p => p.ready && p.connection)) this.beginBattle(room);
      this.broadcast(room);
    } else if (message.type === 'choice') {
      requireValue(room.phase === 'decision' && room.choice.order[0] === player.id, '还未轮到你选择');
      const offer = room.choice.offers.find(row => row.id === message.id);
      requireValue(offer && !Object.values(room.picked).some(row => row.id === offer.id), '选项不存在或已被选择');
      room.picked[player.id] = offer; room.choice.order.shift();
      if (!room.choice.order.length) room.phase = 'prep';
      this.broadcast(room);
    } else if (message.type === 'result') { this.report(room, player, message); }
    else if (message.type === 'boss-progress') { this.bossProgress(room, player, message); }
    else if (message.type === 'next') {
      requireValue(room.phase === 'settlement' && !player.eliminated, '当前不能进入下一回合'); player.next = true;
      if (this.alive(room).every(p => p.next)) this.advance(room);
      this.broadcast(room);
    } else if (message.type === 'snapshot') {
      requireValue(message.snapshot && finite(message.snapshot.round, 1, 15) && message.snapshot.round === room.round, '视角回合不匹配');
      if (this.now() - (player.lastSnapshot || 0) < 65) return; player.lastSnapshot = this.now();
      // 视角是表现消息：不从中读 hp/funds/boss damage 来执行规则。
      player.snapshot = message.snapshot;
      for (const p of room.players) if (p !== player) this.send(p.connection, {type: 'snapshot', playerId: player.id, snapshot: message.snapshot});
    } else if (message.type === 'checkpoint') {
      requireValue(message.checkpoint?.version === 1 && message.checkpoint.online?.config?.runId === room.config?.runId, '恢复点不属于本局');
      // 恢复点只返回本人；队友不能拿它控制商店或窃取重连凭证。
      player.checkpoint = message.checkpoint;
      this.send(connection, {type: 'checkpoint-ack', savedAt: this.now()});
    } else if (message.type === 'transfer') {
      const record = message.record;
      requireValue(record && record.senderId === player.id && validId(record.transferId), '转交身份错误');
      const recipient = room.players.find(p => p.id === record.recipientId && !p.eliminated);
      requireValue(recipient && this.data.profiles[record.chessId], '转交目标无效');
      room.transfers[record.transferId] ??= structuredClone(record);
      this.send(recipient.connection, {type: 'transfer', record: room.transfers[record.transferId]});
      this.send(connection, {type: 'transfer-ack', transferId: record.transferId});
    } else if (message.type === 'leave') { this.leave(room, player); }
    else if (message.type === 'ping') this.send(connection, {type: 'pong', clientTime: message.clientTime, serverTime: this.now()});
    else throw Error('未知联机消息');
  }
  hello(connection, message) {
    helloValid(message, this.rulesHash);
    requireValue(!connection.roomId, '连接已经进入房间');
    let room, player;
    if (message.resumeToken) {
      room = this.rooms.get(message.roomId);
      player = room?.players.find(p => p.resumeToken === message.resumeToken);
      requireValue(player && (player.connection || this.now() - player.disconnectedAt < RECONNECT_WINDOW_MS), '重连凭证无效或已过期');
      if (player.connection && player.connection !== connection) player.connection.close(4001, '已从另一窗口重连');
    } else {
      // 校验昵称/头像先于建房；错误请求不能占用空房名额。
      const profile = profileOf(message.profile);
      requireValue(!message.roomId || typeof message.roomId === 'string', '房间号格式错误');
      room = message.roomId ? this.rooms.get(message.roomId.toUpperCase()) : null;
      if (message.create) {
        this.sweep(); // 先释放已到期的断线房间；现有房间不驱逐、不抢占。
        requireValue(this.rooms.size < this.maxRooms, `服务器房间已满（最多 ${this.maxRooms} 个），请加入已有房间或稍后再试`);
        let id;
        do { id = randomBytes(3).toString('hex').toUpperCase(); } while (this.rooms.has(id));
        room = {id, phase: 'waiting', revision: 0, round: 1, players: [], log: [], transfers: {}, reports: {}, picked: {}};
        this.rooms.set(id, room);
      }
      requireValue(room?.phase === 'waiting', '房间不存在或已经开始');
      requireValue(room.players.length < MAX_PLAYERS, '房间已满');
      player = {id: token().slice(0, 16), resumeToken: token(), seat: [1,2,3,4].find(seat => !room.players.some(p => p.seat === seat)),
        profile, flags: {sees: message.flags?.sees === true}, bandId: null,
        ready: false, next: false, hp: null, maxHp: null, eliminated: false};
      room.players.push(player); room.hostId ??= player.id;
    }
    player.connection = connection; connection.roomId = room.id; connection.playerId = player.id;
    this.send(connection, {type: 'welcome', playerId: player.id, resumeToken: player.resumeToken, roomId: room.id,
      checkpoint: player.checkpoint || null, serverTime: this.now()});
    this.broadcast(room);
    for (const peer of room.players) if (peer !== player && peer.snapshot) this.send(connection, {type: 'snapshot', playerId: peer.id, snapshot: peer.snapshot});
    for (const record of Object.values(room.transfers)) if (record.recipientId === player.id) this.send(connection, {type: 'transfer', record});
  }
  makeConfig(raw = {}, count) {
    const modeId = raw.modeId || 'mode_single_normal'; requireValue(MODES.includes(modeId), '难度无效');
    const seed = randomBytes(4).readUInt32LE();
    const mapId = resolveMapId(this.data, raw.mapId || 'random', waveRng((seed ^ 0x9e3779b9) >>> 0));
    requireValue(this.data.maps.some(m => m.stageId === mapId && m.weight > 0), '地图无效');
    const ban = normalizeBondBan(raw.bondBan || {}, this.data);
    const bossId = rollFinalBoss(this.data, modeId, seed);
    return {runId: token().slice(0, 16), modeId, mapId, seed, initialPlayers: count, bossMultiplier: BOSS_MULTIPLIERS[count],
      bossId, bossMaxHp: finalBossConfig(this.data, bossId, modeId, .75).hp * BOSS_MULTIPLIERS[count],
      waveTable: raw.waveTable ? normalizeWaveTable(raw.waveTable) : defaultWaveTable(),
      bondBan: {...ban, bonds: bondBanIds(this.data, seed, ban)},
      waveRoster: createWaveRoster({data: this.data, modeId, random: waveRng(seed)})};
  }
  beginBattle(room) {
    const turn = roundPlan(this.data, room.config.modeId).find(t => t.round === room.round);
    const boss = !!turn.isBossTurn;
    room.phase = boss ? 'boss' : 'main'; room.reports = {}; room.supportPlayers = [];
    room.rewards = Object.fromEntries(room.players.map(p => [p.id, 0])); room.rewarded = new Set();
    room.task = {id: `${room.config.runId}:${room.round}:main`, kind: boss ? 'boss' : 'main', startedAt: this.now() + 700,
      bossMaxHp: boss ? room.config.bossMaxHp : null};
    if (boss) room.boss = {maxHp: room.config.bossMaxHp, hp: room.config.bossMaxHp, contributions: {}};
    this.log(room, boss ? '最终攻势开始' : `第 ${room.round} 回合道中开始`);
  }
  validateEnemies(rows, room, support = false) {
    requireValue(Array.isArray(rows) && rows.length <= 5000, '敌人报告过大');
    const seen = new Set(), input = new Map((room.task.input || []).map(row => [row.key, row]));
    for (const row of rows) {
      const raw = this.data.enemies[row?.id] || this.data.enemyDependencies?.[row?.id];
      requireValue(raw && validId(row.key) && !seen.has(row.key) && room.players.some(p => p.id === row.sourcePlayerId), '敌人身份或来源无效');
      requireValue(finite(row.leak, 0, 100) && row.leak === Number(raw.lifePointReduce ?? 1), '敌人扣血值不匹配');
      requireValue(row.scale && ['atk', 'hp', 'moveSpeed'].every(key => finite(row.scale[key], 0, 1000)), '敌人战斗倍率无效');
      requireValue(row.bountyReward === null || finite(row.bountyReward, 0, 100), '悬赏数值无效');
      if (support) {
        const origin = input.get(row.key) || input.get(row.rootKey);
        requireValue(origin && origin.sourcePlayerId === row.sourcePlayerId, '联防改变了敌人原始来源');
        if (input.has(row.key)) requireValue(origin.id === row.id && origin.bountyReward === row.bountyReward, '联防改变了敌人种类或悬赏');
        else requireValue(row.derived === true && row.bountyReward === null, '新衍生敌人不能凭空带悬赏');
      }
      seen.add(row.key);
    }
    return structuredClone(rows);
  }
  report(room, player, message) {
    if (room.reports[`${message.taskId}:${player.id}`]) {
      this.send(player.connection, {type: 'result-ack', taskId: message.taskId}); return;
    }
    requireValue(['main', 'support', 'boss'].includes(room.phase) && !player.eliminated && message.taskId === room.task.id, '战斗报告已过期');
    requireValue(room.phase !== 'support' || room.task.playerId === player.id, '联防任务不属于你');
    requireValue(finite(message.elapsed, 0, 10000), '战斗时间无效');
    const remaining = this.validateEnemies(message.remaining || [], room, room.phase === 'support');
    const kills = this.validateEnemies(message.killedBounties || [], room, room.phase === 'support');
    requireValue(!kills.some(row => remaining.some(e => e.key === row.key)), '同一敌人不能既漏失又击倒');
    if (room.phase === 'main') requireValue([...remaining, ...kills].every(row => row.sourcePlayerId === player.id), '道中报告来源不属于本人');
    for (const enemy of kills) if (!room.rewarded.has(enemy.key)) {
      room.rewarded.add(enemy.key); room.rewards[player.id] += enemy.bountyReward || 0;
    }
    const report = {remaining, elapsed: message.elapsed, perfect: message.perfect === true && !remaining.length};
    room.reports[`${message.taskId}:${player.id}`] = report;
    this.send(player.connection, {type: 'result-ack', taskId: message.taskId});
    if (room.phase === 'boss') {
      if (this.alive(room).every(p => room.reports[`${room.task.id}:${p.id}`])) this.finish(room, false);
    } else if (room.phase === 'main') {
      if (this.alive(room).every(p => room.reports[`${room.task.id}:${p.id}`])) {
        const reports = this.alive(room).map(p => ({p, r: room.reports[`${room.task.id}:${p.id}`]}));
        const leaks = reports.flatMap(row => row.r.remaining);
        room.supportPlayers = reports.filter(row => row.r.perfect).sort((a, b) => a.r.elapsed - b.r.elapsed || a.p.seat - b.p.seat).slice(0, 2).map(row => row.p.id);
        room.supportIndex = 0;
        if (leaks.length && room.supportPlayers.length) this.startSupport(room, leaks);
        else this.settle(room, leaks);
      }
    } else {
      // 未报告为漏怪的输入敌人必须已被处理。赏金以明确击倒账本发放，
      // 不能因为客户端缺了一条敌人记录就推定其击倒并付款。
      room.supportIndex++;
      if (remaining.length && room.supportIndex < room.supportPlayers.length) this.startSupport(room, remaining);
      else this.settle(room, remaining);
    }
    this.broadcast(room);
  }
  startSupport(room, input) {
    room.phase = 'support';
    room.task = {id: `${room.config.runId}:${room.round}:support:${room.supportIndex}`, kind: 'support',
      playerId: room.supportPlayers[room.supportIndex], input, startedAt: this.now() + 500};
    this.log(room, `联防 ${room.supportIndex + 1}：${input.length} 名敌人`);
  }
  settle(room, remaining) {
    room.losses = lossesBySource(room.players, remaining);
    for (const p of this.alive(room)) { p.hp = Math.max(0, p.hp - room.losses[p.id]); p.eliminated = p.hp <= 0; p.ready = false; p.next = false; }
    room.lastSettlement = {round: room.round, losses: {...room.losses}, rewards: {...room.rewards},
      players: room.players.map(p => ({id: p.id, hp: p.hp}))};
    room.phase = this.alive(room).length ? 'settlement' : 'finished'; room.success = false;
    this.log(room, '联防结算完成');
  }
  advance(room) {
    room.round++; room.task = null; room.choice = null; room.picked = {}; room.boss = null;
    for (const p of room.players) { p.ready = false; p.next = false; }
    const decision = decisionForRound(this.data, room.config.modeId, room.round, room.config.seed);
    room.phase = decision ? 'decision' : 'prep';
    if (decision) room.choice = {...decision, order: rotateOrder(this.alive(room).map(p => p.id), room.round)};
  }
  bossProgress(room, player, message) {
    if (room.phase === 'finished' && room.task?.id === message.taskId) return;
    requireValue(room.phase === 'boss' && room.task.id === message.taskId && !player.eliminated, 'Boss 进度不属于当前战斗');
    requireValue(finite(message.damage) && finite(message.healing), 'Boss 伤害数据无效');
    const before = room.boss.contributions[player.id] || {damage: 0, healing: 0};
    requireValue(message.damage >= before.damage && message.healing >= before.healing, '累计 Boss 进度不能倒退');
    // 累计数替代单次加法，重连/重发同一累计值不会重复扣血。
    if (message.damage === before.damage && message.healing === before.healing) return;
    room.boss.contributions[player.id] = {damage: message.damage, healing: message.healing};
    room.boss.hp = Math.max(0, Math.min(room.boss.maxHp, room.boss.hp - (message.damage - before.damage) + (message.healing - before.healing)));
    if (room.boss.hp <= 0) { this.finish(room, true); this.broadcast(room); }
    else for (const p of room.players) this.send(p.connection, {type: 'boss', boss: room.boss});
  }
  finish(room, success) { room.phase = 'finished'; room.success = success; this.log(room, success ? '共同击破 Boss，挑战成功' : '挑战结束'); }
  disconnect(connection) {
    const room = this.rooms.get(connection.roomId), p = room?.players.find(p => p.id === connection.playerId);
    if (!p || p.connection !== connection) return;
    p.connection = null; p.disconnectedAt = this.now(); p.ready = false;
    this.log(room, `${p.profile.name} 断线，保留两分钟重连`); this.broadcast(room);
  }
  leave(room, player) {
    const connection = player.connection;
    if (room.phase === 'waiting') {
      room.players = room.players.filter(p => p !== player);
      if (room.hostId === player.id) room.hostId = room.players[0]?.id;
    } else {
      // 主动退出与重连断线不同；它按下面的缺席结算推进，不能让全房永久等候。
      player.connection = null; player.disconnectedAt = 0; this.expirePlayer(room, player);
    }
    if (connection) { delete connection.roomId; delete connection.playerId; this.send(connection, {type: 'left'}); }
    if (!room.players.length) this.rooms.delete(room.id); else this.broadcast(room);
  }
  expirePlayer(room, player) {
    if (room.phase === 'waiting') { room.players = room.players.filter(p => p !== player); if (room.hostId === player.id) room.hostId = room.players[0]?.id; return; }
    if (['briefing', 'strategy'].includes(room.phase)) { this.finish(room, false); return; }
    // 战斗断线超时无法证明本地结果。明确淘汰缺席者并记录原因，不伪造完美/击倒报告。
    player.eliminated = true; player.hp = 0;
    this.log(room, `${player.profile.name} 重连超时，淘汰`);
    if (!this.alive(room).length) return this.finish(room, false);
    if (room.phase === 'support' && room.task.playerId === player.id) {
      const input = room.task.input; room.supportIndex++;
      while (room.supportIndex < room.supportPlayers.length && room.players.find(p => p.id === room.supportPlayers[room.supportIndex])?.eliminated) room.supportIndex++;
      if (room.supportIndex < room.supportPlayers.length) this.startSupport(room, input); else this.settle(room, input);
    } else if (room.phase === 'main' || room.phase === 'boss') {
      // 触发已有收齐报告逻辑：此处缺席者没有资格参与联防。
      const pending = this.alive(room).filter(p => !room.reports[`${room.task.id}:${p.id}`]);
      if (!pending.length) {
        if (room.phase === 'boss') this.finish(room, false);
        else {
          const reports = this.alive(room).map(p => ({p, r: room.reports[`${room.task.id}:${p.id}`]}));
          const leaks = reports.flatMap(row => row.r.remaining);
          room.supportPlayers = reports.filter(row => row.r.perfect).sort((a, b) => a.r.elapsed - b.r.elapsed || a.p.seat - b.p.seat).slice(0, 2).map(row => row.p.id);
          room.supportIndex = 0;
          if (leaks.length && room.supportPlayers.length) this.startSupport(room, leaks); else this.settle(room, leaks);
        }
      }
    } else if (room.phase === 'decision') {
      room.choice.order = room.choice.order.filter(id => id !== player.id); if (!room.choice.order.length) room.phase = 'prep';
    } else if (room.phase === 'settlement' && this.alive(room).every(p => p.next)) this.advance(room);
    else if (room.phase === 'prep' && this.alive(room).every(p => p.ready && p.connection)) this.beginBattle(room);
  }
  sweep() {
    for (const room of this.rooms.values()) {
      for (const p of [...room.players]) if (!p.connection && !p.eliminated && this.now() - p.disconnectedAt >= RECONNECT_WINDOW_MS) {
        this.expirePlayer(room, p); this.broadcast(room);
      }
      if (!room.players.length || room.players.every(p => !p.connection && this.now() - p.disconnectedAt > 30 * 60_000)) this.rooms.delete(room.id);
    }
  }
}
