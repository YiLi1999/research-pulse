# 独立服务器上线：科研脉搏

这个方案把网站运行在独立 Linux 服务器上，你的电脑关机后朋友仍能访问。页面浏览、论文抓取和领域数量统计不调用模型；朋友需要在趋势页输入自己的 API 地址、API Key 和模型名称，才会发起付费分析。

部署包使用一个 Node.js 应用和一个 Caddy HTTPS 代理，不需要数据库，不安装 Chromium。论文、访客排名设置和分析缓存保存在 Docker 数据卷中。当前没有账号或邀请制，持有网址的人可以访问。

## 首次上线

1. 准备一台能访问 arXiv、APS、Nature 和朋友所用模型 API 的 Linux 服务器，安装 [Docker Engine 与 Compose 插件](https://docs.docker.com/engine/install/)。可以先以 1–2 GB 内存作为试运行起点；实际占用需要部署后观察，取决于论文数量和同时分析的人数。
2. 准备一个域名或子域名，把 DNS 的 A 记录指向服务器公网 IP；如配置 AAAA，确保 IPv6 也指向此服务器。服务器防火墙/安全组开放 TCP 80、443；SSH 端口用于你自己管理。应用的 3100 端口只绑定服务器本机，无需对外开放。
3. 把部署包上传并解压到服务器的固定目录，例如 `/opt/research-pulse`。不要上传原电脑的 `.env`、`data/`、`.runtime/`、`archive/` 或研究资料。首次启动会重新抓取公开论文。
4. 在该目录执行：

```sh
cp deploy/server.env.example deploy/server.env
nano deploy/server.env
```

把 `SITE_DOMAIN=research.example.com` 改成实际域名，例如 `SITE_DOMAIN=papers.example.com`。这里不填 `https://`、端口或路径，也不需要填写任何模型 API Key。

5. 启动：

```sh
docker compose --env-file deploy/server.env -f compose.yaml -f deploy/compose.https.yaml config --quiet
docker compose --env-file deploy/server.env -f compose.yaml -f deploy/compose.https.yaml up -d --build
docker compose --env-file deploy/server.env -f compose.yaml -f deploy/compose.https.yaml ps
```

6. 打开 `https://你的域名`。首次论文抓取需要几分钟，页面会先显示空列表；稍后刷新页面。Caddy 在域名解析与端口条件满足时自动获取并续期 HTTPS 证书，详见 [Caddy HTTPS 文档](https://caddyserver.com/docs/quick-starts/https)。

这套配置会把 `HOST` 设为 `0.0.0.0`，并把 `PUBLIC_ORIGIN` 自动设为 `https://你的域名`。网站对写入请求检查来源，因此换域名时需要同时更新 `SITE_DOMAIN` 并重新执行启动命令。容器会在服务器重启后恢复运行。

## 交给朋友使用

分享 HTTPS 地址。朋友可以直接搜索和筛选论文；进入趋势分析后，填写服务商提供的 OpenAI-compatible Chat Completions Base URL、自己的 API Key 和模型 ID，再点击分析。Base URL 应类似 `https://api.example.com/v1`，不要填写完整的 `/chat/completions` 地址。

API Key 会经 HTTPS 交给你的服务器，由服务器临时代为请求指定提供商；应用不将密钥写入浏览器持久存储、磁盘缓存或日志，刷新/关闭页面后需重新输入。分析使用访客的模型额度，不回退使用站长的 `.env`、API Key 或 Codex 登录。应用允许公网 HTTPS API 地址；内网 API、HTTP 地址及需要特殊协议的接口不适用。

访客的关键词排名和分析任务按浏览器 Cookie 分开。同一浏览器保留 Cookie 时可继续使用自己的设置与缓存；更换浏览器或清除 Cookie 会产生新的访客身份。分析结果和论文缓存会保存在服务器数据卷，API Key 不保存在其中。

## 日常操作

服务启动和页面的“刷新数据”按钮会抓取论文，不会自动调用模型。目前没有每天定时抓取任务；长期运行时可按需要在网页点击刷新。

查看日志：

```sh
docker compose --env-file deploy/server.env -f compose.yaml -f deploy/compose.https.yaml logs --tail=100 app caddy
```

更新源码后，在同一目录再次执行上面的 `up -d --build` 命令即可。重建容器、普通停止再启动都会保留论文和缓存。请保留固定目录与 `name: research-pulse`；数据卷名为 `research-pulse_paper-data`。`docker compose down -v` 会删除数据卷，不用于普通更新。数据卷的持久化方式见 [Docker Compose 文档](https://docs.docker.com/compose/intro/compose-application-model/)。

备份论文与设置时，先停止应用，再导出数据卷，最后启动应用：

```sh
docker compose --env-file deploy/server.env -f compose.yaml -f deploy/compose.https.yaml stop app
docker run --rm -v research-pulse_paper-data:/data:ro -v "$PWD":/backup node:22-bookworm-slim tar -czf /backup/research-pulse-data.tar.gz -C /data .
docker compose --env-file deploy/server.env -f compose.yaml -f deploy/compose.https.yaml start app
```

备份文件包含访客设置与分析结果，留在你自己的服务器管理目录，不放进网站静态文件目录。

## 已有 HTTPS 反向代理时

只使用根目录 `compose.yaml`，在部署环境中设置实际 `PUBLIC_ORIGIN`，由已有代理转发到 `127.0.0.1:3100`：

```sh
PUBLIC_ORIGIN=https://papers.example.com docker compose up -d --build
```

代理必须将浏览器的原始 `Origin` 请求头传给应用。不要把 `PUBLIC_ORIGIN` 设为服务器内部地址。独立运行时可以用 `curl http://127.0.0.1:3100/api/health` 检查应用健康状态。

## 轻量部署的边界

默认抓取使用快速模式，主要依赖官方 API、RSS 与普通网页。镜像不下载浏览器，个别需要浏览器兜底的 APS 数据源可能不可用；应用会保留已有缓存并记录失败。初始部署不带原电脑上的论文缓存，因此这类来源首次可能没有数据。

这是一套单实例、少量朋友使用的部署配置；服务器仍需承担抓取、磁盘和网络费用，模型费用由各访客自行承担。部署文件已准备好，实际镜像构建、DNS、证书和公网连通性需要在你的服务器上完成验证。
