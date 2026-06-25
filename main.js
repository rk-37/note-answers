'use strict';

const { Plugin, PluginSettingTab, Setting, Notice, MarkdownView } = require('obsidian');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_SETTINGS = {
  claudePath: '',                               // empty = auto-detect / rely on PATH
  effort: 'low',                                // low effort = faster
  fastMode: true,                               // pass --settings {"fastMode":true}
  model: '',                                    // empty = CLI default
  allowedTools: 'WebSearch WebFetch Read Grep Glob',
  followLinks: true,
  responseLabel: 'Claude',
  timeoutSec: 180,
};

const RULES_BASE = [
  'You are invoked headlessly to APPEND a brief answer to the end of an Obsidian note.',
  'Strict rules:',
  '- Do NOT edit, rewrite, or reformat any existing note content. You have no write tools; do not try.',
  '- The user called you to answer the request written in the FINAL part of the note.',
  '- Be VERY brief and to the point — a few sentences at most, ideally fewer. Dense, no filler.',
  '- Output ONLY the message body text. No label prefix, no surrounding ---, no headings,',
  '  no preamble, no restating the question, no markdown code fences unless truly essential.',
];

const RULES_LINKS = [
  '- If the note contains links relevant to the question, EXPLORE them for context first:',
  '    * [[wikilinks]] / ![[embeds]] / note links -> use Glob/Grep to locate the vault note by name, then Read it.',
  '    * external URLs -> WebFetch them.',
  '  One hop is usually enough; stay fast.',
  '- Use WebSearch for current facts when the note alone is insufficient.',
];

