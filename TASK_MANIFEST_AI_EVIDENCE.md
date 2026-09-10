# 5.1.2beta — AI Beta 估值证据改进（本地，未发布）

- 基线 b4290ba；独立分支 codex/valuation-evidence-review。不得修改隔壁 codex/bond-511beta 或运行中的生产工作区。
- 模型仍为 gpt-oss:20b；改进输入、结构化依据、程序核验与反馈检索，未训练权重。
- 期限调整仅支持明确不调整、同日曲线差、同属性券对斜率。模型自主选券、方法和权重；程序提供计算辅助并独立复算。结构不匹配、错误方向/幅度均拒绝。
- 当前输入没有独立市场溢价证据，因此不能凭空做市场加减点；sourceSpreadBp 不作调整，主体相对曲线利差保留。区间仅能展示采用券折算值的非零分歧。
- UI分开展示期限/市场调整、引用节点或券对、缺失曲线原因；零调整明确标为未调整期限参考。旧结果不冒充新版核验结果。
- 经验保留完整人工反馈，模型不再复述旧估值的错误方法。旧经验不删除，复核前不进入新学习检索。没有修改生产历史数据。

## 验证

- 30 项相关测试通过（其中新增的界面VM测试最初缺少export处理，修正后单独重跑7项全部通过）；覆盖数值证据、历史错误、混用科创属性、零调整标识、反馈存储、生产接口和DM口径。
- 命令：node --test tests/valuation-evidence.test.js tests/valuation-learning-evidence.test.js tests/valuation-model.test.js tests/valuation-production.test.js tests/valuation-ui.test.js tests/dm-realtime-valuations.test.js
- 本机真实 gpt-oss:20b，读取生产已保存证据重放，不写生产记录；最终版本三笔全部通过，尝试次数1/2/1。
- 陕西金融有曲线：2.0229%，期限+0.8188bp；无曲线：2.0147%未调整参考；张家城投5Y/7Y：1.8605%/2.0751%。这只是相同历史材料的方法复测，不是新的市场估值。
- 本地运行输出在忽略目录 .local-data/replay-results.json，包含历史材料关联ID，不纳入Git。

## 边界及后续合并

- 自然语言理由仍可能混淆品种与发行方式、插值与外推；程序核验能保障已支持方法的引用和计算，不能证明选券或市场定价最优。
- 尚未发布、未重启生产gateway、产品版本已标记5.1.2beta（package semver 5.1.2-beta）。合并至后续版本时需同步发布 valuation-model.js 与本地gateway（promptVersion契约必须一致），按正常发布授权执行。
- 改动涉及 valuation-model.js、valuation-assistant.js、tools/local-valuation-model.mjs、tools/valuation-store.mjs、functions/api/dm/valuation.js及相关测试；与5.1.1合并需核对这些文件，保留其其他功能。

## 发布约束（用户明确要求）

本版本编号5.1.2beta，只保留本地，不推送、不部署。等待5.1.1上线后再讨论合并与发布；5.1.1上线本身不构成自动发布授权。

## 5.1.2发布授权

用户已明确要求上线5.1.2并合并5.1.1，取代此前不发布约束。已合并origin/main的01730b0。190项合并后定向测试和Pages Functions编译通过。本地生产gateway继续使用原工作区及原数据目录，更新代码后重启。
