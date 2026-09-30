import { BM25 } from "./search.js";

const WEBLLM_URL = "https://esm.run/@mlc-ai/web-llm@0.2.85";

// 브라우저에서 돌릴 모델 후보 (첫 번째가 기본값)
// WebLLM 0.2.85의 Qwen3.5 설정은 Qwen2 시절 종료 토큰 ID(151643, 151645)를 쓰는데,
// Qwen3.5 어휘에서 151643은 " 내용"이라 한국어 답변이 중간에 끊긴다. 올바른 ID로 덮어쓴다.
const QWEN35_STOP_IDS = [248044, 248046]; // <|endoftext|>, <|im_end|>

const MODELS = [
  { id: "Qwen3.5-2B", label: "표준 · Qwen3.5 2B (약 1GB)", thinking: true, stopIds: QWEN35_STOP_IDS },
  { id: "Qwen3.5-4B", label: "고품질 · Qwen3.5 4B (약 2.3GB)", thinking: true, stopIds: QWEN35_STOP_IDS },
  { id: "Qwen2.5-1.5B-Instruct", label: "경량 · Qwen2.5 1.5B (약 0.9GB)", thinking: false },
];

// 소형 모델은 "모르면 거절" 규칙을 강하게 주면 모든 질문을 거절하므로, 거절 조건은 약하게 질문 뒤에 둔다
const SYSTEM_PROMPT =
  "당신은 '미닉스 더 플렌더 맥스' 음식물 처리기의 사용 설명서 안내 도우미입니다. " +
  "사용자가 제공한 설명서 내용을 바탕으로 한국어로 정확하고 간결하게 답하세요. " +
  "설명서의 문구와 숫자를 그대로 활용하고, 설명서에 없는 내용은 지어내지 마세요.";
const NOT_FOUND_HINT =
  '(설명서 내용에 답이 전혀 없을 때만 "설명서에서 찾을 수 없습니다. 고객만족 서비스센터(1800-6307)로 문의해 주세요."라고 답하세요.)';

const $ = (sel) => document.querySelector(sel);
const log = $("#log");
const form = $("#form");
const input = $("#q");
const sendBtn = $("#send");
const aiBtn = $("#ai-btn");
const modelSel = $("#model");
const statusEl = $("#status");
const progressWrap = $("#progress");
const progressBar = $("#progress-bar");
const progressText = $("#progress-text");

let index = null;
let webllm = null;
let engine = null;
let activeModel = null;
let busy = false;
let hasF16 = false;

// ---------- 초기화 ----------
async function init() {
  const data = await fetch("chunks.json").then((r) => r.json());
  index = new BM25(data.chunks);

  const gpuOk = await detectWebGPU();
  for (const m of MODELS) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.label;
    modelSel.append(opt);
  }
  if (!gpuOk) {
    setStatus("off", "이 브라우저는 AI 미지원 · 검색 모드");
    aiBtn.disabled = true;
    modelSel.disabled = true;
    $("#ai-hint").textContent =
      "WebGPU를 지원하는 최신 Chrome 또는 Edge(PC)에서 AI 답변을 사용할 수 있습니다. 지금은 설명서 검색 결과로 답합니다.";
  } else {
    setStatus("off", "AI 꺼짐 · 검색 모드");
  }
  input.disabled = false;
  sendBtn.disabled = false;
  input.focus();
}

async function detectWebGPU() {
  if (!("gpu" in navigator)) return false;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return false;
    hasF16 = adapter.features.has("shader-f16");
    return true;
  } catch {
    return false;
  }
}

function modelId(m) {
  return `${m.id}-${hasF16 ? "q4f16_1" : "q4f32_1"}-MLC`;
}

function setStatus(kind, text) {
  statusEl.dataset.kind = kind;
  statusEl.textContent = text;
}

