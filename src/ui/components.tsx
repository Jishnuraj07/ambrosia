import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import type { GodName } from "../config.js";
import type { Boss, Labour } from "../events.js";
import type { ApprovalRequest } from "../agent/tools.js";
import { PERSONAS, workingLine } from "../agent/personas.js";
import { progress } from "../game/ranks.js";

const GOLD = "#f5c518";
const DIM = "gray";

const BANNER = [
  "    _    __  __ ____  ____   ___  ____ ___    _    ",
  "   / \\  |  \\/  | __ )|  _ \\ / _ \\/ ___|_ _|  / \\   ",
  "  / _ \\ | |\\/| |  _ \\| |_) | | | \\___ \\| |  / _ \\  ",
  " / ___ \\| |  | | |_) |  _ <| |_| |___) | | / ___ \\ ",
  "/_/   \\_\\_|  |_|____/|_| \\_\\\\___/|____/___/_/   \\_\\",
];
const BANNER_COLORS = ["#fff3b0", "#ffe066", "#f5c518", "#e0a800", "#b8860b"];

export function Banner({ serious }: { serious: boolean }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      {BANNER.map((line, i) => (
        <Text key={i} color={BANNER_COLORS[i]}>
          {line}
        </Text>
      ))}
      <Text color={DIM}>
        {serious
          ? "  serious mode · type a task, /help for commands"
          : "  food of the gods · type a task for Hephaestus, /help for commands"}
      </Text>
    </Box>
  );
}

export function GodLabel({ god }: { god: GodName }) {
  const p = PERSONAS[god];
  return (
    <Text color={p.color} bold>
      {p.glyph} {p.title}
    </Text>
  );
}

export function GodBubble({ god, text }: { god: GodName; text: string }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={PERSONAS[god].color} paddingX={1} marginTop={1}>
      <GodLabel god={god} />
      <Text>{text.trim()}</Text>
    </Box>
  );
}

export function Working({ god, tick, thinking }: { god: GodName; tick: number; thinking: string }) {
  const snippet = thinking.replace(/\s+/g, " ").trim().slice(-90);
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        <Text color={PERSONAS[god].color}>
          <Spinner type="dots" />{" "}
        </Text>
        <GodLabel god={god} />
        <Text color={DIM}> is {workingLine(god, tick)}… (Esc to interrupt)</Text>
      </Text>
      {snippet ? (
        <Text color={DIM} italic wrap="truncate-end">
          {"  ⌁ "}
          {snippet}
        </Text>
      ) : null}
    </Box>
  );
}

const TOOL_ICONS: Record<string, string> = {
  read_file: "📜",
  write_file: "🔨",
  edit_file: "🔧",
  glob: "🧭",
  grep: "🔍",
  shell: "🔥",
  run_tests: "⚔",
};

export function ToolLine({ name, summary, ok, result }: { name: string; summary: string; ok?: boolean; result?: string }) {
  const status = ok === undefined ? <Spinner type="line" /> : ok ? <Text color="green">✓</Text> : <Text color="red">✗</Text>;
  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        {"  "}
        {status} {TOOL_ICONS[name] ?? "•"} <Text bold>{name}</Text> <Text color={DIM}>{summary}</Text>
      </Text>
      {result && ok === false ? (
        <Text color="red" wrap="truncate-end">
          {"     "}
          {result}
        </Text>
      ) : null}
    </Box>
  );
}

export function BossBar({ boss }: { boss: Boss }) {
  const width = Math.min(boss.maxHp, 20);
  const filled = Math.round((boss.hp / boss.maxHp) * width);
  return (
    <Text>
      <Text color="red" bold>
        🐉 {boss.name}{" "}
      </Text>
      <Text color="red">{"♥".repeat(filled)}</Text>
      <Text color={DIM}>{"♡".repeat(width - filled)}</Text>
      <Text color={DIM}>
        {" "}
        {boss.hp}/{boss.maxHp} failing
      </Text>
    </Text>
  );
}

export function StatusBar({ xp, serious, sound, tts }: { xp: number; serious: boolean; sound: boolean; tts: boolean }) {
  if (serious) return <Text color={DIM}>serious mode · /serious to bring back the fun</Text>;
  const { rank, next, fraction } = progress(xp);
  const width = 16;
  const filled = Math.round(fraction * width);
  return (
    <Text>
      <Text color={GOLD} bold>
        {rank.glyph} {rank.name}
      </Text>{" "}
      <Text color={GOLD}>{"▰".repeat(filled)}</Text>
      <Text color={DIM}>{"▱".repeat(width - filled)}</Text>{" "}
      <Text color={GOLD}>⚱ {xp}</Text>
      <Text color={DIM}>
        {next ? ` / ${next.min} to ${next.name}` : " · the summit"}
        {" · "}
        {sound ? (tts ? "🔊 voice" : "🔉") : "🔇"}
      </Text>
    </Text>
  );
}

export function LabourCard({ labour }: { labour: Labour }) {
  return (
    <Box borderStyle="double" borderColor={GOLD} paddingX={1} marginTop={1} flexDirection="column">
      <Text color={GOLD} bold>
        🏆 Labour complete: {labour.title}
      </Text>
      <Text>
        {labour.description} <Text color={GOLD}>+{labour.reward} ambrosia</Text>
      </Text>
    </Box>
  );
}

export function RankUp({ rank }: { rank: string }) {
  return (
    <Box borderStyle="bold" borderColor={GOLD} paddingX={2} marginTop={1} justifyContent="center">
      <Text color={GOLD} bold>
        ⚡ ASCENSION ⚡ You are now a {rank}
      </Text>
    </Box>
  );
}

export function OraclePrompt({ req }: { req: ApprovalRequest }) {
  const verb =
    req.tool === "shell" ? "run a command" : req.tool === "run_tests" ? "run the tests" : req.tool === "write_file" ? "write a file" : "edit a file";
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={req.risky ? "red" : "#c9a0dc"} paddingX={1} marginTop={1}>
      <Text color="#c9a0dc" bold>
        🔮 The Oracle asks: may {PERSONAS[req.god].title} {verb}?
      </Text>
      {req.risky ? (
        <Text color="red" bold>
          ⚠ The smoke darkens. This one looks dangerous.
        </Text>
      ) : null}
      <Text>{req.detail}</Text>
      <Text color={DIM}>
        [y] yes · [a] always allow {req.tool} this session · [n] no
      </Text>
    </Box>
  );
}
