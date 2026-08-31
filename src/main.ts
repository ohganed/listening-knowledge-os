type MarkerType = "unclear" | "interesting" | "important" | "language" | "connection";
type Screen = "start" | "quick" | "commute" | "recent" | "learning" | "candidate" | "inbox";
type KnowledgeCandidateType = "concept" | "expression" | "question" | "idea";

interface ListeningMarker {
  id: string;
  type: MarkerType;
  createdAt: number;
  playbackSeconds?: number;
}

interface KnowledgeCandidate {
  id: string;
  type: KnowledgeCandidateType;
  title: string;
  summary: string;
  sourceText?: string;
}

interface KnowledgeDraft {
  id: string;
  markerId: string;
  type: MarkerType;
  note: string;
  createdAt: string;
  status: "inbox";
  candidateType?: KnowledgeCandidateType;
}

const RECENT_WINDOW_MS = 5 * 60 * 1000;
const DB_NAME = "listening-knowledge-os";
const DB_VERSION = 1;
const MARKER_STORE = "markers";
const DRAFT_STORE = "drafts";

const markerMeta: Record<MarkerType, { icon: string; label: string }> = {
  unclear: { icon: "?", label: "Unclear" },
  interesting: { icon: "💡", label: "Interesting" },
  important: { icon: "!", label: "Important" },
  language: { icon: "🔤", label: "Language" },
  connection: { icon: "🔗", label: "Connect" },
};

const candidateMeta: Record<KnowledgeCandidateType, { icon: string; label: string }> = {
  concept: { icon: "🧠", label: "Concept" },
  expression: { icon: "💬", label: "Expression" },
  question: { icon: "❓", label: "Question" },
  idea: { icon: "💡", label: "Idea" },
};

const state: {
  screen: Screen;
  markers: ListeningMarker[];
  drafts: KnowledgeDraft[];
  selectedMarkerId?: string;
  candidates: KnowledgeCandidate[];
  quickType: MarkerType;
} = {
  screen: "start",
  markers: [],
  drafts: [],
  candidates: [],
  quickType: "unclear",
};

