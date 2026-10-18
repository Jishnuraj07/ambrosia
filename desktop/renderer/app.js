// Ambrosia desktop renderer. Talks to the main process only through
// window.ambrosia (see preload.cjs). All model text is escaped before display.

const api = window.ambrosia;
const $ = (id) => document.getElementById(id);
const RING = 2 * Math.PI * 84; // circumference of the arena ring

// [while running, when done]
const TOOL_LABELS = {
  read_file: ["Reading", "Read"],
  write_file: ["Writing", "Wrote"],
  edit_file: ["Editing", "Edited"],
  glob: ["Finding files", "Found files"],
  grep: ["Searching code", "Searched code"],
  shell: ["Running", "Ran"],
  run_tests: ["Running tests", "Ran tests"],
};
const TOOL_NAMES = { read_file: "reading", write_file: "writing files", edit_file: "editing", glob: "finding files", grep: "searching", shell: "commands", run_tests: "running tests" };
const VERBS = { shell: "run a command", run_tests: "run the tests", write_file: "write a file", edit_file: "edit a file" };

let state = null; // snapshot from the main process
let busy = false;
let live = null; // the god currently speaking: { god, md, text, thinking }
const steps = new Map(); // tool_use id -> row
let tick = 0;

// ---------- helpers ----------

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "ic");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.appendChild(use);
  return svg;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** A small, safe Markdown subset: code blocks, inline code, bold, italics, headings, lists. */
