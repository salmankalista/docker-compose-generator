(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ComposePresets = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  let idCounter = 1;
  function createId(prefix) {
    idCounter += 1;
    return (prefix || "svc") + "_" + Date.now().toString(36) + "_" + idCounter;
  }

  function normalizeService(partial) {
    return {
      id: partial.id || createId("svc"),
      name: partial.name || "app",
      sourceType: partial.sourceType === "build" ? "build" : "image",
      image: partial.image !== undefined ? partial.image : "",
      buildContext: partial.buildContext !== undefined ? partial.buildContext : ".",
      dockerfile: partial.dockerfile || "",
      containerName: partial.containerName || "",
      restart: partial.restart !== undefined ? partial.restart : "unless-stopped",
      command: partial.command || "",
      workingDir: partial.workingDir || "",
      ports: Array.isArray(partial.ports) ? partial.ports.map((p) => ({ ...p })) : [],
      env: Array.isArray(partial.env) ? partial.env.map((e) => ({ ...e })) : [],
      volumes: Array.isArray(partial.volumes) ? partial.volumes.map((v) => ({ ...v })) : [],
      networks: Array.isArray(partial.networks) ? [...partial.networks] : ["app-network"],
      dependsOn: Array.isArray(partial.dependsOn) ? partial.dependsOn.map((d) => ({ ...d })) : [],
      healthcheck: {
        enabled: Boolean(partial.healthcheck && partial.healthcheck.enabled),
        test: (partial.healthcheck && partial.healthcheck.test) || "",
        interval: (partial.healthcheck && partial.healthcheck.interval) || "10s",
        timeout: (partial.healthcheck && partial.healthcheck.timeout) || "5s",
        retries:
          partial.healthcheck && partial.healthcheck.retries !== undefined
            ? partial.healthcheck.retries
            : 5,
        startPeriod: (partial.healthcheck && partial.healthcheck.startPeriod) || "",
      },
    };
  }

  const SERVICE_TEMPLATES = [
    // Web & Proxy
    {
      key: "nginx",
      label: "Nginx",
      category: "Web",
      description: "Lightweight reverse proxy / static web server",
      create: () =>
        normalizeService({
          name: "nginx",
          image: "nginx:alpine",
          ports: [{ host: "80", container: "80", protocol: "tcp" }],
          volumes: [{ source: "./html", target: "/usr/share/nginx/html", mode: "ro" }],
        }),
    },
    {
      key: "caddy",
      label: "Caddy",
      category: "Web",
      description: "Modern web server & automatic HTTPS reverse proxy",
      create: () =>
        normalizeService({
          name: "caddy",
          image: "caddy:2-alpine",
          ports: [
            { host: "80", container: "80", protocol: "tcp" },
            { host: "443", container: "443", protocol: "tcp" },
          ],
          volumes: [
            { source: "./Caddyfile", target: "/etc/caddy/Caddyfile", mode: "ro" },
            { source: "caddy_data", target: "/data", mode: "" },
            { source: "caddy_config", target: "/config", mode: "" },
          ],
        }),
    },
    {
      key: "traefik",
      label: "Traefik",
      category: "Web",
      description: "Cloud-native edge router and dashboard",
      create: () =>
        normalizeService({
          name: "traefik",
          image: "traefik:v3.2",
          command: "--api.insecure=true --providers.docker=true",
          ports: [
            { host: "80", container: "80", protocol: "tcp" },
            { host: "8080", container: "8080", protocol: "tcp" },
          ],
          volumes: [
            { source: "/var/run/docker.sock", target: "/var/run/docker.sock", mode: "ro" },
          ],
        }),
    },
    {
      key: "haproxy",
      label: "HAProxy",
      category: "Web",
      description: "High-performance L4/L7 TCP & HTTP load balancer",
      create: () =>
        normalizeService({
          name: "haproxy",
          image: "haproxy:3.0-alpine",
          ports: [
            { host: "80", container: "80", protocol: "tcp" },
            { host: "8404", container: "8404", protocol: "tcp" },
          ],
          volumes: [
            {
              source: "./haproxy.cfg",
              target: "/usr/local/etc/haproxy/haproxy.cfg",
              mode: "ro",
            },
          ],
        }),
    },

    // App Runtimes
    {
      key: "node",
      label: "Node.js App",
      category: "App",
      description: "Local Dockerfile build for Node.js backend/frontend",
      create: () =>
        normalizeService({
          name: "api",
          sourceType: "build",
          buildContext: ".",
          dockerfile: "Dockerfile",
          ports: [{ host: "3000", container: "3000", protocol: "tcp" }],
          env: [
            { key: "NODE_ENV", value: "development", useEnvFile: false },
            { key: "PORT", value: "3000", useEnvFile: false },
          ],
        }),
    },
    {
      key: "python",
      label: "Python / FastAPI",
      category: "App",
      description: "Python 3.12 service with uvicorn on port 8000",
      create: () =>
        normalizeService({
          name: "backend",
          sourceType: "build",
          buildContext: ".",
          dockerfile: "Dockerfile",
          command: "uvicorn main:app --host 0.0.0.0 --port 8000 --reload",
          ports: [{ host: "8000", container: "8000", protocol: "tcp" }],
          volumes: [{ source: ".", target: "/app", mode: "" }],
        }),
    },
    {
      key: "golang",
      label: "Go App",
      category: "App",
      description: "Go service built from local Dockerfile on port 8080",
      create: () =>
        normalizeService({
          name: "api",
          sourceType: "build",
          buildContext: ".",
          dockerfile: "Dockerfile",
          ports: [{ host: "8080", container: "8080", protocol: "tcp" }],
          env: [{ key: "PORT", value: "8080", useEnvFile: false }],
        }),
    },
    {
      key: "php",
      label: "PHP-FPM",
      category: "App",
      description: "PHP 8.3 FPM container for Nginx + Laravel/Symfony",
      create: () =>
        normalizeService({
          name: "app",
          sourceType: "build",
          buildContext: ".",
          dockerfile: "Dockerfile",
          workingDir: "/var/www/html",
          volumes: [{ source: ".", target: "/var/www/html", mode: "" }],
        }),
    },

    // Databases
    {
      key: "postgres",
      label: "PostgreSQL",
      category: "Database",
      description: "Relational database with persistent volume & healthcheck",
      create: () =>
        normalizeService({
          name: "postgres",
          image: "postgres:16-alpine",
          ports: [{ host: "5432", container: "5432", protocol: "tcp" }],
          env: [
            { key: "POSTGRES_USER", value: "postgres", useEnvFile: true },
            { key: "POSTGRES_PASSWORD", value: "changeme", useEnvFile: true },
            { key: "POSTGRES_DB", value: "app_db", useEnvFile: true },
          ],
          volumes: [{ source: "pgdata", target: "/var/lib/postgresql/data", mode: "" }],
          healthcheck: {
            enabled: true,
            test: "pg_isready -U ${POSTGRES_USER:-postgres}",
            interval: "10s",
            timeout: "5s",
            retries: 5,
          },
        }),
    },
    {
      key: "mysql",
      label: "MySQL",
      category: "Database",
      description: "MySQL 8.4 database with persistent storage",
      create: () =>
        normalizeService({
          name: "mysql",
          image: "mysql:8.4",
          ports: [{ host: "3306", container: "3306", protocol: "tcp" }],
          env: [
            { key: "MYSQL_ROOT_PASSWORD", value: "rootsecret", useEnvFile: true },
            { key: "MYSQL_DATABASE", value: "app_db", useEnvFile: true },
            { key: "MYSQL_USER", value: "app_user", useEnvFile: true },
            { key: "MYSQL_PASSWORD", value: "usersecret", useEnvFile: true },
          ],
          volumes: [{ source: "mysqldata", target: "/var/lib/mysql", mode: "" }],
          healthcheck: {
            enabled: true,
            test: "mysqladmin ping -h localhost",
            interval: "10s",
            timeout: "5s",
            retries: 5,
          },
        }),
    },
    {
      key: "mariadb",
      label: "MariaDB",
      category: "Database",
      description: "MariaDB 11 relational database with healthcheck",
      create: () =>
        normalizeService({
          name: "mariadb",
          image: "mariadb:11",
          ports: [{ host: "3306", container: "3306", protocol: "tcp" }],
          env: [
            { key: "MARIADB_ROOT_PASSWORD", value: "rootsecret", useEnvFile: true },
            { key: "MARIADB_DATABASE", value: "app_db", useEnvFile: true },
            { key: "MARIADB_USER", value: "app_user", useEnvFile: true },
            { key: "MARIADB_PASSWORD", value: "usersecret", useEnvFile: true },
          ],
          volumes: [{ source: "mariadb_data", target: "/var/lib/mysql", mode: "" }],
          healthcheck: {
            enabled: true,
            test: "healthcheck.sh --connect --innodb_initialized",
            interval: "10s",
            timeout: "5s",
            retries: 5,
          },
        }),
    },
    {
      key: "mongo",
      label: "MongoDB",
      category: "Database",
      description: "Document database with root credentials",
      create: () =>
        normalizeService({
          name: "mongo",
          image: "mongo:7",
          ports: [{ host: "27017", container: "27017", protocol: "tcp" }],
          env: [
            { key: "MONGO_INITDB_ROOT_USERNAME", value: "admin", useEnvFile: true },
            { key: "MONGO_INITDB_ROOT_PASSWORD", value: "changeme", useEnvFile: true },
          ],
          volumes: [{ source: "mongodata", target: "/data/db", mode: "" }],
        }),
    },

    // Cache, Queue & Storage
    {
      key: "redis",
      label: "Redis",
      category: "Cache & Queue",
      description: "In-memory cache & message broker",
      create: () =>
        normalizeService({
          name: "redis",
          image: "redis:7-alpine",
          ports: [{ host: "6379", container: "6379", protocol: "tcp" }],
          volumes: [{ source: "redisdata", target: "/data", mode: "" }],
          healthcheck: {
            enabled: true,
            test: "redis-cli ping",
            interval: "10s",
            timeout: "3s",
            retries: 5,
          },
        }),
    },
    {
      key: "rabbitmq",
      label: "RabbitMQ",
      category: "Cache & Queue",
      description: "AMQP message broker with management UI",
      create: () =>
        normalizeService({
          name: "rabbitmq",
          image: "rabbitmq:3-management-alpine",
          ports: [
            { host: "5672", container: "5672", protocol: "tcp" },
            { host: "15672", container: "15672", protocol: "tcp" },
          ],
          env: [
            { key: "RABBITMQ_DEFAULT_USER", value: "guest", useEnvFile: true },
            { key: "RABBITMQ_DEFAULT_PASS", value: "guest", useEnvFile: true },
          ],
          volumes: [{ source: "rabbitmq_data", target: "/var/lib/rabbitmq", mode: "" }],
          healthcheck: {
            enabled: true,
            test: "rabbitmq-diagnostics -q ping",
            interval: "15s",
            timeout: "5s",
            retries: 5,
          },
        }),
    },
    {
      key: "minio",
      label: "MinIO (S3)",
      category: "Cache & Queue",
      description: "S3-compatible local object storage & web console",
      create: () =>
        normalizeService({
          name: "minio",
          image: "minio/minio:latest",
          command: 'server /data --console-address ":9001"',
          ports: [
            { host: "9000", container: "9000", protocol: "tcp" },
            { host: "9001", container: "9001", protocol: "tcp" },
          ],
          env: [
            { key: "MINIO_ROOT_USER", value: "minioadmin", useEnvFile: true },
            { key: "MINIO_ROOT_PASSWORD", value: "minioadmin123", useEnvFile: true },
          ],
          volumes: [{ source: "minio_data", target: "/data", mode: "" }],
        }),
    },

    // AI & Observability
    {
      key: "qdrant",
      label: "Qdrant",
      category: "AI & Metrics",
      description: "Vector database for AI embeddings and RAG search",
      create: () =>
        normalizeService({
          name: "qdrant",
          image: "qdrant/qdrant:latest",
          ports: [{ host: "6333", container: "6333", protocol: "tcp" }],
          volumes: [{ source: "qdrant_storage", target: "/qdrant/storage", mode: "" }],
        }),
    },
    {
      key: "ollama",
      label: "Ollama",
      category: "AI & Metrics",
      description: "Run local LLMs over an OpenAI-compatible API",
      create: () =>
        normalizeService({
          name: "ollama",
          image: "ollama/ollama:latest",
          ports: [{ host: "11434", container: "11434", protocol: "tcp" }],
          volumes: [{ source: "ollama_data", target: "/root/.ollama", mode: "" }],
        }),
    },
    {
      key: "prometheus",
      label: "Prometheus",
      category: "AI & Metrics",
      description: "Metrics scraper & time-series monitoring server",
      create: () =>
        normalizeService({
          name: "prometheus",
          image: "prom/prometheus:latest",
          ports: [{ host: "9090", container: "9090", protocol: "tcp" }],
          volumes: [
            { source: "./prometheus.yml", target: "/etc/prometheus/prometheus.yml", mode: "ro" },
            { source: "prom_data", target: "/prometheus", mode: "" },
          ],
        }),
    },
    {
      key: "grafana",
      label: "Grafana",
      category: "AI & Metrics",
      description: "Dashboards & visualization UI on port 3000",
      create: () =>
        normalizeService({
          name: "grafana",
          image: "grafana/grafana:latest",
          ports: [{ host: "3000", container: "3000", protocol: "tcp" }],
          env: [
            { key: "GF_SECURITY_ADMIN_USER", value: "admin", useEnvFile: true },
            { key: "GF_SECURITY_ADMIN_PASSWORD", value: "admin", useEnvFile: true },
          ],
          volumes: [{ source: "grafana_data", target: "/var/lib/grafana", mode: "" }],
        }),
    },

    // Developer Tools
    {
      key: "adminer",
      label: "Adminer",
      category: "Tools",
      description: "Lightweight web UI for Postgres, MySQL & SQLite",
      create: () =>
        normalizeService({
          name: "adminer",
          image: "adminer:latest",
          ports: [{ host: "8080", container: "8080", protocol: "tcp" }],
        }),
    },
    {
      key: "pgadmin",
      label: "pgAdmin 4",
      category: "Tools",
      description: "Full-featured PostgreSQL web administration UI",
      create: () =>
        normalizeService({
          name: "pgadmin",
          image: "dpage/pgadmin4:latest",
          ports: [{ host: "5050", container: "80", protocol: "tcp" }],
          env: [
            { key: "PGADMIN_DEFAULT_EMAIL", value: "admin@local.dev", useEnvFile: true },
            { key: "PGADMIN_DEFAULT_PASSWORD", value: "admin123", useEnvFile: true },
          ],
          volumes: [{ source: "pgadmin_data", target: "/var/lib/pgadmin", mode: "" }],
        }),
    },
    {
      key: "mailpit",
      label: "Mailpit",
      category: "Tools",
      description: "Local SMTP & email testing web UI",
      create: () =>
        normalizeService({
          name: "mailpit",
          image: "axllent/mailpit:latest",
          ports: [
            { host: "8025", container: "8025", protocol: "tcp" },
            { host: "1025", container: "1025", protocol: "tcp" },
          ],
        }),
    },
    {
      key: "custom",
      label: "Custom Service",
      category: "Tools",
      description: "Blank container to configure from scratch",
      create: () =>
        normalizeService({
          name: "service",
          image: "alpine:latest",
          command: "sleep infinity",
        }),
    },
  ];

  function getTemplate(key) {
    return SERVICE_TEMPLATES.find((t) => t.key === key).create();
  }

  const STACK_PRESETS = [
    // Backend APIs
    {
      key: "node-postgres-redis",
      label: "Node API + Postgres + Redis",
      category: "Backend",
      servicesPreview: ["api", "db", "redis"],
      description: "Express/Node backend with health-checked PostgreSQL and Redis cache.",
      build: () => {
        const db = getTemplate("postgres");
        db.name = "db";
        const redis = getTemplate("redis");
        const api = getTemplate("node");
        api.env.push(
          {
            key: "DATABASE_URL",
            value: "postgresql://postgres:changeme@db:5432/app_db",
            useEnvFile: true,
          },
          { key: "REDIS_URL", value: "redis://redis:6379", useEnvFile: false }
        );
        api.dependsOn = [
          { serviceId: db.id, condition: "service_healthy" },
          { serviceId: redis.id, condition: "service_healthy" },
        ];
        return {
          projectName: "node-stack",
          includeVersion: false,
          networks: ["app-network"],
          services: [api, db, redis],
        };
      },
    },
    {
      key: "fastapi-postgres",
      label: "FastAPI + PostgreSQL + Adminer",
      category: "Backend",
      servicesPreview: ["backend", "db", "adminer"],
      description: "Python FastAPI service, PostgreSQL database, and Adminer web UI.",
      build: () => {
        const db = getTemplate("postgres");
        db.name = "db";
        const api = getTemplate("python");
        api.env = [
          {
            key: "DATABASE_URL",
            value: "postgresql://postgres:changeme@db:5432/app_db",
            useEnvFile: true,
          },
        ];
        api.dependsOn = [{ serviceId: db.id, condition: "service_healthy" }];
        const adminer = getTemplate("adminer");
        adminer.dependsOn = [{ serviceId: db.id, condition: "service_started" }];
        return {
          projectName: "fastapi-stack",
          includeVersion: false,
          networks: ["app-network"],
          services: [api, db, adminer],
        };
      },
    },
    {
      key: "django-postgres-celery",
      label: "Django + Postgres + Redis + Celery",
      category: "Backend",
      servicesPreview: ["web", "worker", "db", "redis"],
      description: "Python web app with background Celery worker, PostgreSQL, and Redis.",
      build: () => {
        const db = getTemplate("postgres");
        db.name = "db";
        const redis = getTemplate("redis");
        const web = normalizeService({
          name: "web",
          sourceType: "build",
          buildContext: ".",
          dockerfile: "Dockerfile",
          command: "python manage.py runserver 0.0.0.0:8000",
          ports: [{ host: "8000", container: "8000", protocol: "tcp" }],
          env: [
            {
              key: "DATABASE_URL",
              value: "postgresql://postgres:changeme@db:5432/app_db",
              useEnvFile: true,
            },
            { key: "CELERY_BROKER_URL", value: "redis://redis:6379/0", useEnvFile: false },
          ],
          volumes: [{ source: ".", target: "/app", mode: "" }],
          dependsOn: [
            { serviceId: db.id, condition: "service_healthy" },
            { serviceId: redis.id, condition: "service_healthy" },
          ],
        });
        const worker = normalizeService({
          name: "worker",
          sourceType: "build",
          buildContext: ".",
          dockerfile: "Dockerfile",
          command: "celery -A core worker -l info",
          env: [
            { key: "DATABASE_URL", value: "${DATABASE_URL}", useEnvFile: false },
            { key: "CELERY_BROKER_URL", value: "redis://redis:6379/0", useEnvFile: false },
          ],
          volumes: [{ source: ".", target: "/app", mode: "" }],
          dependsOn: [
            { serviceId: db.id, condition: "service_healthy" },
            { serviceId: redis.id, condition: "service_healthy" },
          ],
        });
        return {
          projectName: "django-stack",
          includeVersion: false,
          networks: ["app-network"],
          services: [web, worker, db, redis],
        };
      },
    },
    {
      key: "go-postgres-redis",
      label: "Go API + Postgres + Redis",
      category: "Backend",
      servicesPreview: ["api", "db", "redis"],
      description: "Lightweight Go backend with PostgreSQL and Redis ready for microservices.",
      build: () => {
        const db = getTemplate("postgres");
        db.name = "db";
        const redis = getTemplate("redis");
        const api = getTemplate("golang");
        api.env.push(
          {
            key: "DATABASE_URL",
            value: "postgres://postgres:changeme@db:5432/app_db?sslmode=disable",
            useEnvFile: true,
          },
          { key: "REDIS_ADDR", value: "redis:6379", useEnvFile: false }
        );
        api.dependsOn = [
          { serviceId: db.id, condition: "service_healthy" },
          { serviceId: redis.id, condition: "service_healthy" },
        ];
        return {
          projectName: "go-api",
          includeVersion: false,
          networks: ["app-network"],
          services: [api, db, redis],
        };
      },
    },
    {
      key: "laravel-nginx-mysql",
      label: "Laravel (Nginx + PHP + MySQL + Mailpit)",
      category: "Backend",
      servicesPreview: ["nginx", "app", "db", "redis", "mailpit"],
      description: "Complete PHP/Laravel development environment with local SMTP catching.",
      build: () => {
        const db = getTemplate("mysql");
        db.name = "db";
        const redis = getTemplate("redis");
        const mailpit = getTemplate("mailpit");
        const app = getTemplate("php");
        app.env = [
          { key: "DB_HOST", value: "db", useEnvFile: false },
          { key: "DB_DATABASE", value: "${MYSQL_DATABASE}", useEnvFile: false },
          { key: "DB_USERNAME", value: "${MYSQL_USER}", useEnvFile: false },
          { key: "DB_PASSWORD", value: "${MYSQL_PASSWORD}", useEnvFile: false },
          { key: "REDIS_HOST", value: "redis", useEnvFile: false },
          { key: "MAIL_HOST", value: "mailpit", useEnvFile: false },
          { key: "MAIL_PORT", value: "1025", useEnvFile: false },
        ];
        app.dependsOn = [
          { serviceId: db.id, condition: "service_healthy" },
          { serviceId: redis.id, condition: "service_healthy" },
        ];
        const nginx = normalizeService({
          name: "nginx",
          image: "nginx:alpine",
          ports: [{ host: "80", container: "80", protocol: "tcp" }],
          volumes: [
            { source: ".", target: "/var/www/html", mode: "ro" },
            {
              source: "./docker/nginx/default.conf",
              target: "/etc/nginx/conf.d/default.conf",
              mode: "ro",
            },
          ],
          dependsOn: [{ serviceId: app.id, condition: "service_started" }],
        });
        return {
          projectName: "laravel-app",
          includeVersion: false,
          networks: ["app-network"],
          services: [nginx, app, db, redis, mailpit],
        };
      },
    },
    {
      key: "nginx-multi-backend-lb",
      label: "Load Balancer (Nginx + 3 API Backends + Postgres)",
      category: "Backend",
      servicesPreview: ["nginx-lb", "api-1", "api-2", "api-3", "db", "redis"],
      description:
        "Horizontal multi-backend scaling with Nginx upstream load balancing across 3 API replicas.",
      build: () => {
        const db = getTemplate("postgres");
        db.name = "db";
        const redis = getTemplate("redis");

        const makeReplica = (name) =>
          normalizeService({
            name,
            sourceType: "build",
            buildContext: ".",
            dockerfile: "Dockerfile",
            env: [
              { key: "INSTANCE_ID", value: name, useEnvFile: false },
              { key: "PORT", value: "3000", useEnvFile: false },
              {
                key: "DATABASE_URL",
                value: "postgresql://postgres:changeme@db:5432/app_db",
                useEnvFile: true,
              },
              { key: "REDIS_URL", value: "redis://redis:6379", useEnvFile: false },
            ],
            dependsOn: [
              { serviceId: db.id, condition: "service_healthy" },
              { serviceId: redis.id, condition: "service_healthy" },
            ],
            healthcheck: {
              enabled: true,
              test: "wget -qO- http://localhost:3000/health || exit 1",
              interval: "10s",
              timeout: "5s",
              retries: 5,
            },
          });

        const api1 = makeReplica("api-1");
        const api2 = makeReplica("api-2");
        const api3 = makeReplica("api-3");

        const nginxLb = normalizeService({
          name: "nginx-lb",
          image: "nginx:alpine",
          ports: [{ host: "80", container: "80", protocol: "tcp" }],
          volumes: [
            {
              source: "./nginx/nginx.conf",
              target: "/etc/nginx/conf.d/default.conf",
              mode: "ro",
            },
          ],
          dependsOn: [
            { serviceId: api1.id, condition: "service_healthy" },
            { serviceId: api2.id, condition: "service_healthy" },
            { serviceId: api3.id, condition: "service_healthy" },
          ],
        });

        return {
          projectName: "multi-backend-lb",
          includeVersion: false,
          networks: ["app-network"],
          services: [nginxLb, api1, api2, api3, db, redis],
        };
      },
    },
    {
      key: "haproxy-multi-backend",
      label: "HAProxy Load Balancer + 2 Backends + Redis",
      category: "Backend",
      servicesPreview: ["haproxy", "backend-1", "backend-2", "redis"],
      description:
        "Dedicated HAProxy load balancer with live stats dashboard (:8404) routing across 2 backend nodes.",
      build: () => {
        const redis = getTemplate("redis");

        const makeBackend = (name) =>
          normalizeService({
            name,
            sourceType: "build",
            buildContext: ".",
            dockerfile: "Dockerfile",
            env: [
              { key: "NODE_ID", value: name, useEnvFile: false },
              { key: "PORT", value: "8080", useEnvFile: false },
              { key: "REDIS_URL", value: "redis://redis:6379", useEnvFile: false },
            ],
            dependsOn: [{ serviceId: redis.id, condition: "service_healthy" }],
            healthcheck: {
              enabled: true,
              test: "wget -qO- http://localhost:8080/health || exit 1",
              interval: "10s",
              timeout: "5s",
              retries: 5,
            },
          });

        const b1 = makeBackend("backend-1");
        const b2 = makeBackend("backend-2");

        const haproxy = getTemplate("haproxy");
        haproxy.dependsOn = [
          { serviceId: b1.id, condition: "service_healthy" },
          { serviceId: b2.id, condition: "service_healthy" },
        ];

        return {
          projectName: "haproxy-lb",
          includeVersion: false,
          networks: ["app-network"],
          services: [haproxy, b1, b2, redis],
        };
      },
    },
    {
      key: "caddy-multi-service-gateway",
      label: "Multi-Backend Gateway (Caddy + Auth + Core API)",
      category: "Backend",
      servicesPreview: ["caddy", "auth-service", "core-api", "db", "redis"],
      description:
        "Path-routed microservices gateway with Caddy reverse proxy, Auth service, Core API, Postgres, and Redis.",
      build: () => {
        const db = getTemplate("postgres");
        db.name = "db";
        const redis = getTemplate("redis");

        const authSvc = normalizeService({
          name: "auth-service",
          sourceType: "build",
          buildContext: "./services/auth",
          dockerfile: "Dockerfile",
          env: [
            { key: "PORT", value: "3001", useEnvFile: false },
            {
              key: "DATABASE_URL",
              value: "postgresql://postgres:changeme@db:5432/app_db",
              useEnvFile: true,
            },
            { key: "JWT_SECRET", value: "change-this-secret", useEnvFile: true },
            { key: "REDIS_URL", value: "redis://redis:6379", useEnvFile: false },
          ],
          dependsOn: [
            { serviceId: db.id, condition: "service_healthy" },
            { serviceId: redis.id, condition: "service_healthy" },
          ],
          healthcheck: {
            enabled: true,
            test: "wget -qO- http://localhost:3001/health || exit 1",
            interval: "10s",
            timeout: "5s",
            retries: 5,
          },
        });

        const coreApi = normalizeService({
          name: "core-api",
          sourceType: "build",
          buildContext: "./services/core",
          dockerfile: "Dockerfile",
          env: [
            { key: "PORT", value: "3002", useEnvFile: false },
            {
              key: "DATABASE_URL",
              value: "postgresql://postgres:changeme@db:5432/app_db",
              useEnvFile: true,
            },
            { key: "AUTH_SERVICE_URL", value: "http://auth-service:3001", useEnvFile: false },
            { key: "REDIS_URL", value: "redis://redis:6379", useEnvFile: false },
          ],
          dependsOn: [
            { serviceId: db.id, condition: "service_healthy" },
            { serviceId: redis.id, condition: "service_healthy" },
            { serviceId: authSvc.id, condition: "service_healthy" },
          ],
          healthcheck: {
            enabled: true,
            test: "wget -qO- http://localhost:3002/health || exit 1",
            interval: "10s",
            timeout: "5s",
            retries: 5,
          },
        });

        const caddy = getTemplate("caddy");
        caddy.dependsOn = [
          { serviceId: authSvc.id, condition: "service_healthy" },
          { serviceId: coreApi.id, condition: "service_healthy" },
        ];

        return {
          projectName: "multi-backend-gateway",
          includeVersion: false,
          networks: ["app-network"],
          services: [caddy, authSvc, coreApi, db, redis],
        };
      },
    },

    // Fullstack & CMS
    {
      key: "nextjs-postgres",
      label: "Next.js + PostgreSQL + Adminer",
      category: "Fullstack & CMS",
      servicesPreview: ["web", "db", "adminer"],
      description: "Fullstack Next.js app with PostgreSQL and browser DB inspector.",
      build: () => {
        const db = getTemplate("postgres");
        db.name = "db";
        const web = normalizeService({
          name: "web",
          sourceType: "build",
          buildContext: ".",
          dockerfile: "Dockerfile",
          ports: [{ host: "3000", container: "3000", protocol: "tcp" }],
          env: [
            { key: "NODE_ENV", value: "development", useEnvFile: false },
            {
              key: "DATABASE_URL",
              value: "postgresql://postgres:changeme@db:5432/app_db?schema=public",
              useEnvFile: true,
            },
          ],
          dependsOn: [{ serviceId: db.id, condition: "service_healthy" }],
        });
        const adminer = getTemplate("adminer");
        adminer.dependsOn = [{ serviceId: db.id, condition: "service_started" }];
        return {
          projectName: "nextjs-app",
          includeVersion: false,
          networks: ["app-network"],
          services: [web, db, adminer],
        };
      },
    },
    {
      key: "mern-stack",
      label: "MERN Stack (Vite + Express + MongoDB)",
      category: "Fullstack & CMS",
      servicesPreview: ["frontend", "api", "mongo", "mongo-express"],
      description: "React frontend, Express API, MongoDB database, and Mongo Express UI.",
      build: () => {
        const mongo = getTemplate("mongo");
        const api = normalizeService({
          name: "api",
          sourceType: "build",
          buildContext: "./backend",
          dockerfile: "Dockerfile",
          ports: [{ host: "4000", container: "4000", protocol: "tcp" }],
          env: [
            { key: "PORT", value: "4000", useEnvFile: false },
            {
              key: "MONGO_URI",
              value: "mongodb://admin:changeme@mongo:27017/app?authSource=admin",
              useEnvFile: true,
            },
          ],
          dependsOn: [{ serviceId: mongo.id, condition: "service_started" }],
        });
        const frontend = normalizeService({
          name: "frontend",
          sourceType: "build",
          buildContext: "./frontend",
          dockerfile: "Dockerfile",
          ports: [{ host: "5173", container: "5173", protocol: "tcp" }],
          env: [{ key: "VITE_API_URL", value: "http://localhost:4000", useEnvFile: false }],
          dependsOn: [{ serviceId: api.id, condition: "service_started" }],
        });
        const mongoExpress = normalizeService({
          name: "mongo-express",
          image: "mongo-express:latest",
          ports: [{ host: "8081", container: "8081", protocol: "tcp" }],
          env: [
            { key: "ME_CONFIG_MONGODB_SERVER", value: "mongo", useEnvFile: false },
            {
              key: "ME_CONFIG_MONGODB_ADMINUSERNAME",
              value: "${MONGO_INITDB_ROOT_USERNAME}",
              useEnvFile: false,
            },
            {
              key: "ME_CONFIG_MONGODB_ADMINPASSWORD",
              value: "${MONGO_INITDB_ROOT_PASSWORD}",
              useEnvFile: false,
            },
          ],
          dependsOn: [{ serviceId: mongo.id, condition: "service_started" }],
        });
        return {
          projectName: "mern-app",
          includeVersion: false,
          networks: ["app-network"],
          services: [frontend, api, mongo, mongoExpress],
        };
      },
    },
    {
      key: "wordpress-mysql",
      label: "WordPress + MySQL",
      category: "Fullstack & CMS",
      servicesPreview: ["wordpress", "db"],
      description: "Classic WordPress CMS + MySQL 8.4 ready for local theme/plugin dev.",
      build: () => {
        const db = getTemplate("mysql");
        db.name = "db";
        db.env = [
          { key: "MYSQL_ROOT_PASSWORD", value: "rootsecret", useEnvFile: true },
          { key: "MYSQL_DATABASE", value: "wordpress", useEnvFile: true },
          { key: "MYSQL_USER", value: "wp_user", useEnvFile: true },
          { key: "MYSQL_PASSWORD", value: "wp_pass", useEnvFile: true },
        ];
        const wp = normalizeService({
          name: "wordpress",
          image: "wordpress:latest",
          ports: [{ host: "8080", container: "80", protocol: "tcp" }],
          env: [
            { key: "WORDPRESS_DB_HOST", value: "db:3306", useEnvFile: false },
            { key: "WORDPRESS_DB_USER", value: "${MYSQL_USER}", useEnvFile: false },
            { key: "WORDPRESS_DB_PASSWORD", value: "${MYSQL_PASSWORD}", useEnvFile: false },
            { key: "WORDPRESS_DB_NAME", value: "${MYSQL_DATABASE}", useEnvFile: false },
          ],
          volumes: [{ source: "wp_content", target: "/var/www/html", mode: "" }],
          dependsOn: [{ serviceId: db.id, condition: "service_healthy" }],
        });
        return {
          projectName: "wordpress-site",
          includeVersion: false,
          networks: ["app-network"],
          services: [wp, db],
        };
      },
    },
    {
      key: "ghost-mysql",
      label: "Ghost CMS + MySQL",
      category: "Fullstack & CMS",
      servicesPreview: ["ghost", "db"],
      description: "Modern publishing blog powered by Ghost 5 and MySQL 8.",
      build: () => {
        const db = getTemplate("mysql");
        db.name = "db";
        db.env = [
          { key: "MYSQL_ROOT_PASSWORD", value: "rootsecret", useEnvFile: true },
          { key: "MYSQL_DATABASE", value: "ghost", useEnvFile: true },
          { key: "MYSQL_USER", value: "ghost", useEnvFile: true },
          { key: "MYSQL_PASSWORD", value: "ghostsecret", useEnvFile: true },
        ];
        const ghost = normalizeService({
          name: "ghost",
          image: "ghost:5-alpine",
          ports: [{ host: "2368", container: "2368", protocol: "tcp" }],
          env: [
            { key: "url", value: "http://localhost:2368", useEnvFile: false },
            { key: "database__client", value: "mysql", useEnvFile: false },
            { key: "database__connection__host", value: "db", useEnvFile: false },
            { key: "database__connection__user", value: "${MYSQL_USER}", useEnvFile: false },
            {
              key: "database__connection__password",
              value: "${MYSQL_PASSWORD}",
              useEnvFile: false,
            },
            { key: "database__connection__database", value: "${MYSQL_DATABASE}", useEnvFile: false },
          ],
          volumes: [{ source: "ghost_content", target: "/var/lib/ghost/content", mode: "" }],
          dependsOn: [{ serviceId: db.id, condition: "service_healthy" }],
        });
        return {
          projectName: "ghost-blog",
          includeVersion: false,
          networks: ["app-network"],
          services: [ghost, db],
        };
      },
    },
    {
      key: "static-nginx",
      label: "Simple Nginx Web",
      category: "Fullstack & CMS",
      servicesPreview: ["nginx"],
      description: "Minimal single-container static HTML/CSS/JS web server.",
      build: () => ({
        projectName: "web-site",
        includeVersion: false,
        networks: ["app-network"],
        services: [getTemplate("nginx")],
      }),
    },

    // Data, AI & Automation
    {
      key: "n8n-postgres",
      label: "n8n Automation + PostgreSQL",
      category: "Data & AI",
      servicesPreview: ["n8n", "db"],
      description: "Self-hosted workflow automation with persistent PostgreSQL backend.",
      build: () => {
        const db = getTemplate("postgres");
        db.name = "db";
        db.env = [
          { key: "POSTGRES_USER", value: "n8n", useEnvFile: true },
          { key: "POSTGRES_PASSWORD", value: "n8nsecret", useEnvFile: true },
          { key: "POSTGRES_DB", value: "n8n", useEnvFile: true },
        ];
        const n8n = normalizeService({
          name: "n8n",
          image: "docker.n8n.io/n8nio/n8n:latest",
          ports: [{ host: "5678", container: "5678", protocol: "tcp" }],
          env: [
            { key: "DB_TYPE", value: "postgresdb", useEnvFile: false },
            { key: "DB_POSTGRESDB_HOST", value: "db", useEnvFile: false },
            { key: "DB_POSTGRESDB_PORT", value: "5432", useEnvFile: false },
            { key: "DB_POSTGRESDB_DATABASE", value: "${POSTGRES_DB}", useEnvFile: false },
            { key: "DB_POSTGRESDB_USER", value: "${POSTGRES_USER}", useEnvFile: false },
            { key: "DB_POSTGRESDB_PASSWORD", value: "${POSTGRES_PASSWORD}", useEnvFile: false },
            { key: "GENERIC_TIMEZONE", value: "Asia/Jakarta", useEnvFile: false },
          ],
          volumes: [{ source: "n8n_data", target: "/home/node/.n8n", mode: "" }],
          dependsOn: [{ serviceId: db.id, condition: "service_healthy" }],
        });
        return {
          projectName: "n8n-automation",
          includeVersion: false,
          networks: ["app-network"],
          services: [n8n, db],
        };
      },
    },
    {
      key: "ollama-openwebui",
      label: "Local AI (Ollama + Open WebUI)",
      category: "Data & AI",
      servicesPreview: ["ollama", "open-webui"],
      description: "Run local LLMs with Ollama and a ChatGPT-style browser UI.",
      build: () => {
        const ollama = getTemplate("ollama");
        const webui = normalizeService({
          name: "open-webui",
          image: "ghcr.io/open-webui/open-webui:main",
          ports: [{ host: "3000", container: "8080", protocol: "tcp" }],
          env: [
            { key: "OLLAMA_BASE_URL", value: "http://ollama:11434", useEnvFile: false },
          ],
          volumes: [{ source: "open_webui_data", target: "/app/backend/data", mode: "" }],
          dependsOn: [{ serviceId: ollama.id, condition: "service_started" }],
        });
        return {
          projectName: "local-ai",
          includeVersion: false,
          networks: ["app-network"],
          services: [ollama, webui],
        };
      },
    },
    {
      key: "rag-qdrant-postgres",
      label: "AI RAG Base (Qdrant + Postgres + Redis)",
      category: "Data & AI",
      servicesPreview: ["qdrant", "db", "redis"],
      description: "Vector search, relational metadata, and cache for AI applications.",
      build: () => {
        const qdrant = getTemplate("qdrant");
        const db = getTemplate("postgres");
        db.name = "db";
        const redis = getTemplate("redis");
        return {
          projectName: "ai-rag-infra",
          includeVersion: false,
          networks: ["app-network"],
          services: [qdrant, db, redis],
        };
      },
    },
    {
      key: "minio-postgres-pgadmin",
      label: "S3 Storage + Postgres + pgAdmin",
      category: "Data & AI",
      servicesPreview: ["minio", "db", "pgadmin"],
      description: "Local S3 bucket storage (MinIO), PostgreSQL, and pgAdmin 4 console.",
      build: () => {
        const minio = getTemplate("minio");
        const db = getTemplate("postgres");
        db.name = "db";
        const pgadmin = getTemplate("pgadmin");
        pgadmin.dependsOn = [{ serviceId: db.id, condition: "service_healthy" }];
        return {
          projectName: "data-storage",
          includeVersion: false,
          networks: ["app-network"],
          services: [minio, db, pgadmin],
        };
      },
    },

    // Observability & Queues
    {
      key: "prometheus-grafana",
      label: "Monitoring (Prometheus + Grafana)",
      category: "Observability & Queue",
      servicesPreview: ["prometheus", "grafana", "node-exporter"],
      description: "Metrics collection with Prometheus, Node Exporter, and Grafana dashboards.",
      build: () => {
        const nodeExporter = normalizeService({
          name: "node-exporter",
          image: "prom/node-exporter:latest",
          ports: [{ host: "9100", container: "9100", protocol: "tcp" }],
        });
        const prometheus = getTemplate("prometheus");
        prometheus.dependsOn = [{ serviceId: nodeExporter.id, condition: "service_started" }];
        const grafana = getTemplate("grafana");
        grafana.dependsOn = [{ serviceId: prometheus.id, condition: "service_started" }];
        return {
          projectName: "monitoring-stack",
          includeVersion: false,
          networks: ["app-network"],
          services: [prometheus, grafana, nodeExporter],
        };
      },
    },
    {
      key: "rabbitmq-mongo-worker",
      label: "Event Queue (RabbitMQ + MongoDB + Worker)",
      category: "Observability & Queue",
      servicesPreview: ["rabbitmq", "mongo", "worker"],
      description: "Asynchronous queue broker with MongoDB persistence and Node worker.",
      build: () => {
        const rabbitmq = getTemplate("rabbitmq");
        const mongo = getTemplate("mongo");
        const worker = normalizeService({
          name: "worker",
          sourceType: "build",
          buildContext: ".",
          dockerfile: "Dockerfile",
          env: [
            {
              key: "RABBITMQ_URL",
              value: "amqp://guest:guest@rabbitmq:5672",
              useEnvFile: true,
            },
            {
              key: "MONGO_URI",
              value: "mongodb://admin:changeme@mongo:27017/jobs?authSource=admin",
              useEnvFile: true,
            },
          ],
          dependsOn: [
            { serviceId: rabbitmq.id, condition: "service_healthy" },
            { serviceId: mongo.id, condition: "service_started" },
          ],
        });
        return {
          projectName: "queue-workers",
          includeVersion: false,
          networks: ["app-network"],
          services: [worker, rabbitmq, mongo],
        };
      },
    },
    {
      key: "kafka-kraft-ui",
      label: "Apache Kafka (KRaft) + Kafka UI",
      category: "Observability & Queue",
      servicesPreview: ["kafka", "kafka-ui"],
      description: "Single-node Kafka broker (no ZooKeeper) paired with web UI.",
      build: () => {
        const kafka = normalizeService({
          name: "kafka",
          image: "apache/kafka:3.8.0",
          ports: [{ host: "9092", container: "9092", protocol: "tcp" }],
          env: [
            { key: "KAFKA_NODE_ID", value: "1", useEnvFile: false },
            { key: "KAFKA_PROCESS_ROLES", value: "broker,controller", useEnvFile: false },
            {
              key: "KAFKA_LISTENERS",
              value: "PLAINTEXT://:9092,CONTROLLER://:9093",
              useEnvFile: false,
            },
            {
              key: "KAFKA_ADVERTISED_LISTENERS",
              value: "PLAINTEXT://kafka:9092",
              useEnvFile: false,
            },
            {
              key: "KAFKA_CONTROLLER_LISTENER_NAMES",
              value: "CONTROLLER",
              useEnvFile: false,
            },
            {
              key: "KAFKA_LISTENER_SECURITY_PROTOCOL_MAP",
              value: "CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT",
              useEnvFile: false,
            },
            {
              key: "KAFKA_CONTROLLER_QUORUM_VOTERS",
              value: "1@kafka:9093",
              useEnvFile: false,
            },
            { key: "KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR", value: "1", useEnvFile: false },
          ],
          volumes: [{ source: "kafka_data", target: "/var/lib/kafka/data", mode: "" }],
        });
        const kafkaUi = normalizeService({
          name: "kafka-ui",
          image: "provectuslabs/kafka-ui:latest",
          ports: [{ host: "8080", container: "8080", protocol: "tcp" }],
          env: [
            { key: "KAFKA_CLUSTERS_0_NAME", value: "local", useEnvFile: false },
            {
              key: "KAFKA_CLUSTERS_0_BOOTSTRAPSERVERS",
              value: "kafka:9092",
              useEnvFile: false,
            },
          ],
          dependsOn: [{ serviceId: kafka.id, condition: "service_started" }],
        });
        return {
          projectName: "kafka-dev",
          includeVersion: false,
          networks: ["app-network"],
          services: [kafka, kafkaUi],
        };
      },
    },
  ];

  return {
    createId,
    normalizeService,
    SERVICE_TEMPLATES,
    STACK_PRESETS,
  };
});
