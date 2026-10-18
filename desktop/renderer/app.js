// Ambrosia desktop renderer. Talks to the main process only through
// window.ambrosia (see preload.cjs). All model text is escaped before display.

const api = window.ambrosia;
const $ = (id) => document.getElementById(id);

const MONSTERS = { Harpy: "🦅", Minotaur: "🐂", Chimera: "🦁", Hydra: "🐉" };
const TOOL_ICONS = { read_file: "📜", write_file: "🔨", edit_file: "🔧", glob: "🧭", grep: "🔍", shell: "🔥", run_tests: "⚔" };
const ROLES = {
  hephaestus: "Smith · does the work",
  athena: "Strategist · plans the council",
  momus: "Critic · reviews and roasts",
  hermes: "Messenger · narrates",
};
const VERBS = { shell: "run a command", run_tests: "run the tests", write_file: "write a file", edit_file: "edit a file" };

let state = null; // snapshot from the main process
let busy = false;
let live = null; // { god, el, body, text, thinking }
const tools = new Map(); // tool_use id -> row element
let tick = 0;

// ---------- helpers ----------

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** A small, safe Markdown subset: code blocks, inline code, bold, italics, headings, lists. */
function markdown(src) {
  const blocks = [];
  let text = escapeHtml(src.trim()).replace(/```[\w-]*\n?([\s\S]*?)```/g, (_, code) => {
    blocks.push(`<pre><code>${code.replace(/\n$/, "")}</code></pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  const inline = (s) =>
    s
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  const out = [];
  for (const para of text.split(/\n{2,}/)) {
    const lines = para.split("\n");
    if (/^\u0000\d+\u0000$/.test(para.trim())) {
      out.push(para.trim());
    } else if (lines.every((l) => /^\s*[-*] /.test(l))) {
      out.push(`<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*] /, ""))}</li>`).join("")}</ul>`);
    } else if (lines.every((l) => /^\s*\d+[.)] /.test(l))) {
      out.push(`<ol>${lines.map((l) => `<li>${inline(l.replace(/^\s*\d+[.)] /, ""))}</li>`).join("")}</ol>`);
    } else if (/^#{1,3} /.test(para)) {
      out.push(`<h3>${inline(para.replace(/^#{1,3} /, ""))}</h3>`);
    } else {
      out.push(`<p>${inline(para).replace(/\n/g, "<br>")}</p>`);
    }
  }
  return out.join("").replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[Number(i)]);
}

function persona(god) {
  return state.personas[god];
}

function scrollDown() {
  const t = $("transcript");
  const nearBottom = t.scrollHeight - t.scrollTop - t.clientHeight < 200;
  if (nearBottom) requestAnimationFrame(() => (t.scrollTop = t.scrollHeight));
}

function append(node) {
  $("transcript").appendChild(node);
  scrollDown();
  return node;
}

function entry(cls, text) {
  return append(el("div", `entry ${cls}`, text));
}

function toast(html) {
  const t = el("div", "toast");
  t.innerHTML = html;
  $("toasts").appendChild(t);
  setTimeout(() => t.remove(), 4600);
}

// ---------- god messages ----------

function godCard(god) {
  const p = persona(god);
  const card = el("div", "entry god");
  card.style.setProperty("--god-color", p.color);
  card.appendChild(el("div", "avatar", p.glyph));
  const body = el("div", "god-body");
  body.appendChild(el("div", "god-name", p.title));
  const md = el("div", "md");
  body.appendChild(md);
  card.appendChild(body);
  return { card, md };
}

function startLive(god) {
  live = { god, card: null, md: null, text: "", thinking: "" };
}

/** Freeze the streamed text into a permanent card (before tools, prompts, or the turn's end). */
function flushLive() {
  if (live) {
    live.card = null;
    live.md = null;
    live.text = "";
  }
}

function renderLive() {
  if (!live || !live.text.trim()) return;
  if (!live.card) {
    const { card, md } = godCard(live.god);
    live.card = card;
    live.md = md;
    append(card);
  }
  live.md.innerHTML = markdown(live.text);
  scrollDown();
}

// ---------- working indicator ----------