// ---------- AI 모델 불러오기 ----------
aiBtn.addEventListener("click", async () => {
  const m = MODELS.find((x) => x.id === modelSel.value);
  if (engine && activeModel === m) return;
  aiBtn.disabled = modelSel.disabled = true;
  progressWrap.hidden = false;
  setStatus("loading", "AI 불러오는 중…");
  try {
    webllm ??= await import(WEBLLM_URL);
    const id = modelId(m);
    const cfg = webllm.prebuiltAppConfig.model_list.find((x) => x.model_id === id);
    if (cfg?.vram_required_MB) {
      progressText.textContent = `GPU 메모리 약 ${(cfg.vram_required_MB / 1024).toFixed(1)}GB 필요 · 준비 중…`;
    }
    let chatOpts;
    if (m.stopIds && cfg) {
      const chatConfig = await fetch(`${cfg.model}/resolve/main/mlc-chat-config.json`).then((r) => r.json());
      chatOpts = { conv_template: { ...chatConfig.conv_template, stop_token_ids: m.stopIds } };
    }
    if (engine) await engine.unload();
    engine = await webllm.CreateMLCEngine(id, {
      initProgressCallback: (p) => {
        progressBar.style.width = `${Math.round((p.progress || 0) * 100)}%`;
        progressText.textContent = p.text;
      },
    }, chatOpts);
    activeModel = m;
    setStatus("on", `AI 켜짐 · ${m.label.split(" · ")[1].replace(/\s*\(.*\)$/, "")}`);
    aiBtn.textContent = "모델 변경";
    progressWrap.hidden = true;
  } catch (err) {
    console.error(err);
    engine = null;
    activeModel = null;
    setStatus("off", "AI 불러오기 실패 · 검색 모드");
    const msg = String(err.message || err);
    const storage = /Cache|Quota|storage/i.test(msg);
    progressText.textContent =
      (storage
        ? "브라우저 저장 공간이 부족해 모델을 저장하지 못했습니다. 더 가벼운 모델을 선택하거나 디스크 공간을 확보해 주세요. "
        : "불러오기에 실패했습니다. 더 가벼운 모델을 선택하거나 다른 브라우저(Chrome/Edge)에서 시도해 주세요. ") +
      `(${msg})`;
  } finally {
    aiBtn.disabled = modelSel.disabled = false;
  }
});

// ---------- 질문 처리 ----------
form.addEventListener("submit", (e) => {
  e.preventDefault();
  ask(input.value.trim());
});

document.querySelectorAll(".chip").forEach((c) =>
  c.addEventListener("click", () => ask(c.textContent.trim()))
);

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    form.requestSubmit();
  }
});

async function ask(q) {
  if (!q || busy || !index) return;
  busy = true;
  sendBtn.disabled = true;
  input.value = "";
  $("#intro")?.remove();

  addMessage("user").textContent = q;
  const bubble = addMessage("bot");
  const results = index.search(q, 4);

  try {
    if (!results.length) {
      bubble.innerHTML = render("설명서에서 관련 내용을 찾지 못했습니다.");
      addWebSearch(bubble, q);
    } else if (engine) {
      const answer = await answerWithAI(q, results, bubble);
      if (/찾을 수 없습니다/.test(answer)) addWebSearch(bubble, q);
      else addSources(bubble, results);
    } else {
      answerWithSearch(results, bubble);
    }
  } catch (err) {
    console.error(err);
    bubble.innerHTML = render("답변 생성 중 오류가 발생했습니다. 아래 설명서 내용을 참고해 주세요.");
    answerWithSearch(results, bubble, true);
  } finally {
    busy = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

async function answerWithAI(q, results, bubble) {
  const context = results
    .map((r) => `(p.${r.doc.page} · ${r.doc.section})\n${r.doc.text}`)
    .join("\n\n---\n\n");
  bubble.classList.add("typing");
  const req = {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `[설명서 내용]\n${context}\n\n[질문]\n${q}\n\n${NOT_FOUND_HINT}` },
    ],
    temperature: 0.2,
    top_p: 0.9,
    max_tokens: 700,
    stream: true,
  };
  if (activeModel.thinking) req.extra_body = { enable_thinking: false };

  await engine.resetChat();
  const stream = await engine.chat.completions.create(req);
  let text = "";
  for await (const chunk of stream) {
    text += chunk.choices[0]?.delta?.content || "";
    bubble.innerHTML = render(stripThink(text));
    scrollDown();
  }
  bubble.classList.remove("typing");
  return stripThink(text);
}

