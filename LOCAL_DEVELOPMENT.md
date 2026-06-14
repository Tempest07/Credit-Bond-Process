# 本地旁支预览

大改动先在旁支本地跑。生产环境仍然使用 Cloudflare Pages 的 D1 绑定和 `APP_PASSWORD` 口令，本地 `localhost / 127.0.0.1` 会免口令连接本地 D1。

## 启动本地预览

```powershell
git switch codex/secondary-trading-center
npm run dev:local
```

然后打开：

```text
http://127.0.0.1:8788/
```

这个命令会生成一个被 git 忽略的本地 `wrangler.toml`，并把本地 D1 数据保存在 `.wrangler/state`。

## 复制线上资料库到本地

方式一：从线上页面点击“导出资料库”，得到类似 `credit-bond-data-YYYY-MM-DD.json` 的文件。

然后运行：

```powershell
npm run seed:local -- C:\path\to\credit-bond-data-YYYY-MM-DD.json
```

再重新打开或刷新：

```text
http://127.0.0.1:8788/
```

本地预览会读取这份本地 D1，不会写入线上资料库。

方式二：直接从线上 API 拉取。

```powershell
$env:APP_PASSWORD="你的线上口令"
npm run pull:remote
Remove-Item Env:\APP_PASSWORD
```

脚本会把远端响应临时保存到 `.local/remote-state.json`，再写入本地 D1。`.local` 和 `.wrangler` 都被 git 忽略。

## 如果要直接用 Wrangler 远端 D1

当前机器没有可用的 `CLOUDFLARE_API_TOKEN` 时，Wrangler 不能在非交互环境直接读取远端 D1。配置 token 后，也可以用 Wrangler 的远端 D1 命令处理。
