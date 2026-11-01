import { createHash, randomBytes } from "node:crypto";
import { appendFile } from "node:fs/promises";

const summaryPath = process.env.GITHUB_STEP_SUMMARY;

async function summary(markdown) {
  if (summaryPath) await appendFile(summaryPath, `${markdown}\n`, "utf8");
}

async function probeSources() {
  const targets = [
    ["AMFI NAV catalog", "https://portal.amfiindia.com/spages/NAVAll.txt"],
    ["MFapi history", "https://api.mfapi.in/mf/129008"],
  ];
  const results = [];
  for (const [name, url] of targets) {
    const startedAt = performance.now();
    try {
      const response = await fetch(url, {
        headers: { "user-agent": "FundScope-W0-feasibility/1.0" },
        signal: AbortSignal.timeout(45000),
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      const elapsedMs = Math.round(performance.now() - startedAt);
      const ok = response.status >= 200 && response.status < 300;
      const contentType = response.headers.get("content-type") ?? "(none)";
      const result = { name, status: response.status, elapsedMs, bytes: bytes.length, contentType, ok };
      results.push(result);
      console.log(`${name}: HTTP ${response.status}; ${elapsedMs} ms; ${bytes.length} bytes; ${contentType}`);
    } catch (error) {
      const elapsedMs = Math.round(performance.now() - startedAt);
      const reason = error instanceof Error ? error.name : "request error";
      results.push({ name, status: reason, elapsedMs, bytes: 0, contentType: "(none)", ok: false });
      console.log(`${name}: ${reason}; ${elapsedMs} ms`);
    }
  }
  await summary([
    "### W0: source reachability from `ubuntu-latest`",
    "| Source | Result | Latency | Response bytes | Content type |",
    "|---|---:|---:|---:|---|",
    ...results.map((r) => `| ${r.name} | ${r.status} | ${r.elapsedMs} ms | ${r.bytes} | ${r.contentType} |`),
    "",
  ].join("\n"));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

async function githubApi(path, init = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "FundScope-W0-feasibility/1.0",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) {
    console.error(`GitHub API request failed with HTTP ${response.status} (${response.headers.get("x-github-request-id") ?? "no request id"})`);
    throw new Error(`GitHub API HTTP ${response.status}`);
  }
  return response;
}

async function releaseRoundTrip() {
  const repository = process.env.GITHUB_REPOSITORY;
  const tag = `w0-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
  const fileName = "fundscope-w0-50mib-roundtrip.bin";
  const payload = randomBytes(50 * 1024 * 1024);
  const expectedHash = createHash("sha256").update(payload).digest("hex");
  let releaseId;
  let testResult;
  try {
    const created = await githubApi(`/repos/${repository}/releases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tag_name: tag, name: `Temporary W0 feasibility ${tag}`, prerelease: true }),
    });
    const release = await created.json();
    releaseId = release.id;
    const uploadUrl = `${release.upload_url.replace(/\{\?name,label\}$/, "")}?name=${encodeURIComponent(fileName)}`;
    const uploadStartedAt = performance.now();
    const uploaded = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        "content-type": "application/octet-stream",
        "content-length": String(payload.length),
        "x-github-api-version": "2022-11-28",
        "user-agent": "FundScope-W0-feasibility/1.0",
      },
      body: payload,
      signal: AbortSignal.timeout(180000),
    });
    if (!uploaded.ok) throw new Error(`Release asset upload HTTP ${uploaded.status}`);
    const asset = await uploaded.json();
    const uploadMs = Math.round(performance.now() - uploadStartedAt);
    const downloadStartedAt = performance.now();
    const downloaded = await fetch(asset.url, {
      headers: {
        accept: "application/octet-stream",
        authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        "x-github-api-version": "2022-11-28",
        "user-agent": "FundScope-W0-feasibility/1.0",
      },
      signal: AbortSignal.timeout(180000),
    });
    if (!downloaded.ok) throw new Error(`Release asset download HTTP ${downloaded.status}`);
    const received = Buffer.from(await downloaded.arrayBuffer());
    const downloadMs = Math.round(performance.now() - downloadStartedAt);
    const actualHash = createHash("sha256").update(received).digest("hex");
    if (received.length !== payload.length || actualHash !== expectedHash) {
      throw new Error(`Release round-trip mismatch: got ${received.length} bytes`);
    }
    testResult = { ok: true, size: received.length, uploadMs, downloadMs, sha256: actualHash };
    console.log(`Release asset round trip OK: ${received.length} bytes; upload ${uploadMs} ms; download ${downloadMs} ms; SHA-256 ${actualHash}`);
  } finally {
    if (releaseId) {
      const deleted = await fetch(`https://api.github.com/repos/${repository}/releases/${releaseId}`, {
        method: "DELETE",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          "x-github-api-version": "2022-11-28",
          "user-agent": "FundScope-W0-feasibility/1.0",
        },
        signal: AbortSignal.timeout(30000),
      });
      if (!deleted.ok && deleted.status !== 404) console.log(`Temporary release cleanup returned HTTP ${deleted.status}`);
      const tagDeleted = await fetch(`https://api.github.com/repos/${repository}/git/refs/tags/${tag}`, {
        method: "DELETE",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          "x-github-api-version": "2022-11-28",
          "user-agent": "FundScope-W0-feasibility/1.0",
        },
        signal: AbortSignal.timeout(30000),
      });
      if (!tagDeleted.ok && tagDeleted.status !== 404) console.log(`Temporary tag cleanup returned HTTP ${tagDeleted.status}`);
    }
  }
  await summary([
    "### W0: GitHub Release asset persistence",
    `- Temporary 50 MiB asset: ${testResult.size} bytes uploaded and downloaded; SHA-256 matched.`,
    `- Upload: ${testResult.uploadMs} ms; download: ${testResult.downloadMs} ms.`,
    "- Temporary release and tag were deleted after the round trip.",
  ].join("\n"));
}

if (process.argv[2] === "sources") await probeSources();
else if (process.argv[2] === "release") await releaseRoundTrip();
else throw new Error("Usage: node .github/w0/feasibility.mjs <sources|release>");
