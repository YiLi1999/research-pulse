import { apiFetch, usesBrowserRuntime } from './apiClient.js';
const translations = {
  zh: {
    title: "关键词 Rank 设置",
    rules: "评分规则",
    formula: "总分 = Σ weight ×（标题命中 × 2 + 摘要命中 × 1）",
    help: "每个关键词在同一字段只计一次；忽略大小写，按完整词或短语匹配（连字符变体等同）。weight=0 暂停计分；不同关键词独立累加。没有隐藏加分。同分按时间从新到旧，全局 Rank 不随筛选重编号。",
    persistence: "自动保存到当前浏览器对应的访客空间，不影响其他访客；清除站点 Cookie 后会成为新访客。",
    empty: "尚未设置关键词。所有论文得分为 0，按时间排序；空列表也会保存。",
    keyword: "关键词", addLabel: "新增关键词", add: "＋ 添加", remove: "删除", retry: "重试",
    placeholder: "例如 fidelity estimation",
    loading: "正在加载已保存设置…", saved: "已保存 · 排名已更新", pending: "等待自动保存…",
    saving: "正在保存并重新排名…", error: "保存失败，修改尚未确认。请重试。",
    loadError: "读取设置失败。请重试，不会恢复默认值。",
    invalid: "请填写不重复的关键词（1–100 字符）和有效 weight（0–100000）。",
    duplicate: "这个关键词已经存在。", limit: "最多设置 200 个关键词。"
  },
  en: {
    title: "Keyword Rank settings",
    rules: "Scoring rules",
    formula: "Score = Σ weight × (title match × 2 + abstract match × 1)",
    help: "Each keyword counts once per field. Case-insensitive whole-word / phrase matching; equivalent Unicode hyphens are normalized. Weight 0 disables a keyword. Different keywords add independently, with no hidden bonuses. Ties use newest first; global ranks do not change with filters.",
    persistence: "Saved in this browser’s visitor space without affecting others. Clearing site cookies starts a new visitor space.",
    empty: "No keywords. All scores are 0 and papers sort by date. The empty list is saved too.",
    keyword: "Keyword", addLabel: "New keyword", add: "＋ Add", remove: "Delete", retry: "Retry",
    placeholder: "e.g. fidelity estimation",
    loading: "Loading saved settings…", saved: "Saved · ranking updated", pending: "Waiting to save…",
    saving: "Saving and reranking…", error: "Save failed. Changes are not confirmed; please retry.",
    loadError: "Could not load settings. Retry; defaults will not be restored.",
    invalid: "Use unique keywords (1–100 characters) and valid weights (0–100000).",
    duplicate: "This keyword already exists.", limit: "You can set up to 200 keywords."
  }
};

if (usesBrowserRuntime()) {
  translations.zh.persistence = '自动保存在当前浏览器，不影响其他访客；清除站点数据会删除设置。';
  translations.en.persistence = 'Saved in this browser without affecting others. Clearing site data removes your settings.';
}

const normalize = value => value.normalize("NFKC").toLowerCase().replace(/[‐‑‒–—−]/g, "-").replace(/\s+/g, " ").trim();

async function requestSettings(method = "GET", keywordWeights) {
  const response = await apiFetch("/api/scoring", {
    method, cache: "no-store",
    ...(method === "PUT" ? {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keywordWeights }),
      keepalive: true
    } : {})
  });
  if (!response.ok) throw new Error("HTTP " + response.status);
  return response.json();
}

