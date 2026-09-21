# 科研脉搏 · 最新论文与研究趋势

轻量论文网站，汇集 arXiv、APS 和 Nature 论文，提供论文检索、个人关键词排名、领域发文统计及按需趋势分析。可本机运行，也可用 Vercel 共享给朋友。

**网页趋势分析由每位访客填写自己的 API 地址、API Key 和模型。浏览论文、统计发文量与刷新数据不消耗模型额度；网页不会使用站长的模型密钥。** 人物网络功能已移除。

## 给朋友共享

当前优先方案是 **Vercel + GitHub 每日共享论文快照 + 各访客浏览器缓存**：你的电脑关机后仍能访问，不需要数据库，也不需要在部署环境中填写模型 API Key。参照 [Vercel 简明上线步骤](deploy/VERCEL.md) 导入你自己的 GitHub 仓库即可。

Vercel 版本每天由 GitHub Actions 抓取一次公开论文，所有访客共享这份数据；每个人的关键词排名和分析缓存在自己的浏览器。趋势分析由浏览器分步发起，每次 Vercel Function 只代为请求一次访客填写的模型 API。分析期间需保持页面打开，刷新/关闭后可复用已保存的逐篇结果。

独立服务器的 Docker/Caddy 方案仍保留，见 [独立服务器上线说明](deploy/README.md)。以下本机启动与后台服务说明适用于 Node.js / Docker 运行方式。

## 本机启动

建议使用 Node.js 22。首次运行：

```sh
npm ci
cp .env.example .env
npm start
```

