---
name: researcher
description: "Verify before implementing: check current versions, changelogs, engines fields and open issues for libraries (especially whatsapp-web.js, puppeteer, Node LTS status) instead of relying on memory. Use before adding or upgrading a dependency or when an error is unfamiliar."
---

# Researcher Skill

## Purpose
Teaches Claude to research and validate information before implementing. Research is a crucial part of any project. Never assume — always verify.

## When to Activate
- Before using any tool, library, or service Claude hasn't used recently
- When choosing between multiple approaches or technologies
- When implementing security-sensitive functionality
- When dealing with cloud service pricing or limits
- When the user asks "what's the best way to..." or "should I use..."
- Before writing Terraform for a service Claude hasn't provisioned before
- When error messages are unclear or unfamiliar

## Research Workflow
```
1. IDENTIFY what needs validation
   - Is this API/library still maintained?
   - Is this the current best practice?
   - Are there breaking changes in the latest version?
   - What are the actual limits/pricing?

2. CHECK official sources first
   - Official documentation (not blog posts)
   - GitHub repo (check stars, last commit, open issues)
   - Changelog/release notes for recent versions
   - Cloud provider pricing pages

3. VERIFY compatibility
   - Does this work with our stack versions?
   - Are there known conflicts with other dependencies?
   - Does this work on our target OS/architecture (ARM vs x86)?

4. VALIDATE with minimal test
   - Create a small proof-of-concept before full implementation
   - Test the specific feature/API we need, not just "hello world"
   - Verify in an environment matching production

5. DOCUMENT findings
   - What was verified
   - What version/configuration was tested
   - Any gotchas or limitations discovered
```

## Research Checklist by Context

### Before Adding a Dependency
```
□ Is the package actively maintained? (last commit < 6 months)
□ Does it have known security vulnerabilities? (npm audit, pip audit)
□ What's the license? (compatible with our project?)
□ How large is it? (bundle size for frontend, install size for backend)
□ Are there lighter alternatives?
□ What's the minimum version that supports our needs?
```

### Before Choosing a Cloud Service
```
□ What's the actual pricing? (not the marketing page — the pricing calculator)
□ What are the free tier limits?
□ What's the data transfer cost? (often the hidden killer)
□ Is there an equivalent on both AWS and OCI?
□ What's the SLA?
□ How hard is it to migrate away? (vendor lock-in risk)
```

### Before Implementing a Pattern
```
□ Is this still the recommended approach? (check official docs, not 3-year-old blog posts)
□ Are there known issues or gotchas?
□ Does this scale for our expected load?
□ What are the failure modes?
□ How do we monitor/debug this in production?
```

## Red Flags — Stop and Research More
- The approach requires disabling a security feature
- The library hasn't been updated in over a year
- The solution requires admin/root privileges
- The pricing model has "contact sales" instead of clear pricing
- The documentation is sparse or only has "hello world" examples
- Multiple Stack Overflow answers disagree on the approach
- The approach requires a specific cloud provider feature (lock-in risk)

## Source Quality Ranking
```
1. Official documentation (docs.aws.amazon.com, terraform.io/docs)
2. Official GitHub repos (README, issues, discussions)
3. Cloud provider blogs (aws.amazon.com/blogs)
4. Well-known tech blogs (engineering blogs of major companies)
5. Stack Overflow (high-voted recent answers only)
6. Personal blogs (verify claims independently)
7. AI-generated content (treat as unverified — always cross-check)
```
