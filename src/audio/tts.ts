import { spawn, type ChildProcess } from "node:child_process";

let current: ChildProcess | null = null;

function speaker(): [string, string[]] | null {
  if (process.platform === "win32") {
    // Text arrives on stdin, so nothing in it can be interpreted as PowerShell.
    const script =
      "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate = 1; $s.Speak([Console]::In.ReadToEnd())";
    return ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]];
  }
  if (process.platform === "darwin") return ["say", []];
  return ["espeak", ["--stdin"]];
}

/** Speak a line, cutting off whatever was still being said. */
export function speak(text: string): void {
  const cmd = speaker();
  if (!cmd || !text.trim()) return;
  try {
    current?.kill();
    const child = spawn(cmd[0], cmd[1], { stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
    child.on("error", () => {});
    child.stdin?.on("error", () => {});
    child.stdin?.end(text);
    current = child;
  } catch {
    // No speech engine: stay quiet.
  }
}

export function stopSpeaking(): void {
  current?.kill();
  current = null;
}
