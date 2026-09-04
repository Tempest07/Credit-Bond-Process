# 发行结果语义识别

## v4.0.0 大版本标记（2026-09-03）

按用户要求，将本功能标为产品大版本 `4.0.0`，内部构建 `4.0.0.1`。首次上线的 `3.3.0.32` 验收记录保留在下文，避免把历史部署误记为新版本。

- 修改：`index.html` 的页面版本与构建号、`package.json` / `package-lock.json` 的产品版本、`README.md` 的版本说明及 `tests/assets.test.js` 的一致性断言。
- 范围：仅版本与说明；模型配置、业务逻辑、数据格式与浏览器模块均未变，资源缓存标记继续使用 `20260903-semantic-issuance`。
- 验证：`node --test --test-name-pattern='exposes a readable product version|versions all first-party browser modules together' tests/assets.test.js`，2/2 通过；`git diff --check` 通过。未重跑云端模型验收，无新增推理调用。
- 发布检查：推送后核对 Cloudflare Pages check 与生产页面 `v4.0.0` / `4.0.0.1` 标记，无需写入真实项目。

## 工作方式

通知原文与当前项目的品种名称交给 Workers AI；内部标位、估值、综合定价和整本台账不发给模型。模型负责识别品种、发行状态和字段含义，程序负责原文证据、身份、单位及日期校验。

- 品种名称由当前项目的候选集合约束，再用原文中的券名/已有券码独立核对，不能靠模型选中名称就认定匹配。
- 每个字段保留原文引用。数值必须是完整数字，不接受从 `1.99` 中摘出 `1`；同时检查原文紧邻单位，不能把倍数变成利率。
- 引用/归属错误最多交回同一个模型校正一次，校正后重新执行全部校验。总超时 90 秒、最多两次调用，不无限重试，也不静默改用正则结果。
- 缺少原通知日期时不能解释“明天”；缺少最终利率时不能确认结果。这些缺失信息不会让模型补造。
- 全部回拨/取消发行必须有明确原文依据；部分回拨不能清空仍发行的品种。
- 识别只产生预览。确认后按品种 ID 写入，中标量与营收仍由现有标位计算，需人工复核。未识别品种保持不变，未披露字段保留原值；取消/全部回拨除外。
- 修改通知或日期、切换项目、关闭弹层会使旧预览失效；取消草稿不会覆盖既有通知。

## 当前模型配置

`functions/api/_issuance-model.js` 是模型与提示词的唯一配置来源。目前使用 Cloudflare Workers AI 的 `@cf/openai/gpt-oss-120b`，`reasoning_effort: medium`、`temperature: 0`、JSON Schema 结构化输出、输出上限 12000 tokens。该服务 ID 没有日期快照后缀，不能声称锁定了供应商未公开的构建版本。

模型不会保证永远正确；校验和确认界面是实际写入前的必要步骤。有限样例通过率不能等同于生产总体准确率。

## 配置与部署边界

Cloudflare Pages 项目 `credit-bond-process` 的 Production 和 Preview 均需添加变量名为 `AI` 的 Workers AI 绑定，保留现有 `DB`、`PAYMENT_RECEIPTS` 和密钥。接口复用项目现有鉴权，匿名线上请求不能触发推理。日志不记录通知正文或模型全文。

**2026-09-03 已完成生产部署与登录后的真实语义识别预览验收。** 已核对 Production/Preview 的 `AI`，功能提交 `0f27956` 的 Cloudflare Pages check 为 success；部署 `https://d3583d97.credit-bond-process.pages.dev` 返回 build `3.3.0.32`、缓存标记 `20260903-semantic-issuance`。新校验模块可访问，匿名识别请求返回 401 / no-store。现有 DB、PAYMENT_RECEIPTS 保留。

忽略的 `wrangler.toml` 是本地假 DB 配置，不能用于生产部署。

## 验证

离线检查：

```powershell
node --test tests/issuance-recognition.test.js tests/lifecycle.test.js tests/reminders.test.js tests/assets.test.js
```

真实模型验收使用隔离本地数据库与远程 AI，调用会消耗 Cloudflare 推理额度；脚本只发识别请求，不写项目数据：

```powershell
npm run prepare:local
npx --yes wrangler@latest pages dev . --port 8791 --persist-to .wrangler/semantic-acceptance --ai AI --show-interactive-dev-session=false
node tools/eval-issuance-recognition.mjs
```

