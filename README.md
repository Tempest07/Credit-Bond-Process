# Bond Centre

信用债投资流程意见生成器。粘贴固定格式的项目简表后，页面会解析债券信息、匹配主体最新授信、应用投资比例与终批规则，并生成可编辑的流程意见。

## 当前能力

- 解析债券简称、主承身份、分行、期限、规模、评级、询价区间、发行场所、牵头主承、估值和指导价
- 根据简称匹配主体与最新授信
- 自动生成常见银行间债券全称：SCP、CP、MTN、PPN
- 计算建议投资比例与金额
- 自动判断处室、金处、周总或房地产债林总终批
- 一级投标利率固定留作待填写
- 支持浏览器本地资料库与 Cloudflare D1 同步
- 支持 JSON 导入导出备份
- 支持在浏览器本地解析历史 Word 流程文档，按“越靠前越新”归并最新授信
- ABS 意见单独识别和统计，不混入普通信用债主体库
- 历史 Word 异常记录支持在导入前人工修正或排除
- 单笔生成页可直接录入或更新当前主体授信
- 支持一次粘贴多笔项目简表，批量生成、复制和录入新主体授信
- 支持交易所标准公司债全称生成；简表可注明“公开/非公开”或“公募/私募”
- 支持银行间及交易所双品种互拨项目，自动合并简称并分别列示期限、询价区间和建议比例
- 支持将流程意见保存为项目台账，通过看板跟踪待投标、待结果、中标和未中标项目
- 支持按品种记录投标利率、投标量、中标利率、中标量，并自动生成结果摘要
- 支持记录综合定价扣税后营收、FTP，并自动计算扣除 FTP 后收益
- 支持专用邮箱自动接收缴款单，保留原始邮件与 PDF，识别多项目、续页和空白页
- 支持在项目品种内直接查看已对应缴款单，并按日期查看全部归档和人工复核候选
- 支持通过文件管理器弹窗按“缴款单 → 缴款日期 → 原始 PDF”直观浏览邮箱原件
- 支持“应收单据对账”，同时提示已缴款和未缴款中标品种的缺单情况
- 支持按原 PDF 页码人工修正多项目、续页和空白页分组，原始文件始终保留
- 自动匹配缴款单不会改变缴款状态；缴款仍须人工确认

## 规则

- 交易所债券简称通常不能可靠反推出公开或非公开发行，尾号也不能可靠反推出发行期次。发行方式和期次均以明确标注或人工确认为准。

1. 建议投资比例默认使用最新授信批复比例。
2. 兴业银行牵头或联席主承时，比例最高为20%。
3. 隐含评级AA且期限超过授信投资期限时，比例最高为15%。
4. 隐含评级AA(2)且期限超过授信投资期限时，比例最高为10%。
5. 投资金额等于发行规模乘以建议比例。
6. 房地产债由林总终批。
7. 隐含评级AAA：投资金额超过8亿由金处终批，超过10亿由周总终批。
8. 其他隐含评级：投资金额超过3.2亿由金处终批，超过4亿由周总终批。
9. 同一主体的新授信覆盖旧授信；Word批量导入时，文档越靠前的记录越新。

## Cloudflare Pages

1. 创建 GitHub 仓库 `Tempest07/Credit-Bond-Process` 并推送本目录。
2. 创建 Cloudflare Pages 项目，连接该仓库。
3. Framework preset 选择 `None`，Build command 留空，Build output directory 填写 `.`。
4. 创建 D1 数据库 `credit-bond-process`。
5. 在 Pages 项目的 Settings / Bindings 中添加 D1 binding：
   - Variable name：`DB`
   - D1 database：`credit-bond-process`
6. 在 Pages 项目的 Settings / Variables and Secrets 中添加加密 Secret：
   - Variable name：`GATEWAY_AUTH_SECRET`
   - Value：与 `tempest07.com` Gateway Worker 中的 `GATEWAY_AUTH_SECRET` / `TEMPEST_AUTH_SECRET` 保持一致，用于校验 gateway 注入的短期签名身份
7. 为债券数据查询配置服务端 Secrets：
   - `INNO_APP_KEY` / `INNO_APP_SECRET`：DM 债券档案、发行、主体评级与评级机构
   - `WIND_API_KEY`：Wind 中债隐含评级；仅由 Pages Function 读取，不下发到浏览器
8. 重新部署 Pages。

缴款单系统还需要 R2、Queue、Email Routing 和独立 Email Worker，详见 [PAYMENT_RECEIPTS_DEPLOYMENT.md](./PAYMENT_RECEIPTS_DEPLOYMENT.md)。

Pages Function 会在首次通过 gateway 访问资料库时自动创建所需表，并把旧 `app_state` 数据迁移到 `admin` 管理员账号名下；也可以手动执行 `schema.sql`。

## Gateway

在 `tempest07.com` Gateway Worker 的 `ROUTES` 数组中增加：

```js
{
  prefix: "/bond-centre",
  origin: "https://credit-bond-process.pages.dev"
}
```

统一入口：

```text
https://tempest07.com/bond-centre/
```

## 安全要求

资料库 API 不再在项目中心内登录，也不接受 `Authorization: Bearer APP_PASSWORD`。用户先访问 `https://tempest07.com/login/` 完成统一登录；Gateway Worker 校验 `admin` 密码后签发 `tempest07_session` cookie，并在代理到项目中心时注入短期 `X-Tempest-Auth` 签名身份。项目中心 Pages Function 只校验该签名，默认管理员用户名为 `admin`，昵称为“管理员”。

正式启用后仍建议使用 Cloudflare Access 进一步保护 Gateway 路径和 Pages 项目。直接访问 `*.pages.dev` 时，前端会跳转至 Gateway，但跳转本身不能替代访问控制。

## 隐含评级数据源

- 配置 `WIND_API_KEY` 后，中债隐含评级以 Wind 返回值为准，DM 不再作为隐含评级回退来源。
- Wind 无结果时，可使用明确标注的云端主体库历史隐含评级；不得用主体评级替代。
- 项目记录保存 `hiddenRatingSource` 和 `hiddenRatingAsOf`，用于区分 Wind、云端主体库和人工录入。
- 尚未配置 `WIND_API_KEY` 的环境继续沿用旧 DM 行为，便于先合并代码、后配置 Secret；完成 Secret 配置后即自动启用 Wind 替代。

## 二级交易录入

- 当前入口只处理公募债和 PPN：每行粘贴一笔交易要素，系统会生成网页内的待成交记录。
- 待成交卡片保留原始文本和解析字段；填入 50 至 150 之间的净价后点击“成交”，记录进入对应交易日台账。
- 带有“私募债”“非公开”或“协议转让”明确标记的交易所记录会自动分流到协议转让页。系统不会仅凭 `.SH` / `.SZ` 代码判断公募或私募。
- 旧的影子库存、OFR 挂单、一级中标同步数据继续保留在状态中，但当前界面不再展示这些入口。

## Word 历史流程导入

Word 导入解析器将在取得真实文档后实现。解析时将按照文档顺序设置 `sourceRank`，数值越小代表越新；同一主体仅保留最靠前的最新授信。
