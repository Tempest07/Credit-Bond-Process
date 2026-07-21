# 缴款单系统部署说明

缴款单系统由两部分组成：Bond Centre Pages 负责归档查询和项目内查看；独立 Email Worker 负责接收专用邮箱来件、保存原件、拆分 PDF、识别并匹配项目。

## 业务边界

- 自动收件和匹配只建立“缴款单 ↔ 项目品种”的关联，不写入 `paymentCompleted`，也不改变项目 `status`。
- 缴款仍须在 Bond Centre 中人工点击“缴款”或人工勾选“已完成缴款”。
- 一封邮件和一个 PDF 都可能包含多张缴款单。Worker 按原 PDF 逐页判断空白页、新单首页和续页；归档 PDF 保留原附件页码。
- 原始 `.eml`、原始 PDF 和拆分后的单据 PDF 均保存在私有 R2，不生成公开 URL。下载必须经过 Bond Centre 登录校验。
- “应收单据对账”同时检查已缴款和未缴款的中标品种；缺单提示不会自动执行缴款。
- 自动页边界有疑问时，可在 Bond Centre 用“修正拆页”按原页码重新分组或标记空白页。原件不被覆盖；未改变的页组保留原项目对应，改变的页组退回人工确认。

## 1. 前置条件

1. Cloudflare 域名已启用 Email Routing。
2. 已有 Bond Centre 使用的 D1 数据库 `credit-bond-process`。
3. 本机已执行 `wrangler login`，且账号有 Workers、D1、R2、Queues、Email Routing 和 Workers AI 权限。
4. 已确认内部合规允许缴款单交由 Cloudflare Workers AI 识别。如不允许，应把 `analyzePaymentReceiptPage` 替换为获批的内网 OCR 服务后再上线。
5. Cloudflare 账号须为 Workers Paid 计划；本 Worker 为逐页识别配置了 300 秒 CPU 上限，免费计划不满足该运行配置。

## 2. 创建存储和队列

```powershell
npx wrangler r2 bucket create credit-bond-payment-receipts
npx wrangler queues create credit-bond-payment-receipts
npx wrangler queues create credit-bond-payment-receipts-dlq
```

R2 与项目状态分开存储，避免 PDF 被写入整份 `user_app_state` JSON，也避免项目保存覆盖单据索引。

## 3. 配置 Pages

在 Bond Centre Pages 项目的 Bindings 中增加：

- 类型：R2 bucket
- Variable name：`PAYMENT_RECEIPTS`
- Bucket：`credit-bond-payment-receipts`

保留现有 D1 binding `DB`，然后重新部署 Pages。`functions/api/payment-receipts*` 会在首次访问时幂等创建缴款单相关表；也可主动执行：

```powershell
npx wrangler d1 execute credit-bond-process --remote --file schema.sql
```

## 4. 配置并部署 Email Worker

复制可直接被 Wrangler 读取的示例配置：

```powershell
Copy-Item payment-receipt-wrangler.example.jsonc payment-receipt-wrangler.jsonc
```

编辑 `payment-receipt-wrangler.jsonc`：

- 将 `REPLACE_WITH_D1_DATABASE_ID` 替换为现有 D1 的真实 ID。
- `RECEIPT_OWNER_USER_ID` 必须与 Bond Centre 登录用户 ID 一致；当前默认是 `admin`。
- `ALLOWED_SENDERS` 设置为内网转发邮箱的固定发件地址，可用逗号分隔。也支持 `@example.com` 形式的域名白名单，但固定地址更稳妥。
- `AI_PROCESSING_APPROVED` 只有在合规确认允许缴款单内容交由 Workers AI 识别后才能改为 `true`；保持 `false` 时健康检查和上线预检都会失败。
- `EXPECTED_RECIPIENT` 设置为唯一的专用收件地址；当前建议值为 `payment-receipts@tempest07.com`，Worker 会拒绝误投到其他地址的邮件。
- `EXPECTED_RECIPIENT` 是必填安全项；缺失时 Worker 会拒收，而不是放开所有收件地址。
- 可选配置 `FALLBACK_FORWARD_ADDRESS`，且必须先在 Cloudflare 中验证为可转发的目标地址。Email handler 发生未捕获错误时会把原邮件转发到这个兜底地址；未配置时会明确拒收，避免静默丢件。
- 队列、死信队列和 R2 名称应与第 2 步一致。

