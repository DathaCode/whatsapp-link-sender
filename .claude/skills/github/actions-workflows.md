# GitHub Actions Workflow Patterns

## Reusable Workflow (Call from Multiple Repos)
```yaml
# .github/workflows/reusable-docker-build.yml
name: Reusable Docker Build

on:
  workflow_call:
    inputs:
      image_name:
        required: true
        type: string
      dockerfile:
        required: false
        type: string
        default: "Dockerfile"
    secrets:
      AWS_ROLE_ARN:
        required: true

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    outputs:
      image_tag: ${{ steps.meta.outputs.tags }}

    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: us-east-1

      - name: Login to ECR
        id: ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Docker meta
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ steps.ecr.outputs.registry }}/${{ inputs.image_name }}
          tags: |
            type=sha,prefix=
            type=ref,event=branch
            type=semver,pattern={{version}}

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          file: ${{ inputs.dockerfile }}
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

# Usage in another workflow:
# jobs:
#   build:
#     uses: ./.github/workflows/reusable-docker-build.yml
#     with:
#       image_name: myapp
#     secrets:
#       AWS_ROLE_ARN: ${{ secrets.AWS_ROLE_ARN }}
```

## Cache Patterns (Speed Up Builds)
```yaml
# Python pip cache
- uses: actions/setup-python@v5
  with:
    python-version: "3.12"
    cache: 'pip'                    # Built-in cache support

# Node.js npm cache
- uses: actions/setup-node@v4
  with:
    node-version: "20"
    cache: 'npm'
    cache-dependency-path: frontend/package-lock.json

# Docker layer cache
- uses: docker/build-push-action@v5
  with:
    cache-from: type=gha
    cache-to: type=gha,mode=max

# Terraform plugin cache
- uses: actions/cache@v4
  with:
    path: ~/.terraform.d/plugin-cache
    key: terraform-${{ hashFiles('**/.terraform.lock.hcl') }}

# Generic custom cache
- uses: actions/cache@v4
  with:
    path: |
      ~/.cache/some-tool
      ./node_modules
    key: ${{ runner.os }}-build-${{ hashFiles('**/lockfile') }}
    restore-keys: |
      ${{ runner.os }}-build-
```

## Scheduled Workflows
```yaml
# .github/workflows/scheduled.yml
name: Scheduled Tasks

on:
  schedule:
    - cron: '0 6 * * MON'    # Every Monday 6 AM UTC

jobs:
  # Security audit
  security-audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pip install pip-audit && pip-audit -r requirements.txt
      - run: cd frontend && npm audit

  # Terraform drift detection
  drift-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3
      - name: Check for drift
        working-directory: infrastructure/environments/prod
        run: |
          terraform init
          terraform plan -detailed-exitcode
          # Exit code 2 means drift detected
```

## Notification on Failure
```yaml
# Add to any workflow job
steps:
  # ... your steps ...

  - name: Notify on failure
    if: failure()
    uses: slackapi/slack-github-action@v1
    with:
      payload: |
        {
          "text": "❌ Pipeline failed: ${{ github.workflow }} on ${{ github.ref }}\n${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}"
        }
    env:
      SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK }}
```

## Path-Based Triggers (Only Run What Changed)
```yaml
on:
  push:
    branches: [main]
    paths:
      - 'backend/**'           # Only run when backend changes
      - 'requirements*.txt'
      - 'Dockerfile'

# Or with path-ignore
on:
  push:
    paths-ignore:
      - '**.md'                # Don't run CI for docs changes
      - '.github/dependabot.yml'
      - 'LICENSE'
```

## Matrix Builds (Test Multiple Versions)
```yaml
jobs:
  test:
    strategy:
      fail-fast: false          # Don't cancel others if one fails
      matrix:
        python-version: ["3.11", "3.12"]
        os: [ubuntu-latest]
        # Optional: include specific combinations
        include:
          - python-version: "3.12"
            os: macos-latest

    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/setup-python@v5
        with:
          python-version: ${{ matrix.python-version }}
```

## Environment Protection Rules
```yaml
# In your workflow — reference protected environments
jobs:
  deploy-prod:
    environment: production     # Requires approval in GitHub Settings
    runs-on: ubuntu-latest

# GitHub Settings → Environments → production:
# ☑ Required reviewers: your-username
# ☑ Wait timer: 5 minutes (time to cancel if mistake)
# ☑ Deployment branches: main only
```

## Useful Actions Cheat Sheet
```yaml
# Get short SHA for tagging
- name: Get short SHA
  id: sha
  run: echo "short=$(git rev-parse --short HEAD)" >> $GITHUB_OUTPUT

# Set output for other jobs
- name: Set version
  id: version
  run: echo "version=$(cat VERSION)" >> $GITHUB_OUTPUT

# Use in another step
- name: Use version
  run: echo "Deploying version ${{ steps.version.outputs.version }}"

# Conditional step
- name: Only on main
  if: github.ref == 'refs/heads/main'
  run: echo "This is main branch"

# Upload/download artifacts between jobs
- uses: actions/upload-artifact@v4
  with:
    name: build-output
    path: dist/
    retention-days: 5

- uses: actions/download-artifact@v4
  with:
    name: build-output
    path: dist/
```
