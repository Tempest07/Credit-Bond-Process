# Task Manifest

## Goal

修复发行结果录入浮层打开时，底层“增加品种”等控件穿透并凸出浮层的问题。

## Outputs

- `styles.css`: 为打开状态的结果录入锚点建立前景层级。
- `app.js`: 打开与关闭浮层时同步锚点的层级状态。
- `tests/assets.test.js`: 增加浮层层级状态的静态回归检查。

## Changes

- 结果浮层打开时，为整个锚点容器添加 `is-open` 状态并提升层级，而不是只提高浮层内部的 `z-index`。
- 关闭、切换项目或完成排队后会移除前景层状态，避免影响其他页面控件。
- 内部构建更新为 `4.2.0.6`，浏览器缓存键更新为 `20260904-result-popover-layer`。

## Verification

- `node --check app.js`
- `node --test tests/assets.test.js`
- `git diff --check`

## Next

- None.
