# Docker Optimization

## Image Size Reduction

### Layer Optimization
```dockerfile
# BAD — each RUN creates a new layer
RUN apt-get update
RUN apt-get install -y curl
RUN apt-get install -y git
RUN rm -rf /var/lib/apt/lists/*

# GOOD — single layer, cleanup in same layer
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        curl \
        git \
    && rm -rf /var/lib/apt/lists/*
```

### Base Image Selection Guide
```
Image                      Size        Use Case
python:3.12               ~1.0 GB     Never in production
python:3.12-slim          ~150 MB     Default Python choice
python:3.12-alpine        ~50 MB      When slim is too large (may have musl issues)
node:20                   ~1.0 GB     Never in production
node:20-slim              ~250 MB     When you need glibc
node:20-alpine            ~180 MB     Default Node.js choice
nginx:1.27-alpine         ~45 MB      Static site serving
gcr.io/distroless/python3 ~50 MB      Maximum security (no shell)
gcr.io/distroless/nodejs  ~130 MB     Maximum security Node.js
```

### Dependency Caching for Faster Builds
```dockerfile
# Python — copy requirements FIRST, then code
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# ^ This layer is cached if requirements.txt hasn't changed
COPY . .
# ^ Only this layer rebuilds on code changes

# Node.js — same pattern
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
```

## Build Speed Optimization

### BuildKit (Always Enable)
```bash
# Enable BuildKit for faster builds
export DOCKER_BUILDKIT=1

# Or in docker compose
# docker-compose.yml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
      # BuildKit is default in modern Docker Compose
```

### Cache Mounts (Persist Package Manager Cache)
```dockerfile
# Python — cache pip downloads between builds
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt

# Node.js — cache npm downloads
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# apt — cache package downloads
RUN --mount=type=cache,target=/var/cache/apt \
    --mount=type=cache,target=/var/lib/apt/lists \
    apt-get update && apt-get install -y curl
```

### Parallel Multi-Stage Builds
```dockerfile
# These stages build IN PARALLEL with BuildKit
FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY frontend/ .
RUN npm ci && npm run build

FROM python:3.12-slim AS backend-builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# Final stage combines both
FROM python:3.12-slim AS production
COPY --from=backend-builder /install /usr/local
COPY --from=frontend-builder /app/dist ./static/
COPY backend/ ./backend/
```

## Runtime Optimization

### Health Checks (Required for Orchestration)
```dockerfile
# Python app
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

# Node.js app
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD node -e "const http = require('http'); http.get('http://localhost:3000/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); });" || exit 1

# Nginx
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:80/health || exit 1
```

### Graceful Shutdown
```dockerfile
# Use exec form for CMD (PID 1 receives signals correctly)
# GOOD — exec form
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

# BAD — shell form (runs under /bin/sh, signals don't reach app)
# CMD uvicorn app.main:app --host 0.0.0.0 --port 8000

# For Python apps, handle SIGTERM:
# In your Python code:
import signal
import sys

def handle_shutdown(signum, frame):
    print("Shutting down gracefully...")
    # Close DB connections, flush queues, etc.
    sys.exit(0)

signal.signal(signal.SIGTERM, handle_shutdown)
```

### Logging Best Practices
```dockerfile
# Always log to stdout/stderr (not files) in containers
# Docker and K8s collect stdout/stderr automatically

# Python — configure logging to stdout
# logging.conf
# handlers: console -> stream=sys.stdout

# Nginx — symlink logs to stdout/stderr (default in official image)
RUN ln -sf /dev/stdout /var/log/nginx/access.log && \
    ln -sf /dev/stderr /var/log/nginx/error.log
```

## Image Scanning and Verification
```bash
# Scan for vulnerabilities before pushing
trivy image --severity HIGH,CRITICAL myapp:1.0.0

# Check image size breakdown
docker history myapp:1.0.0

# Inspect image labels and metadata
docker inspect myapp:1.0.0

# Dive tool — interactive layer explorer
dive myapp:1.0.0
```

## Size Comparison Checklist
```
□ Using slim/alpine base? (saves 500MB-800MB)
□ Multi-stage build? (dev deps not in prod image)
□ .dockerignore excludes everything unnecessary?
□ RUN commands combined? (fewer layers)
□ --no-cache-dir on pip install?
□ npm ci --only=production? (no devDependencies)
□ Cleanup in same RUN layer as install?
□ No unnecessary tools (curl, vim, etc.) in production stage?
```