function setWorking(god) {
  const w = $("working");
  if (!god) {
    w.hidden = true;
    document.querySelectorAll(".pantheon li").forEach((li) => li.classList.remove("active"));
    return;
  }
  const p = persona(god);
  w.hidden = false;
  const line = p.workingLines[Math.floor(tick / 25) % p.workingLines.length];
  $("working-text").textContent = `${p.glyph} ${p.title} is ${line}…`;
  $("working-thought").textContent = live?.thinking ? `⌁ ${live.thinking.replace(/\s+/g, " ").trim().slice(-140)}` : "";
  document.querySelectorAll(".pantheon li").forEach((li) => li.classList.toggle("active", li.dataset.god === god));
}

// ---------- profile, arena, labours ----------

function rankInfo(xp) {
  let rank = state.ranks[0];
  for (const r of state.ranks) if (xp >= r.min) rank = r;
  const next = state.ranks[state.ranks.indexOf(rank) + 1] ?? null;
  const fraction = next ? (xp - rank.min) / (next.min - rank.min) : 1;
  return { rank, next, fraction };
}

function renderProfile() {
  const { rank, next, fraction } = rankInfo(state.xp);
  $("rank-glyph").textContent = rank.glyph;
  $("rank-name").textContent = rank.name;
  $("xp-fill").style.width = `${Math.round(fraction * 100)}%`;
  $("xp-label").textContent = next ? `${state.xp} / ${next.min} ambrosia to ${next.name}` : `${state.xp} ambrosia · the summit`;
  $("rank").style.visibility = state.serious ? "hidden" : "visible";

  const s = state.stats;
  const rows = [
    ["Ambrosia", state.xp],
    ["Tests fixed", s.testsFixed],
    ["Monsters slain", s.bossesDefeated],
    ["Tasks completed", s.tasks],
    ["Momus approvals", s.reviewsPassed],
    ["Sessions", s.sessions],
  ];
  const dl = $("stats");
  dl.replaceChildren();
  for (const [k, v] of rows) {
    dl.appendChild(el("dt", "", k));
    dl.appendChild(el("dd", "", String(v)));
  }
}

function renderLabours(freshId) {
  const grid = $("labours");
  grid.replaceChildren();
  for (const l of state.labours) {
    const tile = el("div", `labour${l.earned ? " earned" : ""}${l.id === freshId ? " fresh" : ""}`);
    tile.title = `${l.description} (+${l.reward} ambrosia)`;
    tile.appendChild(el("div", "name", `${l.earned ? "🏆" : "·"} ${l.title}`));
    tile.appendChild(el("div", "", l.description));
    grid.appendChild(tile);
  }
  $("labour-count").textContent = `${state.labours.filter((l) => l.earned).length}/${state.labours.length}`;
}

function renderPantheon() {
  const ul = $("pantheon");
  ul.replaceChildren();
  for (const god of ["hephaestus", "athena", "momus", "hermes"]) {
    const p = persona(god);
    const li = el("li");
    li.dataset.god = god;
    li.style.setProperty("--god-color", p.color);
    li.appendChild(el("div", "avatar", p.glyph));
    const text = el("div");
    text.appendChild(el("div", "god-name", p.title));
    text.appendChild(el("div", "role", ROLES[god]));
    li.appendChild(text);
    ul.appendChild(li);
  }
}

function renderBoss(boss, change) {
  const sprite = $("boss-sprite");
  if (!boss || change === "defeated") {
    if (change === "defeated" && !$("arena-boss").hidden) {
      sprite.className = "boss-sprite dying";
      const banner = $("arena-banner");
      banner.textContent = `${boss?.name ?? "Monster"} slain!`;
      banner.hidden = false;
      setTimeout(() => {
        banner.hidden = true;
        $("arena-boss").hidden = true;
        $("arena-idle").hidden = false;
        sprite.className = "boss-sprite";
      }, 2200);
    } else {
      $("arena-boss").hidden = true;
      $("arena-idle").hidden = false;
    }
    return;
  }
  $("arena-idle").hidden = true;
  $("arena-boss").hidden = false;
  sprite.textContent = MONSTERS[boss.name] ?? "👹";
  $("boss-name").textContent = boss.name;
  $("hp-fill").style.width = `${Math.max(4, (boss.hp / boss.maxHp) * 100)}%`;
  $("boss-hp").textContent = `${boss.hp} / ${boss.maxHp} failing test${boss.maxHp === 1 ? "" : "s"}`;
  if (change === "hit" || change === "grow") {
    sprite.className = "boss-sprite";
    void sprite.offsetWidth; // restart the animation
    sprite.className = `boss-sprite ${change}`;
  }
}

