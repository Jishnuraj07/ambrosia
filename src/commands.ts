/** The slash commands, for the suggestions both UIs show as you type "/". Aliases are left out. */
export interface Command {
  name: string;
  args?: string;
  about: string;
}

export const COMMANDS: Command[] = [
  { name: "/heist", args: "<task>", about: "Strategos plans, Fabricator builds, Black ICE reviews" },
  { name: "/roast", about: "Black ICE reviews your uncommitted changes" },
  { name: "/stats", about: "your rank, cred and record" },
  { name: "/hacks", about: "achievements earned and still to earn" },
  { name: "/mute", about: "toggle sound" },
  { name: "/tts", about: "toggle spoken narration" },
  { name: "/serious", about: "toggle the fun" },
  { name: "/clear", about: "wipe the conversation" },
  { name: "/help", about: "list the commands" },
  { name: "/quit", about: "jack out" },
];

/** Commands matching what has been typed so far, or none once the line is past the command word. */
export function suggest(line: string): Command[] {
  if (!line.startsWith("/") || /\s/.test(line)) return [];
  const typed = line.toLowerCase();
  return COMMANDS.filter((c) => c.name.startsWith(typed) && c.name !== typed);
}

/** The line after accepting a suggestion: commands that take an argument get a trailing space. */
export function complete(c: Command): string {
  return c.args ? `${c.name} ` : c.name;
}
