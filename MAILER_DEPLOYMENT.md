# 流程意见邮件发送 Worker 部署说明

这个 Worker 使用 Resend 发送邮件，读取项目中心同一个 D1 数据库，筛选“今日待投标”的项目，并按以下模板发送：

```text
标题：流程意见26XXXX

内容：
1. 26XXXMTN001
项目简表：
……

流程意见：
……
2. ...
```

## 1. Resend 侧准备

1. 打开 Resend，创建 API Key。
2. 如果只是测试，可以先使用 Resend 允许的测试发件域名；正式使用建议验证自己的域名。
3. 记下：
   - `RESEND_API_KEY`
   - `MAIL_FROM`，例如 `流程意见提示 <notify@your-domain.com>`
   - `MAIL_TO`，例如你的工作邮箱

## 2. Cloudflare 创建 Worker

建议 Worker 名称：

```text
credit-bond-mailer
```

在 Cloudflare Dashboard 中：

1. 进入 `Workers & Pages`。
2. 点击 `Create application`。
3. 选择 `Worker`。
4. 名称填写 `credit-bond-mailer`。
5. 创建后进入 Worker 的代码编辑页。
6. 将仓库里的 `mailer-worker.js` 全文复制进去并部署。

## 3. 绑定 D1

进入 Worker：

```text
Settings -> Bindings
```

添加 D1 database binding：

```text
Variable name: DB
D1 database: credit-bond-process
```

## 4. 设置变量和密钥

进入 Worker：

```text
Settings -> Variables and Secrets
```

添加 Secrets：

```text
APP_PASSWORD = 和项目中心当前相同的口令
RESEND_API_KEY = Resend 创建的 API Key
```

添加 Variables：

```text
MAIL_FROM = 流程意见提示 <notify@your-domain.com>
MAIL_TO = your-email@example.com
TIME_ZONE = Asia/Shanghai
MAIL_SEND_EMPTY = false
```

可选：

```text
MAIL_CC = cc@example.com
MAIL_BCC = bcc@example.com
MAIL_REPLY_TO = your-email@example.com
```

## 5. 手动预览和发送

部署完成后打开：

```text
https://credit-bond-mailer.你的workers子域.workers.dev/
```

页面会要求输入 `APP_PASSWORD`。

按钮：

- `预览今日邮件`：只生成内容，不发送。
- `发送今日邮件`：发送今天的待投标流程意见邮件；可以按需重复发送。

## 6. 设置自动定时

如果用 Dashboard 配置 Cron：

```text
30 0 * * 1-5
```

含义：工作日 UTC 00:30，即北京时间 08:30。

如果暂时不想自动发，可以先不添加 Cron，只用手动按钮。

## 7. 邮件筛选规则

邮件只包含：

```text
status 为 未投标 / 待投标
且 cutoffAt 日期等于今天
```

排序：

```text
按截标时间从早到晚
```

标题：

```text
单笔：流程意见26XXX
多笔：流程意见26XXX等N笔
无项目：流程意见今日无待投标
```
