# Bond Centre 5.1.3.1（2026-09-15）

- “结果”提交到AI后台识别后，按钮内显示Libraries.dev Thinking Orbs的`connecting`动画，采用专门调校的20px内联版本和深色背景配色。
- 替换原双层波纹；识别完成的勾选提示、失败提示、结果核对和人工确认流程保持不变。
- 离开可见区域或切换后台标签页时暂停动画；启用系统“减少动态效果”时显示静态Orb；处理结束后停止绘制并清理监听。
- 原生页面直接使用thinking-orbs 0.3.1提供的Canvas引擎，同源托管，不加载外部CDN或React运行时。MIT许可保留于vendor/thinking-orbs/LICENSE；npm run vendor:orbs可从固定版本依赖重建该资源。

页面版本5.1.3.1，npm版本5.1.3-1。仅发布Bond Centre代码与动画资源，不改动数据库、模型请求、识别逻辑或Gateway。
