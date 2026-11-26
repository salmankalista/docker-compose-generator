(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ComposeYamlGenerator = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SERVICE_NAME_REGEX = /^[a-z0-9][a-z0-9_-]*$/;
  const YAML_RESERVED_WORDS = /^(true|false|yes|no|on|off|y|n|null|~)$/i;
  const YAML_NUMERIC_REGEX = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
  const YAML_BASE_NUM_REGEX = /^0[xo][0-9a-f]+$/i;
  const YAML_SEXAGESIMAL_REGEX = /^\d+(:\d+)+$/;

  /**
   * Format a string safely as a YAML scalar.
   * Always quotes reserved booleans/nulls, numbers, empty strings, and syntax-sensitive characters.
   */
  function formatYamlScalar(value, options) {
    const forceQuote = options && options.forceQuote;
    const str = value === undefined || value === null ? "" : String(value);

    if (str === "") {
      return '""';
    }

    const needsQuotes =
      forceQuote ||
      YAML_RESERVED_WORDS.test(str) ||
      YAML_NUMERIC_REGEX.test(str) ||
      YAML_BASE_NUM_REGEX.test(str) ||
      YAML_SEXAGESIMAL_REGEX.test(str) ||
      /^\s|\s$/.test(str) ||
      /[\r\n\t]/.test(str) ||
      /^[-?:,\[\]{}#&*!|>'"%@`]/.test(str) ||
      /:\s|:$|\s#/.test(str) ||
      /["'\\]/.test(str);

    if (!needsQuotes) {
      return str;
    }

    const escaped = str
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r/g, "\\r")
      .replace(/\n/g, "\\n")
      .replace(/\t/g, "\\t");

    return '"' + escaped + '"';
  }

  /**
   * Format a key-value mapping key cleanly for YAML.
   */
  function formatYamlKey(key) {
    const str = String(key || "").trim();
    if (/^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(str) && !YAML_RESERVED_WORDS.test(str)) {
      return str;
    }
    return formatYamlScalar(str, { forceQuote: true });
  }

  /**
   * Format a value for a .env file line.
   */
  function formatEnvFileValue(value) {
    const str = value === undefined || value === null ? "" : String(value);
    if (str === "") {
      return "";
    }
    const needsQuotes = /[\s"'\\#$`\r\n]/.test(str);
    if (!needsQuotes) {
      return str;
    }
    const escaped = str
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r/g, "\\r")
      .replace(/\n/g, "\\n");
    return '"' + escaped + '"';
  }

  /**
   * Determine if a volume source refers to a Docker named volume rather than a bind mount.
   */
  function isNamedVolume(source) {
    const s = String(source || "").trim();
    if (!s) return false;
    if (
      s.startsWith(".") ||
      s.startsWith("/") ||
      s.startsWith("~") ||
      s.startsWith("$") ||
      /^[a-zA-Z]:[\\/]/.test(s)
    ) {
      return false;
    }
    return true;
  }

  /**
   * Format a port mapping entry into a Docker Compose port string.
   */
  function formatPortEntry(port) {
    const host = String(port.host || "").trim();
    const container = String(port.container || "").trim();
    const protocol = String(port.protocol || "").trim().toLowerCase();
    if (!container) return null;

    let mapping = host ? host + ":" + container : container;
    if (protocol === "udp") {
      mapping += "/udp";
    }
    return formatYamlScalar(mapping, { forceQuote: true });
  }

  /**
   * Format a volume mapping entry into a Docker Compose volume string.
   */
  function formatVolumeEntry(vol) {
    const source = String(vol.source || "").trim();
    const target = String(vol.target || "").trim();
    const mode = String(vol.mode || "").trim().toLowerCase();
    if (!source || !target) return null;

    let mapping = source + ":" + target;
    if (mode === "ro") {
      mapping += ":ro";
    }
    return formatYamlScalar(mapping);
  }

  /**
   * Format healthcheck test command into Compose YAML representation.
   */
  function formatHealthcheckTest(rawTest) {
    const testStr = String(rawTest || "").trim();
    if (!testStr) return null;

    if (testStr.startsWith("[") && testStr.endsWith("]")) {
      return testStr;
    }
    if (/^CMD-SHELL\s+/i.test(testStr)) {
      const cmd = testStr.replace(/^CMD-SHELL\s+/i, "");
      return '["CMD-SHELL", ' + formatYamlScalar(cmd, { forceQuote: true }) + "]";
    }
    if (/^CMD\s+/i.test(testStr)) {
      const parts = testStr.replace(/^CMD\s+/i, "").trim().split(/\s+/);
      return (
        '["CMD", ' +
        parts.map((p) => formatYamlScalar(p, { forceQuote: true })).join(", ") +
        "]"
      );
    }
    return '["CMD-SHELL", ' + formatYamlScalar(testStr, { forceQuote: true }) + "]";
  }

  /**
   * Split a raw command string when needed or keep as single string for Compose.
   */
  function formatCommand(rawCmd) {
    const cmd = String(rawCmd || "").trim();
    if (!cmd) return null;
    if (cmd.startsWith("[") && cmd.endsWith("]")) {
      return cmd;
    }
    return formatYamlScalar(cmd);
  }

  /**
   * Validate project configuration and collect human-readable warnings.
   */
  function validateProject(project) {
    const warnings = [];
    const services = Array.isArray(project && project.services) ? project.services : [];

    if (services.length === 0) {
      warnings.push({
        level: "info",
        message: "Add at least one service to generate a docker-compose.yml file.",
      });
      return warnings;
    }

    const serviceNamesSeen = new Map();
    const hostPortsSeen = new Map();
    const envKeysSeen = new Map();
    const serviceById = new Map();

    for (const svc of services) {
      serviceById.set(svc.id, svc);
    }

    for (const svc of services) {
      const name = String(svc.name || "").trim();

      if (!name) {
        warnings.push({
          level: "error",
          serviceId: svc.id,
          message: "A service is missing its name.",
        });
      } else {
        if (!SERVICE_NAME_REGEX.test(name)) {
          warnings.push({
            level: "error",
            serviceId: svc.id,
            message:
              'Service "' +
              name +
              '" should contain only lowercase letters, numbers, "-" or "_" and start with a letter or digit.',
          });
        }
        const prev = serviceNamesSeen.get(name);
        if (prev) {
          warnings.push({
            level: "error",
            serviceId: svc.id,
            message: 'Duplicate service name "' + name + '". Service names must be unique.',
          });
        } else {
          serviceNamesSeen.set(name, svc.id);
        }
      }

      const sourceType = svc.sourceType === "build" ? "build" : "image";
      const image = String(svc.image || "").trim();
      const buildContext = String(svc.buildContext || "").trim();
      if (sourceType === "image" && !image) {
        warnings.push({
          level: "warning",
          serviceId: svc.id,
          message: 'Service "' + (name || "unnamed") + '" has no Docker image specified.',
        });
      }
      if (sourceType === "build" && !buildContext) {
        warnings.push({
          level: "warning",
          serviceId: svc.id,
          message: 'Service "' + (name || "unnamed") + '" has no build context path specified.',
        });
      }

      if (Array.isArray(svc.ports)) {
        for (const p of svc.ports) {
          const host = String(p.host || "").trim();
          const container = String(p.container || "").trim();
          const proto = String(p.protocol || "tcp").trim().toLowerCase() || "tcp";
          if (host && !container) {
            warnings.push({
              level: "warning",
              serviceId: svc.id,
              message:
                'Service "' +
                (name || "unnamed") +
                '" has host port "' +
                host +
                '" without a container port.',
            });
          }
          if (host && container) {
            const portKey = host + "/" + proto;
            const owner = hostPortsSeen.get(portKey);
            if (owner && owner !== svc.id) {
              const ownerSvc = serviceById.get(owner);
              warnings.push({
                level: "warning",
                serviceId: svc.id,
                message:
                  "Host port " +
                  portKey +
                  ' is bound by both "' +
                  ((ownerSvc && ownerSvc.name) || "another service") +
                  '" and "' +
                  (name || "unnamed") +
                  '".',
              });
            } else {
              hostPortsSeen.set(portKey, svc.id);
            }
          }
        }
      }

      if (Array.isArray(svc.env)) {
        for (const row of svc.env) {
          const key = String(row.key || "").trim();
          if (!key) continue;
          if (row.useEnvFile) {
            const val = String(row.value || "");
            const existing = envKeysSeen.get(key);
            if (existing && existing.value !== val) {
              warnings.push({
                level: "warning",
                serviceId: svc.id,
                message:
                  'Environment key "' +
                  key +
                  '" is exported to .env with different values in "' +
                  existing.serviceName +
                  '" and "' +
                  (name || "unnamed") +
                  '".',
              });
            } else if (!existing) {
              envKeysSeen.set(key, { value: val, serviceName: name || "unnamed" });
            }
          }
        }
      }

      if (Array.isArray(svc.dependsOn)) {
        for (const dep of svc.dependsOn) {
          const target = serviceById.get(dep.serviceId);
          if (!target) continue;
          if (dep.serviceId === svc.id) {
            warnings.push({
              level: "error",
              serviceId: svc.id,
              message: 'Service "' + (name || "unnamed") + '" cannot depend on itself.',
            });
          } else if (
            dep.condition === "service_healthy" &&
            !(target.healthcheck && target.healthcheck.enabled && String(target.healthcheck.test || "").trim())
          ) {
            warnings.push({
              level: "warning",
              serviceId: svc.id,
              message:
                'Service "' +
                (name || "unnamed") +
                '" waits for "' +
                (target.name || "unnamed") +
                '" (service_healthy), but "' +
                (target.name || "unnamed") +
                '" has no healthcheck configured.',
            });
          }
        }
      }
    }

    return warnings;
  }

  /**
   * Generate docker-compose.yml content, .env content, and validation diagnostics.
   */
  function generateCompose(project) {
    const safeProject = project || {};
    const services = Array.isArray(safeProject.services) ? safeProject.services : [];
    const warnings = validateProject(safeProject);

    const lines = [];
    const envLines = [];
    const envVarCountRef = { count: 0 };
    const seenEnvKeys = new Set();
    const namedVolumes = new Set();
    const usedNetworks = new Set();

    const serviceById = new Map();
    const resolvedNameById = new Map();
    services.forEach((svc, idx) => {
      serviceById.set(svc.id, svc);
      resolvedNameById.set(
        svc.id,
        String(svc.name || "").trim() || "service_" + (idx + 1)
      );
    });

    if (safeProject.includeVersion) {
      lines.push('version: "3.8"');
    }

    const projectName = String(safeProject.projectName || "").trim();
    if (projectName) {
      lines.push("name: " + formatYamlScalar(projectName));
    }

    if (lines.length > 0 && services.length > 0) {
      lines.push("");
    }

    if (services.length === 0) {
      lines.push("services: {}");
      return {
        yaml: lines.join("\n") + "\n",
        env: "",
        envCount: 0,
        namedVolumes: [],
        usedNetworks: [],
        warnings,
      };
    }

    lines.push("services:");

    services.forEach((svc, idx) => {
      const svcName = resolvedNameById.get(svc.id);
      lines.push("  " + formatYamlKey(svcName) + ":");

      const sourceType = svc.sourceType === "build" ? "build" : "image";
      const image = String(svc.image || "").trim();
      const buildContext = String(svc.buildContext || "").trim();
      const dockerfile = String(svc.dockerfile || "").trim();

      if (sourceType === "build") {
        if (buildContext) {
          if (dockerfile) {
            lines.push("    build:");
            lines.push("      context: " + formatYamlScalar(buildContext));
            lines.push("      dockerfile: " + formatYamlScalar(dockerfile));
          } else {
            lines.push("    build: " + formatYamlScalar(buildContext));
          }
        }
        if (image) {
          lines.push("    image: " + formatYamlScalar(image));
        }
      } else if (image) {
        lines.push("    image: " + formatYamlScalar(image));
      }

      const containerName = String(svc.containerName || "").trim();
      if (containerName) {
        lines.push("    container_name: " + formatYamlScalar(containerName));
      }

      const restart = String(svc.restart || "").trim();
      if (restart) {
        lines.push("    restart: " + formatYamlScalar(restart));
      }

      const workingDir = String(svc.workingDir || "").trim();
      if (workingDir) {
        lines.push("    working_dir: " + formatYamlScalar(workingDir));
      }

      const command = formatCommand(svc.command);
      if (command) {
        lines.push("    command: " + command);
      }

      // Ports
      const formattedPorts = Array.isArray(svc.ports)
        ? svc.ports.map(formatPortEntry).filter(Boolean)
        : [];
      if (formattedPorts.length > 0) {
        lines.push("    ports:");
        for (const p of formattedPorts) {
          lines.push("      - " + p);
        }
      }

      // Environment variables
      const validEnvRows = Array.isArray(svc.env)
        ? svc.env.filter((row) => String(row.key || "").trim() !== "")
        : [];
      if (validEnvRows.length > 0) {
        lines.push("    environment:");
        const serviceEnvExports = [];
        for (const row of validEnvRows) {
          const key = String(row.key).trim();
          const val = row.value === undefined || row.value === null ? "" : String(row.value);
          if (row.useEnvFile) {
            lines.push("      " + formatYamlKey(key) + ": ${" + key + "}");
            if (!seenEnvKeys.has(key)) {
              seenEnvKeys.add(key);
              serviceEnvExports.push(key + "=" + formatEnvFileValue(val));
              envVarCountRef.count += 1;
            }
          } else {
            lines.push("      " + formatYamlKey(key) + ": " + formatYamlScalar(val));
          }
        }
        if (serviceEnvExports.length > 0) {
          if (envLines.length > 0) envLines.push("");
          envLines.push("# " + svcName);
          envLines.push(...serviceEnvExports);
        }
      }

      // Volumes
      const formattedVolumes = [];
      if (Array.isArray(svc.volumes)) {
        for (const vol of svc.volumes) {
          const entry = formatVolumeEntry(vol);
          if (entry) {
            formattedVolumes.push(entry);
            const src = String(vol.source || "").trim();
            if (isNamedVolume(src)) {
              namedVolumes.add(src);
            }
          }
        }
      }
      if (formattedVolumes.length > 0) {
        lines.push("    volumes:");
        for (const v of formattedVolumes) {
          lines.push("      - " + v);
        }
      }

      // Depends On
      const validDeps = Array.isArray(svc.dependsOn)
        ? svc.dependsOn.filter((d) => d && d.serviceId !== svc.id && serviceById.has(d.serviceId))
        : [];
      if (validDeps.length > 0) {
        const useConditionMap = validDeps.some(
          (d) => d.condition && d.condition !== "service_started"
        );
        lines.push("    depends_on:");
        if (useConditionMap) {
          for (const dep of validDeps) {
            const targetName = resolvedNameById.get(dep.serviceId);
            if (!targetName) continue;
            lines.push("      " + formatYamlKey(targetName) + ":");
            lines.push("        condition: " + (dep.condition || "service_started"));
          }
        } else {
          for (const dep of validDeps) {
            const targetName = resolvedNameById.get(dep.serviceId);
            if (!targetName) continue;
            lines.push("      - " + formatYamlKey(targetName));
          }
        }
      }

      // Healthcheck
      if (svc.healthcheck && svc.healthcheck.enabled) {
        const hcTest = formatHealthcheckTest(svc.healthcheck.test);
        if (hcTest) {
          lines.push("    healthcheck:");
          lines.push("      test: " + hcTest);
          if (String(svc.healthcheck.interval || "").trim()) {
            lines.push("      interval: " + formatYamlScalar(svc.healthcheck.interval.trim()));
          }
          if (String(svc.healthcheck.timeout || "").trim()) {
            lines.push("      timeout: " + formatYamlScalar(svc.healthcheck.timeout.trim()));
          }
          if (
            svc.healthcheck.retries !== undefined &&
            svc.healthcheck.retries !== null &&
            String(svc.healthcheck.retries).trim() !== ""
          ) {
            const num = Number(svc.healthcheck.retries);
            lines.push(
              "      retries: " + (Number.isFinite(num) ? String(num) : formatYamlScalar(svc.healthcheck.retries))
            );
          }
          if (String(svc.healthcheck.startPeriod || "").trim()) {
            lines.push("      start_period: " + formatYamlScalar(svc.healthcheck.startPeriod.trim()));
          }
        }
      }

      // Networks
      const svcNetworks = Array.isArray(svc.networks)
        ? svc.networks.map((n) => String(n || "").trim()).filter(Boolean)
        : [];
      if (svcNetworks.length > 0) {
        lines.push("    networks:");
        for (const net of svcNetworks) {
          lines.push("      - " + formatYamlKey(net));
          usedNetworks.add(net);
        }
      }

      if (idx < services.length - 1) {
        lines.push("");
      }
    });

    if (namedVolumes.size > 0) {
      lines.push("");
      lines.push("volumes:");
      for (const volName of namedVolumes) {
        lines.push("  " + formatYamlKey(volName) + ":");
      }
    }

    if (usedNetworks.size > 0) {
      lines.push("");
      lines.push("networks:");
      for (const netName of usedNetworks) {
        lines.push("  " + formatYamlKey(netName) + ":");
        lines.push("    driver: bridge");
      }
    }

    return {
      yaml: lines.join("\n") + "\n",
      env: envLines.length > 0 ? envLines.join("\n") + "\n" : "",
      envCount: envVarCountRef.count,
      namedVolumes: Array.from(namedVolumes),
      usedNetworks: Array.from(usedNetworks),
      warnings,
    };
  }

  /**
   * Normalize a relative path under the project root (e.g., "./services/auth/" -> "services/auth").
   */
  function normalizeRelativePath(rawPath) {
    const p = String(rawPath || "").trim().replace(/\\/g, "/");
    if (!p || p === "." || p === "./") return ".";
    return p.replace(/^\.\//, "").replace(/\/+$/, "");
  }

  /**
   * Build a clean ASCII project directory tree and deployment recommendations
   * tailored to the current Compose project.
   */
  function generateDeployGuide(project) {
    const safeProject = project || {};
    const services = Array.isArray(safeProject.services) ? safeProject.services : [];
    const composeOut = generateCompose(safeProject);
    const rootName =
      String(safeProject.projectName || "").trim() || "my-compose-app";

    const rootNode = { children: new Map(), note: "", order: 0 };

    function ensurePath(relPath, isDir, noteLabel, priority) {
      const parts = relPath.split("/").filter(Boolean);
      let curr = rootNode;
      parts.forEach((part, idx) => {
        const isLast = idx === parts.length - 1;
        if (!curr.children.has(part)) {
          curr.children.set(part, {
            children: new Map(),
            isDir: isLast ? isDir : true,
            notes: [],
            order: priority !== undefined ? priority : 50,
          });
        }
        const next = curr.children.get(part);
        if (isLast) {
          if (isDir) next.isDir = true;
          if (noteLabel && !next.notes.includes(noteLabel)) {
            next.notes.push(noteLabel);
          }
          if (priority !== undefined && priority < next.order) {
            next.order = priority;
          }
        }
        curr = next;
      });
    }

    ensurePath("docker-compose.yml", false, "Generated Compose file", 1);
    if (composeOut.envCount > 0) {
      ensurePath(".env", false, "Secrets & env vars (do not commit to Git)", 2);
    }

    const buildServices = [];
    const hostSockets = [];
    const relativeConfigs = [];
    const sharedBuildGroups = new Map();

    for (const svc of services) {
      const svcName = String(svc.name || "").trim() || "service";
      if (svc.sourceType === "build") {
        buildServices.push(svc);
        const ctx = normalizeRelativePath(svc.buildContext || ".");
        const df = String(svc.dockerfile || "").trim() || "Dockerfile";
        const key = ctx + "|" + df;
        if (!sharedBuildGroups.has(key)) {
          sharedBuildGroups.set(key, { ctx, df, names: [] });
        }
        sharedBuildGroups.get(key).names.push(svcName);
      }

      if (Array.isArray(svc.volumes)) {
        for (const vol of svc.volumes) {
          const src = String(vol.source || "").trim();
          if (!src || isNamedVolume(src)) continue;
          if (src.startsWith("/var/run/docker.sock")) {
            hostSockets.push(src);
            continue;
          }
          if (src.startsWith(".")) {
            const rel = normalizeRelativePath(src);
            if (rel === ".") {
              ensurePath("src", true, "Mounted into " + svcName, 11);
            } else {
              const looksLikeFile =
                /\.[a-z0-9]+$/i.test(rel) ||
                /(^|\/)(Caddyfile|Dockerfile[^/]*|Makefile|Procfile)$/i.test(rel);
              ensurePath(rel, !looksLikeFile, "Mounted into " + svcName, 30);
              relativeConfigs.push({ rel, svcName, target: vol.target });
            }
          }
        }
      }
    }

    for (const group of sharedBuildGroups.values()) {
      const svcLabel = group.names.join(", ");
      if (group.ctx === ".") {
        ensurePath(group.df, false, "Build (" + svcLabel + ")", 10);
        ensurePath("src", true, "App source (" + svcLabel + ")", 11);
      } else {
        ensurePath(group.ctx + "/" + group.df, false, "Build (" + svcLabel + ")", 20);
        ensurePath(group.ctx + "/src", true, "App source (" + svcLabel + ")", 21);
      }
    }

    function renderTreeLines(node, prefix) {
      const entries = Array.from(node.children.entries()).sort((a, b) => {
        if (a[1].order !== b[1].order) return a[1].order - b[1].order;
        if (a[1].isDir !== b[1].isDir) return a[1].isDir ? -1 : 1;
        return a[0].localeCompare(b[0]);
      });

      const out = [];
      entries.forEach(([name, child], idx) => {
        const isLast = idx === entries.length - 1;
        const connector = isLast ? "└── " : "├── ";
        const displayName = child.isDir ? name + "/" : name;
        const comment = child.notes.length > 0 ? "   # " + child.notes.join("; ") : "";
        out.push(prefix + connector + displayName + comment);
        if (child.children.size > 0) {
          const nextPrefix = prefix + (isLast ? "    " : "│   ");
          out.push(...renderTreeLines(child, nextPrefix));
        }
      });
      return out;
    }

    const treeLines = [rootName + "/  (e.g. /opt/apps/" + rootName + "/ on VPS)"];
    treeLines.push(...renderTreeLines(rootNode, ""));

    // Detect backend target services for optional reverse-proxy / LB sample configs
    const backendTargets = services
      .filter((s) => {
        const img = String(s.image || "").toLowerCase();
        const name = String(s.name || "").toLowerCase();
        const isProxyOrInfra =
          /^(nginx|haproxy|caddy|traefik|postgres|mysql|mariadb|mongo|redis|rabbitmq|minio|qdrant|ollama|prometheus|grafana|adminer|pgadmin|mailpit)/.test(
            name
          ) ||
          /^(nginx|haproxy|caddy|traefik|postgres|mysql|mariadb|mongo|redis|rabbitmq|prom\/|grafana\/)/.test(
            img
          );
        return s.sourceType === "build" || !isProxyOrInfra;
      })
      .map((s) => {
        const portEnv = Array.isArray(s.env)
          ? s.env.find((e) => String(e.key || "").trim().toUpperCase() === "PORT")
          : null;
        const containerPort =
          (portEnv && String(portEnv.value || "").trim()) ||
          (s.ports && s.ports[0] && String(s.ports[0].container || "").trim()) ||
          "3000";
        return {
          name: String(s.name || "").trim() || "app",
          port: containerPort,
        };
      });

    const sampleConfigs = [];
    const hasNginxConf = relativeConfigs.some((c) => c.rel.endsWith("nginx.conf") || c.rel.endsWith("default.conf"));
    const hasHaproxyConf = relativeConfigs.some((c) => c.rel.endsWith("haproxy.cfg"));
    const hasCaddyfile = relativeConfigs.some((c) => c.rel.endsWith("Caddyfile"));

    const targetList =
      backendTargets.length > 0
        ? backendTargets
        : [{ name: "api", port: "3000" }];

    if (hasNginxConf) {
      const upstreams = targetList
        .map((t) => "    server " + t.name + ":" + t.port + ";")
        .join("\n");
      sampleConfigs.push({
        filename:
          relativeConfigs.find((c) => c.rel.endsWith("nginx.conf") || c.rel.endsWith("default.conf"))
            .rel,
        language: "nginx",
        content:
          "upstream backend_pool {\n" +
          upstreams +
          "\n}\n\nserver {\n    listen 80;\n\n    location / {\n        proxy_pass http://backend_pool;\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n    }\n}",
      });
    }

    if (hasHaproxyConf) {
      const servers = targetList
        .map((t) => "    server " + t.name + " " + t.name + ":" + t.port + " check")
        .join("\n");
      sampleConfigs.push({
        filename: relativeConfigs.find((c) => c.rel.endsWith("haproxy.cfg")).rel,
        language: "haproxy",
        content:
          "global\n    maxconn 2048\n\ndefaults\n    mode http\n    timeout connect 5s\n    timeout client  30s\n    timeout server  30s\n\nfrontend http_front\n    bind *:80\n    default_backend app_backends\n\nbackend app_backends\n    balance roundrobin\n" +
          servers +
          "\n\nlisten stats\n    bind *:8404\n    stats enable\n    stats uri /\n    stats refresh 10s",
      });
    }

    if (hasCaddyfile) {
      const routes =
        targetList.length === 1
          ? "    reverse_proxy " + targetList[0].name + ":" + targetList[0].port
          : targetList
              .map(
                (t) =>
                  "    handle /" +
                  t.name.replace(/-?(service|api)$/, "") +
                  "/* {\n        reverse_proxy " +
                  t.name +
                  ":" +
                  t.port +
                  "\n    }"
              )
              .join("\n");
      sampleConfigs.push({
        filename: relativeConfigs.find((c) => c.rel.endsWith("Caddyfile")).rel,
        language: "caddy",
        content: ":80 {\n" + routes + "\n}",
      });
    }

    return {
      rootName,
      treeText: treeLines.join("\n"),
      hasBuildServices: buildServices.length > 0,
      namedVolumes: composeOut.namedVolumes,
      hostSockets: Array.from(new Set(hostSockets)),
      sampleConfigs,
    };
  }

  return {
    formatYamlScalar,
    formatYamlKey,
    formatEnvFileValue,
    isNamedVolume,
    formatPortEntry,
    formatVolumeEntry,
    formatHealthcheckTest,
    validateProject,
    generateCompose,
    generateDeployGuide,
  };
});
