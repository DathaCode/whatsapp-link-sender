---
name: github
description: "Git and GitHub workflow: branches, commits, GitHub Actions CI to typecheck, test and build the Docker image. Use when setting up a repo, writing workflows, or preparing commits/PRs."
---

# GitHub Skill (Git + CI/CD)

## Purpose
Git version control, GitHub workflows, branch strategies, and CI/CD pipelines using GitHub Actions for automated testing, building, and deployment.

## When to Activate
- Setting up a new repository
- Creating or modifying CI/CD pipelines
- Setting up branch protection rules
- Automating any build, test, or deploy process
- Debugging pipeline failures
- Managing releases and versioning

## Sub-Skills
| File | When to Read |
|------|-------------|
| `ci-cd-pipelines.md` | Creating or editing GitHub Actions workflows |
| `branch-strategy.md` | Setting up branch rules and merge strategies |
| `actions-workflows.md` | Reusable workflow patterns and action recipes |

## Also Read
- `security/auth-and-secrets.md` — GitHub Secrets and OIDC section
- `docker/SKILL.md` — Container building in CI

## Core Git Rules
1. **Never commit secrets** — use `.gitignore` and `git-secrets` pre-commit hook
2. **Never force push to main/prod** — use branch protection
3. **Always use pull requests** — even as a solo dev (for CI checks and history)
4. **Write meaningful commit messages** — future you will thank present you
5. **Keep commits atomic** — one logical change per commit
6. **Tag releases** — use semantic versioning (v1.2.3)
7. **Use .gitignore from day one** — template it per language

## Commit Message Format
```
type(scope): short description

Longer description if needed.

Types:
  feat:     New feature
  fix:      Bug fix
  refactor: Code change (no new feature, no bug fix)
  docs:     Documentation
  test:     Adding or updating tests
  ci:       CI/CD changes
  chore:    Build process, dependencies
  perf:     Performance improvement
  security: Security fix

Examples:
  feat(api): add user registration endpoint
  fix(auth): resolve token expiry race condition
  ci(deploy): add staging environment pipeline
  refactor(db): migrate from raw SQL to SQLAlchemy ORM
```

## Essential .gitignore
```gitignore
# Environment
.env
.env.*
!.env.example

# Dependencies
node_modules/
__pycache__/
*.pyc
.venv/
venv/

# IDE
.vscode/settings.json
.idea/
*.swp

# OS
.DS_Store
Thumbs.db

# Build
dist/
build/
*.egg-info/

# Testing
.coverage
htmlcov/
.pytest_cache/
.nyc_output/
coverage/

# Terraform
*.tfstate
*.tfstate.*
.terraform/
*.tfvars
!*.tfvars.example
crash.log

# Docker
docker-compose.override.yml

# Logs
*.log
logs/
```

## Repository Setup Checklist
```
□ .gitignore configured for the stack
□ .env.example with placeholder values
□ README.md with setup instructions
□ LICENSE file
□ Branch protection on main
□ Required CI checks before merge
□ Dependabot enabled for security updates
□ CODEOWNERS file (even for solo — documents ownership)
□ GitHub Secrets configured for CI/CD
□ Issue templates and PR templates
```
