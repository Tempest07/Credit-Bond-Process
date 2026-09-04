# Task Manifest

## Goal

在项目中心新增“实时行情” tab：通过导入券码或券名维护关注列表，以 15/20/30 秒频率轮询 DM 实时行情，展示最优 Bid/Ofr，并采用紧凑、深色、专业报价终端风格。

## Outputs

- `realtime-quotes.js`：关注券导入、轮询生命周期、状态管理和行情表格渲染。
- `functions/api/dm/realtime-quotes.js`：券码/券名解析、DM 实时行情查询和稳定输出结构。
- `index.html`、`styles.css`、`app.js`：实时行情 tab、导入弹窗、深色响应式界面和应用集成。
- `tests/dm-realtime-quotes.test.js`、`tests/realtime-quotes.test.js`、`tests/assets.test.js`：接口、解析器和静态集成测试。
- `README.md`：使用方式、数据来源及 DM 聚合行情限制。

## Verification

- `npm test`：471 tests passed，0 failed。
- `git diff --check`：通过（仅 Git 的 CRLF 转换提示）。
- Wrangler Pages 本地预览：桌面端和 390×844 移动端已检查。
- 已验证导入、轮询错误态、待查询行、暂停/恢复和响应式导入弹窗。
- 本机未配置项目所需的 `INNO_APP_KEY` / `INNO_APP_SECRET`，因此未对真实 DM 权限和实时数据做在线联调。

## Data Boundary

DM V2.5 的 `realtime-quote` 接口按债券返回经纪商聚合最优报价和最新成交，不返回单个中介名称。因此界面明确标记为“DM 经纪商聚合”，不伪造平安、中诚、国际、信唐、上田、国利等逐中介明细。

## Next

在具备服务端 DM 密钥和该接口权限的预览/生产环境做一次真实行情验收，重点核对券名解析、收益率/净价单位、报价时间和无行情状态。
