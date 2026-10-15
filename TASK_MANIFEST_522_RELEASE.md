# Bond Centre 5.2.2 发布记录

- 日期：2026-10-15；用户明确要求正式上线 5.2.2 并编写日志。
- 生产基线：`origin/main@644534aa`；发布分支从该提交创建，仅叠加已确认的 OFR/BID 内置模块和缴款单原件核对布局。
- 完整保留 `ab48f01`、`04d37ba`、`644534a` 的债券身份、跨期分组、历史记录匹配和异步查询隔离修复；未回退到本地 beta 的旧基线。
- 产品 / build / npm：`5.2.2`；浏览器资源：`20261015-release-522`。
- 日志：`CHANGELOG-5.2.2.md`、README 版本入口与页面右上角“更新日志”；5.2.1 历史日志保留。
- 验证：完整 `node --test` 699/699；修改模块语法检查；Cloudflare Pages Functions 编译成功；自有代码 `git diff HEAD --check`。PDF.js 许可按上游原样保留。身份核心、lookup API、只读审计工具及原有身份/竞态测试与生产基线无差异。
- 浏览器验证：桌面左右布局、390px 窄屏适配；隔离合成单据验证 PDF 对应页定位与翻页、人工对应后仍需人工缴款确认、刷新保留选择、重复件跳回原始记录、无 PDF 邮件来源查看。合成单据及测试服务均未进入生产数据。
- 发布包含本地 PDF.js 及字体、CMap、解码器与许可。无新增依赖、数据库结构、服务绑定或网关配置变更；不执行数据迁移或清单重新导入。
- 本地 `.local-data`、`.wrangler`、凭据和配置文件由 Git 忽略，发布仅取 Git 已提交文件。
- 发布目标：GitHub `Tempest07/Credit-Bond-Process` 的 `main`，通过现有 Git 集成部署 Cloudflare Pages `credit-bond-process`；入口 `https://tempest07.com/bond-centre/`。
- 发布前回滚点：生产源码 `644534aa` / Pages 部署 `6cdda38b-0ff2-4cdb-9d7a-4f9e97b6d43c`。若需回滚，仅回滚页面部署，保留 D1 清单、缴款单和项目数据。
