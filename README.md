# check-your-api

Batch availability checker for OpenAI-compatible APIs.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Z1rconium/check-your-api)

[简体中文](./README.zh-CN.md)

## Overview

`check-your-api` is a small web UI for validating whether models exposed by an OpenAI-compatible endpoint are actually callable.

It can now run in two modes with the same feature set:

- deploy to `Vercel`
- run as a regular Node server with `npm run start`

It does two things:

- fetches models from `GET /models`
- sends concurrent probe requests to `POST /chat/completions`

Each model is marked as either:

- `Available`
- `Unavailable`

No response content is shown in the UI, but available models also show first-token latency.

## Features

- OpenAI-compatible API model discovery
- Batch availability checking
- Configurable concurrency
- Custom request content
- Same-origin API layer to avoid browser CORS issues
- First-token latency for available models
- Form persistence via `localStorage`

## Screenshot-Level Behavior

The UI includes:

- `API Base URL`
- `API Key`
- `Concurrency`
- `Request Content`
- `Fetch Models`
- `Batch Check`

The request content defaults to `Hi`.

## How It Works

The browser never calls the target API directly.

Instead:

1. the frontend sends requests to `/api/models` and `/api/check`
2. the server layer forwards them to the target API
3. the UI updates each model status based on success or failure

Probe requests use this shape:

```json
{
  "model": "model-id",
  "messages": [
    {
      "role": "user",
      "content": "Hi"
    }
  ],
  "stream": true,
  "temperature": 0,
  "max_tokens": 64
}
```

If the upstream request succeeds, the model is treated as available.
If the upstream emits streamed text, the UI also shows the first-token latency.

## Requirements

- Node.js 18+
- npm

## Quick Start

Install dependencies:

```bash
npm install
```

Run in development mode:

```bash
npm run dev
```

Default local addresses:

- frontend: `http://127.0.0.1:5173`
- proxy: `http://127.0.0.1:8787`

## Production

### Run on a regular server

Build:

```bash
npm run build
```

Start:

```bash
npm run start
```

Override the server port if needed:

```bash
PORT=3000 npm run start
```

### Deploy to Vercel

This repo now includes:

- `api/models.ts`
- `api/check.ts`
- `vercel.json`

Deploy steps:

```bash
vercel
```

Or import the repo in the Vercel dashboard directly.

Vercel will:

- build the frontend from `dist`
- expose `/api/models`
- expose `/api/check`

No extra rewrite or proxy config is required.

## API Compatibility

This project assumes the target service exposes:

- `GET {baseUrl}/models`
- `POST {baseUrl}/chat/completions`

Example base URLs:

```text
https://api.openai.com/v1
https://your-provider.example.com/v1
```

## Project Structure

```text
.
├── api/
│   ├── check.ts
│   └── models.ts
├── server/
│   ├── app.ts
│   ├── core.ts
│   └── index.ts
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   └── styles.css
├── vite.config.ts
└── package.json
```

## Notes

- Higher concurrency is not always better. It can trigger upstream rate limits or gateway protection.
- The API key is stored in browser `localStorage` for convenience.
- A model appearing in `/models` does not guarantee it is actually callable.
- Results do not show response bodies, only availability and first-token latency.

## Roadmap

- export results as `csv` or `json`
- show optional failure details
- add retry and rate-limit strategies
- support more probe types beyond chat completions

## License

No `LICENSE` file has been added yet.