function renderToggles() {
  $("toggle-sound").textContent = state.sound ? "🔉" : "🔇";
  $("toggle-sound").classList.toggle("off", !state.sound);
  $("toggle-tts").classList.toggle("off", !state.tts);
  $("toggle-serious").classList.toggle("off", state.serious);
  $("toggle-serious").title = state.serious ? "Serious mode is on: click to bring back the fun" : "Serious mode (/serious)";
  $("project-path").textContent = state.root;
  $("project").title = `${state.root}\nClick to choose another project`;
  $("demo-badge").hidden = !state.demo;
}

function renderAll() {
  renderProfile();
  renderLabours();
  renderPantheon();
  renderToggles();
  renderBoss(state.boss, "none");
}

// ---------- events from the gods ----------

const handlers = {
  turn_start({ god }) {
    startLive(god);
    setWorking(god);
  },
  text({ delta }) {
    if (!live) return;
    live.text += delta;
    renderLive();
  },
  thinking({ delta }) {
    if (!live) return;
    live.thinking = (live.thinking + delta).slice(-400);
  },
  tool_start({ id, name, summary }) {
    flushLive();
    const row = el("div", "entry tool running");
    row.appendChild(el("span", "status", "⋯"));
    row.appendChild(el("span", "", TOOL_ICONS[name] ?? "•"));
    row.appendChild(el("span", "tool-name", name));
    row.appendChild(el("span", "tool-summary", summary));
    tools.set(id, append(row));
  },
  tool_end({ id, ok, summary }) {
    const row = tools.get(id);
    tools.delete(id);
    if (!row) return;
    row.classList.remove("running");
    row.classList.add(ok ? "ok" : "failed");
    row.querySelector(".status").textContent = ok ? "✓" : "✗";
    if (!ok && summary) row.after(el("div", "tool-error", summary));
  },
  turn_end() {
    flushLive();
    live = null;
    setWorking(null);
  },
  notice({ text }) {
    entry(text.includes("\n") ? "notice block" : "notice", text);
  },
  error({ message }) {
    entry("error", `⚡ ${message}`);
  },
  narration({ text }) {
    entry("narration", `🪽 Hermes: ${text}`);
  },
  xp({ amount, reason, total }) {
    state.xp = total;
    renderProfile();
    const line = el("div", `entry xp-line${amount < 0 ? " negative" : ""}`, `⚱ ${amount > 0 ? "+" : ""}${amount} ambrosia `);
    line.appendChild(el("span", "reason", `· ${reason}`));
    append(line);
    const t = el("div", `xp-toast${amount < 0 ? " negative" : ""}`, `${amount > 0 ? "+" : ""}${amount} ⚱`);
    $("xp-toasts").appendChild(t);
    setTimeout(() => t.remove(), 1900);
  },
  labour(labour) {
    const l = state.labours.find((x) => x.id === labour.id);
    if (l) l.earned = true;
    renderLabours(labour.id);
    const card = el("div", "entry labour-card");
    card.appendChild(el("div", "title", `🏆 Labour complete: ${labour.title}`));
    card.appendChild(el("div", "", `${labour.description} · +${labour.reward} ambrosia`));
    append(card);
    toast(`🏆 <strong>${escapeHtml(labour.title)}</strong><br><span class="muted">${escapeHtml(labour.description)}</span>`);
  },
  rank_up({ rank }) {
    $("ascension-rank").textContent = `You are now a ${rank}`;
    $("ascension").hidden = false;
    setTimeout(() => ($("ascension").hidden = true), 3200);
  },
  boss({ boss, change }) {
    if (state.serious) return;
    state.boss = change === "defeated" ? null : boss;
    renderBoss(boss, change);
    if (!boss || change === "none") return;
    const text = {
      spawn: `${MONSTERS[boss.name] ?? "👹"} A ${boss.name} appears! ${boss.hp} failing test${boss.hp > 1 ? "s" : ""}.`,
      grow: `🐍 It grows new heads! The ${boss.name} now has ${boss.hp}.`,
      hit: `⚔ Hit! The ${boss.name} is down to ${boss.hp}.`,
      defeated: `🏛 The ${boss.name} is slain! All tests pass.`,
    }[change];
    if (text) entry(`boss-line${change === "defeated" ? " win" : ""}`, text);
  },
};