也可在脚本后指定一个或多个 case ID。样例包括 4 个历史故障与 8 个独立合成样例，覆盖倒序、同期限共享字段、全部回拨、取消、中文数字/万元、缺最终利率、不明日期和提示词注入。

### 本机 gpt-oss-20b 隔离验收

本机可使用 Ollama 和 `gpt-oss:20b` 复用生产提示词、JSON Schema、原文证据校验及最多一次校正，并附加版本化的本地 20b 复核提醒。该入口只允许访问 `localhost`，拒绝 Ollama Cloud 和其他模型；不会修改 Pages Function、Cloudflare AI binding、Production 或 Preview 配置。

```powershell
winget install --id Ollama.Ollama -e
ollama pull gpt-oss:20b
npm run eval:issuance:local
```

也可在命令后指定一个或多个 case ID，例如 `npm run eval:issuance:local -- metric-first holdout-transfer`。默认上下文为 16384 tokens、reasoning effort 为 `medium`；如需实验，可设置 `OLLAMA_NUM_CTX` 为 4096 至 65536 的整数，或将 `OLLAMA_REASONING_EFFORT` 设为 `low`、`medium`、`high`。本地验收结果不能自动替代云端模型，必须先比较全部 12 个样例的准确率与耗时，再决定是否新增本地优先路由。

#### 本机验收记录（2026-09-04）

- 环境：Windows、RTX 4090 24GB、Ollama `0.33.3`、`gpt-oss:20b`（本机 ID `17052f91a42e`）、上下文 16384；Ollama 显示模型 `100% GPU`，实测总显存占用约 17.6GB。
- 原生产提示词、`medium`：完整 12 例首轮 9/12 通过；失败为末尾专属缴款日、取消发行误带原计划规模、A/B 共享利率遗漏，均被程序校验安全拦截。
- 本地提示修订 `local-20b-20260904-1`：针对上述三例复测 3/3 通过，耗时约 11–63 秒；但随后完整重跑时 `metric-first` 偶发长推理，约 102 秒后达到 12000-token 上限，因此不能声称完整 12/12 或稳定达标。
- 参数对照：`high` 在三个难例均约 100 秒后达到输出上限（0/3）；`low` 在四个难例仅 1/4 通过。当前保留 `medium` 作为本地验收默认值。
- 决策：20B 不作为 120B 的无条件替代；已新增“本地严格通过，否则 Cloudflare 兜底”路由。只有本地结果通过同一套证据校验且没有任何 warning 时才直接采用；本地离线、超时、忙碌、协议不兼容、校验失败或字段缺失均回退 `@cf/openai/gpt-oss-120b`。Preview 与 Production 均已完成端到端验收；Production 当前启用本地优先路由，保留一键关闭开关。

### 本地优先路由（Production 已启用）

`functions/api/_issuance-provider.js` 负责 provider 选择，`tools/serve-local-issuance-ai.mjs` 是本机单用途网关。网关固定使用 `gpt-oss:20b` 和提示词版本 `local-20b-20260904-1`，只监听 loopback，只接受 `/health` 与 `/v1/issuance-recognition`，要求 Bearer token，并限制同时只有一个推理请求。不要把 Ollama 的 `11434` 端口直接暴露到公网。

生成一次本地密钥并在同一个 PowerShell 会话启动网关：

```powershell
$tokenBytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Fill($tokenBytes)
$env:LOCAL_ISSUANCE_AI_TOKEN = [Convert]::ToHexString($tokenBytes).ToLowerInvariant()
npm run serve:issuance:local
```

本地 Pages 开发环境可在已被 `.gitignore` 忽略的 `.dev.vars` 中设置以下值；Bearer token 必须与网关进程一致：

```dotenv
ISSUANCE_LOCAL_AI_ENABLED=true
ISSUANCE_LOCAL_AI_URL=http://127.0.0.1:11435/v1/issuance-recognition
ISSUANCE_LOCAL_AI_TOKEN=<至少32个header-safe字符>
ISSUANCE_LOCAL_AI_TIMEOUT_MS=45000
```

