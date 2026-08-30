# Task Manifest

## Goal

防止 Bond Centre 的多来源保存互相静默覆盖，并提供可审计、可回溯的版本历史与闲置安全退出。

## Outputs

- `state-history.js`: 状态差异摘要、等价比较和保存来源规范化。
- `functions/api/state-history.js`: 版本历史列表 API。
- `functions/api/state-history/[id].js`: 快照详情与回溯 API。
- `functions/api/_state-versioning.js`: D1 revision、原子保存、冲突快照和 50 版保留策略。

## Changes

- `app.js`, `index.html`, `styles.css`: 本机脏状态保护、revision 同步、冲突提示、历史 UI，以及前台闲置 15 分钟后 60 秒倒计时保存并退出。
- `schema.sql`, `functions/api/_auth.js`, `functions/api/state.js`: 运行时无损迁移、乐观并发控制和 1.8 MB 状态保护上限。
- `tests/api.test.js`, `tests/assets.test.js`, `tests/state-history.test.js`: 覆盖版本保存、过期写入、冲突保留、回溯、大小限制和前端资源版本。
- `README.md`: 记录同步、历史和闲置退出行为。

## Verification

- `npm test`: 401/401 tests passed。
- `node --check ...` 与 `git diff --check`: passed。
- 本地 Wrangler + D1：旧状态迁移为 revision 0；原子保存/恢复至 revision 3；过期 revision 返回 409 且保留 conflict snapshot。
- In-app Browser：历史列表、旧版详情、冲突详情与桌面布局通过；无新增 console error。

## Next

- 发布后继续观察真实多来源冲突；超过 1.8 MB 的状态会被拒绝写入并提示先导出、拆分。
