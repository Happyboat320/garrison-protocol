// 结城理 char_4217_makoto（6 星特种／傀儡师，联动隐藏档 chess_collab_makoto）
//
// 傀儡师的替身机制在本客户端已有实现：native-effects 的 tickDoll／enterDoll 维护 `actor.dollForm={until,nextAt}`（20 秒，
// 来自特性黑板 duration），native-fx 的 drawDollOverlay 只画表现。结城理要在此之上加**人格面具**：
// 游戏数据里人格面具不是独立单位，攻击档案全挂在三个技能的黑板 `attack@*` 上。
//
// 天赋一「不羁之力」（profile.activeTalents 里带 sluggish 的那条；无潜能 PHASE_2：atk=.8、base_attack_time=.4（加算）、
//   sluggish=8、max_hp_t1=.35）：
//   ① 切换为替身状态时，停顿周围一定范围内敌人 sluggish 秒；
//   ② 替身状态下攻击力 +atk、生命值 +max_hp_t1、攻击间隔 +base_attack_time（乘算/加算口径按黑板 key 字面：
//      atk／max_hp_t1 是比例，base_attack_time 是**加算的秒数**）。
// 天赋二「S.E.E.S. 总攻击」（带 atk_scale 的那条；无潜能 PHASE_2 atk_scale=4.3）：
//   替身状态结束后，带领 S.E.E.S. 小队发动总攻击，对小队队员（teamId==='sees'）周围一定范围内所有敌人
//   造成结城理攻击力 × atk_scale 的**真实伤害**（可叠加）。
//
// 三个技能都是「被动：替身状态召唤某个人格面具；主动：立即切换为替身状态作战」（持续 0 秒，切换即结束）：
//   S1 俄耳甫斯        ：攻击造成 attack@atk_scale 法术伤害；范围内有生命 <50% 的友方干员时改为治疗其 attack@heal_scale。
//                        专三：atk_scale=2.8、heal_scale=0.6。PRTS 备注：**不可对空**。
//   S2 塔纳托斯        ：攻击对至多 attack@max_target 名敌人造成 attack@atk_scale 法术伤害并有 attack@prob 概率恐惧
//                        attack@fear 秒；范围内**恐惧中**的敌人若生命值低于结城理攻击力 × attack@kill_atk_scale
//                        则立刻倒下（attack@kill_damage=9999999 无来源真实伤害；斩杀光环**可对空**）。
//                        专三：max_target=4、atk_scale=2.5、prob=.35、fear=1.5、kill_atk_scale=2.8。
//   S3 塔纳托斯·改     ：替身状态初始召唤塔纳托斯·改，攻速 +talent@attack_speed，攻击对至多 attack@max_target 名敌人
//                        造成 attack@atk_scale 的**弱点伤害**；在场时开启技能或受到致命伤改为召唤俄耳甫斯·改，
//                        阻挡数 +attack@block_cnt(=2)，使范围内友方干员获得 attack@prob 物理与法术闪避，
//                        并每秒治疗范围内最多 attack@max_target_heal 名友方干员 attack@heal_scale 的生命值，
//                        直到替身状态结束。专三：attack_speed=60、atk_scale=2.3、heal_scale=.35、prob=.4、
//                        max_target=4、max_target_heal=4。PRTS 备注：塔纳托斯·改**普通攻击可对空**（已登记在 SKILL_ANTIAIR）。
//
// 回归：tests/native-collab-makoto.test.mjs（新文件，必须验证「改回本文件前会失败」）
export const hooks={
 statMods(battle,unit,out){/* TODO：替身形态的攻/血/攻击间隔与 S3 的攻速、闪避光环 */ },
 attackModifier(battle,unit,target,value){/* TODO：人格面具的攻击档案（法术伤害／弱点伤害倍率／目标数） */ },
 skillStart(battle,unit,ctx){/* TODO：切换替身、切换人格面具、S2 斩杀光环、S3 的每秒治疗 */ },
 event(battle,unit,type,payload,ctx){/* TODO：替身结束时的 S.E.E.S. 总攻击 */ },
 tick(battle,unit,ctx){/* TODO：替身形态的周期结算（治疗、斩杀复查） */ }
};