const app = document.querySelector<HTMLDivElement>("#app")!;
let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MARKER_STORE)) {
        const markers = db.createObjectStore(MARKER_STORE, { keyPath: "id" });
        markers.createIndex("createdAt", "createdAt");
        markers.createIndex("type", "type");
      }
      if (!db.objectStoreNames.contains(DRAFT_STORE)) {
        const drafts = db.createObjectStore(DRAFT_STORE, { keyPath: "id" });
        drafts.createIndex("createdAt", "createdAt");
        drafts.createIndex("status", "status");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function putRecord(storeName: string, value: ListeningMarker | KnowledgeDraft) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllRecords<T>(storeName: string): Promise<T[]> {
  const db = await openDatabase();
  return await new Promise<T[]>((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const request = tx.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
}

function uid(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function formatClock(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatAge(ms: number) {
  const diff = Math.max(0, Date.now() - ms);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

function parsePlayback(raw: string): number | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length <= 2) return Number(digits);
  if (digits.length <= 4) {
    const sec = Number(digits.slice(-2));
    const min = Number(digits.slice(0, -2));
    if (sec > 59) return null;
    return min * 60 + sec;
  }
  const sec = Number(digits.slice(-2));
  const min = Number(digits.slice(-4, -2));
  const hr = Number(digits.slice(0, -4));
  if (sec > 59 || min > 59) return null;
  return hr * 3600 + min * 60 + sec;
}

function formatPlayback(totalSeconds?: number) {
  if (totalSeconds == null) return "—";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function shell(content: string) {
  app.innerHTML = `<div class="shell">${content}</div><div id="toast" class="toast">✓ Saved</div>`;
}

function navigate(screen: Screen) {
  state.screen = screen;
  render();
}

function showToast(message: string) {
  const toast = document.querySelector<HTMLDivElement>("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 800);
}

async function saveMarker(type: MarkerType, playbackSeconds?: number) {
  const marker: ListeningMarker = { id: uid("marker"), type, createdAt: Date.now(), playbackSeconds };
  state.markers.unshift(marker);
  await putRecord(MARKER_STORE, marker);
  return marker;
}

async function captureMarker(type: MarkerType) {
  await saveMarker(type);
  renderCommute();
  requestAnimationFrame(() => showToast(`✓ ${markerMeta[type].label} saved`));
}

function candidateTypeForMarker(type: MarkerType): KnowledgeCandidateType {
  switch (type) {
    case "language": return "expression";
    case "unclear": return "question";
    case "connection": return "idea";
    case "important":
    case "interesting":
    default: return "concept";
  }
}

/**
 * v0.2 fallback extractor.
 * This is deliberately deterministic so the core flow works offline and
 * never requires AI to decide what becomes knowledge. A future AI provider
 * can replace this function while keeping the same KnowledgeCandidate model.
 */
async function extractKnowledgeCandidates(
  sourceText: string,
  markerType: MarkerType,
): Promise<KnowledgeCandidate[]> {
  const normalized = sourceText.trim();
  if (!normalized) return [];

  const chunks = normalized
    .split(/(?:\n+|(?<=[.!?。！？])\s+)/)
    .map(text => text.trim())
    .filter(Boolean)
    .slice(0, 3);

  const type = candidateTypeForMarker(markerType);
  return chunks.map(text => ({
    id: uid("candidate"),
    type,
    title: text.length > 42 ? `${text.slice(0, 42)}…` : text,
    summary: text,
    sourceText: normalized,
  }));
}

function renderStart() {
  shell(`
    <div>
      <div class="brand">LISTENING KNOWLEDGE OS</div>
      <h1 class="title">Turn listening into knowledge.</h1>
      <p class="subtle">電車では最小操作。Audibleの再生位置だけ見て、数字をすぐ入力します。</p>
    </div>
    <section class="card stack">
      <button class="primary" id="audibleBtn">⚡ QUICK CAPTURE</button>
      <button class="secondary" id="commuteBtn">🎧 Full Commute View</button>
      <button class="secondary" disabled>🔊 Speaker Listening — next</button>
    </section>
  `);
  document.querySelector("#audibleBtn")?.addEventListener("click", () => navigate("quick"));
  document.querySelector("#commuteBtn")?.addEventListener("click", () => navigate("commute"));
}

function renderQuick() {
  const selected = markerMeta[state.quickType];
  shell(`
    <div class="topbar">
      <div>
        <div class="brand">QUICK CAPTURE</div>
        <h1 class="title">${selected.icon} ${selected.label}</h1>
      </div>
      <button class="ghost" id="inboxBtn">Inbox</button>
    </div>

    <section class="quick-panel">
      <div class="marker-grid compact">
        ${Object.entries(markerMeta).map(([type, meta]) => `
          <button class="marker ${type === state.quickType ? "active" : ""}" data-quick-type="${type}">
            ${meta.icon}<span>${meta.label}</span>
          </button>
        `).join("")}
      </div>

      <label class="position-label" for="positionInput">Audible Position</label>
      <input id="positionInput" class="position-input" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="229" aria-describedby="positionHelp" />
      <div id="positionPreview" class="position-preview">→ 02:29</div>
      <p id="positionHelp" class="subtle center">229 → 02:29 / 1234 → 12:34 / 10532 → 1:05:32</p>

      <button class="primary" id="quickSaveBtn">SAVE & RETURN</button>
      <button class="ghost" id="fullViewBtn">Full Commute View</button>
    </section>
  `);

  const input = document.querySelector<HTMLInputElement>("#positionInput")!;
  const preview = document.querySelector<HTMLDivElement>("#positionPreview")!;
  const save = document.querySelector<HTMLButtonElement>("#quickSaveBtn")!;

  function updatePreview() {
    const value = parsePlayback(input.value);
    preview.textContent = value == null ? "Enter playback time" : `→ ${formatPlayback(value)}`;
    save.disabled = value == null;
  }

  input.addEventListener("input", updatePreview);
  document.querySelectorAll<HTMLButtonElement>("[data-quick-type]").forEach(button => {
    button.addEventListener("click", () => {
      state.quickType = button.dataset.quickType as MarkerType;
      renderQuick();
    });
  });

  save.addEventListener("click", async () => {
    const seconds = parsePlayback(input.value);
    if (seconds == null) return;
    await saveMarker(state.quickType, seconds);
    showToast(`✓ ${markerMeta[state.quickType].label} ${formatPlayback(seconds)}`);
    input.value = "";
    updatePreview();
    setTimeout(() => input.focus(), 100);
  });

  document.querySelector("#fullViewBtn")?.addEventListener("click", () => navigate("commute"));
  document.querySelector("#inboxBtn")?.addEventListener("click", () => navigate("inbox"));
  updatePreview();
  setTimeout(() => input.focus(), 120);
}

function renderCommute() {
  const recentCount = state.markers.filter(m => Date.now() - m.createdAt <= RECENT_WINDOW_MS).length;
  shell(`
    <div class="topbar">
      <div><div class="brand">COMMUTE MODE</div><h1 class="title">Listening</h1></div>
      <button class="ghost" id="inboxBtn">Inbox</button>
    </div>
    <section class="card center">
      <div class="listening-orb"></div>
      <p class="subtle">1タップMarkerか、Quick CaptureでAudibleの再生位置を残します。</p>
      <div class="counter">Recent 5 min: ${recentCount}</div>
      <div class="counter" style="margin-left:6px">Saved: ${state.markers.length}</div>
    </section>
    <button class="primary" id="quickBtn">⚡ QUICK CAPTURE</button>
    <section class="marker-grid">
      ${Object.entries(markerMeta).map(([type, meta]) => `<button class="marker" data-marker="${type}">${meta.icon}<span>${meta.label}</span></button>`).join("")}
    </section>
    <button class="secondary" id="revisitBtn">REVISIT LAST 5 MIN</button>
    <button class="ghost" id="backBtn">Back to Start</button>
  `);
  document.querySelectorAll<HTMLButtonElement>("[data-marker]").forEach(button => {
    button.addEventListener("click", () => void captureMarker(button.dataset.marker as MarkerType));
  });
  document.querySelector("#quickBtn")?.addEventListener("click", () => navigate("quick"));
  document.querySelector("#revisitBtn")?.addEventListener("click", () => navigate("recent"));
  document.querySelector("#inboxBtn")?.addEventListener("click", () => navigate("inbox"));
  document.querySelector("#backBtn")?.addEventListener("click", () => navigate("start"));
}

function markerRows(markers: ListeningMarker[]) {
  if (!markers.length) return `<div class="empty">この範囲にはまだMarkerがありません。</div>`;
  return markers.map(marker => {
    const meta = markerMeta[marker.type];
    return `<button class="marker-row" data-open-marker="${marker.id}"><span class="marker-time">${marker.playbackSeconds != null ? formatPlayback(marker.playbackSeconds) : formatClock(marker.createdAt)}</span><span class="marker-icon">${meta.icon}</span><span class="marker-label">${meta.label}<small style="display:block;color:#8f97a4;margin-top:4px">${formatAge(marker.createdAt)}</small></span></button>`;
  }).join("");
}

function renderRecent() {
  const now = Date.now();
  const recent = state.markers.filter(m => now - m.createdAt <= RECENT_WINDOW_MS);
  const older = state.markers.filter(m => now - m.createdAt > RECENT_WINDOW_MS);
  shell(`
    <div class="topbar"><div><div class="brand">REVISIT</div><h1 class="title">Last 5 Minutes</h1></div><button class="ghost" id="listenBtn">Listening</button></div>
    <section class="card"><div class="brand">TEMPORARY WINDOW</div><p class="subtle">再生位置を入力したMarkerは、Audibleの時間で表示します。</p></section>
    <section class="marker-list">${markerRows(recent)}</section>
    ${older.length ? `<div class="brand" style="margin-top:12px">SAVED EARLIER</div><section class="marker-list">${markerRows(older)}</section>` : ""}
  `);
  document.querySelectorAll<HTMLButtonElement>("[data-open-marker]").forEach(button => {
    button.addEventListener("click", () => { state.selectedMarkerId = button.dataset.openMarker; navigate("learning"); });
  });
  document.querySelector("#listenBtn")?.addEventListener("click", () => navigate("commute"));
}

function renderLearning() {
  const marker = state.markers.find(m => m.id === state.selectedMarkerId);
  if (!marker) { navigate("recent"); return; }
  const meta = markerMeta[marker.type];
  shell(`
    <div class="topbar"><div><div class="brand">LEARNING CARD</div><h1 class="title">${meta.icon} ${meta.label}</h1></div><button class="ghost" id="listenBtn">Listening</button></div>
    <section class="card stack">
      <div class="meta"><div><small>TYPE</small>${meta.label}</div><div><small>AUDIBLE POSITION</small>${formatPlayback(marker.playbackSeconds)}</div></div>
      <div class="card" style="padding:14px"><div class="brand">RELISTEN HINT</div><p class="subtle" style="margin-bottom:0">${marker.playbackSeconds != null ? `まず ${formatPlayback(Math.max(0, marker.playbackSeconds - 20))} 付近から聞き直す` : "再生位置は未入力です"}</p></div>
      <label><div class="subtle" style="margin-bottom:8px">What did you learn?</div><textarea id="note" placeholder="一言だけでもOK。候補を出してから、残すものを自分で選びます。"></textarea></label>
      <button class="primary" id="candidateBtn">FIND KNOWLEDGE CANDIDATES</button>
      <button class="ghost" id="recentBtn">Back to Timeline</button>
    </section>
  `);
  document.querySelector("#candidateBtn")?.addEventListener("click", async () => {
    const note = (document.querySelector<HTMLTextAreaElement>("#note")?.value ?? "").trim();
    state.candidates = await extractKnowledgeCandidates(note, marker.type);
    if (!state.candidates.length) {
      showToast("Add a short note first");
      return;
    }
    navigate("candidate");
  });
  document.querySelector("#listenBtn")?.addEventListener("click", () => navigate("commute"));
  document.querySelector("#recentBtn")?.addEventListener("click", () => navigate("recent"));
}

function renderCandidate() {
  const marker = state.markers.find(m => m.id === state.selectedMarkerId);
  if (!marker) { navigate("recent"); return; }

  const rows = state.candidates.length
    ? state.candidates.map(candidate => {
      const meta = candidateMeta[candidate.type];
      return `<button class="card" style="width:100%;text-align:left" data-candidate-id="${candidate.id}"><div class="brand">${meta.icon} ${meta.label}</div><strong>${candidate.title}</strong><p class="subtle" style="margin-bottom:0">Tap to keep this as knowledge.</p></button>`;
    }).join("")
    : `<div class="empty">候補はありません。Learning Cardへ戻って短いメモを追加してください。</div>`;

  shell(`
    <div class="topbar"><div><div class="brand">KNOWLEDGE CANDIDATES</div><h1 class="title">What should remain?</h1></div><button class="ghost" id="listenBtn">Listening</button></div>
    <section class="card"><p class="subtle" style="margin:0">AIや自動処理は候補を出すだけです。Knowledgeになるのは、あなたが選んだものだけです。</p></section>
    <section class="stack">${rows}</section>
    <button class="ghost" id="learningBtn">Back to Learning Card</button>
  `);

  document.querySelectorAll<HTMLButtonElement>("[data-candidate-id]").forEach(button => {
    button.addEventListener("click", async () => {
      const candidate = state.candidates.find(item => item.id === button.dataset.candidateId);
      if (!candidate) return;
      const draft: KnowledgeDraft = {
        id: uid("draft"),
        markerId: marker.id,
        type: marker.type,
        note: candidate.summary,
        createdAt: new Date().toISOString(),
        status: "inbox",
        candidateType: candidate.type,
      };
      state.drafts.unshift(draft);
      await putRecord(DRAFT_STORE, draft);
      state.candidates = [];
      showToast("✓ Saved to Inbox");
      setTimeout(() => navigate("inbox"), 450);
    });
  });

  document.querySelector("#listenBtn")?.addEventListener("click", () => navigate("commute"));
  document.querySelector("#learningBtn")?.addEventListener("click", () => navigate("learning"));
}

function renderInbox() {
  const rows = state.drafts.length ? state.drafts.map(draft => {
    const meta = markerMeta[draft.type];
    const candidate = draft.candidateType ? candidateMeta[draft.candidateType] : null;
    const marker = state.markers.find(m => m.id === draft.markerId);
    return `<div class="card"><div class="topbar"><strong>${meta.icon} ${meta.label}${candidate ? ` · ${candidate.icon} ${candidate.label}` : ""}</strong><span class="counter">${formatPlayback(marker?.playbackSeconds)}</span></div><p>${draft.note || "<span class='subtle'>No note yet</span>"}</p><div class="subtle">${new Date(draft.createdAt).toLocaleString()}</div></div>`;
  }).join("") : `<div class="empty">まだInboxは空です。</div>`;
  shell(`<div class="topbar"><div><div class="brand">KNOWLEDGE INBOX</div><h1 class="title">Captured</h1></div><button class="ghost" id="listenBtn">Listening</button></div><section class="stack">${rows}</section>`);
  document.querySelector("#listenBtn")?.addEventListener("click", () => navigate("commute"));
}

function render() {
  switch (state.screen) {
    case "start": renderStart(); break;
    case "quick": renderQuick(); break;
    case "commute": renderCommute(); break;
    case "recent": renderRecent(); break;
    case "learning": renderLearning(); break;
    case "candidate": renderCandidate(); break;
    case "inbox": renderInbox(); break;
  }
}

async function bootstrap() {
  try {
    const [markers, drafts] = await Promise.all([
      getAllRecords<ListeningMarker>(MARKER_STORE),
      getAllRecords<KnowledgeDraft>(DRAFT_STORE),
    ]);
    state.markers = markers.sort((a, b) => b.createdAt - a.createdAt);
    state.drafts = drafts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (error) {
    console.warn("IndexedDB unavailable; continuing in memory.", error);
  }
  render();
}

void bootstrap();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}