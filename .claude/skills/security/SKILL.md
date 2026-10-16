---
name: security
description: "Security defaults for every change: secrets in .env only, non-root containers, input validation, httpOnly cookie sessions, rate limiting, CSP/security headers, least exposure (127.0.0.1 port binding). Use when writing any code, Dockerfile, compose file, auth flow or anything handling user input."
---

# Security Skill

## Purpose
Teaches Claude to apply security best practices to EVERY piece of code, configuration, and infrastructure it creates. Security is not optional — it is the default.

## When to Activate
- Writing ANY code (backend, frontend, scripts)
- Creating Docker images or compose files
- Writing Terraform infrastructure
- Configuring CI/CD pipelines
- Handling user input, authentication, or data storage
- ANY cloud resource provisioning

## Sub-Skills (Read Before Acting)
| File | When to Read |
|------|-------------|
| `auth-and-secrets.md` | Any time secrets, API keys, tokens, passwords, or auth flows are involved |
| `web-security.md` | Any web application code (React, APIs, endpoints) |
| `docker-security.md` | Any Dockerfile, compose file, or container configuration |
| `cloud-security.md` | Any AWS or Oracle Cloud resource provisioning |

## Universal Security Rules (Apply Always)
1. **Never hardcode secrets** — use environment variables, vault, or cloud secret managers
2. **Never run as root** — in containers, K8s pods, or cloud instances
3. **Always use HTTPS/TLS** — no exceptions in staging or production
4. **Always validate input** — on both client and server side
5. **Always use least privilege** — IAM roles, K8s RBAC, file permissions
6. **Always scan dependencies** — use `pip audit`, `npm audit`, or GitHub Dependabot
7. **Always tag and version** — never use `latest` tag in production
8. **Always encrypt at rest and in transit** — databases, S3 buckets, secrets
9. **Never expose internal services** — use private subnets, internal load balancers
10. **Always log security events** — auth failures, permission denials, rate limit hits

## Quick Security Checklist (Run Mentally Before Every Output)
```
□ Are there any hardcoded secrets? → Move to secrets manager
□ Is the container running as root? → Add USER directive
□ Are ports unnecessarily exposed? → Close them
□ Is input validated and sanitized? → Add validation
□ Are dependencies pinned to versions? → Pin them
□ Is TLS/HTTPS configured? → Enable it
□ Are IAM permissions too broad? → Narrow them
□ Are security headers set? → Add them
□ Is logging enabled for auth events? → Enable it
□ Is CORS configured correctly? → Restrict origins
```
