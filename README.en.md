# mod-for-slack (preview)

[한국어](README.md)

> This is a «preview (alpha)» release — please report problems as issues.
> This project used to be called SlackMod. If you already installed it, keep using it as is — the `slackmod` command and the `~/.slackmod` folder have not changed ([details](#undo)).

Write in a Slack channel and your Claude Code bot picks it up. Work that takes several steps is handed to **a sub-session of its own for that thread, opened in a new window** (turn off «use sub-sessions» in the setup wizard and the bot does it in its own main window instead · turn on the optional «sub-session router» and a judge model picks which sub-session an owner message belongs to · in the owner's DM threads the bot's replies start with a tag for the owner). Bots talk to each other in threads, and can also talk in a channel where people you allowed (guests) are present.

A guest's message only gets conversation and replies. In a turn that brought a guest's message, every tool except reading and the Slack reply/reaction refuses by itself, and in later turns a hand-off to a sub-session that carries a guest's sentence (30+ characters) word for word is refused. **Limit:** the tools cannot stop the bot from rewording a guest's message and handing that on — the bot's rules cover that part (guest messages are not moved into sub-sessions).

## Who this guide is for

- **First-time users** — follow this page from the top: what it is → install → first use → restart and undo. Unfamiliar words are collected at the bottom in [«Words used here»](#words-used-here).
- **Developers** — folder layout · config files · how to change and extend it · running the tests are in the [developer guide](docs/developers.en.md).

## Two layers: Claude Code mods and mod-for-slack

- **Claude Code mod (CCMOD for short)** — an add-on (plugin) that changes how Claude Code looks and behaves. It can open a pane beside the conversation, put a band above and a status line below the prompt, add commands and tools, and step in just before Claude uses a tool to look at the call or block it. From Claude Code 2.1.287 on, nothing needs to be switched on. A mod runs with your account's permissions, so only add mods you trust ([official docs](https://code.claude.com/docs/en/plugins/mods/overview.md)).
- **mod-for-slack** — this repository's kit, built on that mod framework. It connects Slack to Claude Code bots, hands longer work to a per-thread sub-session in a new window, and shows a status board beside the bot's screen (whether the bot and its sub-sessions are working, idle or waiting). The guest-message limits described above are also kept by the mod, which steps in on every tool call.

## Install Claude Code first

This setup helper assumes **a computer that already has Claude Code**. Any terminal works (macOS Terminal · inside tmux · herdr · cmux) as long as Claude Code is installed. On Windows you work in a Linux-inside-Windows window (WSL · Ubuntu), not in PowerShell — see the Windows line below. If you do not have Claude Code yet, install it the easy way first.

- **Windows** — an all-in-one installer: https://github.com/treylom/cc-codex-easyinstall (installs Linux inside Windows (WSL · Ubuntu), Claude Code and tmux together). The bots run inside that Ubuntu window — when the install is done, open «Ubuntu» from the Start menu and do the «Quick start» below in that window.
- **macOS · Linux · WSL** — the official one-liner (no admin rights): `curl -fsSL https://claude.ai/install.sh | bash` → open `claude` once in a new window and sign in.

## Quick start (macOS · WSL Ubuntu · Linux)

```bash
git clone <this repository's URL> mod-for-slack && cd mod-for-slack
bash install.sh
```

No Slack app yet? See [Create the Slack app and get its tokens](docs/slack-app.en.md) first — one app per bot, and the repository includes a manifest file (`slackmod/slack-app-manifest.json`) that fills in the app settings at once.

`install.sh` checks the programs it needs (Claude Code · node 20+ · python3 · git · a multi-window tool) and, for anything missing, only shows the install command (it never runs admin-rights commands by itself). Then Claude Code starts straight into the **setup wizard**.

What the wizard does:

0. Looks at the computer first (read only): computer type · terminal · Claude Code version · built-in memory · note-app folder · skills and add-ons already installed. Your past Claude Code conversation history is only counted, **after telling you first** (folders you worked in most · tools you used most — message text is neither stored nor shown · you can choose «don't read»).
1. Finds settings you already use (Claude Code · Codex · other bots), shows them and asks whether to bring them in. Bringing them in moves **copies** only, into a separate folder — the originals are not touched.
2. You pick a mode: quick (recommended defaults) · full (choose every option) · blank (install only). Quick mode still asks once: «shall I also ask about recommended skills · work folders · memory?»
3. You pick the window tool · Slack connection · wiki folder · MCP · Codex · check skills · browser · memory · use sub-sessions · sub-session router (quick mode asks only about the Slack connection · use sub-sessions · sub-session router).
   More options: **recommended skills** (the same base set for everyone — carrying memory over · finding material · a «what should I use?» helper · check and undo — on top of that, only items from our list and from Claude Code's official add-on list that fit your setup · anything already there is left out · only what you pick goes in) · **memory** (built-in memory + note-app folder · if you have neither, it lays out an empty notes-folder skeleton · outside memory services are connected only when a connection test passes) · **work folders** (optional — links the folders you usually work in to the bot · the bot does not open folders outside the linked ones) · **thinking depth** (all bots at once or per bot) · **usable models** (name check + a short real call · no answer = «not confirmed»).
4. Sets each bot's name and personality in a short interview, and checks them before they go in. If there are no bots to bring in, it starts from three role defaults (lead · watch/schedule · research).
   It asks five things about the work you do — choose «later» and it puts the question aside and asks again later.
5. Installs what you picked **at once** (each install records «what it changed» → you can undo the install you just did), shows a health-check table, then opens a new terminal window where you enter the tokens and start the bots. On first launch the bot window shows confirmation screens — how to answer them is the «first-launch confirmation screens in the bot window» line in [SUPPORT.md](SUPPORT.md) (Korean): in short, the folder-trust and bypass-permissions screens come once each (`slackmod attach <bot>`, arrow down to «Yes», Enter — plain Enter picks «No, exit»), and the development-channels screen comes every launch and `slackmod start` answers it for you.

To redo just one section: call it in Claude Code like `/mods-setup:setup --section slack`. To continue only the sections you put aside: `bash install.sh --resume` in the terminal — this works even before Slack is connected (at the end the wizard can also open a Claude Code window in that bot's folder so you continue there). To change a bot's thinking depth later, run `slackmod set-effort <bot|all> <low|medium|high|xhigh|max|default>` and restart that bot.

## First use

1. Start the bots: `slackmod start all` in the terminal (skip this if the setup wizard already started them at the end). Check with `slackmod status` — each bot should show «켜짐» (on).
2. Talk to a bot in Slack: as the owner, send it a DM, or invite it to the channel you entered during setup (`/invite @botname`) and call it with `@botname`.
3. Short tasks get an answer right there. For work that takes several steps, the bot leaves a one-line «a sub-session has taken this» note and opens a sub-session for that thread in a new window. When the sub-session finishes, the bot posts the result in the same thread.
4. To see what a bot is doing, run `slackmod attach <bot>` in the terminal — the bot's screen opens (in tmux, to leave: press Ctrl+b, release, then d). The status board beside it shows whether the bot and its sub-sessions are working, idle or waiting.
5. Not sure what to ask for? Ask the bot «what should I use?» — it picks only from the features this bot really has.

## Public repositories that go well with it

Our public repositories that the wizard's «recommended skills» section suggests when they fit (only what you pick goes in). Type the two lines inside Claude Code.

- Notes-folder organizing helper — https://github.com/treylom/knowledge-manager · `/plugin marketplace add treylom/knowledge-manager` → `/plugin install km@knowledge-manager`
- Polishing request prompts — https://github.com/treylom/prompt-engineering-skills · `/plugin marketplace add treylom/prompt-engineering-skills` → `/plugin install prompt-engineering-skills@prompt-engineering-skills`

## Rules and related repositories

This repository is where the original bot operating rules live. [rules/](rules/) has three sets — for Claude Code bots (`rules/claude-code/`) · for Codex bots (`rules/codex/`) · a general edition without bot-specific parts (`rules/general/`). The three repositories below each hold a copy of their set with an installer, and point back here in their top line.

- [ThisCode](https://github.com/treylom/ThisCode) — Claude Code bot operating set (a copy of `rules/claude-code/` · installer)
- [ThisCodex](https://github.com/treylom/ThisCodex) — Codex bot operating set (a copy of `rules/codex/` · installer)
- [tofu-harness](https://github.com/treylom/tofu-harness) — general-edition rules and a harness check tool (a copy of `rules/general/`)

### Recent changes

- 2026-11 · The original rules moved into this repository. The default branches of the three repositories also took the 2026-10-25~27 rule updates (web research uses our own tools first · public material is checked down to the line breaks as drawn on screen · how security reviews are done · processes are checked and stopped one at a time).

## Supported environments

See [SUPPORT.md](SUPPORT.md) (Korean). tmux (the official choice) is the default multi-window tool; with cmux and herdr, start tmux inside their window. herdr also supports opening sub-session windows directly as herdr tabs. Orca is being tried out.

## If you already use a Telegram or Discord channel

If you turned on Claude Code's official channel plugins (Telegram · Discord · iMessage · fakechat) for your whole account, that plugin also starts when a kit bot starts and competes for the same token as your existing bot (Telegram drops the existing connection). Row [8] of the health-check table names those bots and plugins. If a bot uses that channel on purpose, put it in that bot's `extra_channels` in the settings (`~/.slackmod/config.json`) and run `install.sh` again (then [8] stops counting it). Otherwise switch it off as shown, in that bot folder's `.claude/settings.local.json` — that switches it off for every Claude window opened in that folder, so if you share the bot folder with other work windows, it is off there too.

## After restarting the computer

The bots do not start by themselves (the kit installs no auto-start). If you restarted the computer or the multi-window tool (tmux etc.) was closed, run `slackmod start all` once in the terminal — the bot windows and the Slack bridges come back. Bridge files left over from the shutdown are cleaned up by the kit at that point. Check with `slackmod status` («켜짐» = on, for each bot).

- To restart just one bot, type the bot's name (e.g. `lead`) in the terminal — if it is running, only that bot's session is stopped, started again as a new conversation, and you are taken into that bot's screen. Slack messages that arrive in the first 30 seconds or so after the start can be missed, so please send them again.
- Sub-sessions that were running at the time end too. A new message in that thread goes to the bot's main window.
- Schedules set inside a bot session (repeating jobs inside the session etc.) disappear with the session — set them again.

## Good to know (preview release)

- **File permissions in the bot window:** the bot window runs with umask 077. Files and folders the bot makes with Bash · git · npm are also «owner only» (600/700) by default, so where another account must read them — a shared team folder, a web server, a Docker volume — widen the permissions of just those files (`chmod`). A shell left in the same window after the bot stops keeps the same setting.
- **The sub-session router's bundled judge (optional · off by default):** when on, each judgement sends the owner's message to the bot (up to 4,000 characters) and the sub-session descriptions to the Anthropic API (Claude API). Put the key in with `slackmod set-judge-key <bot>` — it does not go into the bot's environment, but programs of the same account (the bot's Bash included) can read that key file, so use a judge-only key with a spend limit. Turning the router off leaves the key file in place — to remove it, delete that bot's `~/.slackmod/bots/<bot>/slack/route-judge.key`.
- **A very busy computer:** if the gate that runs in front of each of the bot's tool calls goes over its time limit (7 seconds), that call is refused (even though the gate only lets things through). If a tool call is refused now and then under very heavy load, try again — this will be fixed in a later release.

## Undo

To undo **only the install you just did**, run `slackmod undo` in the terminal — it first shows what will be rolled back. If that looks right, `slackmod undo --yes`. If even one file was edited by hand after the install, it touches nothing, shows the list of those files and stops. Slack tokens (the bot's `slack/.env`) are not rolled back. Undoing the very first install removes mod-for-slack itself, as it was before the install.

To remove mod-for-slack completely: `slackmod stop all` → if there are files you want back, copy them out of `~/.slackmod/backup/<time>/` first (the pre-install copy of your shell settings file is there too, and this folder is inside `~/.slackmod`, so the last step deletes it as well) → delete the `# >>> slackmod >>>` block from your shell settings file (`~/.zshrc` or `~/.bashrc`) → delete the `~/.slackmod` folder (the token and judge-key files go with it). Bot work folders (default `~/bots/<name>`) and the files the wizard put in them (character file · `.claude/settings.json` · `.mcp.json`) stay, so delete them yourself if you no longer need them.

The command (`slackmod`), the install folder (`~/.slackmod`) and the bundle folder (`slackmod/`) keep their earlier names on purpose, so existing installs keep working after the rename to mod-for-slack. Slack apps you already made under the name «SlackMod …» do not need renaming either.

## Words used here

- **Bot** — one Claude Code window connected to one Slack app. You set its name and personality in the wizard.
- **Sub-session** — a new Claude Code window the bot opens to hand over the work of one thread. It works on that thread only and reports back to the bot when it is done.
- **Status board** — the pane beside the bot's screen. It shows what the bot and its sub-sessions are doing right now.
- **Slack bridge** — a small program that passes messages between Slack and the bot's window. Each bot has its own.
- **Tokens** — two password-like values the Slack app gives the bot (`xoxb-` · `xapp-`). Keep them private.
- **Manifest** — a file that fills in the Slack app settings at once (`slackmod/slack-app-manifest.json`).
- **Setup wizard** — the helper that starts when you run `bash install.sh`: it asks, lets you choose and installs, inside Claude Code.
- **Multi-window tool** — a program that keeps several windows in one terminal (tmux etc.). Bots and sub-sessions run there.
- **Owner · guest** — owner = the person who installs the bots and gives them work. Guest = someone the owner allows to talk with the bot in the same channel (conversation and replies only).
- **Mod (CCMOD)** — an add-on that changes how Claude Code looks and behaves. See «Two layers» above.
- **Skill** — a packaged procedure (one file) the bot pulls out for a particular job. You pick them in the wizard's «recommended skills» section.
- **Sub-session router** — an optional feature (off by default) where a judge model picks which sub-session an owner message belongs to.

## License

MIT — [LICENSE](LICENSE). Some bot-personality templates generalize MIT-licensed public templates ([setup/ATTRIBUTIONS.md](setup/ATTRIBUTIONS.md)).
