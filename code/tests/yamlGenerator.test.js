"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  formatYamlScalar,
  isNamedVolume,
  formatHealthcheckTest,
  validateProject,
  generateCompose,
  generateDeployGuide,
} = require("../js/yamlGenerator.js");
const { SERVICE_TEMPLATES, STACK_PRESETS, normalizeService } = require("../js/presets.js");

test("formatYamlScalar quotes YAML reserved words, numbers, empty strings, and special chars", () => {
  assert.equal(formatYamlScalar(""), '""');
  assert.equal(formatYamlScalar("yes"), '"yes"');
  assert.equal(formatYamlScalar("NO"), '"NO"');
  assert.equal(formatYamlScalar("true"), '"true"');
  assert.equal(formatYamlScalar("3000"), '"3000"');
  assert.equal(formatYamlScalar("80:80"), '"80:80"');
  assert.equal(formatYamlScalar("hello: world"), '"hello: world"');
  assert.equal(formatYamlScalar("a #comment"), '"a #comment"');
  assert.equal(formatYamlScalar("nginx:alpine"), "nginx:alpine");
  assert.equal(formatYamlScalar("${POSTGRES_PASSWORD}"), "${POSTGRES_PASSWORD}");
});

test("isNamedVolume distinguishes named volumes from bind mounts", () => {
  assert.equal(isNamedVolume("pgdata"), true);
  assert.equal(isNamedVolume("wp_content"), true);
  assert.equal(isNamedVolume("./html"), false);
  assert.equal(isNamedVolume("../data"), false);
  assert.equal(isNamedVolume("/var/run/docker.sock"), false);
  assert.equal(isNamedVolume("~/app"), false);
  assert.equal(isNamedVolume("${DATA_DIR}/db"), false);
  assert.equal(isNamedVolume("C:\\app\\data"), false);
  assert.equal(isNamedVolume(""), false);
});

test("formatHealthcheckTest normalizes shell commands and preserves arrays", () => {
  assert.equal(
    formatHealthcheckTest("redis-cli ping"),
    '["CMD-SHELL", "redis-cli ping"]'
  );
  assert.equal(
    formatHealthcheckTest("CMD-SHELL curl -f http://localhost || exit 1"),
    '["CMD-SHELL", "curl -f http://localhost || exit 1"]'
  );
  assert.equal(
    formatHealthcheckTest('["CMD", "pg_isready"]'),
    '["CMD", "pg_isready"]'
  );
});

test("generateCompose handles empty project cleanly", () => {
  const result = generateCompose({
    projectName: "",
    includeVersion: false,
    networks: ["app-network"],
    services: [],
  });
  assert.equal(result.yaml, "services: {}\n");
  assert.equal(result.env, "");
  assert.equal(result.envCount, 0);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].level, "info");
});

test("generateCompose builds complete YAML with .env extraction, named volumes, healthcheck, and depends_on", () => {
  const db = normalizeService({
    id: "db_1",
    name: "db",
    image: "postgres:16-alpine",
    ports: [{ host: "5432", container: "5432", protocol: "tcp" }],
    env: [
      { key: "POSTGRES_PASSWORD", value: "s3cr3t value", useEnvFile: true },
      { key: "TZ", value: "UTC", useEnvFile: false },
    ],
    volumes: [{ source: "pgdata", target: "/var/lib/postgresql/data", mode: "" }],
    networks: ["backend"],
    healthcheck: {
      enabled: true,
      test: "pg_isready -U postgres",
      interval: "10s",
      timeout: "5s",
      retries: 5,
    },
  });

  const api = normalizeService({
    id: "api_1",
    name: "api",
    sourceType: "build",
    buildContext: ".",
    dockerfile: "Dockerfile.prod",
    ports: [{ host: "3000", container: "3000", protocol: "udp" }],
    env: [{ key: "PORT", value: "3000", useEnvFile: false }],
    volumes: [{ source: "./src", target: "/app/src", mode: "ro" }],
    networks: ["backend"],
    dependsOn: [{ serviceId: "db_1", condition: "service_healthy" }],
  });

  const res = generateCompose({
    projectName: "demo-app",
    includeVersion: true,
    networks: ["backend"],
    services: [db, api],
  });

  assert.equal(res.warnings.length, 0);
  assert.equal(res.envCount, 1);
  assert.deepEqual(res.namedVolumes, ["pgdata"]);
  assert.deepEqual(res.usedNetworks, ["backend"]);

  assert.match(res.yaml, /^version: "3\.8"\nname: demo-app\n\nservices:/);
  assert.match(res.yaml, /POSTGRES_PASSWORD: \$\{POSTGRES_PASSWORD\}/);
  assert.match(res.yaml, /PORT: "3000"/);
  assert.match(res.yaml, /- "3000:3000\/udp"/);
  assert.match(res.yaml, /- \.\/src:\/app\/src:ro/);
  assert.match(res.yaml, /dockerfile: Dockerfile\.prod/);
  assert.match(res.yaml, /condition: service_healthy/);
  assert.match(res.yaml, /\nvolumes:\n  pgdata:\n/);
  assert.match(res.yaml, /\nnetworks:\n  backend:\n    driver: bridge\n/);

  assert.equal(res.env, '# db\nPOSTGRES_PASSWORD="s3cr3t value"\n');
});

