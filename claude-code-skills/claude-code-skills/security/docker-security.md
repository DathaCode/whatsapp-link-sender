# Docker Security

## Dockerfile Security Rules

### 1. Never Run as Root
```dockerfile
# ALWAYS add a non-root user
FROM python:3.12-slim

RUN groupadd -r appuser && useradd -r -g appuser -d /app -s /sbin/nologin appuser

WORKDIR /app
COPY --chown=appuser:appuser . .

# Switch to non-root BEFORE CMD
USER appuser
CMD ["python", "main.py"]
```

### 2. Use Multi-Stage Builds (Minimize Attack Surface)
```dockerfile
# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

# Stage 2: Production (minimal image)
FROM node:20-alpine AS production
RUN addgroup -S appuser && adduser -S appuser -G appuser
WORKDIR /app

# Copy ONLY what's needed
COPY --from=builder --chown=appuser:appuser /app/dist ./dist
COPY --from=builder --chown=appuser:appuser /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appuser /app/package.json ./

USER appuser
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### 3. Pin Base Image Versions
```dockerfile
# BAD — unpredictable
# FROM python:latest
# FROM node:alpine

# GOOD — pinned and reproducible
FROM python:3.12.4-slim-bookworm
FROM node:20.15.0-alpine3.20

# BEST — pin by digest for critical production images
FROM python:3.12.4-slim-bookworm@sha256:abc123...
```

### 4. Never Put Secrets in Docker Images
```dockerfile
# BAD — secrets baked into image layers
# ENV API_KEY=sk-12345
# COPY .env .
# ARG DB_PASSWORD

# GOOD — inject at runtime
# docker run -e API_KEY=$API_KEY myapp
# docker run --env-file .env myapp (local dev only)

# For build-time secrets (e.g., private npm registry):
# Use BuildKit secrets mount
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm ci
```

### 5. Minimize Image Contents
```dockerfile
# Use .dockerignore to exclude unnecessary files
# .dockerignore
.git
.github
node_modules
.env
.env.*
*.md
tests/
__pycache__
.pytest_cache
.coverage
docker-compose*.yml
```

### 6. Scan Images for Vulnerabilities
```bash
# Using Trivy (recommended)
trivy image myapp:latest

# In CI/CD pipeline
trivy image --exit-code 1 --severity HIGH,CRITICAL myapp:latest

# Using Docker Scout
docker scout cves myapp:latest
```

## Docker Compose Security

### Production Compose Patterns
```yaml
services:
  app:
    image: myregistry/myapp:1.2.3    # Pinned version, never :latest
    read_only: true                    # Read-only filesystem
    tmpfs:
      - /tmp                           # Writable tmp only where needed
    security_opt:
      - no-new-privileges:true         # Prevent privilege escalation
    cap_drop:
      - ALL                            # Drop all capabilities
    cap_add:
      - NET_BIND_SERVICE               # Add back only what's needed
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 512M                 # Prevent memory bombs
        reservations:
          cpus: '0.25'
          memory: 128M
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

### Network Isolation
```yaml
services:
  frontend:
    networks:
      - frontend-net

  api:
    networks:
      - frontend-net       # Can talk to frontend
      - backend-net        # Can talk to database

  database:
    networks:
      - backend-net        # ONLY backend — not reachable from frontend

networks:
  frontend-net:
    driver: bridge
  backend-net:
    driver: bridge
    internal: true         # No external access
```

## Docker Runtime Security
```bash
# Never run with --privileged in production
# Never mount docker.sock unless absolutely necessary
# Never use --net=host in production

# Use read-only root filesystem
docker run --read-only --tmpfs /tmp myapp:1.2.3

# Drop capabilities
docker run --cap-drop=ALL --cap-add=NET_BIND_SERVICE myapp:1.2.3

# Set resource limits
docker run --memory=512m --cpus=1.0 myapp:1.2.3
```

## Image Registry Security
```bash
# Always use private registries for production images
# AWS ECR
aws ecr get-login-password | docker login --username AWS --password-stdin ACCOUNT.dkr.ecr.REGION.amazonaws.com

# Enable image scanning on push
aws ecr put-image-scanning-configuration \
  --repository-name myapp \
  --image-scanning-configuration scanOnPush=true

# OCI Container Registry
docker login REGION.ocir.io -u TENANCY/USERNAME
```
