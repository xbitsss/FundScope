import { createServer } from 'vite';
import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';

const count = Number(process.env.FUNDSCOPE_PERF_FUNDS || 14_200);
const rounds = Math.max(1, Number(process.env.FUNDSCOPE_PERF_ROUNDS || 3));
const now = 20_500 * 86_400_000;
const categories = ['Large Cap', 'Flexi Cap', 'Corporate Bond', 'Liquid', 'Balanced Advantage'];
const amcs = ['Alpha Mutual Fund', 'Beta Mutual Fund', 'Nifty Asset Management'];
const server = await createServer({ configFile: 'vite.config.ts', server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });

try {
  const { computeScreenerView, defaultScreenerFilters } = await server.ssrLoadModule('/src/domain/screener/filters.ts');
  const { ScreenerEngine } = await server.ssrLoadModule('/src/engine/core.ts');
  const funds = Array.from({ length: count }, (_, index) => ({
    code: index + 1,
    isinGrowth: null,
    isinReinvestment: null,
    name: index % 7 === 0 ? `Nifty 50 Index Fund ${index}` : `Synthetic Scheme ${index}`,
    amc: amcs[index % amcs.length],
    category: categories[index % categories.length],
    assetClass: ['equity', 'debt', 'hybrid'][index % 3],
    classRuleId: 'PERF_SYNTHETIC',
    taxonomyVersion: 1,
    subCategory: categories[index % categories.length],
    structure: index % 13 === 0 ? 'close' : 'open',
    plan: index % 4 === 0 ? 'Regular' : 'Direct',
    option: index % 5 === 0 ? 'IDCW' : 'Growth',
    nav: 10 + (index % 700) / 10,
    navDate: 20_500,
    history: [],
    metrics: { cagr_1y: index % 17 === 0 ? null : (index % 220) / 10, cagr_3y: (index % 400) / 10 },
    management: index % 2 ? 'Active' : 'Passive',
    group: `Group ${index % 5}`,
    riskBand: ['Low', 'Medium', 'High'][index % 3],
    philosophy: 'Blend/Unspecified',
    speciality: index % 2 ? ['Index'] : [],
    lifecycle: 'active',
  }));
  const measure = (fn) => {
    const start = performance.now();
    fn();
    return performance.now() - start;
  };
  const samples = { searchKeystroke: [], categoryToggle: [], metricRange: [] };
  const engineSamples = { searchKeystroke: [], categoryToggle: [], metricRange: [], sortSwitch: [] };
  const buildSamples = [];
  const buildProfiles = [];
  let engine;
  for (let run = 0; run < 3; run += 1) {
    const buildStart = performance.now();
    const profile = {};
    engine = new ScreenerEngine(funds, (phase, milliseconds) => { profile[phase] = milliseconds; });
    buildSamples.push(performance.now() - buildStart);
    buildProfiles.push(profile);
  }
  const engineBuildMs = [...buildSamples].sort((a, b) => a - b)[1];
  for (let round = 0; round < rounds; round += 1) {
    for (const search of ['n', 'ni', 'nif', 'nift', 'nifty', 'nifty ', 'nifty 5', 'nifty 50', 'nifty 50 ', 'nifty 50 i', 'nifty 50 in', 'nifty 50 ind', 'nifty 50 inde', 'nifty 50 index']) {
      samples.searchKeystroke.push(measure(() => computeScreenerView(funds, { ...defaultScreenerFilters, search }, now)));
    }
    samples.categoryToggle.push(measure(() => computeScreenerView(funds, { ...defaultScreenerFilters, assetClasses: ['equity'] }, now)));
    samples.metricRange.push(measure(() => computeScreenerView(funds, { ...defaultScreenerFilters, metrics: [{ id: 'cagr_1y', min: 10, max: 20, excludeMissing: true }] }, now)));
    for (const search of ['n', 'ni', 'nif', 'nift', 'nifty', 'nifty ', 'nifty 5', 'nifty 50', 'nifty 50 ', 'nifty 50 i', 'nifty 50 in', 'nifty 50 ind', 'nifty 50 inde', 'nifty 50 index']) {
      engineSamples.searchKeystroke.push(measure(() => engine.query({ ...defaultScreenerFilters, search }, { id: 'name', desc: false }, now)));
    }
    engineSamples.categoryToggle.push(measure(() => engine.query({ ...defaultScreenerFilters, assetClasses: ['equity'] }, { id: 'name', desc: false }, now)));
    engineSamples.metricRange.push(measure(() => engine.query({ ...defaultScreenerFilters, metrics: [{ id: 'cagr_1y', min: 10, max: 20, excludeMissing: true }] }, { id: 'name', desc: false }, now)));
    engineSamples.sortSwitch.push(measure(() => engine.query(defaultScreenerFilters, { id: 'cagr_3y', desc: true }, now)));
  }
  const summary = Object.fromEntries(Object.entries(samples).map(([name, values]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return [name, { samples: values.length, p50Ms: sorted[Math.floor((sorted.length - 1) * 0.5)], p95Ms: sorted[Math.floor((sorted.length - 1) * 0.95)], maxMs: sorted.at(-1) }];
  }));
  const report = {
    schemaVersion: 2,
    capturedAt: new Date().toISOString(),
    environment: { runtime: `Node ${process.version}`, cpuThrottle: 'none', browser: null, viewport: null },
    dataset: { count, synthetic: true, source: 'deterministically generated records shaped like Fund; no user or market data' },
    caveat: 'This is a reproducible Node measurement of the reference implementation and the in-process optimized engine on synthetic data. It is not a throttled-phone browser measurement: this workspace has no Playwright dependency, browser binary, or local snapshot. Worker message transfer, paint latency, scroll FPS, heap, INP and CLS are not represented.',
    reference: summary,
    optimizedEngine: { build: { samples: buildSamples, firstMs: buildSamples[0], p50Ms: engineBuildMs, firstPhaseBreakdown: buildProfiles[0] }, interactions: Object.fromEntries(Object.entries(engineSamples).map(([name, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return [name, { samples: values.length, p50Ms: sorted[Math.floor((sorted.length - 1) * 0.5)], p95Ms: sorted[Math.floor((sorted.length - 1) * 0.95)], maxMs: sorted.at(-1) }];
    })) },
  };
  const destination = process.env.FUNDSCOPE_PERF_OUTPUT || 'docs/PERF_before.json';
  await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await server.close();
}
