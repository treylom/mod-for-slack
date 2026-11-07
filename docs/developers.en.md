# Developer guide

[한국어](developers.md) · [For first-time users (README)](../README.en.md)

This page is for developers who want to change or extend mod-for-slack. For installing and first use, see the [README](../README.en.md).

## Two layers

- **Claude Code mod** — a plugin that changes how Claude Code looks and behaves. A plugin becomes a mod when its `hooks/hooks.json` has a `modules` key pointing to a module (`register.js`) that exports `register(on)`. Handlers attach to events (`tool.call` · `prompt.submit` · `turn.complete` · `ui.render` · `session.*` and others) and use the `$` they receive (the mods API) for panes, bands, the status line and notifications (`$.ui`), commands (`$.command`), tools (`$.tool`) and more. Needs terminal Claude Code 2.1.287 or later. Official docs: [overview](https://code.claude.com/docs/en/plugins/mods/overview.md) · [API](https://code.claude.com/docs/en/plugins/mods/api.md) · [reference](https://code.claude.com/docs/en/plugins/mods/reference.md).
- **mod-for-slack** — one plugin built on that framework (`slackmod/app/mods-harness`), plus the kit that connects it to Slack and handles install and start-up.

The full mods API types are not in this repository. When Claude Code loads a plugin with `--plugin-dir`, it writes them into that plugin's `.claude-plugin/types/claude-code/index.d.ts`. The repository's `types/index.d.ts` is a small file that only lists the state keys this plugin uses (`mh.*`).

## Folder layout

| Where | What |
|---|---|
| `install.sh` | The entry point. Checks the programs it needs and opens Claude Code with the setup wizard (`setup/`) (`--section` · `--resume` · `--answers`). |
| `setup/` | The setup wizard plugin (name `mods-setup` · command `/mods-setup:setup`). Skills `mods-setup` · `mods-doctor` · `bot-interview`, helpers in `lib/`, tests in `tests/`. |
| `slackmod/` | The bundle that gets installed (it keeps its earlier name for existing installs). See the table below. |
| `rules/` | Three sets of bot operating rules (Claude Code · Codex · general edition). The tool scripts the rules call are not included. |
| `docs/` | The Slack app guide and this page. |

Inside `slackmod/`:

| Where | What |
|---|---|
| `install.sh` | The installer. Installs under `~/.slackmod` and records what it changed so `slackmod undo` can roll it back. Running it twice gives the same result. |
| `bin/slackmod` | Start · stop · status commands (`start` · `stop` · `status` · `attach` · `open` · `set-token` · `set-judge-key` · `set-effort` · `effort` · `undo` · `check-windows`). |
| `lib/slackmod_config.py` | Reads and checks the config file and writes each bot's start-up files. |
| `lib/record.py` | Install records and undo. |
| `app/mods-harness` | The Claude Code mod plugin (below). |
| `app/channel-server` | The Slack bridge (Slack ↔ bot window). |
| `hooks/pass.sh` | The gate every tool call goes through (it currently lets everything through). |
| `templates/` | Bot rules (main-session contract · no-sub-session edition), the help skill `slackmod-help`, an empty notes-folder skeleton. |
| `MANIFEST.txt` · `SHA256SUMS` | The source commits the bundle was built from · the pinned Claude Code version · file checksums. |

The plugin `app/mods-harness` loads seven parts through `hooks/hooks.json` → `register.js`: config loading · the gate (hook runner) · sessions (a sub-session per thread) · the screen (band and status board) · tools · memory · the owner tag. Tools: the bot's main session gets `spawn_child` · `list_children` · `close_child` · `send_to_child` · `board_summary` · a sub-session gets `report_to_parent` · `ask_sibling` · `answer_sibling` · `board_post` · `board_read` (plus `not_mine` when the sub-session router is on · plus `spawn_child` and the rest while depth is left) · both get `progress_line`. With sub-sessions turned off (`children: false`) those five main-session tools are not loaded.

## What runs at start-up

`slackmod start <bot>` opens two windows in a session named after the bot.

- `bridge` — the Slack bridge (`app/channel-server`). Its log is the bot's `slack/server.log`.
- `main` — Claude Code. It sets `MODS_HARNESS_BOT` · `MODS_HARNESS_SESSION_ID` (a new value) · `MODS_HARNESS_CONFIG` (that bot's `harness.json`), loads `--plugin-dir app/mods-harness` · `--mcp-config` · `--append-system-prompt-file` (the bot rules) · the Slack channel server, and runs in the bot's work folder with umask 077.

Inside herdr it opens one herdr workspace with two tabs instead of a session (`--backend auto|tmux|herdr`).

Files the installer writes for each bot (`~/.slackmod/bots/<bot>/`): `harness.json` (plugin config) · `mcp.json` · `launch.sh` (start-up values · owner-only) · `slack/.env` (tokens · only written by `slackmod set-token`).

## Config

One config file = `~/.slackmod/config.json` (example: `slackmod/config.example.json`). After editing it, run `bash install.sh` again and each bot's files are written again.

- Required: `schema` · `slack` (channel · owner) · `bots` (1–4) · `aliases` · `permission` · `child` (sub-session model · thinking depth · free disk/memory thresholds).
- Optional: `mode` · `wiki` · `memory_setup` · `browser` · `help_skill` · `children` · `children_open` · `owner_tag` · `window_backend` · `router` — their meanings are in the description at the top of `slackmod/lib/slackmod_config.py`.
- Per bot: `name` · `work_dir` · `slack_bot_user_id` · `model` · (optional) `effort` · `projects` (work folders) · `extra_channels` · `extra_env` (allowed names only · secret-looking names go to the bot's `.env` only).

Do not edit `harness.json` by hand (the installer writes it again). Main sections: `hooks` (the gate) · `memory` · `session` (default model · owner · sub-sessions) · `ui` (screen name `system_name`) · `owner`.

## Changing and extending

- **Bot rules** — put md files in the bot work folder's `.claude/rules/` (the installer writes `slackmod-projects.md` · `slackmod-memory.md` again on each run). The repository's `rules/` holds three reference sets.
- **Skills** — the bot work folder's `.claude/skills/<name>/SKILL.md` or your user folder `~/.claude/skills/`. This is Claude Code's normal skill mechanism.
- **Other channels** — list them in the bot's `extra_channels` and they load after the Slack channel server.
- **The gate** — edit `slackmod/hooks/pass.sh`, then run `bash install.sh` again to record the new checksum. Editing only the installed copy breaks the checksum and tool calls are refused (the health check names it).
- **Redo a wizard section** — `/mods-setup:setup --section <section>` or `bash install.sh --section <section>`. Sections = `mux` · `slack` · `wiki` · `mcp` · `codex` · `doctor` · `browser` · `memory` · `children` · `router` · `bots`.
- **Change the mod itself** — edit `slackmod/app/mods-harness/src/`, check with `claude plugin validate slackmod/app/mods-harness`, and restart the bot.

## Tests

The tests in this repository are in `setup/tests/`.

```bash
bash setup/tests/run-all.sh          # all · rc and PASS/FAIL counts per file
bash setup/tests/run-all.sh m4       # only files whose name starts with m4
MUTATE=1 bash setup/tests/run-all.sh # also switches each check off in turn and counts what the tests catch
```

Hand-run tests (`m3-bundle-layout` · `m3-live-wizard` · `m3-g34-live`) are left out of the run. The bundle-building, installer-contract and trace-scan tests are not in the public repository, so `run-all.sh` skips them.

## Claude Code version

The bundle is tested against one Claude Code version (`slackmod/app/mods-harness/.claude-code-version`). With a different version, the installer only shows a warning and the command to match it; it does not block. Bot windows run with auto-update turned off.

## About the name

The product name is mod-for-slack. So that existing installs keep working, the command `slackmod` · the install folder `~/.slackmod` · the repository folder `slackmod/` · the shell settings block marker `# >>> slackmod >>>` · the `SLACKMOD_*` environment variables · the plugin name `mods-harness` keep their earlier names. Claude Code puts the plugin name in front of a plugin's status line and notifications, so notification lines on screen start with «mods-harness:».

## Rules and related repositories

The original bot operating rules (`rules/`) and the related repositories that hold copies of them are listed in [«Rules and related repositories» in the README](../README.en.md#rules-and-related-repositories).
