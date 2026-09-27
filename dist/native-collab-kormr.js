// 虎狼丸 char_4220_kormr（1 星近卫／剑豪，联动隐藏档 chess_collab_kormr）
//
// 天赋「黑色猎犬」（PRTS revisionId 424872；数值只从 profile.activeTalents 的黑板读，无潜能档）：
//   部署后对周围一定范围内**最近的 1 名敌人**发动**总计 6 次无视闪避**的斩击，每次造成相当于攻击力
//   `atk_scale` 的法术伤害，**最后一次**斩击改为造成攻击力 `final_atk_scale` 的法术伤害并使目标
//   **恐惧** `fear` 秒。无潜能档：atk_scale=1、final_atk_scale=2、fear=4（满潜 2／4／4）。
// 没有主动技能（skillRefs 为空）。特性「普通攻击连续造成两次伤害」由 BRANCH_POLICIES.sword 提供。
//
// 回归：tests/native-collab-kormr.test.mjs（新文件，必须验证「改回本文件前会失败」）
export const hooks={
 // deploy(battle,unit)：在 native-effects 的 deploy 事件里调用，此时 unit 已经落位。
 deploy(battle,unit){/* TODO */ }
};
