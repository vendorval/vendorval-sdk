# AGENTS.md

This repository follows the guidance in [`CLAUDE.md`](./CLAUDE.md) — it applies to AI coding agents and human contributors alike.

Key points:

- **This repo is public.** Never commit secrets, production data, or internal-only references; keep changelogs and code comments written for SDK consumers.
- Two SDKs — Node (`packages/node`) and Python (`packages/python`) — ship the same surface and must stay at parity.
- Build, test, and release commands and conventions live in [`CLAUDE.md`](./CLAUDE.md), [`CONTRIBUTING.md`](./CONTRIBUTING.md), and [`RELEASING.md`](./RELEASING.md).
