// 埃癸斯 char_4218_aigis（5 星狙击／裂空炮手，联动隐藏档 chess_collab_aigis）
//
// 天赋「反暗影特殊压制兵装」（第二格天赋；数值从 profile.activeTalents 黑板读，无潜能档）：
//   造成的物理伤害 +`damage_scale`-1（1.1 → +10%），受到的物理伤害 -`damage_resistance`（0.1 → -10%）。
//   → 「造成」挂 attackModifier（只在 type==='physical' 时乘 damage_scale）；
//   → 「受到」挂 damageReduction（只在 type==='physical' 时把减免抬到 damage_resistance）。
// 分支「裂空炮手」已经由 BRANCH_POLICIES.skybreaker 实现（可对空、非技能期只打空中与自身阻挡、
// 技能期间溅射半径 1.1、优先攻击自身阻挡的单位）；「起飞／降落」的表现仍未实现，不要在这里补。
//
// S1「启动狂宴模式」（持续 20 秒；黑板 atk／def 是**加成比例**，无潜能专三 atk=1.4、def=0.7）：
//   攻击力 +atk、防御 +def；未阻挡时攻击目标在攻击范围内**随机**选取；技能结束后自身**晕眩** `stun` 秒（10 秒）。
//   → 攻防走 statMods（只在技能生效期间）；随机索敌与结束自晕见下方 TODO 注释。
// S2「全弹发射」（瞬发；黑板 times=6、atk_scale=1.6、kick_atk_scale=3，专三）：
//   锁定范围内一个目标发射 `times` 枚导弹，每枚造成 `atk_scale` 攻击力的物理伤害，
//   之后自身飞踢向目标，对目标及**目标周围敌人**造成 `kick_atk_scale` 攻击力的物理伤害。
//
// 回归：tests/native-collab-aigis.test.mjs（新文件，必须验证「改回本文件前会失败」）
export const hooks={
 // statMods(battle,unit,out)：把加成写进 out.add／out.ratio／out.attackSpeed，并可 push out.parts 说明来源。
 statMods(battle,unit,out){/* TODO */ },
 // skillStart(battle,unit,ctx)：开技那一帧。ctx 里有 dealDamage／applyStatus／addEffect 等结算入口。
 skillStart(battle,unit,ctx){/* TODO */ }
};
