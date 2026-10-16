---
name: docker
description: "Dockerfile and docker compose patterns: multi-stage builds, pinned base images, non-root user, healthchecks, named volumes, log rotation, shm_size for Chromium, compose profiles. Use when editing Dockerfile, docker-compose.yml, .dockerignore or debugging containers."
---

# Docker Skill

## Purpose
Comprehensive Docker knowledge for building, running, and optimizing containers for all applications.

## When to Activate
- Creating or editing a Dockerfile
- Writing or modifying docker-compose.yml
- Debugging container issues
- Optimizing image size or build speed
- Setting up local development environments
- Preparing containers for Kubernetes deployment

## Sub-Skills
| File | When to Read |
|------|-------------|
| `dockerfile-patterns.md` | Writing or reviewing any Dockerfile |
| `compose-patterns.md` | Multi-container setups, local development, or simple deployments |
| `optimization.md` | Reducing image size, build time, or runtime performance |

## Also Read
- `security/docker-security.md` — ALWAYS when writing Dockerfiles
- `cost-reducer/code-level-savings.md` — Image size optimization section

## Core Docker Rules
1. **One process per container** — don't run multiple services in one container
2. **Use multi-stage builds** — separate build and runtime stages
3. **Never use :latest in production** — always pin versions with tags
4. **Always have a .dockerignore** — exclude everything not needed for build
5. **Layer ordering matters** — put rarely-changing layers first for cache efficiency
6. **Use HEALTHCHECK** — every production container needs a health check
7. **Non-root user** — always switch to non-root before CMD
8. **Use COPY, not ADD** — ADD has extra features you probably don't need
9. **Combine RUN commands** — fewer layers = smaller image
10. **Always set resource limits** — in compose or K8s, never unlimited

## Quick Reference Commands
```bash
# Build
docker build -t myapp:1.0.0 .
docker build -t myapp:1.0.0 -f docker/Dockerfile .

# Run
docker run -d --name myapp -p 8000:8000 --env-file .env myapp:1.0.0

# Debug
docker logs myapp --tail 100 -f
docker exec -it myapp /bin/sh
docker inspect myapp

# Cleanup
docker system prune -a --volumes    # Nuclear option — removes everything unused
docker image prune -a               # Remove unused images only
docker volume prune                 # Remove unused volumes only

# Registry
docker tag myapp:1.0.0 registry.example.com/myapp:1.0.0
docker push registry.example.com/myapp:1.0.0
```
