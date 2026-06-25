# Note Answers

An Obsidian plugin that answers the question at the **end of your current note** by calling
your locally installed [Claude Code](https://claude.com/claude-code) CLI, then **appends** a brief
reply to the note. It never edits your existing content — the CLI is given no write tools; the
plugin does the append.

```
...your note, ending with a question.

---

Claude: <brief answer>

---
```

## How it works

1. You run the command (bind it to a hotkey).
2. The plugin reads the active note (live editor buffer) and passes it to `claude -p` headlessly.
3. The CLI answers the request in the **final part** of the note. If "Explore links" is on, it
   resolves `[[wikilinks]]`, embeds, and URLs in the note for context (read-only).
4. The plugin appends the reply as a `--- / Label: … / ---` block.

Each run is **stateless** — a fresh CLI invocation, not a continuing conversation.

## Requirements

- **Desktop only** (uses Node `child_process` to run a local binary).
- [Claude Code](https://claude.com/claude-code) installed and **authenticated** (`claude` runnable
  from your shell). Verify with `claude --version`.

## Install (via BRAT)

1. Install the **BRAT** community plugin.
2. BRAT → *Add beta plugin* → enter this repo: `rk-37/note-answers`.
3. Enable **Note Answers** in *Settings → Community plugins*.
4. *Settings → Hotkeys* → bind **"Answer the request at the end of this note."**

## Settings

| Setting | Default | Purpose |
|---|---|---|
| Claude CLI path | auto-detect | Absolute path to `claude` (has a **Detect** button). |
| Effort | `low` | Reasoning effort; lower is faster. |
| Fast mode | on | Passes `--settings {"fastMode":true}`. |
| Model | CLI default | Optional model override. |
| Allowed tools | `WebSearch WebFetch Read Grep Glob` | Tools the CLI may use (read-only + web). |
| Explore links | on | Read `[[links]]`/URLs for context. |
| Response label | `Claude` | Prefix on the appended message. |
| Timeout (seconds) | `180` | Abort the call after this long. |

## Privacy & data use

> **This plugin runs your local `claude` CLI and sends the current note — and any linked notes it
> reads — to that CLI, which transmits them to Anthropic for processing.** It may also fetch URLs
> found in the note and perform web searches when enabled. Only use it on notes you are comfortable
> sharing. No data is sent anywhere by the plugin itself other than to the `claude` binary you
> configure.

## License

MIT — see [LICENSE](LICENSE).
