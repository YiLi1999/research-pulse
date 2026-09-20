export function buildSummaryMessages(paper) {
  return [
    {
      role: "system",
      content:
        "你是一名量子信息与量子物理方向的中文科研助手。请严格基于给定论文信息输出 JSON，不要输出 Markdown，不要编造论文中没有出现的结果。"
    },
    {
      role: "user",
      content: JSON.stringify({
        task: "请为 arXiv 论文生成中文总结与关键词。",
        output_schema: {
          oneLine: "一句话总述",
          researchProblem: "研究问题",
          method: "核心方法",
          results: "主要结果",
          whyImportant: "为什么值得关注",
          keywords: ["关键词1", "关键词2", "关键词3"],
          importanceScore: "0-100 之间的整数，可粗略反映关注度"
        },
        requirements: [
          "中文，学术但易读",
          "不要空话，尽量具体",
          "不要只是翻译摘要，要提炼研究贡献",
          "关键词尽量短，偏研究主题词"
        ],
        paper: {
          title: paper.title,
          authors: paper.authors,
          abstract: paper.abstract,
          categories: paper.categories
        }
      })
    }
  ];
}