function candidateClaudePaths() {
  const home = os.homedir();
  return [
    path.join(home, '.local', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    '/usr/bin/claude',
  ];
}

function detectClaudePath() {
  for (const c of candidateClaudePaths()) {
    try { if (fs.existsSync(c)) return c; } catch (e) { /* ignore */ }
  }
  return null;
}

function buildEnv() {
  const home = os.homedir();
  const extra = [
    path.join(home, '.local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ].join(':');
  return Object.assign({}, process.env, { PATH: extra + ':' + (process.env.PATH || '') });
}

module.exports = class NoteAnswersPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.addCommand({
      id: 'append-answer',
      name: 'Answer the request at the end of this note',
      callback: () => this.run(),
    });
    this.addSettingTab(new NoteAnswersSettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  resolveClaudePath() {
    const configured = (this.settings.claudePath || '').trim();
    if (configured) return configured;
    return detectClaudePath() || 'claude'; // last resort: rely on PATH
  }

  vaultBasePath() {
    const a = this.app.vault.adapter;
    if (typeof a.getBasePath === 'function') return a.getBasePath();
    return a.basePath;
  }

  buildPrompt(notePath, content) {
    return [
      'Here is an Obsidian note. The user has written a question or request in the FINAL part of',
      'the note (last lines / last section). Answer it concisely.',
      '',
      '<note path="' + notePath + '">',
      content,
      '</note>',
      '',
      'Output ONLY your answer message. Be very brief.',
    ].join('\n');
  }

  buildRules() {
    const r = this.settings.followLinks ? RULES_BASE.concat(RULES_LINKS) : RULES_BASE.slice();
    return r.join('\n');
  }

  async run() {
    const file = this.app.workspace.getActiveFile();
    if (!file) { new Notice('Note Answers: no active note.'); return; }

    // Prefer the live editor buffer so an unsaved trailing question is included.
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const content = view ? view.editor.getValue() : await this.app.vault.read(file);

    const notice = new Notice('Claude is thinking…', 0);

    const tools = (this.settings.allowedTools || '').split(/[\s,]+/).filter(Boolean);
    const args = [
      '-p', this.buildPrompt(file.path, content),
      '--append-system-prompt', this.buildRules(),
      '--effort', this.settings.effort || 'low',
    ];
    if (this.settings.fastMode) args.push('--settings', '{"fastMode":true}');
    if ((this.settings.model || '').trim()) args.push('--model', this.settings.model.trim());
    if (tools.length) args.push('--allowedTools', ...tools); // variadic: keep last

    const child = execFile(this.resolveClaudePath(), args, {
      cwd: this.vaultBasePath(),
      env: buildEnv(),
      timeout: Math.max(10, Number(this.settings.timeoutSec) || 180) * 1000,
      maxBuffer: 16 * 1024 * 1024,
    }, async (err, stdout, stderr) => {
      notice.hide();
      if (err) {
        console.error('[note-answers]', err, stderr);
        const hint = /ENOENT/.test(String(err))
          ? ' (claude binary not found — set its path in plugin settings)'
          : '';
        new Notice('Note Answers failed: ' + ((stderr && stderr.trim()) || err.message) + hint, 9000);
        return;
      }
      const msg = (stdout || '').trim();
      if (!msg) { new Notice('Note Answers: empty response.'); return; }

      // The plugin owns formatting + the append. The CLI only produced <msg>.
      const label = (this.settings.responseLabel || 'Claude').trim();
      const block = '\n' + label + ': ' + msg + '\n';
      await this.app.vault.append(file, block);
      new Notice('Note answered.');
    });

    // The note is passed via -p, not stdin; close stdin so the CLI doesn't wait for piped input.
    if (child.stdin) child.stdin.end();
  }
};

class NoteAnswersSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Claude CLI path')
      .setDesc('Absolute path to the `claude` executable. Leave empty to auto-detect / use PATH.')
      .addText((t) => t
        .setPlaceholder('auto-detect')
        .setValue(this.plugin.settings.claudePath)
        .onChange(async (v) => { this.plugin.settings.claudePath = v.trim(); await this.plugin.saveSettings(); }))
      .addButton((b) => b
        .setButtonText('Detect')
        .onClick(async () => {
          const found = detectClaudePath();
          if (found) {
            this.plugin.settings.claudePath = found;
            await this.plugin.saveSettings();
            new Notice('Found: ' + found);
            this.display();
          } else {
            new Notice('Could not auto-detect claude. Set the path manually.');
          }
        }));

    new Setting(containerEl)
      .setName('Effort')
      .setDesc('Reasoning effort for the CLI call. Lower is faster.')
      .addDropdown((d) => d
        .addOptions({ low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' })
        .setValue(this.plugin.settings.effort)
        .onChange(async (v) => { this.plugin.settings.effort = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Fast mode')
      .setDesc('Pass --settings {"fastMode":true} for faster output (Opus models).')
      .addToggle((t) => t
        .setValue(this.plugin.settings.fastMode)
        .onChange(async (v) => { this.plugin.settings.fastMode = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Model')
      .setDesc('Optional model override (alias or full id). Empty = CLI default.')
      .addText((t) => t
        .setPlaceholder('default')
        .setValue(this.plugin.settings.model)
        .onChange(async (v) => { this.plugin.settings.model = v.trim(); await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Allowed tools')
      .setDesc('Space/comma separated tools the CLI may use. Read-only + web is recommended.')
      .addText((t) => t
        .setValue(this.plugin.settings.allowedTools)
        .onChange(async (v) => { this.plugin.settings.allowedTools = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Explore links')
      .setDesc('Instruct the model to read [[links]] / URLs in the note for context.')
      .addToggle((t) => t
        .setValue(this.plugin.settings.followLinks)
        .onChange(async (v) => { this.plugin.settings.followLinks = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Response label')
      .setDesc('Prefix for the appended message, e.g. "Claude".')
      .addText((t) => t
        .setValue(this.plugin.settings.responseLabel)
        .onChange(async (v) => { this.plugin.settings.responseLabel = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Timeout (seconds)')
      .setDesc('Abort the CLI call after this many seconds.')
      .addText((t) => t
        .setValue(String(this.plugin.settings.timeoutSec))
        .onChange(async (v) => {
          const n = parseInt(v, 10);
          this.plugin.settings.timeoutSec = isNaN(n) ? 180 : n;
          await this.plugin.saveSettings();
        }));

    const disc = containerEl.createEl('p', {
      text: 'Privacy: this plugin runs your local `claude` CLI and sends the current note (and any '
        + 'linked notes it reads) to that CLI, which transmits them to Anthropic. Only use it on '
        + 'notes you are comfortable sharing.',
    });
    disc.addClass('note-answers-disclaimer');
  }
}
