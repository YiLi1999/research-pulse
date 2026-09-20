import { hasLlmConfig, chatJson } from "../summarizer/llmClient.js";

function countKeywords(papers) {
  const counter = new Map();
  for (const paper of papers) {
    for (const keyword of paper.keywords || []) {
      const normalized = keyword.trim();
      if (!normalized) {
        continue;
      }
      counter.set(normalized, (counter.get(normalized) || 0) + 1);
    }
  }

  return Array.from(counter.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([keyword, count]) => ({ keyword, count }));
}

function buildTopicClusters(keywordStats) {
  const clusters = [
    {
      topic: "量子信息与通信",
      matchers: ["communication", "cryptography", "device-independent", "self-testing", "bell", "randomness"]
    },
    {
      topic: "量子计算与纠错",
      matchers: ["computing", "error correction", "ldpc", "decoder", "fault tolerance", "surface code"]
    },
    {
      topic: "量子多体与开放系统",
      matchers: ["many-body", "open", "entanglement", "chaos", "anyon"]
    },
    {
      topic: "量子光学与连续变量",
      matchers: ["optics", "photon", "continuous variable", "cavity", "spin-phonon"]
    }
  ];

  return clusters
    .map((cluster) => {
      const hits = keywordStats.filter((item) =>
        cluster.matchers.some((matcher) => item.keyword.toLowerCase().includes(matcher))
      );

      return {
        topic: cluster.topic,
        count: hits.reduce((sum, item) => sum + item.count, 0),
        keywords: hits.slice(0, 5).map((item) => item.keyword)
      };
    })
    .filter((cluster) => cluster.count > 0)
    .sort((a, b) => b.count - a.count);
}

function buildFallbackTrendSummary(papers, keywordStats, clusters) {
  const leadingKeywords = keywordStats.slice(0, 8).map((item) => item.keyword).join("、");
  const leadingTopics = clusters.slice(0, 3).map((item) => item.topic).join("、");

  return `最近 7 天 quant-ph 论文主要集中在 ${leadingTopics || "量子信息与量子计算"}。从高频关键词看，${leadingKeywords || "量子纠错、纠缠与量子通信"} 出现较多，说明本周关注点仍围绕量子纠错、量子资源理论、量子通信与多体纠缠结构展开。若从推荐分数和关键词覆盖看，值得优先浏览的是同时涉及 foundational、information 或 optics 交叉主题的论文。`;
}

export async function analyzeTrends(papers, options = {}) {
  const keywordStats = countKeywords(papers);
  const clusters = buildTopicClusters(keywordStats);
  const topPapers = [...papers]
    .sort((a, b) => (b.recommendation?.score || 0) - (a.recommendation?.score || 0))
    .slice(0, 8)
    .map((paper) => ({
      title: paper.title,
      keywords: paper.keywords || [],
      score: paper.recommendation?.score || 0
    }));

  let weeklySummary = buildFallbackTrendSummary(papers, keywordStats, clusters);

  if (options.useLlm !== false && hasLlmConfig() && papers.length > 0) {
    try {
      const result = await chatJson([
        {
          role: "system",
          content:
            "你是一名量子方向文献分析助手。请基于给定的关键词统计和代表论文，输出 JSON，总结最近一周 arXiv quant-ph 的研究趋势。"
        },
        {
          role: "user",
          content: JSON.stringify({
            output_schema: {
              weeklySummary: "一段中文趋势总结",
              notableDirections: ["方向1", "方向2", "方向3"]
            },
            inputs: {
              keywordStats: keywordStats.slice(0, 20),
              clusters,
              topPapers
            }
          })
        }
      ]);

      weeklySummary = result.weeklySummary || weeklySummary;

      if (Array.isArray(result.notableDirections) && result.notableDirections.length > 0) {
        for (const direction of result.notableDirections) {
          clusters.push({ topic: direction, count: 0, keywords: [] });
        }
      }
    } catch {
      // 失败时保留启发式总结
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    keywordStats,
    clusters,
    weeklySummary
  };
}
