# Ambrosia

A coding agent for your terminal, played as Greek myth. Claude works as a small pantheon, failing tests show up as monsters to slay, and your progress is counted in ambrosia.

```
    _    __  __ ____  ____   ___  ____ ___    _
   / \  |  \/  | __ )|  _ \ / _ \/ ___|_ _|  / \
  / _ \ | |\/| |  _ \| |_) | | | \___ \| |  / _ \
 / ___ \| |  | | |_) |  _ <| |_| |___) | | / ___ \
/_/   \_\_|  |_|____/|_| \_\\___/|____/___/_/   \_\
```

It is a real agent. It reads, searches and edits files, runs commands, and runs your tests. The fun sits on top as a separate layer, and `--serious` turns all of it off.

## The pantheon

| God | Role | Default model |
|---|---|---|
| ⚒ **Hephaestus** | Does the work: reads, edits, runs | `claude-opus-5-5` |
| 🦉 **Athena** | Plans in `/council` | `claude-opus-5-5` |
| 🎭 **Momus** | Reviews and roasts your diff | `claude-sonnet-5-5` |
| 🪽 **Hermes** | Narrates in one-liners | `claude-haiku-4-5` |

## The game

- **Ambrosia (XP).** You earn it for slaying failing tests, finishing tasks and winning Momus's approval. You lose some when a test you fixed breaks again.
- **Ranks.** Mortal → Hero → Demigod → Titan → Olympian.
- **Monsters.** When `run_tests` finds failures, a monster spawns with one HP per failing test: a Harpy, Minotaur, Chimera or Hydra. Fixes land as hits. If the failure count rises, it grows new heads.
- **Labours.** There are 11 achievements, including First Blood, Hydra Slayer, Sisyphus, Icarus and Golden Fleece. `/labours` lists them.
- **The Oracle.** Every write, edit and command asks your permission first. Risky commands (`rm -rf`, `git push --force` and similar) carry a warning.
- **Sound.** Earcons are synthesised on the fly. Hermes can read his commentary aloud through Windows SAPI, `say` on macOS or `espeak` on Linux. Nothing extra needs installing.

## Setup

Requires Node 20 or later.

```sh
npm install
export ANTHROPIC_API_KEY=sk-ant-...      # PowerShell: $env:ANTHROPIC_API_KEY = "sk-ant-..."
export ANTHROPIC_WORKSPACE_ID=wrkspc_...   # only if your key is not scoped to a workspace
npm start                                # or: node bin/ambrosia.mjs [task]
npm link                                 # optional: puts `ambrosia` on your PATH
```

Run it from inside the project you want to work on, or point it there with `--cwd <dir>`.

## Desktop app

The same pantheon in a window. It has a god chat, an arena where monsters take hits and fall, a rank and XP bar, a labours board, and the Oracle as a dialog. The agent, the game and your progress are shared with the terminal version.

```sh
npm run desktop              # open the last project, or pick a folder
npm run desktop -- --demo    # a scripted demo project; no API key needed
npm run package:desktop      # build release/Ambrosia 1.0.0.exe (portable) and an installer
```

Click the folder in the top bar to switch projects. The Oracle takes `Y` / `A` / `N`, and `Esc` stops the gods.

## Commands

| | |
|---|---|
| *any text* | a task for Hephaestus |
| `/council <task>` | Athena plans, Hephaestus builds, Momus reviews (with one revision round) |
| `/roast` | Momus reviews your uncommitted changes |
| `/stats`, `/labours` | your record |
| `/mute`, `/tts` | sound and spoken narration |
| `/serious` | toggle the fun |
| `/clear`, `/quit` | |
| `Esc` | interrupt the gods |

Flags: `--serious`, `--mute`, `--yolo` (approve everything; careful), `--cwd <dir>`, `--test-sounds`.

## Config

`~/.ambrosia/config.json` is written on first run. It sets each god's model and effort, sound, tts, the narrator, `autoApprove` (tools that never ask the Oracle), and `workspaceId` (for keys not scoped to a workspace). Your progress lives in `~/.ambrosia/profile.json`. Set `AMBROSIA_HOME` to keep them somewhere else.

## Development

```sh
npm run build       # compile to dist/ (bin/ambrosia.mjs uses it when present, else runs src via tsx)
npm test            # unit tests (82): tools, safety, parsing, game engine, agent loop, council,
                    #   narrator, session commands and approvals, config/profile, UI components
npm run typecheck
npm run smoke       # drives the real UI end to end with a scripted model; no API key needed
npm run smoke -- --live   # the same run against the real models (costs a few cents)
npm run check       # typecheck, tests, build and the scripted smoke test, as CI runs it
npm run smoke:desktop     # drives the desktop window through the demo; screenshots in shots/
```

CI (`.github/workflows/ci.yml`) runs `check` on Ubuntu and Windows with Node 20 and 24.

Layout: `src/agent/` holds the loop, tools, personas and council. The game engine, labours, ranks and profile are in `src/game/`, sound and speech in `src/audio/`, and the Ink UI in `src/ui/`. `src/narrator.ts` is Hermes. Everything talks through the typed event bus in `src/events.ts`. The game, the narrator and the sound only listen to it, so the agent never depends on them.
