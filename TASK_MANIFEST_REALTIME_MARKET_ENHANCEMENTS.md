# Task Manifest

## Goal

增强实时行情 Tab：加入中债/中证估值、可配置行情列、跨页面未读变动、到价提醒和 Bid/Ofr 点击复制。

## Outputs

- `realtime-quotes.js`：列排序/拖动/隐藏、后台轮询、变动轨迹、目标价和复制话术。
- `functions/api/dm/realtime-valuations.js`：低频读取 DM 最新可用中债/中证 YTM/YTE 与净价。
- `index.html`、`styles.css`：可配置深色行情表、到价提醒栏及变化闪烁样式。
- `styles.css`：将状态圆点、`LIVE` 与轮询说明收拢为一组，避免宽容器把 `LIVE` 推到标题区右侧。
- `realtime-quotes.js`：导入时过滤地区/分组标题，并在 DM 精确匹配失败后自动移除无效项。
- `functions/api/dm/realtime-quotes.js`：纯数字代码也必须由 DM 基础资料确认，不再把未知编号强行保留为债券。
- `realtime-quotes.js`、`styles.css`：债券列加宽，简称完整换行显示，不再被省略号截断；券码保持单行。

## Verification

- `npm test`：487 passed，0 failed；实时行情与页面资产针对性测试 47 passed，0 failed。
- Wrangler Pages 本地预览：桌面端与 390×844 移动端已检查，控制台无错误。
- 本机未配置 `INNO_APP_KEY` / `INNO_APP_SECRET`，真实 DM 估值与行情仍需在生产环境验收。

## Next

- 生产联调时核对 DM 返回的中债/中证估值日期、行权/到期口径及净价字段。
- 浏览器后台计时器可能被系统节流；页面会持续尝试轮询并累计实际收到的全部未读变动。
