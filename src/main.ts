type MarkerType = "unclear" | "interesting" | "important" | "language" | "connection";
type Screen = "start" | "commute" | "recent" | "learning" | "inbox";

interface ListeningMarker {
  id: string;
  type: MarkerType;
  createdAt: number;
}

interface KnowledgeDraft {
  id: string;
  markerId: string;
  type: MarkerType;
  note: string;
  createdAt: string;
  status: "inbox";
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

const state: {
  screen: Screen;
  markers: ListeningMarker[];
  drafts: KnowledgeDraft[];
  selectedMarkerId?: string;
} = {
  screen: "start",
  markers: [],
  drafts: [],
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

function formatTime(ms: number) {
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatAge(ms: number) {
  const diff = Math.max(0, Date.now() - ms);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ago`;
}

function shell(content: string) {
  app.innerHTML = `<div class="shell">${content}</div><div id="toast" class="toast">✓ Marked</div>`;
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
  setTimeout(() => toast.classList.remove("show"), 850);
}

async function captureMarker(type: MarkerType) {
  const marker: ListeningMarker = {
    id: uid("marker"),
    type,
    createdAt: Date.now(),
  };

  state.markers.unshift(marker);
  await putRecord(MARKER_STORE, marker);
  renderCommute();
  requestAnimationFrame(() => showToast(`✓ ${markerMeta[type].label} saved`));
}

function renderStart() {
  shell(`
    <div>
      <div class="brand">LISTENING KNOWLEDGE OS</div>
      <h1 class="title">Turn listening into knowledge.</h1>
      <p class="subtle">通勤中は聴くことを優先。気になった瞬間だけ1タップで残します。</p>
    </div>

    <section class="card stack">
      <button class="primary" id="audibleBtn">🎧 Audible / Other App</button>
      <button class="secondary" disabled>🎤 Microphone — later</button>
      <button class="secondary" disabled>📁 Audio File — later</button>
      <button class="secondary" disabled>📋 Paste Text — later</button>
    </section>
  `);

  document.querySelector("#audibleBtn")?.addEventListener("click", () => navigate("commute"));
}

function renderCommute() {
  const recentCount = state.markers.filter(m => Date.now() - m.createdAt <= RECENT_WINDOW_MS).length;

  shell(`
    <div class="topbar">
      <div>
        <div class="brand">COMMUTE MODE</div>
        <h1 class="title">Listening</h1>
      </div>
      <button class="ghost" id="inboxBtn">Inbox</button>
    </div>

    <section class="card center">
      <div class="listening-orb"></div>
      <p class="subtle">Audibleを聴き続けてください。画面を見る必要はありません。</p>
      <div class="counter">Recent 5 min: ${recentCount}</div>
      <div class="counter" style="margin-left:6px">Saved: ${state.markers.length}</div>
    </section>

    <section class="marker-grid">
      ${Object.entries(markerMeta).map(([type, meta]) => `
        <button class="marker" data-marker="${type}">
          ${meta.icon}<span>${meta.label}</span>
        </button>
      `).join("")}
    </section>

    <button class="primary" id="revisitBtn">REVISIT LAST 5 MIN</button>
    <button class="ghost" id="backBtn">Back to Start</button>
  `);

  document.querySelectorAll<HTMLButtonElement>("[data-marker]").forEach(button => {
    button.addEventListener("click", () => void captureMarker(button.dataset.marker as MarkerType));
  });

  document.querySelector("#revisitBtn")?.addEventListener("click", () => navigate("recent"));
  document.querySelector("#inboxBtn")?.addEventListener("click", () => navigate("inbox"));
  document.querySelector("#backBtn")?.addEventListener("click", () => navigate("start"));
}

function markerRows(markers: ListeningMarker[]) {
  if (!markers.length) return `<div class="empty">この範囲にはまだMarkerがありません。</div>`;

  return markers.map(marker => {
    const meta = markerMeta[marker.type];
    return `
      <button class="marker-row" data-open-marker="${marker.id}">
        <span class="marker-time">${formatTime(marker.createdAt)}</span>
        <span class="marker-icon">${meta.icon}</span>
        <span class="marker-label">${meta.label}<small style="display:block;color:#8f97a4;margin-top:4px">${formatAge(marker.createdAt)}</small></span>
      </button>
    `;
  }).join("");
}

function renderRecent() {
  const now = Date.now();
  const recent = state.markers.filter(m => now - m.createdAt <= RECENT_WINDOW_MS);
  const older = state.markers.filter(m => now - m.createdAt > RECENT_WINDOW_MS);

  shell(`
    <div class="topbar">
      <div>
        <div class="brand">REVISIT</div>
        <h1 class="title">Last 5 Minutes</h1>
      </div>
      <button class="ghost" id="listenBtn">Listening</button>
    </div>

    <section class="card">
      <div class="brand">TEMPORARY WINDOW</div>
      <p class="subtle">将来ここに直近5分のTranscriptが並びます。今はMarker位置を5分Timelineとして保存しています。</p>
    </section>

    <section class="marker-list">${markerRows(recent)}</section>

    ${older.length ? `
      <div class="brand" style="margin-top:12px">SAVED EARLIER</div>
      <section class="marker-list">${markerRows(older)}</section>
    ` : ""}
  `);

  document.querySelectorAll<HTMLButtonElement>("[data-open-marker]").forEach(button => {
    button.addEventListener("click", () => {
      state.selectedMarkerId = button.dataset.openMarker;
      navigate("learning");
    });
  });

  document.querySelector("#listenBtn")?.addEventListener("click", () => navigate("commute"));
}

function renderLearning() {
  const marker = state.markers.find(m => m.id === state.selectedMarkerId);
  if (!marker) {
    navigate("recent");
    return;
  }

  const meta = markerMeta[marker.type];

  shell(`
    <div class="topbar">
      <div>
        <div class="brand">LEARNING CARD</div>
        <h1 class="title">${meta.icon} ${meta.label}</h1>
      </div>
      <button class="ghost" id="listenBtn">Listening</button>
    </div>

    <section class="card stack">
      <div class="meta">
        <div><small>TYPE</small>${meta.label}</div>
        <div><small>WHEN</small>${formatAge(marker.createdAt)}</div>
      </div>

      <div class="card" style="padding:14px">
        <div class="brand">CONTEXT</div>
        <p class="subtle" style="margin-bottom:0">Transcript Providerを追加すると、このMarkerを中心に前後の英文を表示します。</p>
      </div>

      <label>
        <div class="subtle" style="margin-bottom:8px">My Note</div>
        <textarea id="note" placeholder="一言だけでもOK。あとでKnowledgeへ育てます。"></textarea>
      </label>

      <button class="primary" id="saveBtn">SAVE TO INBOX</button>
      <button class="ghost" id="recentBtn">Back to 5-min Timeline</button>
    </section>
  `);

  document.querySelector("#saveBtn")?.addEventListener("click", async () => {
    const note = (document.querySelector<HTMLTextAreaElement>("#note")?.value ?? "").trim();
    const draft: KnowledgeDraft = {
      id: uid("draft"),
      markerId: marker.id,
      type: marker.type,
      note,
      createdAt: new Date().toISOString(),
      status: "inbox",
    };

    state.drafts.unshift(draft);
    await putRecord(DRAFT_STORE, draft);
    showToast("✓ Saved to Inbox");
    setTimeout(() => navigate("commute"), 450);
  });

  document.querySelector("#listenBtn")?.addEventListener("click", () => navigate("commute"));
  document.querySelector("#recentBtn")?.addEventListener("click", () => navigate("recent"));
}

function renderInbox() {
  const rows = state.drafts.length
    ? state.drafts.map(draft => {
        const meta = markerMeta[draft.type];
        return `
          <div class="card">
            <div class="topbar">
              <strong>${meta.icon} ${meta.label}</strong>
              <span class="counter">INBOX</span>
            </div>
            <p>${draft.note || "<span class='subtle'>No note yet</span>"}</p>
            <div class="subtle">${new Date(draft.createdAt).toLocaleString()}</div>
          </div>
        `;
      }).join("")
    : `<div class="empty">まだInboxは空です。</div>`;

  shell(`
    <div class="topbar">
      <div>
        <div class="brand">KNOWLEDGE INBOX</div>
        <h1 class="title">Captured</h1>
      </div>
      <button class="ghost" id="listenBtn">Listening</button>
    </div>
    <section class="stack">${rows}</section>
  `);

  document.querySelector("#listenBtn")?.addEventListener("click", () => navigate("commute"));
}

function render() {
  switch (state.screen) {
    case "start": renderStart(); break;
    case "commute": renderCommute(); break;
    case "recent": renderRecent(); break;
    case "learning": renderLearning(); break;
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
