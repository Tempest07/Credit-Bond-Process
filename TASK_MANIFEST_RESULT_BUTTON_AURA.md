# Task Manifest

## Goal

将“结果”按钮内部异常闪烁的白点替换为按钮外沿的队列状态光效。

## Changes

- `app.js`：队列状态改挂在结果按钮外层锚点，并补充 `aria-busy`。
- `styles.css`：处理中显示双层外扩波纹，待核对显示柔和呼吸光晕；保留按钮自身点击涟漪。
- 第一方资源缓存键更新为 `20260904-result-aura`，内部构建更新为 `4.2.0.4`。

## Verification

- `node --check app.js`：通过。
- `node --test tests/assets.test.js`：38 项通过。
- 本地浏览器视觉核验：处理中双层波纹与待核对呼吸光晕均生效，原按钮内部状态点已移除。

## Next

- None.
