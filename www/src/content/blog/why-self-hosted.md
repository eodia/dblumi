---
title: "Why we chose self-hosted over SaaS"
description: "Cloud SQL clients are convenient — until they're not. Here's why dblumi is self-hosted by design, not by compromise."
date: 2026-04-14
author: "Marc Jamain"
tags: ["philosophy", "self-hosted", "security"]
---

Every few months, another cloud-based database tool launches with a slick UI and a free tier. And every few months, the same question comes up in security reviews: *"Wait, our production credentials are where?"*

dblumi is self-hosted by design. Not because we couldn't build a SaaS — but because we think it's the wrong model for a SQL client.

## The problem with cloud SQL clients

When you use a hosted SQL client, your database credentials live on someone else's servers. Your queries — which often contain business logic, customer data patterns, and internal naming conventions — travel through infrastructure you don't control.

For personal projects, that's fine. For a team running production queries on sensitive data, it's a non-starter in many industries.

## What self-hosted gives you

- **Zero data exposure** — credentials are encrypted at rest (AES-256-GCM) on your own machine
- **Compliance by default** — no third-party data processing agreements needed
- **Network isolation** — the app runs inside your VPN, firewall, or private subnet
- **Full control** — you own the upgrade schedule, the backup strategy, the retention policy

## But what about convenience?

Self-hosting used to mean "spend a week configuring Nginx". With dblumi, it's one command:

```bash
docker run -p 5173:5173 eodia/dblumi
```

That's it. The app starts, you create an account, add a connection. No DNS to configure, no reverse proxy required for local use. For production, a `docker-compose.yml` with Traefik or Caddy takes about 10 minutes.

## The AI angle

dblumi's copilot uses **your API keys** to talk directly to Claude, GPT, or a local Ollama instance. The prompts go straight from your server to the provider — dblumi never sees them. Compare that to hosted tools where your schema context is processed on their backend.

## Open source as a trust mechanism

dblumi is AGPL-3.0. You can read every line of code, audit the encryption, verify that credentials are never logged. That's not a marketing claim — it's a verifiable fact.

We believe the best SQL client is one your security team can approve without a 3-month procurement process.

---

Try it yourself: [get started](/dblumi/guides/installation/) or check the [source on GitHub](https://github.com/eodia/dblumi).
