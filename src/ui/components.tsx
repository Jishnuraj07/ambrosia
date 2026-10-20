import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import type { CrewName } from "../config.js";
import type { Boss, Hack } from "../events.js";
import type { ApprovalRequest } from "../agent/tools.js";
import { PERSONAS, workingLine } from "../agent/personas.js";
import { progress } from "../game/ranks.js";

const NEON = "#ff2bd6";
const ACID = "#c6ff3d";
const CYAN = "#29e7ff";
const DIM = "gray";

const BANNER = [
  "    _    __  __ ____  ____   ___  ____ ___    _    ",
  "   / \\  |  \\/  | __ )|  _ \\ / _ \\/ ___|_ _|  / \\   ",
  "  / _ \\ | |\\/| |  _ \\| |_) | | | \\___ \\| |  / _ \\  ",
  " / ___ \\| |  | | |_) |  _ <| |_| |___) | | / ___ \\ ",
  "/_/   \\_\\_|  |_|____/|_| \\_\\\\___/|____/___/_/   \\_\\",
];
const BANNER_COLORS = ["#ff2bd6", "#d24bff", "#9a6bff", "#5f9bff", "#29e7ff"];

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
          : "  jack in · type a job for Fabricator, /help for commands"}
      </Text>
    </Box>
  );
}

export function CrewLabel({ crew }: { crew: CrewName }) {
  const p = PERSONAS[crew];
  return (
    <Text color={p.color} bold>
      {p.glyph} {p.title}
    </Text>
  );
}

export function CrewBubble({ crew, text }: { crew: CrewName; text: string }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={PERSONAS[crew].color} paddingX={1} marginTop={1}>
      <CrewLabel crew={crew} />
      <Text>{text.trim()}</Text>
    </Box>
  );
}

export function Working({ crew, tick, thinking }: { crew: CrewName; tick: number; thinking: string }) {
  const snippet = thinking.replace(/\s+/g, " ").trim().slice(-90);
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        <Text color={PERSONAS[crew].color}>
          <Spinner type="dots" />{" "}
        </Text>
        <CrewLabel crew={crew} />
        <Text color={DIM}> is {workingLine(crew, tick)}… (Esc to interrupt)</Text>
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
  read_file: "📄",
  write_file: "💾",
  edit_file: "⌨",
  glob: "🗂",
  grep: "🔎",
  shell: "⚡",
  run_tests: "🧪",
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
        ☣ {boss.name}{" "}
      </Text>
      <Text color="red">{"█".repeat(filled)}</Text>
      <Text color={DIM}>{"░".repeat(width - filled)}</Text>
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
      <Text color={NEON} bold>
        {rank.glyph} {rank.name}
      </Text>{" "}
      <Text color={CYAN}>{"▰".repeat(filled)}</Text>
      <Text color={DIM}>{"▱".repeat(width - filled)}</Text>{" "}
      <Text color={ACID}>◆ {xp}</Text>
      <Text color={DIM}>
        {next ? ` / ${next.min} to ${next.name}` : " · top of the grid"}
        {" · "}
        {sound ? (tts ? "🔊 voice" : "🔉") : "🔇"}
      </Text>
    </Text>
  );
}

export function HackCard({ hack }: { hack: Hack }) {
  return (
    <Box borderStyle="double" borderColor={ACID} paddingX={1} marginTop={1} flexDirection="column">
      <Text color={ACID} bold>
        🔓 Hack unlocked: {hack.title}
      </Text>
      <Text>
        {hack.description} <Text color={ACID}>+{hack.reward} cred</Text>
      </Text>
    </Box>
  );
}

export function RankUp({ rank }: { rank: string }) {
  return (
    <Box borderStyle="bold" borderColor={NEON} paddingX={2} marginTop={1} justifyContent="center">
      <Text color={NEON} bold>
        ▲ UPGRADE INSTALLED ▲ You are now a {rank}
      </Text>
    </Box>
  );
}

export function GatePrompt({ req }: { req: ApprovalRequest }) {
  const verb =
    req.tool === "shell" ? "run a command" : req.tool === "run_tests" ? "run the tests" : req.tool === "write_file" ? "write a file" : "edit a file";
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={req.risky ? "red" : CYAN} paddingX={1} marginTop={1}>
      <Text color={CYAN} bold>
        ⌬ Operator check: may {PERSONAS[req.crew].title} {verb}?
      </Text>
      {req.risky ? (
        <Text color="red" bold>
          ⚠ Threat level high. This one looks dangerous.
        </Text>
      ) : null}
      <Text>{req.detail}</Text>
      <Text color={DIM}>
        [y] yes · [a] always allow {req.tool} this session · [n] no
      </Text>
    </Box>
  );
}
