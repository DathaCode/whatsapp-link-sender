# How to use this skills pack with Claude Code

## Layout

```
stdrd/
├── CLAUDE.md                        ← installed copy (Claude Code reads this automatically)
├── .claude/skills/<name>/SKILL.md   ← installed skills (auto-discovered by Claude Code)
├── claude-code-skills/
│   ├── sync-skills.ps1              ← copies the pack below into CLAUDE.md + .claude/skills
│   └── claude-code-skills/          ← SOURCE: edit files here
│       ├── CLAUDE.md
│       ├── PROMPTING-GUIDE.md
│       ├── project-memory/          ← living project memory (decisions, gotchas, status)
│       ├── whatsapp-web-js/
│       ├── node-express-backend/
│       ├── sqlite/
│       ├── docker/  react/  typescript/
│       ├── security/  researcher/  self-healing/
│       └── cost-reducer/  github/
└── wa-link-sender/                  ← the app
```

Each skill folder has a `SKILL.md` with YAML front matter (`name`, `description`). Claude uses the
description to decide when to load it. Extra `.md` files in a folder are sub-guides that SKILL.md points to.

## Editing skills
1. Edit files under `claude-code-skills/claude-code-skills/`.
2. Run `powershell -File stdrd/claude-code-skills/sync-skills.ps1` to install them.
3. Start a new Claude Code session in `stdrd/` (skills are discovered at session start).

## Prompts that work well

**Start of a session**
```
Read the project-memory skill and wa-link-sender/README.md, then tell me the current status and open items.
```

**Fix a bug**
```
The QR code no longer appears after `docker compose up -d`. Follow self-healing and whatsapp-web-js:
reproduce it, find the root cause, fix it, verify the container is healthy, and record the gotcha in project-memory.
```

**Upgrade the WhatsApp library**
```
Use the researcher skill to check the latest whatsapp-web.js release and open issues. Upgrade if it's safe,
rebuild, verify the QR and a restart, and update project-memory with the version and date.
```

**Add a feature**
```
Add <feature> to wa-link-sender. Follow node-express-backend, sqlite (new migration, don't edit old ones),
react and security. Add tests, update README and .env.example if config changes, and update project-memory.
```

**Prepare for the Linux server**
```
Follow docker and security. Walk me through deploying to Ubuntu with the proxy profile for <domain>,
including backups of the volumes. Don't change code unless needed.
```

## Tips
- Ask for verification explicitly ("prove it works": tests, healthy container, curl /healthz).
- When Claude learns something non-obvious, ask it to put it in `project-memory` so the next session knows.
- Keep secrets out of prompts. Refer to "the ACCESS_KEY in .env" instead of pasting values.
