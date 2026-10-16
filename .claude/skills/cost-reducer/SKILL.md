---
name: cost-reducer
description: "Keep running costs at zero or minimal: free tiers, smallest viable server, no paid SaaS, small images and logs with rotation. Use when choosing hosting, services, or anything that could add recurring cost."
---

# Cost Reducer Skill

## Purpose
Teaches Claude to find cost optimization opportunities in code, infrastructure, and services. Critical for a solo developer paying for everything.

## When to Activate
- Provisioning ANY cloud resource (AWS or OCI)
- Choosing instance sizes, storage types, or service tiers
- Designing architecture for a new application
- Reviewing existing infrastructure
- When the user mentions budget, cost, or saving
- Before every `terraform apply` on production

## Sub-Skills
| File | When to Read |
|------|-------------|
| `cloud-and-infra.md` | Any cloud resource provisioning or architecture decision |
| `services-and-finops.md` | Choosing between managed services, SaaS tools, pricing tiers |
| `code-level-savings.md` | Code optimizations that reduce compute/bandwidth/storage costs |

## Core Cost Rules
1. **Start small, scale up** — never over-provision. Use the smallest viable instance/tier
2. **Use free tiers first** — both AWS and OCI have generous free tiers
3. **Spot/Preemptible for non-critical** — dev/staging/batch jobs should use spot instances
4. **Right-size everything** — monitor actual usage and downsize over-provisioned resources
5. **Automate shutdown** — dev/staging environments should auto-stop outside work hours
6. **Choose region wisely** — pricing varies by region, pick the cheapest that meets latency needs
7. **Reserved > On-Demand** — for stable production workloads, commit for 1-3 years
8. **Serverless for spiky loads** — Lambda/Functions for unpredictable traffic patterns
9. **Delete unused resources** — orphaned EBS volumes, old snapshots, unused EIPs cost money
10. **Monitor daily** — set up billing alerts before you start spending

## Quick Cost Check (Before Any Provisioning)
```
□ Is this the smallest instance that meets requirements?
□ Can this use spot/preemptible instances?
□ Is auto-scaling configured (scale down, not just up)?
□ Are dev/staging resources scheduled to stop after hours?
□ Is this covered by free tier?
□ Are billing alerts configured?
□ Is there a cheaper region that meets latency needs?
□ Can this be serverless instead of always-on?
```