test("validateProject flags duplicate names, port collisions, and missing healthcheck on service_healthy", () => {
  const s1 = normalizeService({
    id: "s1",
    name: "web",
    image: "nginx:alpine",
    ports: [{ host: "8080", container: "80", protocol: "tcp" }],
  });
  const s2 = normalizeService({
    id: "s2",
    name: "web",
    image: "nginx:alpine",
    ports: [{ host: "8080", container: "80", protocol: "tcp" }],
    dependsOn: [{ serviceId: "s1", condition: "service_healthy" }],
  });

  const warnings = validateProject({ services: [s1, s2] });
  const messages = warnings.map((w) => w.message).join("\n");

  assert.match(messages, /Duplicate service name "web"/);
  assert.match(messages, /Host port 8080\/tcp/);
  assert.match(messages, /has no healthcheck configured/);
});

test("all built-in stack presets and service templates generate valid configs with zero warnings", () => {
  assert.ok(SERVICE_TEMPLATES.length >= 23);
  assert.ok(STACK_PRESETS.length >= 20);

  for (const tpl of SERVICE_TEMPLATES) {
    assert.ok(tpl.category, `Template "${tpl.key}" missing category`);
    const svc = tpl.create();
    const out = generateCompose({
      projectName: "tpl-test",
      includeVersion: false,
      networks: ["app-network"],
      services: [svc],
    });
    assert.equal(
      out.warnings.length,
      0,
      `Expected service template "${tpl.key}" to have 0 warnings, got: ${JSON.stringify(out.warnings)}`
    );
  }

  for (const preset of STACK_PRESETS) {
    assert.ok(preset.category, `Preset "${preset.key}" missing category`);
    assert.ok(
      Array.isArray(preset.servicesPreview) && preset.servicesPreview.length > 0,
      `Preset "${preset.key}" missing servicesPreview`
    );
    const project = preset.build();
    const out = generateCompose(project);
    assert.equal(
      out.warnings.length,
      0,
      `Expected preset "${preset.key}" to have 0 warnings, got: ${JSON.stringify(out.warnings)}`
    );
    assert.ok(out.yaml.includes("services:"));
  }

  const lbPreset = STACK_PRESETS.find((p) => p.key === "nginx-multi-backend-lb");
  assert.ok(lbPreset, "Expected nginx-multi-backend-lb preset to exist");
  const lbOut = generateCompose(lbPreset.build());
  assert.match(lbOut.yaml, /nginx-lb:/);
  assert.match(lbOut.yaml, /api-1:/);
  assert.match(lbOut.yaml, /api-2:/);
  assert.match(lbOut.yaml, /api-3:/);
});

test("generateDeployGuide produces folder tree, build tips, and load balancer sample configs", () => {
  const lbPreset = STACK_PRESETS.find((p) => p.key === "nginx-multi-backend-lb");
  const lbGuide = generateDeployGuide(lbPreset.build());

  assert.equal(lbGuide.rootName, "multi-backend-lb");
  assert.equal(lbGuide.hasBuildServices, true);
  assert.match(lbGuide.treeText, /multi-backend-lb\//);
  assert.match(lbGuide.treeText, /docker-compose\.yml/);
  assert.match(lbGuide.treeText, /\.env/);
  assert.match(lbGuide.treeText, /Dockerfile\s+# Build \(api-1, api-2, api-3\)/);
  assert.match(lbGuide.treeText, /nginx\//);
  assert.match(lbGuide.treeText, /nginx\.conf/);
  assert.equal(lbGuide.sampleConfigs.length, 1);
  assert.equal(lbGuide.sampleConfigs[0].filename, "nginx/nginx.conf");
  assert.match(lbGuide.sampleConfigs[0].content, /server api-1:3000;/);
  assert.match(lbGuide.sampleConfigs[0].content, /server api-2:3000;/);
  assert.match(lbGuide.sampleConfigs[0].content, /server api-3:3000;/);

  const caddyPreset = STACK_PRESETS.find((p) => p.key === "caddy-multi-service-gateway");
  const caddyGuide = generateDeployGuide(caddyPreset.build());
  assert.match(caddyGuide.treeText, /services\//);
  assert.match(caddyGuide.treeText, /auth\//);
  assert.match(caddyGuide.treeText, /core\//);
  assert.match(caddyGuide.treeText, /Caddyfile\s+#/);
  assert.doesNotMatch(caddyGuide.treeText, /Caddyfile\//);
  assert.equal(caddyGuide.sampleConfigs.length, 1);
  assert.match(caddyGuide.sampleConfigs[0].content, /reverse_proxy auth-service:3001/);
  assert.match(caddyGuide.sampleConfigs[0].content, /reverse_proxy core-api:3002/);
});