Windows PowerShell 可用 `Copy-Item .env.example .env` 复制模板；已有 `.env` 时保留原文件。之后双击根目录的 **打开科研脉搏.cmd**，或访问已启动的 [本地网页](http://localhost:3100/)。开发时可使用 `npm run dev`。

| 页面 | 地址 | 功能 |
| --- | --- | --- |
| 最新论文 | `http://localhost:3100/` | 论文卡片、标题/作者/摘要搜索、期刊与时间筛选、个人关键词排名 |
| 趋势分析 | `http://localhost:3100/?view=overview` | 14 个大领域及子领域发文量、填写个人 API 后按需分析 |

旧地址 `/trends` 和 `/trends.html` 保留跳转到当前趋势页。论文列表最多展示筛选和排序后的 80 篇；趋势分析使用所选领域完整的近 7 天样本，不受此显示上限影响。

最新论文默认“全部期刊＋近 7 天”与趋势分析“全部领域”使用同一套日期筛选和去重规则：按站点时区计算今天及前 6 天，截止当前时间，排除未来及无有效日期的记录，按 DOI、版本编号和归一化标题去重。修改关键词权重只改变排名，不改变统计数量；切换期刊或时间窗口后，首页数量对应当前筛选范围。

默认只监听本机 `127.0.0.1:3100`。`HOST` 可修改监听地址，`PORT` 可修改端口；服务器部署还需配置实际 HTTPS 地址对应的 `PUBLIC_ORIGIN`。附带的 Docker/Caddy 配置已处理这些设置。

## 趋势分析：访客自行提供 API

先用规则统计领域发文量，选择领域后手动启动 AI。数学包括代数数论、几何拓扑、分析与微分方程、概率统计、组合与信息论、应用数值分析、数学物理、逻辑与基础。

在趋势页填写以下三项：

| 输入 | 说明 |
| --- | --- |
| API 地址（Base URL） | 服务商的公网 HTTPS OpenAI-compatible 地址，例如 `https://api.example.com/v1` |
| API Key | 访客自己的密钥 |
| 模型名称 | 服务商提供的实际模型 ID |

服务端请求 `${baseUrl}/chat/completions`。具体模型需支持此接口；不支持内网地址、HTTP 地址或额外的自定义认证方式。未填写时仍可浏览论文和领域统计。

密钥仅在页面和请求运行期间的服务端内存中使用，不写入浏览器持久存储、服务器数据文件或日志。刷新/关闭页面后需重新输入。公网部署时，密钥会通过 HTTPS 发送到本站服务器再请求模型提供商。Vercel 版本把个人排名和分析缓存保存在各访客自己的浏览器；本机 / Docker 版本使用浏览器 Cookie 隔离服务端任务与个人缓存。两种方式下，更换浏览器均不会同步原浏览器的个人设置与结果。

网页不读取旧版 `TREND_API_*` / `TREND_ANALYSIS_PROVIDER` 配置，也不会回退到站长的 `LLM_*` 或本机 Codex。旧 `.env` 无需删除，但部署到公开服务器不需要携带它。旧的单篇总结网页接口已关闭。

分析和缓存规则：

- 分析范围是应用时区今天及前 6 天，截止请求时；按 DOI、版本编号和归一化标题去重。
- 首次读取所选范围内未缓存论文的标题和摘要，不读取全文。
- 后续只重读新增或标题、摘要变化的论文，再用近 7 天的逐篇笔记分层汇总。
- 同一访客可复用逐篇结果与完整报告；模型、内容或提取版本变化会产生新缓存。重试保留已成功保存的逐篇结果。
- 每个研究问题附有依据论文。规则统计明确标记为非 AI 归纳，AI 失败不会静默更换提供商。

发文量不等于研究人数，多标签分类可能重复计入或误分；抓取样本不代表全学界。目前归纳共同研究问题，没有比较前一周，不能据此认定热度上升。

## 论文来源与个人排名

- **arXiv**：默认 `ARXIV_CATEGORIES=quant-ph,math`，包括量子物理和全部 32 个数学子分类。数学独立分页，`ARXIV_MATH_MAX_PAGES=50` 控制上限。API 请求串行且间隔至少约 3 秒；quant-ph 可用官方网页兜底。抓取失败保留对应分类缓存，达到页数上限提示不完整，跨分类与版本按 arXiv ID 去重。
- **APS**：支持 PRL、PRA、PRB、PRD、PRE、PRX、PRX Quantum、Physical Review Applied、Research、Materials。官方 RSS 优先，网页补全为兜底；详情不可访问时保留已取得的元数据。
- **Nature**：配置 Nature Communications、Nature Physics、Nature Photonics 和 npj Quantum Information；实际记录取决于当期发文、筛选规则与抓取可用性。

Vercel 版本由 GitHub Actions 每日更新共享论文，网页刷新只读取已经发布的快照。在本机 / Docker 版本，服务启动、页面“刷新数据”和 `npm run refresh` 会抓取论文，没有每日自动抓取任务。两种方式均不在刷新时调用模型，首次抓取可能需要几分钟。

首页编辑关键词及权重后自动保存为当前访客的设置，不影响朋友的排名。

**总分 = Σ weight ×（标题命中 × 2 + 摘要命中 × 1）**

每个关键词在标题、摘要中各最多计一次；忽略大小写，按完整词或短语匹配。支持 0–100000 的权重，最多 200 个关键词。清空筛选不会修改关键词；删空关键词也会保存。Rank 不因期刊筛选而重新编号，卡片可展开评分明细。

## 本机 Windows 后台服务

| 操作 | 命令或文件 |
| --- | --- |
| 安装 Windows 登录自启并启动 | `npm run service:install` / 启用开机自启.cmd |
| 恢复服务与已有自启 | `npm run service:start` |
| 查看状态 | `npm run service:status` |
| 停止服务并暂停自启 | `npm run service:stop` |
| 移除自启并停止服务 | `npm run service:uninstall` / 取消开机自启.cmd |

任务计划在 Windows 登录时静默启动一次；没有周期检查或异常自动重启。由任务计划启动后无需保持终端或 Codex 打开。异常停止后双击“打开科研脉搏.cmd”恢复。本机服务随电脑关机停止；供朋友长期访问使用独立服务器部署。

修改 `.env` 或服务端代码后需重启；修改前端静态文件后刷新网页即可。日志和进程记录位于 `.runtime/`。书签和 Chrome 扩展只负责打开网页，不启动 Node。不要直接打开 HTML，也不要移动已配置自启的项目目录。

## 数据保留与目录

每次抓取前自动执行 **30 天本地数据保留策略**，远程抓取失败也会清理。论文按论文日期清理，缺失日期时使用抓取时间或文件修改时间；本机分析缓存按论文或缓存时间清理。过期原始快照及 `archive/cleanup-*.zip` / `.json` 也会删除。个人排名设置、环境配置、源码和研究资料不参与论文数据清理。Vercel 版本的私人分析结果保存在浏览器，清除该网站的浏览器数据即可删除；它们不写入共享论文快照。

网页默认显示最近 7 天；30 天是数据保留上限，不保证保存完整的 30 天历史论文库。普通浏览器刷新不触发清理。Docker 部署将整个 `data/` 持久化到数据卷。

| 路径 | 用途 |
| --- | --- |
| `src/` | 当前应用源码和测试 |
| `src/web/public/` | 网页静态资源 |
| `deploy/`、`Dockerfile`、`compose.yaml` | 独立服务器部署配置及说明 |
| `vercel.json`、`api/chat.js`、`src/browser/` | Vercel 配置、单次模型代理与浏览器分析程序 |
| `public-data/dashboard.json` | 可发布的论文元数据快照，不含私人分析和排名 |
| `.github/workflows/refresh-papers.yml` | 每日抓取、更新公开快照，触发 Vercel 重建 |
| `dist/` | `npm run build:vercel` 生成的静态网站 |
| `scripts/` | Windows 服务管理和验证脚本 |
| `.env`、`.runtime/` | 本机配置、日志与进程记录，不打包上传 |
| `data/papers.json` | 合并论文库 |
| `data/arxiv-papers.json`、`data/aps/`、`data/nature/` | 各来源缓存和原始抓取快照 |
| `data/cache/` | 刷新状态、个人排名设置 |
| `data/analysis/` | 规则统计、排名导出及按访客隔离的趋势缓存 |
| `data/raw/` | 原始抓取快照 |
| `data/summaries/` | 旧版单篇总结缓存 |
| `paper2task_materials/`、`archive/` | 独立研究资料和历史归档，不参与网页发布 |

## 维护与验证

`npm run lint` 检查启动入口语法。在 PowerShell 可只执行应用测试，避免操作 Windows 自启：

```powershell
$sourceTestFiles = @(rg --files src -g '*.test.js')
node --test @sourceTestFiles
```

`scripts/windows-service.test.js` 是 Windows 服务集成测试，会在隔离目录创建临时任务，日常前端修改无需运行。`npm run refresh:aps:accepted` 和 `npm run fetch:nature` 是独立抓取命令；轻量 Docker 镜像未安装浏览器，不能执行需要浏览器的兜底路径。

本机 / Docker 主要接口：`GET /api/health`、`GET /api/papers`、`GET /api/analysis`、`GET/PUT /api/scoring`、`POST /api/refresh`、`GET /api/trends/fields`、`GET/POST /api/trends/options`、`POST /api/trends/analyze`、`GET /api/trends/jobs/:id`。分析 POST 的 `api` 字段为 `{ baseUrl, apiKey, model }`，任务状态仅向所属访客返回。Vercel 版本在浏览器内实现这些状态操作，仅 `POST /api/chat` 调用服务器；此接口始终要求访客自带 API 配置。

部署相关本地检查：`npm run build:vercel` 构建可公开静态文件；`node --test scripts/chat-api.test.js` 验证请求限制、密钥隔离与快照脱敏。
