# Bond Centre 5.2.1 发布记录

- 日期：2026-10-08；用户明确要求上线 5.2.1。
- 基线：`origin/main` 的 `bbef63a`；在独立 worktree 整理正式版，保留主线 OFR/BID 清单和网关路径修复。
- 范围：流程意见 C 方案布局、黑白灰配色、字段按钮定位与框线高亮；原生正文编辑及纯文本复制保留。
- 产品 / build / npm：`5.2.1`；浏览器资源：`20261008-release-521-r2`。
- 验证：`npm ci --ignore-scripts --no-audit --no-fund`；`npm test` 635/635；修改模块的 `node --check`；`git diff --check`。
- Beta 已验证桌面及 390px 宽度下的框线、滚动定位、编辑清除与纯文本复制。
- 不含本地预览数据库、日志、凭据或数据快照；未改动服务绑定、数据结构和网关配置。
- 发布目标：GitHub `Tempest07/Credit-Bond-Process` 的 `main` / Cloudflare Pages `credit-bond-process`，公开入口 `https://tempest07.com/bond-centre/`。
- 发布前生产部署：`bf34e67f-ff97-4c67-aba5-8828275c5285`，源码 `bbef63a`，可用于故障回滚。
- 同日修正：浮点宽度被 clientWidth 取整造成正文与镜像换行不同；改为保留小数尺寸并扣除滚动条。浏览器扫描 450–589.75px（步进 0.25px），原先 6 个宽度出现一行差异，修复后 560 个宽度全部一致；移除叠加的内层聚焦边框。