远程 Preview/Production 不能访问本机 loopback。接入时使用 [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/) 将单用途网关映射到 HTTPS hostname；网关自身始终校验随机 Bearer secret。可再增加 [Access service token](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/) 作为边缘第二层鉴权。Pages 侧将以下敏感值保存为 [Secret](https://developers.cloudflare.com/workers/configuration/secrets/)，不能写入仓库或普通 vars：

- `ISSUANCE_LOCAL_AI_TOKEN`
- `ISSUANCE_LOCAL_AI_ACCESS_CLIENT_ID`（启用 Access 后）
- `ISSUANCE_LOCAL_AI_ACCESS_CLIENT_SECRET`（启用 Access 后）

非敏感配置为 `ISSUANCE_LOCAL_AI_ENABLED=true`、`ISSUANCE_LOCAL_AI_URL=https://<受 Access 保护的 hostname>/v1/issuance-recognition`；`ISSUANCE_LOCAL_AI_TIMEOUT_MS` 可设 5000–60000，默认 45000。未设置 `ISSUANCE_LOCAL_AI_ENABLED=true` 时完全不请求本机，保持原 Cloudflare-only 行为。

#### Preview 与离线兜底验收（2026-09-04）

- 创建 remotely-managed Tunnel `credit-bond-issuance-local-ai`，HTTPS hostname 为 `issuance-local-ai.tempest07.com`，origin 只指向 `http://127.0.0.1:11435`；公网无 Bearer token 的健康请求返回 401，带 token 返回 200。
- 本机随机 Bearer secret 只保存在当前 Windows 用户环境和 Pages Secret；Preview 另有隔离的临时鉴权 secret。仓库和命令输出没有 secret。
- Windows 登录自启动任务为 `CreditBond Local Issuance Gateway` 和 `CreditBond Local Issuance Tunnel`，均以当前用户、失败后重试方式运行；两者通过 `tools/run-local-issuance-hidden.vbs` 启动，不占用可见 Terminal 窗口。验收结束时两者状态均为 `Running`。
- 独立 Pages Preview：`https://local-ai-preview.credit-bond-process.pages.dev`。匿名识别返回 401；经 Preview 签名的真实识别返回 200、`provider=local-ollama`、`gpt-oss:20b`、一次调用、0 error、0 warning，Function 端耗时约 12.5 秒。
- 暂停本地网关后重复同一条 Preview 请求，返回 200、`provider=workers-ai`、`model=@cf/openai/gpt-oss-120b`、`fallbackFrom=local-ollama`、`fallbackReason=local_http`，耗时约 41.7 秒；随后本地网关自动恢复，远程健康检查再次为 200。该兜底验收实际消耗了一次 Workers AI 推理额度。
- Preview 使用 256-bit 随机 Bearer secret 验证端到端路由。Cloudflare Access 作为可选第二层加固，状态见下方 Production 记录。

#### Production 发布、回退与恢复验收（2026-09-04）

- Production Pages 新增 `ISSUANCE_LOCAL_AI_ENABLED`、`ISSUANCE_LOCAL_AI_URL`、`ISSUANCE_LOCAL_AI_TOKEN`、`ISSUANCE_LOCAL_AI_TIMEOUT_MS` 四个加密变量，原有 `APP_PASSWORD`、`GATEWAY_AUTH_SECRET`、`INNO_APP_KEY`、`INNO_APP_SECRET`、`TEMPEST_AUTH_SECRET`、`WIND_API_KEY` 全部保留。最终开关为 `ISSUANCE_LOCAL_AI_ENABLED=true`，超时为 45000ms。
- 首次启用本地路由的 Production deployment 为 `https://479ba1f7.credit-bond-process.pages.dev`，分支 `main`，关联当时的 HEAD `3adaa4b`，以 `commit-dirty=true` 直传；正式固化后仍以 Git `main` 的 Pages deployment 为生产来源。此前先发布了 `https://f51da9d5.credit-bond-process.pages.dev` 的关闭开关基线；部署 URL 与 Production alias 的匿名识别请求均返回 401。
- 第一次直传 `ff8ec6b5` 因 Wrangler 从仓库根目录误读被忽略的本地 `wrangler.toml` 占位 D1 UUID 而失败，未替换线上版本；发现后立即将 Production 开关改为 `false`。随后从不含该配置的干净 staging 目录重新发布成功，再启用并发布最终版本。
- 登录 `https://tempest07.com/bond-centre/` 后，对 26苏元禾MTN002A/B 的原始通知执行真实 Production 识别。在线时页面明确显示 `gpt-oss:20b`，两品种券码、期限、规模、票面、全场倍数、边际倍数和缴款日均通过校验；点击“取消”，未写入项目。
- 暂停 `CreditBond Local Issuance Gateway`、保留 Tunnel 后重复请求，Production 仍返回两品种模型结果，证明 Cloudflare 兜底链路可用；Cloudflare 结果遗漏四个倍数字段，被应用校验标为“暂不能写入”，没有假装成功。该步骤实际消耗了一次 Workers AI 推理额度。
- 重启网关后，本地与公网 `/health` 均返回 200；再次执行 Production 识别，页面重新显示 `gpt-oss:20b` 且两品种完整通过。最终再次点击“取消”，两个计划任务均为 `Running`。
- Cloudflare Zero Trust 尚未在该账号启用。控制台要求先激活 Zero Trust Free，并授权超过免费额度时从已登记银行卡扣款；本次未获该新增计费授权，因此未创建 Access service token，也未勾选条款。当前公网入口依靠随机 256-bit Bearer secret、HTTPS Tunnel、loopback-only origin、固定路径/模型和单并发限制；无 Bearer 的请求返回 401。若后续明确授权 Zero Trust 计费条款，可增加 `Service Auth + Service Token`，代码已支持成对的 `ISSUANCE_LOCAL_AI_ACCESS_CLIENT_ID` / `ISSUANCE_LOCAL_AI_ACCESS_CLIENT_SECRET`。
- 快速回滚不需要回退代码：将 Production Secret `ISSUANCE_LOCAL_AI_ENABLED` 改为 `false` 并重新部署即可恢复 Cloudflare-only；已验证的关闭开关基线 deployment 为 `f51da9d5`。

发布清单：目标是以 RTX 4090 本地模型优先处理发行结果语义识别，本机不可用时自动回退 Cloudflare；输出包括 provider 路由、本机网关、Tunnel、登录自启动任务和 Production 配置。验证包括 35/35 定向测试、语法与 diff 检查、Production 匿名 401、在线本地命中、离线云端兜底、恢复后重新本地命中。当前没有未完成的功能项；可选后续仅为用户明确接受 Zero Trust 计费条款后的 Access 第二层加固。

浏览器已在本地测试库验证：取消草稿时 revision 不变；确认 A/B 后分别写入 1.59%/1.70%、5000 万、2026-09-03，revision 由 1 到 2；修改通知日期使预览失效，未再次写入。390px 移动视口和 1280px 桌面视口的预览无横向溢出；日期输入 16px。未修改真实线上项目。

### 真实模型验收记录（2026-09-03）

初测的轻量配置存在遗漏/错误，未发布。最终配置（gpt-oss-120b medium、候选券名枚举、12000 tokens）的原始单次提取单轮 11/12 通过；余下 `holdout-transfer` 因证据词序改写及末尾日期范围遗漏被安全拦截。

针对该已观察到的问题加入一次有上限的模型校正后，复测结果为：

| 样例 | 预期 | 结果 | 模型调用次数 | 总耗时 |
| --- | --- | --- | --- | --- |
| holdout-transfer | A 全部回拨，B 正常发行，不串日期 | 通过 | 2 | 44.7s |
| holdout-missing | 缺最终利率，拒绝写入 | 通过 | 1 | 21.1s |
| holdout-date | 缺原通知日期，不能解释明天，拒绝写入 | 通过 | 1 | 19.6s |
| holdout-injection | 非本项目且带提示词注入，拒绝写入 | 通过 | 1 | 3.5s |

其余 8 个正例保持相同的单次提取输入与校验规则，已在上一轮通过；这里不是声称另跑了一轮 12/12，也不是生产总体准确率统计。UI 另一次在本地隔离库实际识别苏元禾 A/B 成功。相关离线测试共 107/107 通过。

### 生产浏览器验收（2026-09-03）

用户正常登录 `https://tempest07.com/bond-centre/` 后，对苏元禾 A/B 的原始通知点击“语义识别”，原通知日期保持 `2026-09-02`。生产页面返回模型标识 `@cf/openai/gpt-oss-120b`，预览如下：

| 品种 | 券码 | 期限 | 规模（亿元） | 票面利率 | 全场倍数 | 边际倍数 | 缴款日 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 26苏元禾MTN002A(科创债) | 102683475 | 3年 | 5 | 1.59% | 3.86 | 2.86 | 2026-09-03 |
| 26苏元禾MTN002B(科创债) | 102683476 | 5年 | 5 | 1.70% | 3.26 | 1 | 2026-09-03 |

未披露的起息日期显示“未识别”，没有把缴款日自动当成起息日。随后点击“取消”，项目表单逐项比较与识别前一致，云端仍显示版本 177 已确认。本次线上验收没有点击“确认写入并生成汇报”，未修改真实项目；写入路径已在上述本地隔离数据库验证。
