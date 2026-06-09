# Cloudflare 部署清单

当前代码仓库：

```text
https://github.com/Tempest07/Credit-Bond-Process
```

请严格按以下顺序操作。

## 1. 创建 Pages 项目

1. 打开 Cloudflare Dashboard。
2. 进入 `Workers & Pages`。
3. 选择 `Create application` / `Pages` / `Connect to Git`。
4. 选择 GitHub 仓库 `Tempest07/Credit-Bond-Process`。
5. 项目名称填写：

```text
credit-bond-process
```

6. 构建设置：

```text
Production branch: main
Framework preset: None
Build command: 留空
Build output directory: .
Root directory: 留空
```

7. 完成首次部署。

首次部署后应获得：

```text
https://credit-bond-process.pages.dev/
```

此时页面可以使用本机资料库，但云端 D1 尚未启用。

## 2. 创建 D1 数据库

1. 在 Cloudflare Dashboard 进入 `Storage & Databases` / `D1 SQL Database`。
2. 创建数据库：

```text
credit-bond-process
```

3. 返回 Pages 项目 `credit-bond-process`。
4. 进入 `Settings` / `Bindings`。
5. 添加 D1 binding：

```text
Variable name: DB
D1 database: credit-bond-process
```

Pages Function 会在第一次成功访问 API 时自动创建数据表，无需手工执行 SQL。

## 3. 设置云端口令

在 Pages 项目 `Settings` / `Variables and Secrets` 中添加加密 Secret：

```text
Variable name: APP_PASSWORD
Value: 设置一个仅自己知道的高强度口令
```

保存后，重新部署最新的 `main` 分支。

进入网页后点击右上角“设置云端口令”，输入同一个口令即可连接 D1。口令仅保存在当前浏览器会话。

## 4. 部署 Gateway Worker

打开现有 Worker：

```text
tempest07-gateway
```

使用以下仓库文件的完整内容覆盖 Worker，然后点击部署：

```text
https://github.com/Tempest07/tempest07-home/blob/main/gateway-worker.js
```

该文件已经包含：

```js
{
  prefix: "/credit-bond-process",
  origin: "https://credit-bond-process.pages.dev",
}
```

## 5. 验证

依次检查：

```text
https://credit-bond-process.pages.dev/
```

应自动跳转至：

```text
https://tempest07-gateway.weiqian-yu.workers.dev/credit-bond-process/
```

在统一入口中：

1. 点击“载入示例”。
2. 确认非我行主承时生成 `30% / 2.1亿元`。
3. 将主承身份改为“牵头”。
4. 确认主承销商改为兴业银行，生成 `20% / 1.4亿元`。
5. 点击“设置云端口令”并输入 `APP_PASSWORD`。
6. 新增一条主体资料并点击“同步资料库”。
7. 刷新页面，重新输入口令，确认资料仍然存在。

## 6. 建议的额外保护

资料可能包含授信信息，建议继续使用 Cloudflare Access 保护 Pages 项目和统一入口。`APP_PASSWORD` 已能保护 D1 API，但 Access 可以进一步限制谁能打开页面。
