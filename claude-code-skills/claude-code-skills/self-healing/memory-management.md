# Memory Management

## Purpose
Tracks what Claude has learned during the current session to avoid repeating mistakes and to build on successful patterns.

## Session Memory Rules

### What to Remember
1. **Environment Details**: OS, installed tools, versions discovered during the session
2. **Working Paths**: Project structure, important file locations
3. **Successful Patterns**: Commands that worked, configurations that were correct
4. **Failed Approaches**: What was tried and why it failed (to avoid retrying)
5. **User Preferences**: Coding style, naming conventions, tool preferences expressed
6. **Credentials Context**: Which secrets/configs are needed (NOT the values themselves)

### What to NEVER Remember
1. Actual secret values, passwords, tokens
2. Personal data not relevant to the task

## Session Knowledge Tracking Format

When working on a complex task, Claude should mentally maintain:

```
PROJECT CONTEXT:
- Name: [project name]
- Stack: [languages, frameworks]
- Cloud: [AWS/OCI resources in use]
- Repo: [GitHub repo location]

ENVIRONMENT:
- Node version: [discovered version]
- Python version: [discovered version]
- Docker version: [discovered version]
- Chromium version (in image): [discovered version]
- whatsapp-web.js version: [pinned version]

WHAT WORKED:
- [Approach A for problem X]
- [Configuration Y for service Z]

WHAT FAILED (DO NOT RETRY):
- [Approach B for problem X — failed because...]
- [Configuration W for service Z — failed because...]

USER PREFERENCES DISCOVERED:
- [Prefers X over Y]
- [Uses naming convention Z]
```

## Cross-Project Learning

### When the user starts a new project, carry forward:
1. Their cloud infrastructure patterns (VPC layout, security groups)
2. Their Docker base image preferences
3. Their CI/CD pipeline structure
4. Their monitoring and logging setup
5. Their naming conventions

### When the user returns to an existing project:
1. Read existing config files first (package.json, pyproject.toml, terraform.tfvars)
2. Check existing CI/CD workflows to understand the pipeline
3. Look at existing Dockerfiles to match the pattern
4. Check git history for recent changes and conventions

## Error Memory

### After any error, log mentally:
```
ERROR LOG:
- Error: [exact error message]
- Context: [what was being done]
- Root Cause: [identified cause]
- Fix Applied: [what fixed it]
- Prevention: [how to avoid in future]
```

### Before attempting any fix, check:
1. Have I seen this error before in this session?
2. Did a previous fix for a similar error work?
3. Am I about to retry something that already failed?

## Cleanup Memory

### Track resources created during the session:
```
RESOURCES CREATED:
- Docker images: [list]
- K8s resources: [list]
- Cloud resources: [list]
- Temp files: [list]

AT SESSION END OR USER REQUEST:
- Clean up temp files
- Note any resources that need manual cleanup
- Warn about any running services that cost money
```
