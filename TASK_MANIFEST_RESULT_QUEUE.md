# Task Manifest

## Goal

将发行结果录入改为不遮挡工作区的紧凑浮层，并支持多项目后台串行识别、右下角复核通知及安全的相对缴款日解析。

## Outputs

- `index.html` / `styles.css` / `app.js`: 4.2.0 结果录入浮层、浏览器内串行队列、项目级状态提示和人工复核入口。
- `issuance-queue.js`: 单并发识别队列，单笔失败不阻塞后续任务。
- `issuance-recognition.js`: 以原通知日期为锚点识别“明天、周一、下周一缴款”，并防止跨品种误套日期。

## Changes

- 识别完成前不展开项目结果表单；完成后仅提示复核，只有用户点击确认才写入台账。
- 识别期间允许切换项目继续录入；同一项目不重复并发，品种结构变化会使旧结果失效。
- 产品版本更新为 `4.2.0`，内部构建为 `4.2.0.1`。

## Verification

- `npm test`: 477 项通过，0 项失败。
- `node --test tests/assets.test.js tests/issuance-queue.test.js tests/issuance-recognition.test.js`: 68 项通过，0 项失败。
- 本地 Wrangler Pages：桌面与 390×844 手机视口均验证浮层定位、关闭、排队失败通知及通知跳回复核；控制台无新增错误。

## Next

- 合并并部署生产 `main` 后核对线上版本与 Cloudflare Pages 状态。
