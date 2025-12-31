# Windows Telemetry Dashboard

Web dashboard and lightweight Windows agent for collecting CPU, memory, disk, process, and event-log data. The dashboard is built with Next.js and designed for deployment on Vercel. The Python agent runs on Windows hosts and periodically sends telemetry to the dashboard.

## Prerequisites

- Node.js 18+
- npm 9+
- Windows hosts need PowerShell, WMIC, and Python 3.9+.

## Local Development

Install dependencies and start the dev server:

```bash
npm install
npm run dev
```

Visit `http://localhost:3000` to view the dashboard. The API and dashboard use an ingest secret to authenticate incoming telemetry. Set a custom secret in `.env.local`:

```bash
echo "INGEST_SECRET=super-secret-token" >> .env.local
```

## Deploying to Vercel

1. Push this repository to GitHub/GitLab.
2. Create a Vercel project and import the repo.
3. Add `INGEST_SECRET` as an environment variable in the Vercel dashboard.
4. Deploy. The production dashboard will be available at `https://agentic-dfa9917c.vercel.app`.

## Python Agent

The agent lives in `agent/python_agent/collector.py`. It gathers metrics using built-in Windows tooling and posts snapshots to the ingest API.

### Configuration

Environment variables:

- `INGEST_URL` (default `http://localhost:3000/api/ingest`)
- `INGEST_SECRET` (default `dev-secret`)
- `AGENT_ID` (defaults to Windows `hostname`)
- `INGEST_INTERVAL` seconds between samples (default `30`)
- `MAX_PROCESSES` number of processes to include (default `15`)
- `MAX_EVENTS` number of recent event logs (default `20`)

### Running on Windows

```powershell
setx INGEST_URL "https://agentic-dfa9917c.vercel.app/api/ingest"
setx INGEST_SECRET "super-secret-token"

python collector.py
```

Leave the process running as a scheduled task or service for continuous reporting.

## API Overview

- `POST /api/ingest`: accepts JSON payloads from agents. Authenticated via `X-Ingest-Secret`.
- `GET /api/metrics`: returns the latest telemetry snapshot for all agents.

The in-memory store keeps up to 60 recent samples per agent on each serverless instance. For persistent storage, connect the ingest handler to a database or queue.
