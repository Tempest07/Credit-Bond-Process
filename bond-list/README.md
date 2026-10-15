# OFR / BID 清单

入口：Bond Centre 内部导航「OFR/BID 清单」，对应 `#bond-list` 视图。原 `/bond-centre/bond-list/` 链接转入同一模块。沿用 Gateway 登录和服务端 DM 配置。

- 编辑器与其他模块共用 Bond Centre 页面、导航及 UI 样式，切换视图保留输入。`bond-list-editor.js` 负责清单编辑与保存，`bond-list-editor.css` 仅作用于本模块。
- `/api/bond-list/state` 继续按登录用户读写 D1 `bond_list_drafts`，使用 revision 条件更新保护多窗口写入，保持已有清单数据格式。
- `/api/bond-list/lookup` 复用现有 DM 加密客户端，只查询基础信息，唯一精确匹配才补码；保留双边报价和原文。
- 初始清单不随静态资源发布。首次发布通过受控 D1 导入当前用户数据；没有清单的账号只得到空分行。
- 本地调试使用现有 `npm run prepare:local` 和 `wrangler pages dev`；本地凭据留在忽略的 `.dev.vars`。
- 新 API 鉴权、来源检查、请求大小限制、并发冲突及匹配规则见 `tests/bond-list.test.js`。

回滚页面与 API 可回滚本次生产提交；D1 清单保留，不删除已有报价。新增表不会改写原有 `user_app_state`。
