# 用 Vercel 分享给朋友

推荐使用 **Vercel + GitHub 每日共享论文快照**。网站不依赖你的电脑，不需要买独立服务器或数据库；朋友各自在趋势页填写自己的 API Key，模型费用计入他们自己的 API 账户。发布后可以直接分享 Vercel 提供的 HTTPS 地址，无需先买域名。

Vercel Hobby 面向个人、非商业项目，包含免费额度但不是无限量；少量朋友使用可先在额度内运行，访问和分析增多时需看控制台用量。详见 [Hobby 说明](https://vercel.com/docs/plans/hobby)。GitHub 公共仓库的标准托管运行器与私有仓库的分钟额度规则不同，私有仓库请查看 [GitHub Actions 额度](https://docs.github.com/en/billing/concepts/product-billing/github-actions)。

## 一次性上线

1. 用自己的 GitHub 账号创建一个**个人仓库**，建议设为 Private。不要放在 GitHub Organization 下；Vercel Hobby 对组织私有仓库有限制。把部署包中的文件上传到仓库根目录，保留隐藏目录 `.github/`。部署包不包含原电脑的 `.env`、`data/` 或研究资料；`public-data/dashboard.json` 是剔除私人设置后的公开论文快照，可以上传。
2. 注册/登录 Vercel，关联同一个 GitHub 账号，选择 **Add New → Project**，导入这个仓库。选择 Hobby。项目根目录保持根目录，Framework Preset 选 **Other**，Node.js 选 **22.x**。仓库里的 `vercel.json` 会设置安装命令 `npm ci`、构建命令 `npm run build:vercel` 和输出目录 `dist`。**不填任何模型 API Key，也不需要设置 PUBLIC_ORIGIN。**
3. 点击 Deploy。构建完成后，打开项目的 Production 地址，例如 `https://你的项目.vercel.app`。分享这个正式地址给朋友；如有 Vercel 登录拦截，在项目的 Deployment Protection 中确认正式站点允许朋友访问，预览部署可以继续保留保护。
4. 查看首页论文及趋势页，确认不填 API 时可看数量统计；填写自己的 API 配置后才分析。首次部署使用包内公开快照，每日自动更新需要继续完成下一节。

网页是静态文件，只有 `/api/chat` 使用 Vercel Function，每次只等待一次模型请求。整个多步分析由朋友的浏览器组织，逐篇结果和报告缓存在他们自己的浏览器 IndexedDB。API 地址、API Key 和模型名称另存于当前浏览器的本站 localStorage，刷新或重新打开会自动填入；点击“清除 API Key”会删除保存的密钥，并保留地址和模型。密钥不存入 IndexedDB 分析结果、部署环境、论文文件或服务器日志。关闭页面后分析停止，重新打开可使用恢复的配置手动检查已有缓存；恢复配置本身不调用模型。清除浏览器网站数据会删除配置和分析缓存。

## 开启每日更新

工作流文件是 `.github/workflows/refresh-papers.yml`，默认在 [arXiv 常规公布时间](https://info.arxiv.org/help/availability.html)后 **10 分钟**运行：美国东部时间周日至周四 **20:10**，对应北京时间周一至周五夏令时 **08:10**、冬令时 **09:10**。工作流使用 `America/New_York` 时区自动适配夏令时，也可手动运行。此计划按常规公布时间触发，不检测 arXiv 的节假日或临时延迟。它先用上次公开快照恢复缓存，再抓取公开论文，最后只提交剔除私人内容后的快照；不执行 AI 分析，不需要模型密钥。

1. 在 GitHub 仓库 **Settings → Actions → General** 中允许 Actions，确保 Workflow permissions 允许 **Read and write permissions**，以便每日更新文件。如果你启用了分支保护，应允许这个维护工作流提交，或改为人工合并更新。
2. 在 **Settings → Secrets and variables → Actions → Variables** 新建两个普通仓库变量：

   | 变量 | 填什么 |
   | --- | --- |
   | `DEPLOY_COMMIT_NAME` | 你自己的 GitHub 提交姓名或用户名 |
   | `DEPLOY_COMMIT_EMAIL` | 已关联到你 GitHub 账号的提交邮箱；可以从个人 GitHub Settings → Emails 复制完整的 `...@users.noreply.github.com` 邮箱 |

   这两个变量让**你自己的自动维护提交**正确关联到你绑定的 Vercel 账号。不要填写朋友或机器人的身份；Hobby 要求私有仓库触发部署的提交作者属于项目所有者，详见 [Vercel Git 部署要求](https://vercel.com/docs/git)。变量不是模型密钥。

3. 打开仓库 **Actions → Refresh public papers → Run workflow**，首次手动运行一次。确认工作流成功提交 `public-data/dashboard.json` 后，Vercel 自动开始新的 Production 部署；部署完成后网页显示新的更新时间。若 Actions 成功而 Vercel 阻止部署，先检查这两个变量的邮箱是否确实关联到同一个 GitHub/Vercel 账号。

GitHub 的定时任务可能延迟，不保证准确到分钟；公共仓库长时间无活动也可能停用计划任务，详见 [GitHub 定时工作流说明](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)。必要时从 Actions 手动运行一次。

## 朋友实际看到的行为

- 论文与领域数量统计使用同一份每日更新数据，不会每人重复抓取。网页“刷新”只重新读取最近已发布的数据；立即抓取需由你在 GitHub Actions 手动运行工作流。
- 每个人的关键词权重保存在自己的浏览器，不影响其他朋友。
- 趋势分析需输入公网 HTTPS 的 OpenAI-compatible Chat Completions Base URL、自己的 API Key 和模型 ID。密钥经本站 HTTPS Function 临时转发到填写的提供商，因此朋友应信任分享给他们的这个站点。
- 分析时保持页面打开。页面重载或关闭会中止后续步骤；已发出的模型请求仍可能计费。重新打开后自动恢复本浏览器保存的 API 配置，点击检查缓存即可复用结果；不同模型或内容变化会重新分析。

## 维护与本地验证

只改界面或代码时提交仓库，Vercel 自动重建；不在 Vercel 构建中抓论文。需要手动生成公开快照时，在本机已经有论文数据的项目目录执行：

```sh
npm run export:public
npm run build:vercel
```

`export:public` 只复制允许公开的论文元数据，剔除单篇私人总结、个人权重、分析结果和配置；`build:vercel` 只使用 `public-data/dashboard.json`。不要把原始 `data/` 整体复制成公开文件。

本项目开启 Fluid Compute，单次 Function 上限配置为 300 秒；其中一次模型请求最多等待 180 秒，不在 Function 里保存任务或创建后台循环。相关配置见 [Vercel 时长限制](https://vercel.com/docs/functions/configuring-functions/duration) 和 [项目配置](https://vercel.com/docs/project-configuration/vercel-json)。网络或模型响应过慢时可以重试已完成缓存之后的部分。

当前交付的是可部署代码和公开数据快照，还没有连接你的 GitHub/Vercel 账号或实际发布。首次上线后需检查实际域名、Function 网络连通性、每日更新和账户用量。Docker 独立服务器方案仍保留在 [另一份部署说明](README.md) 中，作为以后需要常驻后台时的备选。
