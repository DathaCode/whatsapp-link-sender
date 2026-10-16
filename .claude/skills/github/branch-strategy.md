# Branch Strategy (Solo Developer Optimized)

## Recommended: Simplified GitHub Flow

### Branches
```
main          ← Production-ready code. Protected. All deploys from here.
develop       ← Integration branch. New features merge here first.
feature/*     ← New features (branch from develop, merge to develop)
fix/*         ← Bug fixes (branch from develop, merge to develop)
hotfix/*      ← Urgent prod fixes (branch from main, merge to main AND develop)
release/*     ← Release prep (branch from develop, merge to main)
```

### Flow for New Features
```bash
# 1. Create feature branch from develop
git checkout develop
git pull origin develop
git checkout -b feature/user-authentication

# 2. Work on the feature (commit often)
git add .
git commit -m "feat(auth): add JWT token generation"
git commit -m "feat(auth): add login endpoint"
git commit -m "test(auth): add login endpoint tests"

# 3. Push and create PR to develop
git push origin feature/user-authentication
# Create PR: feature/user-authentication → develop

# 4. After CI passes and review, merge to develop
# 5. Delete feature branch
```

### Flow for Hotfixes (Production Emergency)
```bash
# 1. Branch from main
git checkout main
git pull origin main
git checkout -b hotfix/fix-payment-crash

# 2. Fix the issue
git commit -m "hotfix(payment): fix null pointer in checkout flow"

# 3. PR to main (fast-track, skip staging if critical)
# 4. After merge to main, ALSO merge to develop
git checkout develop
git merge main
git push origin develop
```

### Flow for Releases
```bash
# 1. Create release branch from develop
git checkout develop
git checkout -b release/1.2.0

# 2. Final testing, version bumps, changelog updates
git commit -m "chore: bump version to 1.2.0"

# 3. PR to main
# 4. After merge, tag the release
git checkout main
git pull origin main
git tag -a v1.2.0 -m "Release 1.2.0: user authentication feature"
git push origin v1.2.0

# 5. Merge back to develop
git checkout develop
git merge main
git push origin develop
```

## Branch Protection Rules (GitHub Settings)

### Main Branch
```
Settings → Branches → Add rule for "main":

☑ Require a pull request before merging
  ☑ Require approvals: 0 (solo dev — but CI must pass)
☑ Require status checks to pass before merging
  ☑ backend-test
  ☑ frontend-test
  ☑ security-scan
  ☑ docker-build (if applicable)
☑ Require branches to be up to date before merging
☑ Do not allow bypassing the above settings
☐ Require signed commits (optional — recommended)
☑ Do not allow deletions
☑ Do not allow force pushes
```

### Develop Branch
```
Settings → Branches → Add rule for "develop":

☑ Require status checks to pass before merging
  ☑ backend-test
  ☑ frontend-test
☐ Require approvals (not needed for develop)
☑ Do not allow force pushes
```

## Tagging and Releases

### Semantic Versioning
```
v{MAJOR}.{MINOR}.{PATCH}

MAJOR: Breaking changes (v1.0.0 → v2.0.0)
MINOR: New features, backwards compatible (v1.0.0 → v1.1.0)
PATCH: Bug fixes, backwards compatible (v1.0.0 → v1.0.1)

Pre-release: v1.2.0-rc.1, v1.2.0-beta.1
```

### Automated Release with Tags
```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
          draft: false
          prerelease: ${{ contains(github.ref, '-rc') || contains(github.ref, '-beta') }}
```

## Useful Git Commands
```bash
# Undo last commit (keep changes)
git reset --soft HEAD~1

# Amend last commit message
git commit --amend -m "new message"

# Interactive rebase (clean up before PR)
git rebase -i HEAD~3

# Stash work in progress
git stash push -m "WIP: working on auth"
git stash list
git stash pop

# Cherry-pick a commit from another branch
git cherry-pick abc123

# See what changed between branches
git log develop..feature/my-feature --oneline

# Find which commit broke something
git bisect start
git bisect bad          # Current commit is broken
git bisect good v1.0.0  # This version was working
# Git will binary search to find the breaking commit
```