export function mountKeywordRankEditor({ lang = "zh", onSaved }) {
  const $ = selector => document.querySelector(selector);
  const rows = $("#keywordRows");
  let language = lang, status = "loading", loaded = false, version = 0, savedVersion = 0;
  let timer, saving = false, nextId = 0;
  const t = key => translations[language][key];
  const controls = () => [...rows.querySelectorAll(".keyword-row")];

  function showStatus(next) {
    status = next;
    $("#rankSaveStatus").textContent = t(next);
    $("#rankSaveStatus").dataset.state = next;
    $("#rankRetry").hidden = next !== "error" && next !== "loadError";
  }

  function setLanguage(next) {
    language = next;
    const texts = {
      rankSettingsTitle: "title", rankFormula: "formula", rankHelp: "help", rankPersistence: "persistence",
      rankEmpty: "empty", newKeywordLabel: "addLabel", keywordAdd: "add", rankRetry: "retry", rankRulesLabel: "rules"
    };
    for (const [id, key] of Object.entries(texts)) $("#" + id).textContent = t(key);
    $("#keywordInput").placeholder = t("placeholder");
    rows.setAttribute("aria-label", t("title"));
    for (const row of controls()) {
      row.querySelector(".keyword-label").textContent = t("keyword");
      row.querySelector("button").textContent = "×";
      row.querySelector("button").title = t("remove");
      row.querySelector("button").setAttribute("aria-label", t("remove") + " " + row.querySelector(".keyword-name").value);
    }
    showStatus(status);
  }

  function readWeights() {
    const result = new Map();
    for (const row of controls()) {
      const input = row.querySelector(".keyword-name"), weightInput = row.querySelector(".keyword-weight");
      const key = normalize(input.value), raw = weightInput.value, weight = Number(raw);
      input.setCustomValidity("");
      weightInput.setCustomValidity("");
      if (!key || key.length > 100 || /[\u0000-\u001f]/.test(key) || result.has(key)) {
        input.setCustomValidity(t("invalid"));
        throw new Error("invalid");
      }
      if (!raw.trim() || !Number.isFinite(weight) || weight < 0 || weight > 100000 || !weightInput.validity.valid) {
        weightInput.setCustomValidity(t("invalid"));
        throw new Error("invalid");
      }
      result.set(key, weight);
    }
    return Object.fromEntries(result);
  }

  async function flush() {
    clearTimeout(timer);
    if (!loaded || saving || version === savedVersion) return;
    let weights;
    try { weights = readWeights(); } catch { showStatus("invalid"); return; }
    const sentVersion = version;
    saving = true;
    showStatus("saving");
    try {
      const response = await requestSettings("PUT", weights);
      savedVersion = sentVersion;
      // A slower response must never replace newer edits or their paper ranking.
      if (version === sentVersion) {
        onSaved(response);
        showStatus("saved");
      }
    } catch {
      if (version === sentVersion) showStatus("error");
    } finally {
      saving = false;
      if (version !== sentVersion) void flush();
    }
  }

  function changed(immediate = false) {
    version++;
    clearTimeout(timer);
    $("#rankEmpty").hidden = controls().length !== 0;
    try { readWeights(); } catch { showStatus("invalid"); return; }
    showStatus("pending");
    timer = setTimeout(flush, immediate ? 0 : 450);
  }

  function appendRow(keyword, weight) {
    const id = ++nextId;
    const row = document.createElement("div");
    row.className = "keyword-row";
    // Only static markup goes into innerHTML. User keywords are assigned as values.
    row.innerHTML = '<label><span class="keyword-label"></span><input class="keyword-name" maxlength="100" required></label><label class="weight-label"><span>Weight</span><input class="keyword-weight" type="number" min="0" max="100000" step="any" required></label><button type="button" class="keyword-delete">×</button>';
    const nameInput = row.querySelector(".keyword-name");
    nameInput.value = keyword;
    nameInput.id = "rank-keyword-" + id;
    row.querySelector(".keyword-label").textContent = t("keyword");
    const weightInput = row.querySelector(".keyword-weight");
    weightInput.value = weight;
    weightInput.id = "rank-weight-" + id;
    const remove = row.querySelector("button");
    remove.title = t("remove");
    remove.setAttribute("aria-label", t("remove") + " " + keyword);
    remove.onclick = () => { row.remove(); changed(true); };
    row.oninput = () => {
      remove.setAttribute("aria-label", t("remove") + " " + nameInput.value);
      changed();
    };
    rows.append(row);
  }

  async function load() {
    showStatus("loading");
    try {
      const settings = await requestSettings();
      if (!settings.keywordWeights || Array.isArray(settings.keywordWeights) || typeof settings.keywordWeights !== "object") {
        throw new Error("Invalid settings");
      }
      rows.replaceChildren();
      for (const [keyword, weight] of Object.entries(settings.keywordWeights)) appendRow(keyword, weight);
      loaded = true;
      $("#keywordInput").disabled = $("#keywordWeight").disabled = $("#keywordAdd").disabled = false;
      $("#rankEmpty").hidden = controls().length !== 0;
      showStatus("saved");
    } catch { showStatus("loadError"); }
  }

  $("#keywordForm").onsubmit = event => {
    event.preventDefault();
    if (!loaded) return;
    const input = $("#keywordInput"), weightInput = $("#keywordWeight");
    input.setCustomValidity("");
    let current;
    try { current = readWeights(); } catch { showStatus("invalid"); return; }
    const keyword = normalize(input.value);
    if (Object.hasOwn(current, keyword)) {
      input.setCustomValidity(t("duplicate")); input.reportValidity(); return;
    }
    if (controls().length >= 200) {
      input.setCustomValidity(t("limit")); input.reportValidity(); return;
    }
    if (!keyword || keyword.length > 100 || !weightInput.value.trim() || !$("#keywordForm").reportValidity()) return;
    appendRow(keyword, Number(weightInput.value));
    input.value = "";
    changed(true);
    input.focus();
  };
  $("#keywordInput").oninput = () => $("#keywordInput").setCustomValidity("");
  $("#rankRetry").onclick = () => loaded ? flush() : load();
  // Don't claim a pending debounce/request was saved if the user leaves immediately.
  window.addEventListener("beforeunload", event => {
    if (version !== savedVersion) {
      void flush();
      event.preventDefault();
      event.returnValue = "";
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush();
  });
  setLanguage(language);
  return { ready: load(), setLanguage };
}