function markdown(src) {
  const blocks = [];
  const text = escapeHtml(src.trim()).replace(/```[\w-]*\n?([\s\S]*?)```/g, (_, code) => {
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
    if (/^\u0000\d+\u0000$/.test(para.trim())) out.push(para.trim());
    else if (lines.every((l) => /^\s*[-*] /.test(l))) out.push(`<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*] /, ""))}</li>`).join("")}</ul>`);
    else if (lines.every((l) => /^\s*\d+[.)] /.test(l))) out.push(`<ol>${lines.map((l) => `<li>${inline(l.replace(/^\s*\d+[.)] /, ""))}</li>`).join("")}</ol>`);
    else if (/^#{1,3} /.test(para)) out.push(`<h3>${inline(para.replace(/^#{1,3} /, ""))}</h3>`);
    else out.push(`<p>${inline(para).replace(/\n/g, "<br>")}</p>`);
  }
  return out.join("").replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[Number(i)]);
}

const persona = (god) => state.personas[god];

function scrollDown(force = false) {
  const t = $("transcript");
  if (force || t.scrollHeight - t.scrollTop - t.clientHeight < 240) {
    requestAnimationFrame(() => (t.scrollTop = t.scrollHeight));
  }
}

function append(node) {
  document.querySelector(".empty")?.remove();
  $("transcript").appendChild(node);
  scrollDown();
  return node;
}

function line(cls, text) {
  return append(el("div", cls, text));
}

// ---------- the gods speaking ----------

function startLive(god) {
  live = { god, md: null, text: "", thinking: "" };
}

/** Freeze what was streamed so far; the next words start a new message. */
function flushLive() {
  if (live) {
    live.md = null;
    live.text = "";
  }
}

function renderLive() {
  if (!live || !live.text.trim()) return;
  if (!live.md) {
    const p = persona(live.god);
    const msg = el("div", "msg");
    msg.style.setProperty("--god", p.color);
    const who = el("div", "who");
    who.appendChild(el("span", "dot"));
    who.appendChild(el("span", "", p.title));
    msg.appendChild(who);
    live.md = el("div", "md");
    msg.appendChild(live.md);
    append(msg);
  }
  // Momus ends with a protocol line for the harness; show it as a tag instead.
  const verdict = live.text.match(/VERDICT:\s*(APPROVED|REVISE)/i);
  live.md.innerHTML = markdown(live.text.replace(/\n?\s*VERDICT:\s*(APPROVED|REVISE)\s*$/i, ""));
  if (verdict) {
    const approved = verdict[1].toUpperCase() === "APPROVED";
    live.md.appendChild(el("span", `verdict ${approved ? "approved" : "revise"}`, approved ? "Approved" : "Wants changes"));
  }
  scrollDown();
}

function setWorking(god) {
  const w = $("working");
  if (!god) {
    w.hidden = true;
    return;
  }
  const p = persona(god);
  w.hidden = false;
  w.style.setProperty("--god", p.color);
  const flavour = p.workingLines[Math.floor(tick / 30) % p.workingLines.length];
  $("working-text").textContent = `${p.title} is ${flavour}`;
  const thought = live?.thinking?.replace(/\s+/g, " ").trim();
  $("working-thought").textContent = thought ? thought.slice(-140) : "";
}

// ---------- rank, arena, labours, record ----------

function rankInfo(xp) {
  let rank = state.ranks[0];
  for (const r of state.ranks) if (xp >= r.min) rank = r;
  const next = state.ranks[state.ranks.indexOf(rank) + 1] ?? null;
  return { rank, next, fraction: next ? (xp - rank.min) / (next.min - rank.min) : 1 };
}

function renderRank() {
  const { rank, next, fraction } = rankInfo(state.xp);
  $("rank-name").textContent = rank.name;
  $("xp-fill").style.width = `${Math.round(fraction * 100)}%`;
  $("xp-label").textContent = String(state.xp);
  $("rank").title = next ? `${state.xp} ambrosia. ${next.min - state.xp} more to reach ${next.name}.` : `${state.xp} ambrosia. The highest rank.`;
  $("rank").hidden = state.serious;
}

function floatXp(amount) {
  const f = $("xp-float");
  f.textContent = `${amount > 0 ? "+" : "−"}${Math.abs(amount)}`;
  f.className = `xp-float${amount < 0 ? " loss" : ""}`;
  void f.offsetWidth;
  f.classList.add("show");
}

function renderStats() {
  const s = state.stats;
  const rows = [
    ["Tests fixed", s.testsFixed],
    ["Monsters slain", s.bossesDefeated],
    ["Tasks done", s.tasks],
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
  const ul = $("labours");
  ul.replaceChildren();
  for (const l of state.labours) {
    const li = el("li", `${l.earned ? "earned" : ""}${l.id === freshId ? " fresh" : ""}`);
    li.title = `${l.description}. Worth ${l.reward} ambrosia.`;
    li.appendChild(el("span", "pip"));
    li.appendChild(el("span", "", l.title));
    ul.appendChild(li);
  }
  $("labour-count").textContent = `${state.labours.filter((l) => l.earned).length} of ${state.labours.length}`;
}

function setRing(fraction) {
  $("ring-hp").style.strokeDashoffset = String(RING * (1 - Math.max(0, Math.min(1, fraction))));
}

function pulseArena(cls) {
  const a = $("arena");
  a.classList.remove("hit", "grow", "won");
  void a.offsetWidth;
  a.classList.add(cls);
}

function renderArena(boss, change) {
  const a = $("arena");
  if (change === "defeated") {
    a.classList.remove("fighting");
    setRing(1);
    $("foe-name").textContent = `${boss?.name ?? "Monster"} slain`;
    $("foe-hp").textContent = "All tests pass";
    pulseArena("won");
    setTimeout(() => {
      if (state.boss) return; // a new fight began meanwhile
      a.classList.remove("won");
      $("foe-name").textContent = "All clear";
      $("foe-hp").textContent = "No failing tests";
    }, 3000);
    return;
  }
  if (!boss) {
    a.classList.remove("fighting");
    setRing(1);
    $("foe-name").textContent = "All clear";
    $("foe-hp").textContent = "No failing tests";
    return;
  }
  a.classList.add("fighting");
  setRing(boss.hp / boss.maxHp);
  $("foe-name").textContent = boss.name;
  $("foe-hp").textContent = `${boss.hp} of ${boss.maxHp} test${boss.maxHp === 1 ? "" : "s"} failing`;
  if (change === "hit" || change === "grow") pulseArena(change);
}

function renderTools() {
  const sound = $("toggle-sound");
  sound.querySelector("use").setAttribute("href", state.sound ? "#i-sound" : "#i-sound-off");
  sound.title = state.sound ? "Sound on" : "Sound off";
  $("toggle-tts").classList.toggle("on", state.tts);
  $("toggle-tts").title = state.tts ? "Hermes reads his lines aloud (on)" : "Hermes reads his lines aloud (off)";
  $("toggle-serious").classList.toggle("on", state.serious);
  $("toggle-serious").title = state.serious ? "Serious mode is on" : "Serious mode: no game, no narration";
  $("project-path").textContent = state.root;
  $("project").title = `${state.root}\nChoose another project folder`;
  $("demo-badge").hidden = !state.demo;
  document.querySelector(".rail").hidden = state.serious;
}

function renderAll() {
  renderRank();
  renderLabours();
  renderStats();
  renderTools();
  renderArena(state.boss, "none");
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
    if (live) live.thinking = (live.thinking + delta).slice(-400);
  },
  tool_start({ id, name, summary }) {
    flushLive();
    const row = el("div", "step running");
    row.appendChild(el("span", "state"));
    row.dataset.tool = name;
    row.appendChild(el("span", "step-name", TOOL_LABELS[name]?.[0] ?? name));
    row.appendChild(el("span", "step-arg", summary));
    steps.set(id, append(row));
  },
  tool_end({ id, ok, summary }) {
    const row = steps.get(id);
    steps.delete(id);
    if (!row) return;
    row.className = `step ${ok ? "ok" : "failed"}`;
    row.querySelector(".step-name").textContent = TOOL_LABELS[row.dataset.tool]?.[1] ?? row.dataset.tool;
    row.querySelector(".state").appendChild(icon(ok ? "check" : "cross"));
    if (!ok && summary) row.after(el("div", "step-error", summary));
  },
  turn_end() {
    flushLive();
    live = null;
    setWorking(null);
  },
  notice({ text }) {
    line(text.includes("\n") ? "note block" : "note", text);
  },
  error({ message }) {
    line("fail", message);
  },
  narration({ text }) {
    const n = el("div", "hermes");
    n.appendChild(el("b", "", "Hermes "));
    n.appendChild(document.createTextNode(text));
    append(n);
  },
  xp({ amount, reason, total }) {
    state.xp = total;
    renderRank();
    floatXp(amount);
    if (amount < 0) line("event foe", `A test you fixed broke again. ${amount} ambrosia.`);
  },
  labour(labour) {
    const l = state.labours.find((x) => x.id === labour.id);
    if (l) l.earned = true;
    renderLabours(labour.id);
    const row = el("div", "labour-line");
    row.appendChild(icon("drop"));
    const text = el("div");
    text.appendChild(el("strong", "", labour.title));
    text.appendChild(el("span", "labour-desc", labour.description));
    row.appendChild(text);
    row.appendChild(el("span", "gain", `+${labour.reward}`));
    append(row);
  },
  rank_up({ rank }) {
    $("ascension-rank").textContent = rank;
    $("ascension").hidden = false;
    setTimeout(() => ($("ascension").hidden = true), 3200);
  },
  boss({ boss, change }) {
    if (state.serious || !boss || change === "none") return;
    state.boss = change === "defeated" ? null : boss;
    renderArena(boss, change);
    const n = boss.hp;
    const text = {
      spawn: `A ${boss.name} appears with ${n} failing test${n === 1 ? "" : "s"}.`,
      grow: `The ${boss.name} grows new heads. ${n} tests failing now.`,
      hit: `The ${boss.name} takes a hit. ${n} left.`,
      defeated: `The ${boss.name} is slain. All tests pass.`,
    }[change];
    line(`event ${change === "defeated" ? "won" : "foe"}`, text);
  },
};

// ---------- the Oracle ----------

const oracleQueue = [];

function showOracle() {
  const next = oracleQueue[0];
  if (!next) {
    $("oracle").hidden = true;
    $("prompt").focus();
    return;
  }
  const { req } = next;
  $("oracle-title").textContent = `Allow ${persona(req.god).title} to ${VERBS[req.tool] ?? req.tool}?`;
  $("oracle-detail").textContent = req.detail;
  $("oracle-risk").hidden = !req.risky;
  $("oracle-tool").textContent = TOOL_NAMES[req.tool] ?? req.tool;
  document.querySelector(".oracle").classList.toggle("risky", req.risky);
  $("oracle").hidden = false;
  $("oracle-yes").focus();
}

function answerOracle(answer) {
  const next = oracleQueue.shift();
  if (!next) return;
  api.approve(next.id, answer);
  if (answer === "always") line("note", `${persona(next.req.god).title} may keep ${TOOL_NAMES[next.req.tool] ?? next.req.tool} without asking, for the rest of this session.`);
  if (answer === "no") line("note", `Denied: ${next.req.summary}`);
  showOracle();
}

// ---------- input ----------

function setBusy(b) {
  busy = b;
  $("prompt").disabled = b;
  $("send").disabled = b;
  document.querySelectorAll(".shortcut").forEach((c) => (c.disabled = b));
  if (!b) $("prompt").focus();
}

async function submit(raw) {
  const text = raw.trim();
  if (!text || busy) return;
  $("prompt").value = "";
  autosize();
  const you = el("div", "you");
  you.appendChild(el("p", "", text));
  append(you);
  scrollDown(true);
  setBusy(true);
  try {
    state = await api.submit(text);
    renderTools();
    renderRank();
    renderStats();
  } catch (err) {
    line("fail", String(err?.message ?? err));
  } finally {
    setBusy(false);
    setWorking(null);
  }
}

function autosize() {
  const t = $("prompt");
  t.style.height = "auto";
  t.style.height = `${Math.min(t.scrollHeight, 200)}px`;
}

function wire() {
  $("form").addEventListener("submit", (e) => {
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
  document.querySelectorAll(".shortcut").forEach((b) =>
    b.addEventListener("click", () => {
      if (b.dataset.run) void submit(b.dataset.run);
      else {
        $("prompt").value = b.dataset.insert;
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
    line("note", `Now working in ${state.root}`);
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
  wire();
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
