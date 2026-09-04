# Task Manifest

## Goal

让发行结果录入浮层始终附着在“结果”按钮下方，并随页面一起滚动。

## Changes

- `index.html`：将浮层移入结果按钮的相对定位锚点。
- `styles.css`：由视口固定定位改为按钮下方的绝对定位。
- `app.js`：移除滚动时重算视口位置，仅在打开或窗口缩放时校正横向边界。
- 第一方资源缓存键更新为 `20260904-result-anchor`，内部构建更新为 `4.2.0.3`。

## Verification

- `node --test tests/assets.test.js`：通过。
- 本地浏览器滚动核验：页面下滚 720px 后，按钮与浮层同步上移 720px，浮层顶边持续位于按钮底边下方 9px；通过。

## Next

- None.
