(function () {
  "use strict";

  const STORAGE_KEY = "composeforge_project_v1";
  const THEME_STORAGE_KEY = "composeforge_theme_v1";

  const { generateCompose, generateDeployGuide, isNamedVolume } = window.ComposeYamlGenerator;
  const { createId, normalizeService, SERVICE_TEMPLATES, STACK_PRESETS } =
    window.ComposePresets;

  const state = {
    project: null,
    activeServiceId: null,
    activeOutputTab: "yaml", // "yaml" | "env" | "cli"
    latestOutput: null,
    templateCategory: "All",
    templateQuery: "",
    starterCategory: "All",
    starterQuery: "",
  };

  let toastTimer = null;

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === "className") {
          node.className = v;
        } else if (k === "textContent") {
          node.textContent = v;
        } else if (k.startsWith("on") && typeof v === "function") {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === "checked" || k === "disabled" || k === "selected" || k === "value") {
          node[k] = v;
        } else {
          node.setAttribute(k, String(v));
        }
      }
    }
    if (children !== undefined && children !== null) {
      const list = Array.isArray(children) ? children : [children];
      for (const child of list) {
        if (child === undefined || child === null || child === false) continue;
        if (typeof child === "string" || typeof child === "number") {
          node.appendChild(document.createTextNode(String(child)));
        } else {
          node.appendChild(child);
        }
      }
    }
    return node;
  }

  function showToast(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.classList.add("visible");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove("visible");
    }, 2200);
  }

  function saveProject() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.project));
    } catch (_) {
      // Ignore storage errors in restricted environments
    }
  }

  function loadInitialProject() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.services)) {
          return {
            projectName: parsed.projectName || "",
            includeVersion: Boolean(parsed.includeVersion),
            networks:
              Array.isArray(parsed.networks) && parsed.networks.length > 0
                ? parsed.networks
                : ["app-network"],
            services: parsed.services.map(normalizeService),
          };
        }
      }
    } catch (_) {
      // Fall back to default starter stack
    }
    return STACK_PRESETS[0].build();
  }

  function getUniqueServiceName(baseName) {
    const cleanBase = String(baseName || "service")
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-")
      .replace(/^-+/, "") || "service";
    const existing = new Set(state.project.services.map((s) => s.name));
    if (!existing.has(cleanBase)) return cleanBase;
    let i = 2;
    while (existing.has(cleanBase + "-" + i)) {
      i += 1;
    }
    return cleanBase + "-" + i;
  }

  function getActiveService() {
    return state.project.services.find((s) => s.id === state.activeServiceId) || null;
  }

  function ensureActiveService() {
    if (state.project.services.length === 0) {
      state.activeServiceId = null;
      return;
    }
    if (!getActiveService()) {
      state.activeServiceId = state.project.services[0].id;
    }
  }

  function applyTheme(theme) {
    const next = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    const btn = document.getElementById("themeToggleBtn");
    btn.textContent = next === "dark" ? "Light Mode" : "Dark Mode";
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch (_) {}
  }

  function initTheme() {
    let saved = "dark";
    try {
      saved = localStorage.getItem(THEME_STORAGE_KEY) || "dark";
    } catch (_) {}
    applyTheme(saved);
  }

  function copyTextToClipboard(text, label) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard
        .writeText(text)
        .then(() => showToast("Copied " + label + " to clipboard"))
        .catch(() => fallbackCopy(text, label));
    } else {
      fallbackCopy(text, label);
    }
  }

  function fallbackCopy(text, label) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      showToast("Copied " + label + " to clipboard");
    } catch (_) {
      showToast("Could not copy automatically — please copy manually");
    }
    document.body.removeChild(ta);
  }

  function downloadFile(filename, content) {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("Downloaded " + filename);
  }

  /* ==================== SYNTAX HIGHLIGHTING ==================== */

  function appendHighlightedValue(parent, valueText) {
    const varRegex = /\$\{[^}]+\}/g;
    let lastIdx = 0;
    let match;
    while ((match = varRegex.exec(valueText)) !== null) {
      if (match.index > lastIdx) {
        appendPlainSegment(parent, valueText.slice(lastIdx, match.index));
      }
      parent.appendChild(el("span", { className: "tok-var", textContent: match[0] }));
      lastIdx = varRegex.lastIndex;
    }
    if (lastIdx < valueText.length) {
      appendPlainSegment(parent, valueText.slice(lastIdx));
    }
  }

  function appendPlainSegment(parent, seg) {
    const trimmed = seg.trim();
    if (/^(true|false|yes|no|on|off|\d+(\.\d+)?)$/i.test(trimmed)) {
      parent.appendChild(el("span", { className: "tok-num", textContent: seg }));
    } else {
      parent.appendChild(el("span", { className: "tok-str", textContent: seg }));
    }
  }

  function renderHighlightedYamlLine(line) {
    const container = el("span", { className: "line-text" });
    if (!line) {
      container.textContent = " ";
      return container;
    }

    const commentMatch = line.match(/^(\s*#.*)$/);
    if (commentMatch) {
      container.appendChild(el("span", { className: "tok-comment", textContent: line }));
      return container;
    }

    // List item: "      - value"
    const listMatch = line.match(/^(\s*-\s+)(.*)$/);
    if (listMatch) {
      container.appendChild(el("span", { className: "tok-dash", textContent: listMatch[1] }));
      appendHighlightedValue(container, listMatch[2]);
      return container;
    }

    // Key: value
    const kvMatch = line.match(/^(\s*)([^:\s][^:]*?)(:\s*)(.*)$/);
    if (kvMatch) {
      if (kvMatch[1]) {
        container.appendChild(document.createTextNode(kvMatch[1]));
      }
      container.appendChild(el("span", { className: "tok-key", textContent: kvMatch[2] }));
      container.appendChild(document.createTextNode(kvMatch[3]));
      if (kvMatch[4]) {
        appendHighlightedValue(container, kvMatch[4]);
      }
      return container;
    }

    container.textContent = line;
    return container;
  }

  function renderHighlightedEnvLine(line) {
    const container = el("span", { className: "line-text" });
    if (!line) {
      container.textContent = " ";
      return container;
    }
    if (line.trimStart().startsWith("#")) {
      container.appendChild(el("span", { className: "tok-comment", textContent: line }));
      return container;
    }
    const eqIdx = line.indexOf("=");
    if (eqIdx > 0) {
      container.appendChild(el("span", { className: "tok-key", textContent: line.slice(0, eqIdx) }));
      container.appendChild(document.createTextNode("="));
      container.appendChild(el("span", { className: "tok-str", textContent: line.slice(eqIdx + 1) }));
      return container;
    }
    container.textContent = line;
    return container;
  }

  /* ==================== RENDERING ==================== */

  function renderProjectSettings() {
    const nameInput = document.getElementById("projectNameInput");
    if (document.activeElement !== nameInput) {
      nameInput.value = state.project.projectName || "";
    }
    document.getElementById("includeVersionInput").checked = Boolean(
      state.project.includeVersion
    );

    const netList = document.getElementById("projectNetworksList");
    netList.replaceChildren();
    state.project.networks.forEach((net) => {
      const chip = el("span", { className: "chip" }, [
        net,
        el("button", {
          type: "button",
          className: "chip-remove",
          title: "Remove network " + net,
          "aria-label": "Remove network " + net,
          textContent: "×",
          onClick: () => {
            state.project.networks = state.project.networks.filter((n) => n !== net);
            state.project.services.forEach((svc) => {
              svc.networks = svc.networks.filter((n) => n !== net);
            });
            onStructureChange();
          },
        }),
      ]);
      netList.appendChild(chip);
    });
  }

  function renderTemplates() {
    const categories = ["All", ...new Set(SERVICE_TEMPLATES.map((t) => t.category))];
    const filterEl = document.getElementById("templateCategoryFilter");
    filterEl.replaceChildren();
    categories.forEach((cat) => {
      filterEl.appendChild(
        el("button", {
          type: "button",
          className: "filter-pill" + (state.templateCategory === cat ? " active" : ""),
          textContent: cat,
          onClick: () => {
            state.templateCategory = cat;
            renderTemplates();
          },
        })
      );
    });

    const query = state.templateQuery.trim().toLowerCase();
    const filtered = SERVICE_TEMPLATES.filter((tpl) => {
      const catOk =
        state.templateCategory === "All" || tpl.category === state.templateCategory;
      const textOk =
        !query ||
        tpl.label.toLowerCase().includes(query) ||
        tpl.category.toLowerCase().includes(query) ||
        tpl.description.toLowerCase().includes(query);
      return catOk && textOk;
    });

    const grid = document.getElementById("templateButtons");
    grid.replaceChildren();
    if (filtered.length === 0) {
      grid.appendChild(
        el("span", {
          className: "muted text-xs",
          textContent: "No service templates match your filter.",
        })
      );
      return;
    }

    filtered.forEach((tpl) => {
      const btn = el(
        "button",
        {
          type: "button",
          className: "template-btn",
          title: tpl.description,
          onClick: () => addServiceFromTemplate(tpl),
        },
        [
          el("span", { className: "template-name", textContent: "+ " + tpl.label }),
          el("span", { className: "template-cat", textContent: tpl.category }),
        ]
      );
      grid.appendChild(btn);
    });
  }

  function applyStarterPreset(preset) {
    state.project = preset.build();
    state.activeServiceId = state.project.services[0]
      ? state.project.services[0].id
      : null;
    onStructureChange();
    showToast("Loaded starter pack: " + preset.label);
  }

  function openStarterPacksModal() {
    document.getElementById("starterPacksModal").classList.remove("hidden");
    renderStarterPacksModal();
  }

  function closeStarterPacksModal() {
    document.getElementById("starterPacksModal").classList.add("hidden");
  }

  function renderStarterPacksModal() {
    const categories = ["All", ...new Set(STACK_PRESETS.map((p) => p.category))];
    const filterEl = document.getElementById("starterCategoryFilter");
    filterEl.replaceChildren();
    categories.forEach((cat) => {
      filterEl.appendChild(
        el("button", {
          type: "button",
          className: "filter-pill" + (state.starterCategory === cat ? " active" : ""),
          textContent: cat,
          onClick: () => {
            state.starterCategory = cat;
            renderStarterPacksModal();
          },
        })
      );
    });

    const query = state.starterQuery.trim().toLowerCase();
    const filtered = STACK_PRESETS.filter((preset) => {
      const catOk =
        state.starterCategory === "All" || preset.category === state.starterCategory;
      const textOk =
        !query ||
        preset.label.toLowerCase().includes(query) ||
        preset.category.toLowerCase().includes(query) ||
        preset.description.toLowerCase().includes(query) ||
        preset.servicesPreview.some((s) => s.toLowerCase().includes(query));
      return catOk && textOk;
    });

    const grid = document.getElementById("starterPacksGrid");
    grid.replaceChildren();
    if (filtered.length === 0) {
      grid.appendChild(
        el("p", {
          className: "muted",
          textContent: "No starter packs match your search.",
        })
      );
      return;
    }

    filtered.forEach((preset) => {
      const card = el("div", { className: "starter-pack-card" }, [
        el("div", null, [
          el("div", { className: "starter-pack-cat", textContent: preset.category }),
          el("h3", { className: "starter-pack-title", textContent: preset.label }),
          el("p", { className: "starter-pack-desc", textContent: preset.description }),
        ]),
        el("div", { className: "starter-pack-services" },
          preset.servicesPreview.map((name) =>
            el("span", { className: "service-pill-mini", textContent: name })
          )
        ),
        el("button", {
          type: "button",
          className: "btn btn-primary btn-sm",
          textContent: "Use This Stack",
          onClick: () => {
            applyStarterPreset(preset);
            closeStarterPacksModal();
          },
        }),
      ]);
      grid.appendChild(card);
    });
  }

  function renderServiceTabs() {
    const tabsEl = document.getElementById("servicesTabs");
    tabsEl.replaceChildren();

    if (state.project.services.length === 0) {
      tabsEl.appendChild(
        el("span", {
          className: "muted text-xs",
          textContent: "No services added yet — pick a template above to get started.",
        })
      );
      return;
    }

    state.project.services.forEach((svc, idx) => {
      const isActive = svc.id === state.activeServiceId;
      const firstPort =
        svc.ports && svc.ports[0] && svc.ports[0].host
          ? ":" + svc.ports[0].host
          : "";
      const label = (svc.name || "service_" + (idx + 1)).trim();
      const tab = el(
        "button",
        {
          type: "button",
          className: "service-tab" + (isActive ? " active" : ""),
          role: "tab",
          "aria-selected": isActive ? "true" : "false",
          "data-service-id": svc.id,
          onClick: () => {
            state.activeServiceId = svc.id;
            renderServiceTabs();
            renderServiceEditor();
          },
        },
        [
          el("span", { textContent: label }),
          firstPort ? el("span", { className: "service-tab-port", textContent: firstPort }) : null,
        ]
      );
      tabsEl.appendChild(tab);
    });
  }

  function updateActiveTabLabelInPlace(svc) {
    const tab = document.querySelector(
      '.service-tab[data-service-id="' + svc.id + '"]'
    );
    if (!tab) return;
    const spans = tab.querySelectorAll("span");
    if (spans[0]) {
      spans[0].textContent = (svc.name || "unnamed").trim();
    }
    const firstPort =
      svc.ports && svc.ports[0] && svc.ports[0].host ? ":" + svc.ports[0].host : "";
    if (spans[1]) {
      if (firstPort) {
        spans[1].textContent = firstPort;
      } else {
        spans[1].remove();
      }
    } else if (firstPort) {
      tab.appendChild(el("span", { className: "service-tab-port", textContent: firstPort }));
    }
    const heading = document.getElementById("activeServiceHeading");
    if (heading) {
      heading.textContent = (svc.name || "unnamed").trim();
    }
  }

  function renderServiceEditor() {
    const container = document.getElementById("serviceEditorContainer");
    container.replaceChildren();
    const svc = getActiveService();

    if (!svc) {
      container.appendChild(
        el("div", { className: "empty-state" }, [
          el("h3", { textContent: "Your stack is empty" }),
          el("p", {
            textContent:
              "Click any service template above (like Nginx, PostgreSQL, or Node.js) or load a starter stack from the top bar.",
          }),
        ])
      );
      return;
    }

    const svcIdx = state.project.services.findIndex((s) => s.id === svc.id);

    // Header
    const header = el("div", { className: "service-editor-header" }, [
      el("h3", { className: "service-editor-title" }, [
        el("span", { id: "activeServiceHeading", textContent: svc.name || "unnamed" }),
      ]),
      el("div", { className: "service-editor-actions" }, [
        el("button", {
          type: "button",
          className: "btn btn-ghost btn-xs",
          textContent: "Move Left",
          disabled: svcIdx <= 0,
          onClick: () => moveService(svc.id, -1),
        }),
        el("button", {
          type: "button",
          className: "btn btn-ghost btn-xs",
          textContent: "Move Right",
          disabled: svcIdx >= state.project.services.length - 1,
          onClick: () => moveService(svc.id, 1),
        }),
        el("button", {
          type: "button",
          className: "btn btn-secondary btn-xs",
          textContent: "Duplicate",
          onClick: () => duplicateService(svc),
        }),
        el("button", {
          type: "button",
          className: "btn btn-ghost btn-xs btn-danger-text",
          textContent: "Delete",
          onClick: () => deleteService(svc.id),
        }),
      ]),
    ]);
    container.appendChild(header);

    // 1. Identity & Source
    const sourceToggle = el("div", { className: "segmented" }, [
      el("button", {
        type: "button",
        className: "segmented-btn" + (svc.sourceType !== "build" ? " active" : ""),
        textContent: "Docker Image",
        onClick: () => {
          svc.sourceType = "image";
          onStructureChange();
        },
      }),
      el("button", {
        type: "button",
        className: "segmented-btn" + (svc.sourceType === "build" ? " active" : ""),
        textContent: "Dockerfile Build",
        onClick: () => {
          svc.sourceType = "build";
          if (!svc.buildContext) svc.buildContext = ".";
          onStructureChange();
        },
      }),
    ]);

    const sourceFields =
      svc.sourceType === "build"
        ? [
            el("div", { className: "field" }, [
              el("label", { textContent: "Build Context" }),
              el("input", {
                type: "text",
                className: "mono-input",
                value: svc.buildContext,
                placeholder: ".",
                onInput: (e) => {
                  svc.buildContext = e.target.value;
                  onFieldChange(svc);
                },
              }),
            ]),
            el("div", { className: "field" }, [
              el("label", { textContent: "Dockerfile (optional)" }),
              el("input", {
                type: "text",
                className: "mono-input",
                value: svc.dockerfile,
                placeholder: "Dockerfile",
                onInput: (e) => {
                  svc.dockerfile = e.target.value;
                  onFieldChange(svc);
                },
              }),
            ]),
          ]
        : [
            el("div", { className: "field" }, [
              el("label", { textContent: "Image" }),
              el("input", {
                type: "text",
                className: "mono-input",
                value: svc.image,
                placeholder: "e.g. nginx:alpine",
                onInput: (e) => {
                  svc.image = e.target.value;
                  onFieldChange(svc);
                },
              }),
            ]),
            el("div", { className: "field" }, [
              el("label", { textContent: "Container Name (optional)" }),
              el("input", {
                type: "text",
                className: "mono-input",
                value: svc.containerName,
                placeholder: "auto-generated if empty",
                onInput: (e) => {
                  svc.containerName = e.target.value;
                  onFieldChange(svc);
                },
              }),
            ]),
          ];

    const restartSelect = el(
      "select",
      {
        value: svc.restart,
        onChange: (e) => {
          svc.restart = e.target.value;
          onFieldChange(svc);
        },
      },
      [
        el("option", { value: "unless-stopped", textContent: "unless-stopped (recommended)" }),
        el("option", { value: "always", textContent: "always" }),
        el("option", { value: "on-failure", textContent: "on-failure" }),
        el("option", { value: "no", textContent: "no" }),
        el("option", { value: "", textContent: "(unset)" }),
      ]
    );
    restartSelect.value = svc.restart;

    const coreSection = el("div", { className: "editor-section" }, [
      el("div", { className: "editor-section-head" }, [
        el("h3", { textContent: "General & Image" }),
        sourceToggle,
      ]),
      el("div", { className: "form-grid-2" }, [
        el("div", { className: "field" }, [
          el("label", { textContent: "Service Name" }),
          el("input", {
            type: "text",
            className: "mono-input",
            value: svc.name,
            placeholder: "e.g. api",
            onInput: (e) => {
              svc.name = e.target.value;
              onFieldChange(svc);
            },
          }),
        ]),
        el("div", { className: "field" }, [
          el("label", { textContent: "Restart Policy" }),
          restartSelect,
        ]),
        ...sourceFields,
        el("div", { className: "field" }, [
          el("label", { textContent: "Command (optional)" }),
          el("input", {
            type: "text",
            className: "mono-input",
            value: svc.command,
            placeholder: "e.g. npm run dev",
            onInput: (e) => {
              svc.command = e.target.value;
              onFieldChange(svc);
            },
          }),
        ]),
        el("div", { className: "field" }, [
          el("label", { textContent: "Working Directory (optional)" }),
          el("input", {
            type: "text",
            className: "mono-input",
            value: svc.workingDir,
            placeholder: "e.g. /app",
            onInput: (e) => {
              svc.workingDir = e.target.value;
              onFieldChange(svc);
            },
          }),
        ]),
      ]),
    ]);
    container.appendChild(coreSection);

    // 2. Ports
    const portRows = el("div", { className: "rows-stack" });
    if (svc.ports.length === 0) {
      portRows.appendChild(
        el("span", { className: "muted text-xs", textContent: "No ports exposed." })
      );
    } else {
      svc.ports.forEach((port, idx) => {
        const protoSelect = el(
          "select",
          {
            "aria-label": "Port protocol",
            onChange: (e) => {
              port.protocol = e.target.value;
              onFieldChange(svc);
            },
          },
          [
            el("option", { value: "tcp", textContent: "TCP" }),
            el("option", { value: "udp", textContent: "UDP" }),
          ]
        );
        protoSelect.value = port.protocol || "tcp";

        portRows.appendChild(
          el("div", { className: "row-ports" }, [
            el("input", {
              type: "text",
              className: "mono-input",
              value: port.host,
              placeholder: "Host (e.g. 8080)",
              "aria-label": "Host port",
              onInput: (e) => {
                port.host = e.target.value;
                onFieldChange(svc);
              },
            }),
            el("span", { className: "row-sep", textContent: ":" }),
            el("input", {
              type: "text",
              className: "mono-input",
              value: port.container,
              placeholder: "Container (e.g. 80)",
              "aria-label": "Container port",
              onInput: (e) => {
                port.container = e.target.value;
                onFieldChange(svc);
              },
            }),
            protoSelect,
            el("button", {
              type: "button",
              className: "btn-icon-remove",
              title: "Remove port",
              "aria-label": "Remove port",
              textContent: "×",
              onClick: () => {
                svc.ports.splice(idx, 1);
                onStructureChange();
              },
            }),
          ])
        );
      });
    }

    container.appendChild(
      el("div", { className: "editor-section" }, [
        el("div", { className: "editor-section-head" }, [
          el("h3", { textContent: "Ports" }),
          el("button", {
            type: "button",
            className: "btn btn-secondary btn-xs",
            textContent: "+ Add Port",
            onClick: () => {
              svc.ports.push({ host: "", container: "", protocol: "tcp" });
              onStructureChange();
              focusLastInput(".row-ports input");
            },
          }),
        ]),
        portRows,
      ])
    );

    // 3. Environment Variables
    const envRows = el("div", { className: "rows-stack" });
    if (svc.env.length === 0) {
      envRows.appendChild(
        el("span", { className: "muted text-xs", textContent: "No environment variables defined." })
      );
    } else {
      svc.env.forEach((row, idx) => {
        envRows.appendChild(
          el("div", { className: "row-env" }, [
            el("input", {
              type: "text",
              className: "mono-input",
              value: row.key,
              placeholder: "KEY",
              "aria-label": "Environment variable name",
              onInput: (e) => {
                row.key = e.target.value;
                onFieldChange(svc);
              },
            }),
            el("input", {
              type: "text",
              className: "mono-input",
              value: row.value,
              placeholder: "value",
              "aria-label": "Environment variable value",
              onInput: (e) => {
                row.value = e.target.value;
                onFieldChange(svc);
              },
            }),
            el("button", {
              type: "button",
              className: "env-pill-toggle" + (row.useEnvFile ? " active" : ""),
              title: row.useEnvFile
                ? "Exported to .env file as ${" + (row.key || "KEY") + "}. Click to inline."
                : "Inlined in YAML. Click to extract into .env file.",
              textContent: row.useEnvFile ? "In .env" : "Inline",
              onClick: () => {
                row.useEnvFile = !row.useEnvFile;
                onStructureChange();
              },
            }),
            el("button", {
              type: "button",
              className: "btn-icon-remove",
              title: "Remove variable",
              "aria-label": "Remove variable",
              textContent: "×",
              onClick: () => {
                svc.env.splice(idx, 1);
                onStructureChange();
              },
            }),
          ])
        );
      });
    }

    container.appendChild(
      el("div", { className: "editor-section" }, [
        el("div", { className: "editor-section-head" }, [
          el("h3", { textContent: "Environment Variables" }),
          el("div", { className: "service-editor-actions" }, [
            svc.env.length > 0
              ? el("button", {
                  type: "button",
                  className: "btn btn-ghost btn-xs",
                  textContent: svc.env.every((r) => r.useEnvFile)
                    ? "Inline all"
                    : "All to .env",
                  onClick: () => {
                    const next = !svc.env.every((r) => r.useEnvFile);
                    svc.env.forEach((r) => {
                      r.useEnvFile = next;
                    });
                    onStructureChange();
                  },
                })
              : null,
            el("button", {
              type: "button",
              className: "btn btn-secondary btn-xs",
              textContent: "+ Add Variable",
              onClick: () => {
                svc.env.push({ key: "", value: "", useEnvFile: false });
                onStructureChange();
                focusLastInput(".row-env input");
              },
            }),
          ]),
        ]),
        envRows,
      ])
    );

    // 4. Volumes
    const volRows = el("div", { className: "rows-stack" });
    if (svc.volumes.length === 0) {
      volRows.appendChild(
        el("span", { className: "muted text-xs", textContent: "No volumes mounted." })
      );
    } else {
      svc.volumes.forEach((vol, idx) => {
        const modeSelect = el(
          "select",
          {
            "aria-label": "Volume access mode",
            onChange: (e) => {
              vol.mode = e.target.value;
              onFieldChange(svc);
            },
          },
          [
            el("option", { value: "", textContent: "rw" }),
            el("option", { value: "ro", textContent: "ro" }),
          ]
        );
        modeSelect.value = vol.mode === "ro" ? "ro" : "";

        volRows.appendChild(
          el("div", { className: "row-volumes" }, [
            el("input", {
              type: "text",
              className: "mono-input",
              value: vol.source,
              placeholder: "pgdata or ./data",
              "aria-label": "Volume source",
              onInput: (e) => {
                vol.source = e.target.value;
                onFieldChange(svc);
              },
            }),
            el("span", { className: "row-sep", textContent: ":" }),
            el("input", {
              type: "text",
              className: "mono-input",
              value: vol.target,
              placeholder: "/var/lib/data",
              "aria-label": "Container mount path",
              onInput: (e) => {
                vol.target = e.target.value;
                onFieldChange(svc);
              },
            }),
            modeSelect,
            el("button", {
              type: "button",
              className: "btn-icon-remove",
              title: "Remove volume",
              "aria-label": "Remove volume",
              textContent: "×",
              onClick: () => {
                svc.volumes.splice(idx, 1);
                onStructureChange();
              },
            }),
          ])
        );
      });
    }

    const namedCount = svc.volumes.filter((v) => isNamedVolume(v.source)).length;
    container.appendChild(
      el("div", { className: "editor-section" }, [
        el("div", { className: "editor-section-head" }, [
          el("h3", { textContent: "Volumes" }),
          el("button", {
            type: "button",
            className: "btn btn-secondary btn-xs",
            textContent: "+ Add Volume",
            onClick: () => {
              svc.volumes.push({ source: "", target: "", mode: "" });
              onStructureChange();
              focusLastInput(".row-volumes input");
            },
          }),
        ]),
        volRows,
        el("p", {
          className: "volume-type-hint",
          textContent:
            "Tip: Paths starting with ./ or / are bind mounts; names like pgdata are auto-declared under top-level volumes:" +
            (namedCount > 0 ? " (" + namedCount + " named volume on this service)" : ""),
        }),
      ])
    );

    // 5. Networks & Depends On
    const netGroup = el("div", { className: "toggle-pill-group" });
    if (state.project.networks.length === 0) {
      netGroup.appendChild(
        el("span", {
          className: "muted text-xs",
          textContent: "No custom networks defined in Project Settings.",
        })
      );
    } else {
      state.project.networks.forEach((net) => {
        const selected = svc.networks.includes(net);
        netGroup.appendChild(
          el(
            "label",
            { className: "toggle-pill" + (selected ? " selected" : "") },
            [
              el("input", {
                type: "checkbox",
                checked: selected,
                onChange: (e) => {
                  if (e.target.checked) {
                    if (!svc.networks.includes(net)) svc.networks.push(net);
                  } else {
                    svc.networks = svc.networks.filter((n) => n !== net);
                  }
                  onStructureChange();
                },
              }),
              el("span", { className: "mono-input", textContent: net }),
            ]
          )
        );
      });
    }

    const otherServices = state.project.services.filter((s) => s.id !== svc.id);
    const depsContainer = el("div", { className: "depends-list" });
    if (otherServices.length === 0) {
      depsContainer.appendChild(
        el("span", {
          className: "muted text-xs",
          textContent: "Add another service to configure depends_on ordering.",
        })
      );
    } else {
      otherServices.forEach((other) => {
        const existingDep = svc.dependsOn.find((d) => d.serviceId === other.id);
        const condSelect = el(
          "select",
          {
            disabled: !existingDep,
            "aria-label": "Dependency condition for " + other.name,
            onChange: (e) => {
              if (existingDep) {
                existingDep.condition = e.target.value;
                onFieldChange(svc);
              }
            },
          },
          [
            el("option", { value: "service_started", textContent: "service_started" }),
            el("option", { value: "service_healthy", textContent: "service_healthy" }),
          ]
        );
        condSelect.value = existingDep ? existingDep.condition || "service_started" : "service_started";

        depsContainer.appendChild(
          el("div", { className: "depends-row" }, [
            el("label", { className: "checkbox-inline" }, [
              el("input", {
                type: "checkbox",
                checked: Boolean(existingDep),
                onChange: (e) => {
                  if (e.target.checked) {
                    svc.dependsOn.push({
                      serviceId: other.id,
                      condition:
                        other.healthcheck && other.healthcheck.enabled
                          ? "service_healthy"
                          : "service_started",
                    });
                  } else {
                    svc.dependsOn = svc.dependsOn.filter((d) => d.serviceId !== other.id);
                  }
                  onStructureChange();
                },
              }),
              el("span", { className: "mono-input", textContent: other.name || "unnamed" }),
            ]),
            condSelect,
          ])
        );
      });
    }

    container.appendChild(
      el("div", { className: "editor-section" }, [
        el("div", { className: "editor-section-head" }, [
          el("h3", { textContent: "Networks & Dependencies" }),
        ]),
        el("div", { className: "field", style: "margin-bottom: 0.9rem;" }, [
          el("label", { textContent: "Attach to Networks" }),
          netGroup,
        ]),
        el("div", { className: "field" }, [
          el("label", { textContent: "Depends On (Startup Order)" }),
          depsContainer,
        ]),
      ])
    );

    // 6. Healthcheck
    const hcEnabled = Boolean(svc.healthcheck && svc.healthcheck.enabled);
    const hcSection = el("div", { className: "editor-section" }, [
      el("div", { className: "editor-section-head" }, [
        el("h3", { textContent: "Healthcheck" }),
        el("label", { className: "checkbox-inline" }, [
          el("input", {
            type: "checkbox",
            checked: hcEnabled,
            onChange: (e) => {
              svc.healthcheck.enabled = e.target.checked;
              onStructureChange();
            },
          }),
          el("span", { textContent: "Enable healthcheck" }),
        ]),
      ]),
    ]);

    if (hcEnabled) {
      hcSection.appendChild(
        el("div", { className: "form-grid-2" }, [
          el("div", { className: "field", style: "grid-column: 1 / -1;" }, [
            el("label", { textContent: "Test Command" }),
            el("input", {
              type: "text",
              className: "mono-input",
              value: svc.healthcheck.test,
              placeholder: "e.g. curl -f http://localhost:3000/health || exit 1",
              onInput: (e) => {
                svc.healthcheck.test = e.target.value;
                onFieldChange(svc);
              },
            }),
          ]),
          el("div", { className: "field" }, [
            el("label", { textContent: "Interval" }),
            el("input", {
              type: "text",
              className: "mono-input",
              value: svc.healthcheck.interval,
              placeholder: "10s",
              onInput: (e) => {
                svc.healthcheck.interval = e.target.value;
                onFieldChange(svc);
              },
            }),
          ]),
          el("div", { className: "field" }, [
            el("label", { textContent: "Timeout" }),
            el("input", {
              type: "text",
              className: "mono-input",
              value: svc.healthcheck.timeout,
              placeholder: "5s",
              onInput: (e) => {
                svc.healthcheck.timeout = e.target.value;
                onFieldChange(svc);
              },
            }),
          ]),
          el("div", { className: "field" }, [
            el("label", { textContent: "Retries" }),
            el("input", {
              type: "number",
              min: "1",
              max: "50",
              value: svc.healthcheck.retries,
              onInput: (e) => {
                svc.healthcheck.retries = e.target.value;
                onFieldChange(svc);
              },
            }),
          ]),
          el("div", { className: "field" }, [
            el("label", { textContent: "Start Period (optional)" }),
            el("input", {
              type: "text",
              className: "mono-input",
              value: svc.healthcheck.startPeriod,
              placeholder: "e.g. 15s",
              onInput: (e) => {
                svc.healthcheck.startPeriod = e.target.value;
                onFieldChange(svc);
              },
            }),
          ]),
        ])
      );
    }
    container.appendChild(hcSection);
  }

  function focusLastInput(selector) {
    requestAnimationFrame(() => {
      const inputs = document.querySelectorAll(selector);
      if (inputs.length > 0) {
        // Focus first empty input in the last row
        const lastRow = inputs[inputs.length - 1].closest(".row-ports, .row-env, .row-volumes");
        if (lastRow) {
          const firstInput = lastRow.querySelector("input");
          if (firstInput) firstInput.focus();
        }
      }
    });
  }

  function renderPreview() {
    const output = generateCompose(state.project);
    state.latestOutput = output;

    // Update badge & footer actions
    document.getElementById("envCountBadge").textContent = String(output.envCount);
    const downloadEnvBtn = document.getElementById("downloadEnvBtn");
    if (output.envCount > 0) {
      downloadEnvBtn.classList.remove("hidden");
    } else {
      downloadEnvBtn.classList.add("hidden");
    }

    // Diagnostics
    const diagBar = document.getElementById("diagnosticsBar");
    diagBar.replaceChildren();
    if (output.warnings.length === 0) {
      diagBar.appendChild(
        el("div", {
          className: "diag-item diag-ok",
          textContent: "Valid configuration — ready to copy or download.",
        })
      );
    } else {
      output.warnings.forEach((w) => {
        const cls =
          w.level === "error"
            ? "diag-error"
            : w.level === "warning"
            ? "diag-warning"
            : "diag-info";
        diagBar.appendChild(
          el("div", { className: "diag-item " + cls, textContent: w.message })
        );
      });
    }

    // Code vs CLI tabs
    const codeViewer = document.getElementById("codeViewerContainer");
    const cliGuide = document.getElementById("cliGuideContainer");
    const copyBtn = document.getElementById("copyOutputBtn");
    const downloadBtn = document.getElementById("downloadOutputBtn");

    document.querySelectorAll(".output-tab").forEach((tab) => {
      const active = tab.getAttribute("data-output-tab") === state.activeOutputTab;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });

    if (state.activeOutputTab === "cli") {
      codeViewer.classList.add("hidden");
      cliGuide.classList.remove("hidden");
      copyBtn.classList.add("hidden");
      downloadBtn.textContent = "Download YAML";
      renderCliGuide(cliGuide);
    } else {
      cliGuide.classList.add("hidden");
      codeViewer.classList.remove("hidden");
      copyBtn.classList.remove("hidden");
      downloadBtn.textContent = "Download";

      const isEnv = state.activeOutputTab === "env";
      const content = isEnv
        ? output.env || "# No variables exported to .env yet.\n# Click \"Inline\" on any service env variable to export it here.\n"
        : output.yaml;

      codeViewer.replaceChildren();
      const lines = content.replace(/\n$/, "").split("\n");
      lines.forEach((line, i) => {
        const lineNode = el("div", { className: "code-line" }, [
          el("span", { className: "line-num", textContent: String(i + 1) }),
          isEnv ? renderHighlightedEnvLine(line) : renderHighlightedYamlLine(line),
        ]);
        codeViewer.appendChild(lineNode);
      });
    }

    // Footer summary stats
    const summaryEl = document.getElementById("summaryStats");
    summaryEl.replaceChildren(
      el("span", {
        textContent:
          state.project.services.length +
          " service" +
          (state.project.services.length === 1 ? "" : "s"),
      }),
      el("span", {
        textContent:
          output.namedVolumes.length +
          " named volume" +
          (output.namedVolumes.length === 1 ? "" : "s"),
      }),
      el("span", {
        textContent:
          output.usedNetworks.length +
          " network" +
          (output.usedNetworks.length === 1 ? "" : "s"),
      })
    );
  }

  function renderCliGuide(container) {
    container.replaceChildren();
    const guide = generateDeployGuide(state.project);

    // 1. Recommended Project Folder Structure
    container.appendChild(
      el("h4", {
        className: "deploy-section-title",
        textContent: "Recommended Project Folder Layout",
      })
    );
    container.appendChild(
      el("div", { className: "cli-step" }, [
        el("div", { className: "cli-step-head" }, [
          el("span", {
            textContent: "Place these files together (e.g. /opt/apps/" + guide.rootName + "/)",
          }),
          el("button", {
            type: "button",
            className: "btn btn-secondary btn-xs",
            textContent: "Copy Tree",
            onClick: () => copyTextToClipboard(guide.treeText, "folder layout"),
          }),
        ]),
        el("pre", { className: "cli-cmd", textContent: guide.treeText }),
      ])
    );

    // 2. Where to Put Personal Code When Deploying
    const deployTips = [
      guide.hasBuildServices
        ? el("li", null, [
            el("strong", { textContent: "Option A — Build on Server (VPS / Git Clone): " }),
            "Keep ",
            el("code", { textContent: "docker-compose.yml" }),
            ", ",
            el("code", { textContent: "Dockerfile" }),
            ", and your app source code in one folder (e.g. ",
            el("code", { textContent: "/opt/apps/" + guide.rootName }),
            "). Create ",
            el("code", { textContent: ".env" }),
            " manually on the server (never commit secrets to Git) and run ",
            el("code", { textContent: "docker compose up -d --build" }),
            ".",
          ])
        : el("li", null, [
            el("strong", { textContent: "Pre-built Images Only: " }),
            "This stack pulls existing Docker images directly. On your server, you only need ",
            el("code", { textContent: "docker-compose.yml" }),
            " (plus ",
            el("code", { textContent: ".env" }),
            " and any config files mounted above) inside ",
            el("code", { textContent: "/opt/apps/" + guide.rootName }),
            ".",
          ]),
    ];

    if (guide.hasBuildServices) {
      deployTips.push(
        el("li", null, [
          el("strong", { textContent: "Option B — Production CI/CD (Recommended): " }),
          "Build and push your app image to GHCR / Docker Hub from CI, switch the service from ",
          el("code", { textContent: "Dockerfile Build" }),
          " to ",
          el("code", { textContent: "Docker Image" }),
          ", then deploy only ",
          el("code", { textContent: "docker-compose.yml" }),
          " + ",
          el("code", { textContent: ".env" }),
          " + proxy configs to the VPS (no raw source code needed on the server).",
        ])
      );
    }

    if (guide.namedVolumes.length > 0) {
      deployTips.push(
        el("li", null, [
          el("strong", { textContent: "Database & Persistent Volumes: " }),
          "Named volumes (",
          el("code", { textContent: guide.namedVolumes.join(", ") }),
          ") are managed automatically by Docker outside your app folder (",
          el("code", { textContent: "/var/lib/docker/volumes/" }),
          "), so your data stays safe across container rebuilds.",
        ])
      );
    }

    container.appendChild(
      el("div", { className: "cli-step" }, [
        el("div", { className: "cli-step-head" }, [
          el("span", { textContent: "Where to Put Your Code When Deploying" }),
        ]),
        el("ul", { className: "deploy-tips-list" }, deployTips),
      ])
    );

    // 3. Auto-generated Sample Proxy / Load Balancer Configs (if mounted)
    if (guide.sampleConfigs.length > 0) {
      container.appendChild(
        el("h4", {
          className: "deploy-section-title",
          textContent: "Starter Reverse Proxy / Load Balancer Config",
        })
      );
      guide.sampleConfigs.forEach((cfg) => {
        container.appendChild(
          el("div", { className: "cli-step" }, [
            el("div", { className: "cli-step-head" }, [
              el("span", { textContent: cfg.filename }),
              el("button", {
                type: "button",
                className: "btn btn-secondary btn-xs",
                textContent: "Copy Config",
                onClick: () => copyTextToClipboard(cfg.content, cfg.filename),
              }),
            ]),
            el("pre", { className: "cli-cmd", textContent: cfg.content }),
          ])
        );
      });
    }

    // 4. Docker Compose CLI Commands
    container.appendChild(
      el("h4", {
        className: "deploy-section-title",
        textContent: "Docker Compose CLI Commands",
      })
    );
    const commands = [
      {
        title: "1. Start all services in background",
        cmd: guide.hasBuildServices
          ? "docker compose up -d --build"
          : "docker compose up -d",
      },
      {
        title: "2. Check running containers & health",
        cmd: "docker compose ps",
      },
      {
        title: "3. Stream live logs",
        cmd: "docker compose logs -f",
      },
      {
        title: "4. Validate final merged config",
        cmd: "docker compose config",
      },
      {
        title: "5. Stop and remove containers",
        cmd: "docker compose down",
      },
    ];

    commands.forEach((item) => {
      container.appendChild(
        el("div", { className: "cli-step" }, [
          el("div", { className: "cli-step-head" }, [
            el("span", { textContent: item.title }),
            el("button", {
              type: "button",
              className: "btn btn-secondary btn-xs",
              textContent: "Copy",
              onClick: () => copyTextToClipboard(item.cmd, "command"),
            }),
          ]),
          el("code", { className: "cli-cmd", textContent: item.cmd }),
        ])
      );
    });
  }

  /* ==================== ACTIONS ==================== */

  function onFieldChange(svc) {
    saveProject();
    if (svc) {
      updateActiveTabLabelInPlace(svc);
    }
    renderPreview();
  }

  function onStructureChange() {
    ensureActiveService();
    saveProject();
    renderProjectSettings();
    renderServiceTabs();
    renderServiceEditor();
    renderPreview();
  }

  function addServiceFromTemplate(tpl) {
    const svc = tpl.create();
    svc.name = getUniqueServiceName(svc.name);
    if (state.project.networks.length > 0) {
      svc.networks = [state.project.networks[0]];
    } else {
      svc.networks = [];
    }
    state.project.services.push(svc);
    state.activeServiceId = svc.id;
    onStructureChange();
    showToast("Added " + svc.name + " service");
  }

  function duplicateService(svc) {
    const copy = normalizeService(JSON.parse(JSON.stringify(svc)));
    copy.id = createId("svc");
    copy.name = getUniqueServiceName(svc.name + "-copy");
    state.project.services.push(copy);
    state.activeServiceId = copy.id;
    onStructureChange();
    showToast("Duplicated as " + copy.name);
  }

  function deleteService(serviceId) {
    const target = state.project.services.find((s) => s.id === serviceId);
    state.project.services = state.project.services.filter((s) => s.id !== serviceId);
    state.project.services.forEach((s) => {
      s.dependsOn = s.dependsOn.filter((d) => d.serviceId !== serviceId);
    });
    ensureActiveService();
    onStructureChange();
    if (target) showToast("Removed " + target.name);
  }

  function moveService(serviceId, delta) {
    const idx = state.project.services.findIndex((s) => s.id === serviceId);
    const nextIdx = idx + delta;
    if (idx < 0 || nextIdx < 0 || nextIdx >= state.project.services.length) return;
    const [item] = state.project.services.splice(idx, 1);
    state.project.services.splice(nextIdx, 0, item);
    onStructureChange();
  }

  function initBindings() {
    // Project name
    document.getElementById("projectNameInput").addEventListener("input", (e) => {
      state.project.projectName = e.target.value;
      onFieldChange(null);
    });

    // Legacy version toggle
    document.getElementById("includeVersionInput").addEventListener("change", (e) => {
      state.project.includeVersion = e.target.checked;
      onFieldChange(null);
    });

    // Add network
    document.getElementById("addNetworkForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = document.getElementById("newNetworkInput");
      const net = input.value.trim().replace(/\s+/g, "-");
      if (!net) return;
      if (!state.project.networks.includes(net)) {
        state.project.networks.push(net);
        onStructureChange();
        showToast("Added network " + net);
      }
      input.value = "";
    });

    // Template search
    document.getElementById("templateSearchInput").addEventListener("input", (e) => {
      state.templateQuery = e.target.value;
      renderTemplates();
    });

    // Starter Packs Modal
    const openStarterBtn = document.getElementById("openStarterPacksBtn");
    openStarterBtn.textContent = "Starter Packs (" + STACK_PRESETS.length + ")";
    openStarterBtn.addEventListener("click", openStarterPacksModal);
    document
      .getElementById("closeStarterPacksBtn")
      .addEventListener("click", closeStarterPacksModal);
    document.getElementById("starterPacksModal").addEventListener("click", (e) => {
      if (e.target.id === "starterPacksModal") {
        closeStarterPacksModal();
      }
    });
    document.getElementById("starterSearchInput").addEventListener("input", (e) => {
      state.starterQuery = e.target.value;
      renderStarterPacksModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeStarterPacksModal();
      }
    });

    // Stack presets dropdown (grouped by category)
    const presetSelect = document.getElementById("stackPresetSelect");
    const presetGroups = new Map();
    STACK_PRESETS.forEach((preset) => {
      if (!presetGroups.has(preset.category)) {
        const group = document.createElement("optgroup");
        group.label = preset.category;
        presetGroups.set(preset.category, group);
        presetSelect.appendChild(group);
      }
      presetGroups
        .get(preset.category)
        .appendChild(el("option", { value: preset.key, textContent: preset.label }));
    });
    presetSelect.addEventListener("change", (e) => {
      const key = e.target.value;
      if (!key) return;
      const preset = STACK_PRESETS.find((p) => p.key === key);
      if (preset) {
        applyStarterPreset(preset);
      }
      e.target.value = "";
    });

    // Theme toggle
    document.getElementById("themeToggleBtn").addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme");
      applyTheme(current === "dark" ? "light" : "dark");
    });

    // Reset button
    document.getElementById("resetProjectBtn").addEventListener("click", () => {
      state.project = {
        projectName: "",
        includeVersion: false,
        networks: ["app-network"],
        services: [],
      };
      state.activeServiceId = null;
      onStructureChange();
      showToast("Cleared project");
    });

    // Output tabs
    document.querySelectorAll(".output-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        state.activeOutputTab = tab.getAttribute("data-output-tab");
        renderPreview();
      });
    });

    // Copy active output
    document.getElementById("copyOutputBtn").addEventListener("click", () => {
      if (!state.latestOutput) return;
      if (state.activeOutputTab === "env") {
        if (!state.latestOutput.env) {
          showToast("No .env entries to copy yet");
          return;
        }
        copyTextToClipboard(state.latestOutput.env, ".env");
      } else {
        copyTextToClipboard(state.latestOutput.yaml, "docker-compose.yml");
      }
    });

    // Download active output
    document.getElementById("downloadOutputBtn").addEventListener("click", () => {
      if (!state.latestOutput) return;
      if (state.activeOutputTab === "env") {
        if (!state.latestOutput.env) {
          showToast("No .env entries to download yet");
          return;
        }
        downloadFile(".env", state.latestOutput.env);
      } else {
        downloadFile("docker-compose.yml", state.latestOutput.yaml);
      }
    });

    // Download .env quick button
    document.getElementById("downloadEnvBtn").addEventListener("click", () => {
      if (state.latestOutput && state.latestOutput.env) {
        downloadFile(".env", state.latestOutput.env);
      }
    });
  }

  function init() {
    initTheme();
    state.project = loadInitialProject();
    ensureActiveService();
    renderTemplates();
    initBindings();
    renderProjectSettings();
    renderServiceTabs();
    renderServiceEditor();
    renderPreview();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
