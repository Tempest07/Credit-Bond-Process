# Bond Centre 5.0.1.20

## 目标与范围

- 仅发布 Bond Centre；Gateway 不在此次发布范围。
- 网页右上角 UI Beta 默认关闭，保留旧版布局；开启后使用新版布局和动效。
- 两种界面共用最新业务逻辑，包括投标结束后直接终止、终止后撤回、日期筛选清空。
- 切换只重排现有 DOM 和启停新版样式；保留输入与结果录入浮层，列表中的历史选中项不会自动展开。
- 浏览器仅保存 `bond-centre-ui-beta` 外观偏好；不将偏好写入云端资料库。

## 修改位置

- `index.html`、`ui-preference.js`、`ui-mode.js`、`ui-mode.css`：版本、默认旧版、即时切换。
- `workspace-design.css`、`workspace-sections.css`、`workspace-motion.css`：新版界面。
- `app.js`：共享业务交互、新旧布局适配、切换状态修复。
- 模块资源版本参数、package/lock、README 及针对性测试。

## 数据边界

- 本地预览服务器及其内存示例资料位于仓库外，不属于 Git 发布文件。
- 相对 main 4f73d9c，生产 API、持久化、数据库结构、绑定和部署配置无净改动。
- 发布仅推送代码；不运行数据导入、D1 写入、迁移、资料库同步或生产业务操作。
- 原始开发检出的其他本地实验保留原状，不并入此次发布。

## 验证

- assets、UI mode、project actions、workspace dismiss、bid finalization、lifecycle、realtime quotes、DM realtime quotes：119 项通过。
- app/ui-mode/ui-preference 语法检查与 Git diff 检查通过。
- 隔离预览验证默认旧版、偏好刷新保留、两种界面往返、保留选中项时不弹详情、结果原文保留、导航动效及主要页面切换。
- 390px 手机宽度与 Android 本地壳验证开关可用、工具挂载正确、无横向溢出；恢复默认浏览器尺寸。
- 发布后通过 Git main SHA、Pages 部署及静态版本资源只读核验，不在生产创建示例项目。

## 检查入口

- 正式站点：`https://tempest07.com/bond-centre/`
- 打开右上角 UI Beta 开关可启用新版；关闭恢复旧版。
- 页面和完整构建版本为 5.0.1.20；npm SemVer 为 5.0.1。
