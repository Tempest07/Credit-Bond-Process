# 项目表视觉识别

构建 `5.0.2.2`：项目表截图 → Pages `/api/project-screenshot/recognize` → 已鉴权的本机网关 `/v1/project-screenshot` → Ollama `qwen3-vl:8b-instruct` → 原有 DM 全称核验与简称展示。

## 运行

- Ollama 监听本机 `11434`，安装 `qwen3-vl:8b-instruct`。语义识别继续使用 `gpt-oss:20b`。
- `tools/serve-local-issuance-ai.mjs` 默认仅监听 `127.0.0.1:11435`，沿用 `LOCAL_ISSUANCE_AI_TOKEN` 和现有 Cloudflare Tunnel。视觉与语义请求共用一个推理占用标记，忙时返回 429。
- Pages 沿用服务端 `ISSUANCE_LOCAL_AI_ENABLED`、`ISSUANCE_LOCAL_AI_URL`、`ISSUANCE_LOCAL_AI_TOKEN` 配置及已有 Access 凭据；密钥不进入浏览器或日志。
- 本机网关需要同步 `tools/serve-local-issuance-ai.mjs`、`tools/local-project-vision.mjs`、`project-screenshot-vision.js`，并保留其既有 imports。后台计划任务使用的 checkout 必须包含这些文件；更新后在空闲时重启网关。
- 电脑、Ollama 和 Tunnel 必须在线。PNG/JPEG/WebP 原图最大 30 MiB，最长边 16000 像素且不超过 1800 万像素。页面在服务不可用时提示人工补录。

## 数据与验证

模型只读取分行与债券全称；图片内文字作为待识别内容。缺失或不确定的字段保留人工核对，未通过 DM 核验的条目不可复制为确认简称。上传和识别不会自动写入台账。

针对性验证覆盖服务端登录与来源检查、图片格式和体积、上游协议、忙碌/离线响应、网关鉴权、共享推理占用和原有发行协议。用户提供的 6106×483 原图在本机新网关实测识别出 5 条完整记录，分行、全称和期次一致，无警告。Pages Functions 构建通过。

## 回滚

页面可回滚到前一生产部署。新网关保留原有发行接口，可继续运行；若需恢复旧网关，在空闲时恢复升级前备份并重启原网关计划任务。无需更改数据库、Tunnel 或密钥。
