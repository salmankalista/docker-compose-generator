# ComposeForge — Simple Docker Compose Generator

A lightweight, zero-dependency web application built with vanilla HTML, CSS, and JavaScript to visually build and export clean `docker-compose.yml` and `.env` files.

## Features

- **Quick-Add Service Templates (23 templates)**: Nginx, Caddy, Traefik, HAProxy, Node.js, Python/FastAPI, Go, PHP-FPM, PostgreSQL, MySQL, MariaDB, MongoDB, Redis, RabbitMQ, MinIO (S3), Qdrant, Ollama, Prometheus, Grafana, Adminer, pgAdmin 4, Mailpit, and Custom services with category & search filtering.
- **Starter Pack Templates (20 stacks)**: Browseable Starter Packs modal & grouped quick selector covering Backend & Load Balancing (Node, FastAPI, Django+Celery, Go, Laravel, Nginx Load Balancer + 3 API Replicas, HAProxy Load Balancer + 2 Backends, Caddy Multi-Backend Gateway), Fullstack & CMS (Next.js, MERN, WordPress, Ghost, Static Nginx), Data & AI (n8n, Ollama+Open WebUI, AI RAG, MinIO+Postgres), and Observability & Queues (Prometheus+Grafana, RabbitMQ+Worker, Apache Kafka KRaft).
- **Visual Configuration**:
  - Docker Image or Dockerfile Build (`context` + optional `dockerfile`)
  - Ports (`host:container` with TCP/UDP)
  - Environment variables with per-variable **Inline / `.env` extraction** (`${VAR}`)
  - Volumes with automatic top-level named volume detection vs bind mounts
  - Custom bridge networks and `depends_on` (`service_started` / `service_healthy`)
  - Container healthchecks
- **Live Validation**: Flags duplicate service names, host port conflicts, invalid service identifiers, and missing healthchecks for `service_healthy` dependencies.
- **Instant Export & Deploy Guide**: Syntax-highlighted live preview for `docker-compose.yml`, `.env`, and a dynamic **Deploy Guide** showing recommended project folder layout, where to place your app source code when deploying (build-on-VPS vs CI/CD pre-built images), auto-generated sample Nginx/HAProxy/Caddy configs, and Docker Compose CLI commands.
- **Theme & Persistence**: Dark/Light mode toggle and automatic `localStorage` saving.

## Project Structure

- `code/index.html` — Main web application UI
- `code/styles.css` — Responsive styling (dark & light themes)
- `code/js/` — Presets, YAML/Deploy Guide generator, and interactive state logic
- `code/tests/` — Node unit tests

## Run Locally

Because it uses plain HTML, CSS, and JavaScript with no build step, you can run it either way:

1. **Open directly**: Double-click `code/index.html` in your browser.
2. **Or serve locally** (recommended):

   ```bash
   python -m http.server 8080 --directory code
   ```

   Then visit `http://localhost:8080`.

## Run Tests

Requires Node.js (uses the built-in `node:test` runner, no `npm install` needed):

```bash
node --test code/tests/yamlGenerator.test.js
```

## Credits

- **Creator & Maintainer**: [@salmankalista](https://github.com/salmankalista)
- **AI Pair Programming**: Built collaboratively using Antigravity
- **Standards & Ecosystem**: Inspired by the [Compose Specification](https://compose-spec.io/) and built with zero-dependency vanilla HTML, CSS, and JavaScript.

## License

This project is open source and licensed under the **MIT License** — see the [LICENSE](LICENSE) file for full details.

Copyright (c) 2026 salmankalista. You are free to use, modify, and distribute this software for personal or commercial projects.
