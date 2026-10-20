# Ambrosia

A coding agent for your terminal, played as a cyberpunk heist. Claude works as a small netrunner crew, failing tests boot up as hostile programs to purge, and your progress is counted in street cred.

```
    _    __  __ ____  ____   ___  ____ ___    _
   / \  |  \/  | __ )|  _ \ / _ \/ ___|_ _|  / \
  / _ \ | |\/| |  _ \| |_) | | | \___ \| |  / _ \
 / ___ \| |  | | |_) |  _ <| |_| |___) | | / ___ \
/_/   \_\_|  |_|____/|_| \_\\___/|____/___/_/   \_\
```

It is a real agent. It reads, searches and edits files, runs commands, and runs your tests. The fun sits on top as a separate layer, and `--serious` turns all of it off.

## The crew

| Crew member | Role | Default model |
|---|---|---|
| ⚙ **Fabricator** | Does the work: reads, edits, runs | `claude-opus-5-5` |
| ◈ **Strategos** | Plans in `/heist` | `claude-opus-5-5` |
| ❄ **Black ICE** | Reviews and roasts your diff | `claude-sonnet-5-5` |
| 📡 **Pirate Radio** | Narrates in one-liners | `claude-haiku-4-5` |

## The game

- **Cred (XP).** You earn it for killing failing tests, finishing jobs and getting past Black ICE. You lose some when a test you fixed breaks again.
- **Ranks.** Script Kiddie → Runner → Netrunner → Ghost → Legend.
- **Threats.** When `run_tests` finds failures, a threat boots up with one HP per failing test: a Bug, Daemon, Worm or Rogue AI. Fixes land as hits. If the failure count rises, it replicates.
- **Hacks.** There are 11 achievements, including First Blood, Fork Bomb Survivor, Infinite Loop, Bricked and Cracked the ICE. `/hacks` lists them.
- **The Operator check.** Every write, edit and command asks your permission first. Risky commands (`rm -rf`, `git push --force` and similar) carry a warning.
- **Sound.** Synth earcons are generated on the fly. Pirate Radio can read its commentary aloud through Windows SAPI, `say` on macOS or `espeak` on Linux. Nothing extra needs installing.

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

The same crew in a window. It has the crew chat, an arena where threats take hits and get purged, a rank and cred bar, a hacks board, and the Operator check as a dialog. The agent, the game and your progress are shared with the terminal version.

```sh
npm run desktop              # open the last project, or pick a folder
npm run desktop -- --demo    # a scripted demo project; no API key needed
npm run package:desktop      # build release/Ambrosia 1.0.0.exe (portable) and an installer
```

The app icon lives in `desktop/icon.svg`. After editing it, run `npx electron scripts/make-icon.mjs` to regenerate the PNGs that the window and the installer use.

Click the folder in the top bar to switch projects. The Operator check takes `Y` / `A` / `N`, and `Esc` stops the crew.

## Commands

| | |
|---|---|
| *any text* | a job for Fabricator |
| `/heist <task>` | Strategos plans, Fabricator builds, Black ICE reviews (with one revision round). `/council` still works. |
| `/roast` | Black ICE reviews your uncommitted changes |
| `/stats`, `/hacks` | your record (`/labours` still works) |
| `/mute`, `/tts` | sound and spoken narration |
| `/serious` | toggle the fun |
| `/clear`, `/quit` | |
| `Esc` | interrupt the crew |

Flags: `--serious`, `--mute`, `--yolo` (approve everything; careful), `--cwd <dir>`, `--test-sounds`.

## Config

`~/.ambrosia/config.json` is written on first run. It sets each crew member's model and effort (keys `fabricator`, `strategos`, `blackice`, `radio`), sound, tts, the narrator, `autoApprove` (tools that never ask the Operator), and `workspaceId` (for keys not scoped to a workspace). Your progress lives in `~/.ambrosia/profile.json`. Set `AMBROSIA_HOME` to keep them somewhere else.

Upgrading from 1.1 or earlier: config keys named after the old gods (`hephaestus`, `athena`, `momus`, `hermes`) and achievements earned as labours are read and carried over automatically.

## Development

```sh
npm run build       # compile to dist/ (bin/ambrosia.mjs uses it when present, else runs src via tsx)
npm test            # unit tests (84): tools, safety, parsing, game engine, agent loop, heist,
                    #   narrator, session commands and approvals, config/profile, UI components
npm run typecheck
npm run smoke       # drives the real UI end to end with a scripted model; no API key needed
npm run smoke -- --live   # the same run against the real models (costs a few cents)
npm run check       # typecheck, tests, build and the scripted smoke test, as CI runs it
npm run smoke:desktop     # drives the desktop window through the demo; screenshots in shots/
```

CI (`.github/workflows/ci.yml`) runs `check` on Ubuntu and Windows with Node 20 and 24.

Layout: `src/agent/` holds the loop, tools, personas and the heist (`council.ts`). The game engine, hacks, ranks and profile are in `src/game/`, sound and speech in `src/audio/`, and the Ink UI in `src/ui/`. `src/narrator.ts` is Pirate Radio. Everything talks through the typed event bus in `src/events.ts`. The game, the narrator and the sound only listen to it, so the agent never depends on them.