先校验打包，再部署：

```powershell
npm run receipts:preflight -- --config payment-receipt-wrangler.jsonc
npx wrangler deploy --dry-run --config payment-receipt-wrangler.jsonc
npx wrangler deploy --config payment-receipt-wrangler.jsonc
```

`/health` 只在 D1、R2、Queue、AI、发件人白名单、专用收件地址及 AI 合规开关全部有效时返回 200；否则返回 503，防止占位配置被误认为已经可收件。

## 5. 创建专用收件地址

在 Cloudflare Dashboard 的 Email / Email Routing 中：

1. 新建一个专用地址；本项目建议使用 `payment-receipts@tempest07.com`。
2. Action 选择 Send to a Worker。
3. Worker 选择 `credit-bond-payment-receipts`。
4. 在内网邮箱创建自动转发规则，把带 PDF 缴款单的邮件转发到这个专用地址。
5. 转发必须保留原 PDF 附件，不要把整封邮件封装成单独的 `.eml` 附件。

Cloudflare 入站邮件上限为 25 MiB；超限来件会被拒绝并应在内网邮箱侧告警。
单封邮件最多自动处理 20 个附件，单个 PDF 最多 20 MiB、最多自动处理 60 页；超过上限的来件会完整保留原邮件或附件并进入待复核，不会静默丢页。

## 6. 上线验收

1. 在 Bond Centre 建立一个中标项目，填写品种简称、债券代码、中标金额和缴款日期，但不要点击缴款。
2. 向专用地址发送包含该项目缴款单的测试邮件；可使用一个含“项目首页 + 续页 + 空白页 + 第二个项目首页”的多页 PDF。
3. 在“缴款单”入口确认：原附件名、原附件页码、归档日期、识别字段和匹配状态均正确。
4. 在“应收单据对账”确认该品种从“缺少单据”变成“已有对应单据”；已缴款和未缴款项目都应纳入检查。
5. 在项目详情的对应品种下打开拆分后的 PDF。
6. 确认项目仍显示“待缴款”，`paymentCompleted` 仍为未勾选。
7. 对含糊匹配点击候选项目按钮，确认只更新关联关系，不改变缴款状态。
8. 对测试 PDF 使用“修正拆页”：保持页组不变时原项目对应应保留；改变页组时受影响单据应退回“待人工确认”，原 PDF 仍可打开。
9. 重复转发同一附件，确认第二份显示为“重复单据”。

## 7. 运维要点

- Email handler 只校验收发件地址、保存原始邮件并入队；MIME/PDF 附件解析、逐页 OCR 与拆分均在 Queue consumer 中异步执行。
- 原始邮件按 `raw/YYYY/MM/DD/<batch-id>/message.eml` 保存；拆分单据按 `receipts/YYYY/MM/DD/<receipt-id>.pdf` 保存。
- Message-ID 与原始邮件 SHA-256 共同用于邮件级幂等；同一 Message-ID 但内容不同的邮件会另行保留并强制复核。业务标识充分时使用业务指纹识别重复单据，否则使用原附件 SHA-256 加原页码。
- AI 无法可靠判断页面边界时，单据进入“待人工确认”，不会做高风险自动对应。
- Worker 同时消费死信队列，把重试用尽的邮件或附件写成归档页可见的失败记录；仍建议对 Queue/DLQ 深度、Worker error 日志、R2 用量和“待人工确认/识别失败”数量设置告警。
- 队列失败采用 15 秒起步的指数退避。Cron 每 10 分钟扫描一次，超过 20 分钟仍停在接收、排队、处理或可重试错误状态的任务会用条件更新重新入队；超时的人工拆页锁会回到待复核状态。
- 人工重拆使用文件版本校验和处理锁，不能与自动识别或另一次重拆同时覆盖。重拆提交成功后只清理旧的派生 PDF，原始 `.eml` 和原始附件始终保留。
- 变更发件白名单、专用邮箱或 OCR 服务时，应保留一封多项目、多续页、含空白页的回归样例。
