import { apiFetch, usesBrowserRuntime } from './apiClient.js';
import { mountKeywordRankEditor } from './keywordRankEditor.js';
import { paperCard, escapeHtml } from './paperCards.js';
import { journalIdentity } from './journalIdentity.js';
import { mountConcernAnalysis } from './concernAnalysis.js';
let keywordEditor;
let concernAnalysis;
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const state={papers:[],filtered:[],loading:true,dataVersion:0,days:7,journal:'',sort:'rank',lang:localStorage.getItem('rp-lang')||'zh'};
const copy={zh:{brandSub:'最新科研动态 · LIVE',navPapers:'最新论文',navAnalysis:'趋势分析',refresh:'刷新数据',heroTitle:'各大期刊 · 最近<span>7天论文</span>',journalLabel:'选择期刊',window:'时间窗口',clear:'清空筛选（保留权重）',paperHeading:'最近 7 天期刊论文',paperSub:'包含 accepted 与 published；点击标题查看原文',search:'搜索标题、作者或摘要',brief:'汇集 arXiv、APS 与 Nature 最新论文。点击刷新即可重新抓取、去重并更新数据。',empty:'没有匹配论文',loading:'正在加载论文与排名…'},en:{brandSub:"WHAT'S EVERYONE WORKING ON? · LIVE",navPapers:'Latest papers',navAnalysis:'Trend analysis',refresh:'Refresh data',heroTitle:'Major journals · <span>Last 7 days</span>',journalLabel:'Select journal',window:'Time window',clear:'Clear filters (keep weights)',paperHeading:'Journal papers from the last 7 days',paperSub:'Includes accepted and published papers; click a title to read',search:'Search titles, authors or abstracts',brief:'Latest papers from arXiv, APS and Nature. Refresh to crawl, deduplicate and update the dataset.',empty:'No matching papers',loading:'Loading papers and ranking…'}};
if (usesBrowserRuntime()) {
  copy.zh.brief = '汇集 arXiv、APS 与 Nature 最新论文。论文每天统一更新；刷新会重新读取最新数据。';
  copy.en.brief = 'Latest papers from arXiv, APS and Nature, updated daily. Refresh reloads the latest shared dataset.';
}
function setLanguage(lang){state.lang=lang;localStorage.setItem('rp-lang',lang);document.documentElement.lang=lang==='zh'?'zh-CN':'en';$$('[data-i18n]').forEach(el=>el.textContent=copy[lang][el.dataset.i18n]);$$('[data-i18n-html]').forEach(el=>el.innerHTML=copy[lang][el.dataset.i18nHtml]);$$('[data-i18n-placeholder]').forEach(el=>el.placeholder=copy[lang][el.dataset.i18nPlaceholder]);$$('.lang-btn').forEach(b=>b.classList.toggle('active',b.dataset.lang===lang));$('#brief').textContent=copy[lang].brief;keywordEditor?.setLanguage(lang);concernAnalysis?.setLanguage(lang);renderPapers()}
function text(p){return `${p.title||''} ${p.abstract||''} ${(p.authors||[]).join(' ')}`.toLowerCase()}
function date(p){return new Date(p.date||p.submittedAt||0)}
function apply(){const cutoff=Date.now()-state.days*864e5;state.filtered=state.papers.filter(p=>(state.days===9999||date(p)>=cutoff)&&(!state.journal||(p.journal_display||p.journal||p.source)===state.journal));render()}
function render() {
  $('#paperCount').textContent = state.filtered.length;
  $('#brief').textContent = copy[state.lang].brief;
  renderPapers();
}
function renderPapers() {
  if (state.loading) { $('#paperList').textContent = copy[state.lang].loading; return; }
  const query = ($('#search')?.value || '').toLowerCase();
  const sorter = state.sort === 'rank' ? ((a,b) => (a.recommendation?.final_rank || 99999) - (b.recommendation?.final_rank || 99999))
    : state.sort === 'date-asc' ? ((a,b) => date(a) - date(b)) : ((a,b) => date(b) - date(a));
  const list = state.filtered.filter(p => !query || text(p).includes(query)).sort(sorter).slice(0,80);
  const journals = new Map();
  state.filtered.forEach(p => { const identity=journalIdentity(p); const entry=journals.get(identity.name)||{identity,count:0}; entry.count++; journals.set(identity.name,entry); });
  $('#journalSummary').innerHTML = [...journals.values()].sort((a,b)=>b.count-a.count).map(({identity,count}) =>
    '<span class="journal-pill journal-key" data-journal="'+identity.key+'"><i aria-hidden="true"></i>'+escapeHtml(identity.name)+'<b>'+count+'</b></span>').join('');
  $('#paperList').innerHTML = list.map(p => paperCard(p,state.lang)).join('') || '<p>'+copy[state.lang].empty+'</p>';
}
async function load(){const loadVersion=++state.dataVersion;const p=await apiFetch('/api/papers',{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json()});if(loadVersion!==state.dataVersion)return;state.loading=false;state.papers=p.papers||[];const journals=[...new Set(state.papers.map(x=>x.journal_display||x.journal||x.source).filter(Boolean))].sort();$('#journal').innerHTML=`<option value="">${state.lang==='zh'?'全部期刊':'All journals'}</option>`+journals.map(j=>`<option value="${j}">${j}</option>`).join('');$('#journal').value=state.journal;$('#updated').textContent=`SYNC · ${new Date(p.state?.lastRefreshAt||Date.now()).toLocaleString(state.lang==='zh'?'zh-CN':'en-US')}`;apply();void concernAnalysis?.refresh()}
$$('.lang-btn').forEach(b=>b.onclick=()=>setLanguage(b.dataset.lang));$('#journal').onchange=e=>{state.journal=e.target.value;apply()};$('#sort').onchange=e=>{state.sort=e.target.value;renderPapers()};setLanguage(state.lang);
$$('.nav').forEach(b=>b.onclick=()=>{$$('.nav,.view').forEach(x=>x.classList.remove('active'));b.classList.add('active');$('#'+b.dataset.view).classList.add('active')});$('#days').onchange=e=>{state.days=+e.target.value;apply()};$('#search').oninput=renderPapers;$('#clear').onclick=()=>{state.journal='';state.days=7;$('#journal').value='';$('#days').value='7';$('#search').value='';apply()};$('#refresh').onclick=async()=>{const b=$('#refresh');b.classList.add('loading');b.disabled=true;try{await apiFetch('/api/refresh',{method:'POST'});await load()}finally{b.classList.remove('loading');b.disabled=false}};keywordEditor=mountKeywordRankEditor({lang:state.lang,onSaved:result=>{state.dataVersion++;state.loading=false;state.papers=result.papers;apply()}});keywordEditor.ready.then(load).catch(e=>$('#brief').textContent=`数据加载失败：${e.message}`);

concernAnalysis = mountConcernAnalysis({ lang: state.lang });
const requestedView = new URLSearchParams(location.search).get('view');
if (requestedView === 'overview') $(`.nav[data-view="${requestedView}"]`).click();