// ---------- the Oracle ----------

const oracleQueue = [];

function showOracle() {
  const next = oracleQueue[0];
  if (!next) {
    $("oracle").hidden = true;
    return;
  }
  const { req } = next;
  const p = persona(req.god);
  $("oracle-title").textContent = `The Oracle asks: may ${p.title} ${VERBS[req.tool] ?? req.tool}?`;
  $("oracle-detail").textContent = req.detail;
  $("oracle-risk").hidden = !req.risky;
  $("oracle-tool").textContent = req.tool;
  document.querySelector(".oracle-card").classList.toggle("risky", req.risky);
  $("oracle").hidden = false;
  $("oracle-yes").focus();
}

function answerOracle(answer) {
  const next = oracleQueue.shift();
  if (!next) return;
  api.approve(next.id, answer);
  // A plain "yes" shows as the tool running; only the memorable answers get a line.
  if (answer === "always") entry("notice", `🔮 The Oracle allows ${next.req.tool} for the rest of this session.`);
  if (answer === "no") entry("notice", `🔮 The Oracle forbids it: ${next.req.summary}`);
  showOracle();
}

// ---------- input ----------

function setBusy(b) {
  busy = b;
  $("prompt").disabled = b;
  $("send").disabled = b;
  document.querySelectorAll(".chip").forEach((c) => (c.disabled = b));
  if (!b) $("prompt").focus();
}

async function submit(line) {
  const text = line.trim();
  if (!text || busy) return;
  $("prompt").value = "";
  autosize();
  const user = el("div", "entry user");
  user.appendChild(el("div", "bubble", text));
  append(user);
  document.querySelector(".welcome")?.remove();
  setBusy(true);
  try {
    state = await api.submit(text);
    renderToggles();
    renderProfile();
  } catch (err) {
    entry("error", `⚡ ${err?.message ?? err}`);
  } finally {
    setBusy(false);
    setWorking(null);
  }
}

function autosize() {
  const t = $("prompt");
  t.style.height = "auto";
  t.style.height = `${Math.min(t.scrollHeight, 180)}px`;
}

function wireInput() {
  $("composer").addEventListener("submit", (e) => {
    e.preventDefault();
    void submit($("prompt").value);
  });
  $("prompt").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit($("prompt").value);
    }
  });
  $("prompt").addEventListener("input", autosize);
  document.querySelectorAll(".chip").forEach((chip) =>
    chip.addEventListener("click", () => {
      if (chip.dataset.run) void submit(chip.dataset.run);
      else {
        $("prompt").value = chip.dataset.insert;
        $("prompt").focus();
      }
    }),
  );
  $("stop").addEventListener("click", () => api.interrupt());
  $("toggle-sound").addEventListener("click", () => void submit("/mute"));
  $("toggle-tts").addEventListener("click", () => void submit("/tts"));
  $("toggle-serious").addEventListener("click", () => void submit("/serious"));
  $("project").addEventListener("click", async () => {
    if (busy) return;
    const snap = await api.pickFolder();
    if (!snap) return;
    state = snap;
    renderAll();
    entry("notice", `📁 Now working in ${state.root}`);
  });
  $("oracle-yes").addEventListener("click", () => answerOracle("yes"));
  $("oracle-always").addEventListener("click", () => answerOracle("always"));
  $("oracle-no").addEventListener("click", () => answerOracle("no"));
  $("ascension").addEventListener("click", () => ($("ascension").hidden = true));

  document.addEventListener("keydown", (e) => {
    if (!$("oracle").hidden) {
      const k = e.key.toLowerCase();
      if (k === "y") answerOracle("yes");
      else if (k === "a") answerOracle("always");
      else if (k === "n" || k === "escape") answerOracle("no");
      return;
    }
    if (e.key === "Escape" && busy) api.interrupt();
  });
}

// ---------- start ----------

async function main() {
  state = await api.init();
  renderAll();
  wireInput();
  api.onEvent((name, payload) => handlers[name]?.(payload));
  api.onApproval((id, req) => {
    flushLive();
    oracleQueue.push({ id, req });
    if (oracleQueue.length === 1) showOracle();
  });
  setInterval(() => {
    tick++;
    if (live) setWorking(live.god);
  }, 80);
  $("prompt").focus();
}

void main();
