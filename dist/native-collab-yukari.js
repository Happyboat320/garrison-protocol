// 岳羽由加莉 char_4219_yukari（5 星辅助／游击手，联动隐藏档 chess_collab_yukari）
//
// 天赋「治愈之风」（数值从 profile.activeTalents 黑板读，无潜能档 max_target=3、heal_scale=1）：
//   技能结束后，治疗**自身**和攻击范围内最多 `max_target` 名干员相当于攻击力 `heal_scale` 的生命值。
//   选取口径：优先生命比例最低者，跳过满血的非自身目标（自身永远可选）。
// 分支「游击手」（supportiveranger）：可对空；「可以使用触发型效果协助作战」——本客户端的第一个
//   触发型效果就是她的 S2，钩子挂在 hooks.event 的 'skill-start' 上（监听友军开技）。
//
// S1「龙卷箭」（瞬发；专三 multi_atk_scale=0.8、final_atk_scale=4、levitate=1.5）：
//   立即发射三发箭矢，每发对目标造成 `multi_atk_scale` 攻击力的**法术**伤害，
//   随后追加一次 `final_atk_scale` 攻击力的**范围**法术伤害并**浮空**所有目标 `levitate` 秒
//   （PRTS 备注：追加伤害的溅射半径为 1.1）。
// S2「明镜止水」（瞬发；专三 max_target=4、duration=15、damage_up=0.3）：
//   为范围内最多 `max_target` 名我方干员（**优先结城理、其次术师干员**）施加触发型效果：
//   该干员施放技能后，自身在 `duration` 秒内获得 `damage_up` 的**术法充盈**。
//
// 回归：tests/native-collab-yukari.test.mjs（新文件，必须验证「改回本文件前会失败」）
export const hooks={
 statMods(battle,unit,out){/* TODO */ },
 // skillStart(battle,unit,ctx)：开技那一帧（S1 的伤害链、S2 的施加都要在这里落地）。
 skillStart(battle,unit,ctx){/* TODO */ },
 // event(battle,unit,type,payload,ctx)：监听者视角，type 里有 'skill-start'／'skill-end' 等；
 // unit 是**持有钩子的干员**，payload.target 才是本次事件的当事人。
 event(battle,unit,type,payload,ctx){/* TODO */ },
 tick(battle,unit,ctx){/* TODO */ }
};
