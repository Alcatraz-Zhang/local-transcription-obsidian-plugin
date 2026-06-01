# Obsidian Local ASR Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new Obsidian plugin plus Dockerized ASR gateway MVP for local meeting transcription.

**Architecture:** The plugin records or uploads audio, saves vault files, submits `/jobs`, polls status, and creates Markdown notes. The gateway runs as the container main process and starts Qwen3-ASR as an internal child process only when work arrives.

**Tech Stack:** TypeScript, Obsidian API, Vitest, Python, FastAPI, pytest, Docker Compose, Qwen3-ASR.

---

- [x] Create monorepo structure, tests, and package configs.
- [x] Implement gateway formatter, lifecycle manager, `/jobs`, `/health`, and OpenAI-compatible endpoint.
- [x] Implement plugin template, transcript, post-processing, gateway client, settings, and main plugin entry.
- [x] Add Docker Compose, gateway Dockerfile, `.env.example`, README, and pinned upstream reference.
- [x] Run final verification: plugin tests, gateway tests, plugin build, compose config, git status.
