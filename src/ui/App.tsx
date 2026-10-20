import React, { useEffect, useRef, useState } from "react";
import { Box, Static, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import type { CrewName } from "../config.js";
import type { Boss, Hack } from "../events.js";
import type { ApprovalRequest } from "../agent/tools.js";
import type { ApprovalAnswer, Session } from "../session.js";
import { Banner, BossBar, CrewBubble, HackCard, GatePrompt, RankUp, StatusBar, ToolLine, Working } from "./components.js";

type Entry =
  | { id: number; kind: "banner" }
  | { id: number; kind: "user"; text: string }
  | { id: number; kind: "crew"; crew: CrewName; text: string }
  | { id: number; kind: "tool"; name: string; summary: string; ok: boolean; result: string }
  | { id: number; kind: "notice"; text: string }
  | { id: number; kind: "error"; text: string }
  | { id: number; kind: "narration"; text: string }
  | { id: number; kind: "xp"; amount: number; reason: string }
  | { id: number; kind: "hack"; hack: Hack }
  | { id: number; kind: "rank"; rank: string }
  | { id: number; kind: "boss"; text: string };

type NewEntry = Entry extends infer E ? (E extends Entry ? Omit<E, "id"> : never) : never;

interface Live {
  crew: CrewName;
  text: string;
  thinking: string;
}

interface RunningTool {
  id: string;
  name: string;
  summary: string;
}

let nextId = 0;

function EntryView({ e }: { e: Entry }) {
  switch (e.kind) {
    case "banner":
      return null;
    case "user":
      return (
        <Box marginTop={1}>
          <Text color="#ff2bd6" bold>
            ›{" "}
          </Text>
          <Text bold>{e.text}</Text>
        </Box>
      );
    case "crew":
      return <CrewBubble crew={e.crew} text={e.text} />;
    case "tool":
      return <ToolLine name={e.name} summary={e.summary} ok={e.ok} result={e.result} />;
    case "notice":
      return (
        <Box marginTop={1}>
          <Text color="#7fdcff">{e.text}</Text>
        </Box>
      );
    case "error":
      return (
        <Box marginTop={1}>
          <Text color="red">⚡ {e.text}</Text>
        </Box>
      );
    case "narration":
      return (
        <Text color="#c6ff3d" italic>
          📡 Radio: {e.text}
        </Text>
      );
    case "xp":
      return (
        <Text color={e.amount > 0 ? "#c6ff3d" : "red"}>
          {"  "}◆ {e.amount > 0 ? "+" : ""}
          {e.amount} cred <Text color="gray">· {e.reason}</Text>
        </Text>
      );
    case "hack":
      return <HackCard hack={e.hack} />;
    case "rank":
      return <RankUp rank={e.rank} />;
    case "boss":
      return (
        <Text color="red" bold>
          {"  "}
          {e.text}
        </Text>
      );
  }
}

export function App({ session, initialPrompt }: { session: Session; initialPrompt?: string }) {
  const { exit } = useApp();
  const [entries, setEntries] = useState<Entry[]>([{ id: nextId++, kind: "banner" }]);
  const [live, setLive] = useState<Live | null>(null);
  const [running, setRunning] = useState<RunningTool[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [approval, setApproval] = useState<{ req: ApprovalRequest; resolve: (a: ApprovalAnswer) => void } | null>(null);
  const [boss, setBoss] = useState<Boss | null>(null);
  const [xp, setXp] = useState(session.engine.profile.xp);
  const [mode, setMode] = useState({ serious: session.serious, sound: session.sound, tts: session.tts });
  const [tick, setTick] = useState(0);
  const liveRef = useRef<Live | null>(null);
  const dirty = useRef(false);
  const toolSummaries = useRef(new Map<string, string>());

  const add = (e: NewEntry) => setEntries((prev) => [...prev, { ...e, id: nextId++ } as Entry]);

  /** Move streamed text into the permanent transcript. */
  const flushLive = () => {
    const l = liveRef.current;
    if (l && l.text.trim()) add({ kind: "crew", crew: l.crew, text: l.text });
    if (l) {
      l.text = "";
      l.thinking = "";
      setLive({ ...l });
    }
  };

  useEffect(() => {
    const b = session.bus;
    const offs = [
      b.on("turn_start", ({ crew }) => {
        liveRef.current = { crew, text: "", thinking: "" };
        setLive({ ...liveRef.current });
      }),
      b.on("text", ({ delta }) => {
        if (liveRef.current) {
          liveRef.current.text += delta;
          dirty.current = true;
        }
      }),
      b.on("thinking", ({ delta }) => {
        if (liveRef.current) {
          liveRef.current.thinking = (liveRef.current.thinking + delta).slice(-400);
          dirty.current = true;
        }
      }),
      b.on("tool_start", (t) => {
        flushLive();
        toolSummaries.current.set(t.id, t.summary);
        setRunning((r) => [...r, { id: t.id, name: t.name, summary: t.summary }]);
      }),
      b.on("tool_end", (t) => {
        setRunning((r) => r.filter((x) => x.id !== t.id));
        const summary = toolSummaries.current.get(t.id) ?? "";
        toolSummaries.current.delete(t.id);
        add({ kind: "tool", name: t.name, summary, ok: t.ok, result: t.summary });
      }),
      b.on("turn_end", () => {
        flushLive();
        liveRef.current = null;
        setLive(null);
        setRunning([]);
      }),
      b.on("notice", ({ text }) => add({ kind: "notice", text })),
      b.on("error", ({ message }) => add({ kind: "error", text: message })),
      b.on("narration", ({ text }) => add({ kind: "narration", text })),
      b.on("xp", ({ amount, reason, total }) => {
        setXp(total);
        add({ kind: "xp", amount, reason });
      }),
      b.on("hack", (hack) => add({ kind: "hack", hack })),
      b.on("rank_up", ({ rank }) => add({ kind: "rank", rank })),
      b.on("boss", ({ boss: bs, change }) => {
        setBoss(change === "defeated" ? null : bs);
        if (!bs) return;
        const text =
          change === "spawn"
            ? `☣ A ${bs.name} appears! ${bs.hp} failing test${bs.hp > 1 ? "s" : ""}.`
            : change === "grow"
              ? `🧬 It replicates! The ${bs.name} now runs ${bs.hp}.`
              : change === "hit"
                ? `⚡ Hit! The ${bs.name} is down to ${bs.hp}.`
                : change === "defeated"
                  ? `✔ The ${bs.name} is purged! All tests pass.`
                  : "";
        if (text) add({ kind: "boss", text });
      }),
    ];
    session.setApprovalHandler(
      (req) =>
        new Promise<ApprovalAnswer>((resolve) => {
          flushLive();
          setApproval({ req, resolve });
        }),
    );
    return () => offs.forEach((o) => o());
  }, [session]);

  // Repaint streamed text at a steady rate instead of on every token; also drives the spinner flavour.
  useEffect(() => {
    const t = setInterval(() => {
      setTick((n) => n + 1);
      if (dirty.current && liveRef.current) {
        dirty.current = false;
        setLive({ ...liveRef.current });
      }
    }, 80);
    return () => clearInterval(t);
  }, []);

  const submit = async (line: string) => {
    setInput("");
    if (!line.trim()) return;
    add({ kind: "user", text: line });
    setBusy(true);
    const result = await session.submit(line);
    setBusy(false);
    setMode({ serious: session.serious, sound: session.sound, tts: session.tts });
    if (result === "quit") exit();
  };

  useEffect(() => {
    if (initialPrompt) void submit(initialPrompt);
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useInput((ch, key) => {
    if (approval) {
      const c = ch.toLowerCase();
      const answer: ApprovalAnswer | null = c === "y" || key.return ? "yes" : c === "a" ? "always" : c === "n" || key.escape ? "no" : null;
      if (!answer) return;
      add({
        kind: "notice",
        text: answer === "no" ? "⌬ Operator blocked it." : answer === "always" ? `⌬ Operator allows ${approval.req.tool} for this session.` : "⌬ Operator allows it.",
      });
      approval.resolve(answer);
      setApproval(null);
      return;
    }
    if (key.escape && busy) session.interrupt();
  });

  return (
    <Box flexDirection="column">
      <Static items={entries}>{(e) => (e.kind === "banner" ? <Banner key={e.id} serious={session.serious} /> : <EntryView key={e.id} e={e} />)}</Static>

      {live?.text.trim() ? <CrewBubble crew={live.crew} text={live.text} /> : null}
      {running.map((t) => (
        <ToolLine key={t.id} name={t.name} summary={t.summary} />
      ))}
      {approval ? <GatePrompt req={approval.req} /> : null}
      {live && !approval && running.length === 0 ? <Working crew={live.crew} tick={tick} thinking={live.thinking} /> : null}

      <Box flexDirection="column" marginTop={1}>
        {boss && !mode.serious ? <BossBar boss={boss} /> : null}
        <StatusBar xp={xp} serious={mode.serious} sound={mode.sound} tts={mode.tts} />
        {busy ? (
          <Text color="gray">{approval ? "Answer the Operator check above." : "The crew is on the job. Esc to interrupt."}</Text>
        ) : (
          <Box>
            <Text color="#ff2bd6" bold>
              ›{" "}
            </Text>
            <TextInput value={input} onChange={setInput} onSubmit={(v) => void submit(v)} placeholder="What's the job?" />
          </Box>
        )}
      </Box>
    </Box>
  );
}
