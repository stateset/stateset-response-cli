# Getting Started

## 1) Install

```bash
npm install -g stateset-response-cli
```

Node.js `18+` is required.

## 2) Run Guided Setup

```bash
response init
```

`response init` will:
- set up authentication (if needed)
- run diagnostics
- optionally configure integrations
- start chat

## 3) Manual Setup (Alternative)

```bash
response auth login
response doctor
response chat
```

## 4) Useful Follow-ups

```bash
response auth status
response integrations status
response integrations setup --from-env --validate-only
```

For full command reference, return to [`README.md`](../README.md).
