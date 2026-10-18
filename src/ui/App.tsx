import React, { useEffect, useRef, useState } from "react";
import { Box, Static, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import type { GodName } from "../config.js";
import type { Boss, Labour } from "../events.js";
import type { ApprovalRequest } from "../agent/tools.js";
import type { ApprovalAnswer, Session } from "../session.js";
import { Banner, BossBar, GodBubble, LabourCard, OraclePrompt, RankUp, StatusBar, ToolLine, Working } from "./components.js";

type Entry =
  | { id: number; kind: "banner" }
  | { id: number; kind: "user"; text: string }
  | { id: number; kind: "god"; god: GodName; text: string }
  | { id: number; kind: "tool"; name: string; summary: string; ok: boolean; result: string }
  | { id: number; kind: "notice"; text: string }
  | { id: number; kind: "error"; text: string }
  | { id: number; kind: "narration"; text: string }
  | { id: number; kind: "xp"; amount: number; reason: string }
  | { id: number; kind: "labour"; labour: Labour }
  | { id: number; kind: "rank"; rank: string }
  | { id: number; kind: "boss"; text: string };

type NewEntry = Entry extends infer E ? (E extends Entry ? Omit<E, "id"> : never) : never;

interface Live {
  god: GodName;
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
          <Text color="#f5c518" bold>
            ›{" "}
          </Text>
          <Text bold>{e.text}</Text>
        </Box>
      );
    case "god":
      return <GodBubble god={e.god} text={e.text} />;
    case "tool":
      return <ToolLine name={e.name} summary={e.summary} ok={e.ok} result={e.result} />;
    case "notice":
      return (
        <Box marginTop={1}>
          <Text color="#c9a0dc">{e.text}</Text>
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
        <Text color="#7bed9f" italic>
          🪽 Hermes: {e.text}
        </Text>
      );
    case "xp":
      return (
        <Text color={e.amount > 0 ? "#f5c518" : "red"}>
          {"  "}⚱ {e.amount > 0 ? "+" : ""}
          {e.amount} ambrosia <Text color="gray">· {e.reason}</Text>
        </Text>
      );
    case "labour":
      return <LabourCard labour={e.labour} />;
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
    if (l && l.text.trim()) add({ kind: "god", god: l.god, text: l.text });
    if (l) {
      l.text = "";
      l.thinking = "";
      setLive({ ...l });
    }
  };

  useEffect(() => {
    const b = session.bus;
    const offs = [
      b.on("turn_start", ({ god }) => {
        liveRef.current = { god, text: "", thinking: "" };
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
      b.on("labour", (labour) => add({ kind: "labour", labour })),
      b.on("rank_up", ({ rank }) => add({ kind: "rank", rank })),
      b.on("boss", ({ boss: bs, change }) => {
        setBoss(change === "defeated" ? null : bs);
        if (!bs) return;
        const text =
          change === "spawn"
            ? `🐉 A ${bs.name} appears! ${bs.hp} failing test${bs.hp > 1 ? "s" : ""}.`
            : change === "grow"
              ? `🐍 It grows new heads! The ${bs.name} now has ${bs.hp}.`
              : change === "hit"
                ? `⚔ Hit! The ${bs.name} is down to ${bs.hp}.`
                : change === "defeated"
                  ? `🏛 The ${bs.name} is slain! All tests pass.`
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
        text: answer === "no" ? "🔮 The Oracle forbids it." : answer === "always" ? `🔮 The Oracle allows ${approval.req.tool} for this session.` : "🔮 The Oracle allows it.",
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

      {live?.text.trim() ? <GodBubble god={live.god} text={live.text} /> : null}
      {running.map((t) => (
        <ToolLine key={t.id} name={t.name} summary={t.summary} />
      ))}
      {approval ? <OraclePrompt req={approval.req} /> : null}
      {live && !approval && running.length === 0 ? <Working god={live.god} tick={tick} thinking={live.thinking} /> : null}

      <Box flexDirection="column" marginTop={1}>
        {boss && !mode.serious ? <BossBar boss={boss} /> : null}
        <StatusBar xp={xp} serious={mode.serious} sound={mode.sound} tts={mode.tts} />
        {busy ? (
          <Text color="gray">{approval ? "Answer the Oracle above." : "The gods are at work. Esc to interrupt."}</Text>
        ) : (
          <Box>
            <Text color="#f5c518" bold>
              ›{" "}
            </Text>
            <TextInput value={input} onChange={setInput} onSubmit={(v) => void submit(v)} placeholder="What shall we forge?" />
          </Box>
        )}
      </Box>
    </Box>
  );
}