// 설명서에 없는 질문: 제품명을 붙인 검색어로 외부 검색 결과를 새 탭에서 열 수 있게 안내
function addWebSearch(bubble, q) {
  const query = encodeURIComponent(`미닉스 더 플렌더 맥스 ${q}`);
  const box = document.createElement("div");
  box.className = "websearch";
  box.innerHTML =
    `<p class="muted">설명서에 없는 내용이라 인터넷 검색을 안내합니다. (공식 설명서가 아닌 정보는 정확하지 않을 수 있어요)</p>` +
    `<div class="websearch-links">` +
    `<a href="https://duckduckgo.com/?q=${query}" target="_blank" rel="noopener">DuckDuckGo에서 검색</a>` +
    `<a href="https://search.naver.com/search.naver?query=${query}" target="_blank" rel="noopener">네이버에서 검색</a>` +
    `<a href="tel:1800-6307">고객센터 1800-6307</a>` +
    `</div>`;
  bubble.append(box);
  scrollDown();
}

function answerWithSearch(results, bubble, append = false) {
  const html = results
    .map(
      (r) => `<div class="excerpt"><div class="excerpt-head">${pageLink(r.doc)}</div>${render(r.doc.text)}</div>`
    )
    .join("");
  const lead = append ? "" : `<p class="muted">설명서에서 찾은 관련 내용입니다. (AI를 켜면 요약된 답변을 받을 수 있어요)</p>`;
  bubble.innerHTML += lead + html;
  scrollDown();
}

function addSources(bubble, results) {
  const seen = new Set();
  const links = results
    .filter((r) => !seen.has(r.doc.page) && seen.add(r.doc.page))
    .map((r) => pageLink(r.doc))
    .join(" ");
  const details = document.createElement("details");
  details.className = "sources";
  details.innerHTML =
    `<summary>근거: ${links}</summary>` +
    results
      .map((r) => `<div class="excerpt"><div class="excerpt-head">${pageLink(r.doc)}</div>${render(r.doc.text)}</div>`)
      .join("");
  bubble.append(details);
  scrollDown();
}

// ---------- 표시 도우미 ----------
function addMessage(role) {
  const row = document.createElement("div");
  row.className = `msg ${role}`;
  const b = document.createElement("div");
  b.className = "bubble";
  row.append(b);
  log.append(row);
  scrollDown();
  return b;
}

function pageLink(doc) {
  return `<a href="manual.pdf#page=${doc.page}" target="_blank" rel="noopener">p.${doc.page} ${escapeHtml(doc.section)}</a>`;
}

function stripThink(t) {
  return t.replace(/<think>[\s\S]*?(<\/think>|$)/g, "").trimStart();
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// 아주 가벼운 마크다운: 굵게, 목록, 줄바꿈
function render(text) {
  const lines = escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").split("\n");
  let html = "";
  let list = null;
  for (const raw of lines) {
    const ln = raw.trim();
    const ul = ln.match(/^(?:[-•·*]|&middot;)\s+(.*)/);
    const ol = ln.match(/^(\d+)[.)]\s+(.*)/);
    const kind = ul ? "ul" : ol ? "ol" : null;
    if (kind !== list) {
      if (list) html += `</${list}>`;
      if (kind) html += `<${kind}>`;
      list = kind;
    }
    if (ul) html += `<li>${ul[1]}</li>`;
    else if (ol) html += `<li>${ol[2]}</li>`;
    else if (ln) html += `<p>${ln}</p>`;
  }
  if (list) html += `</${list}>`;
  return html;
}

function scrollDown() {
  log.scrollTop = log.scrollHeight;
}

init().catch((err) => {
  console.error(err);
  setStatus("off", "초기화 실패");
});
