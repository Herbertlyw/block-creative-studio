import { build, createServer } from 'vite';
import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const demo = process.argv.includes('--demo');
const notices = [];
// Inspect actual bundled static and dynamic modules, not merely source names in
// the filesystem. The runtime probe independently exercises both input paths.
const result = await build({
  configFile: 'vite.config.ts',
  logLevel: 'silent',
  build: { write: false, sourcemap: false, minify: false },
});
const chunks = (Array.isArray(result) ? result : [result])
  .flatMap((item) => item.output ?? [])
  .filter((item) => item.type === 'chunk');
const modules = [...new Set(chunks.flatMap((chunk) => Object.keys(chunk.modules)))].map((path) =>
  relative(process.cwd(), path).replaceAll('\\', '/'),
);
const existing = (path) => modules.some((item) => item === path);
const rendered = (path) =>
  chunks.some((chunk) =>
    Object.entries(chunk.modules).some(
      ([name, info]) =>
        relative(process.cwd(), name).replaceAll('\\', '/') === path && info.renderedLength > 0,
    ),
  );
const legacy = [
  'src/state/useStudioModel.ts',
  'src/domain/gameEngine.ts',
  'src/domain/projectValidation.ts',
  'src/director/presentationCompiler.ts',
  'src/exporter/offlineVideoExporter.ts',
].filter(existing);
// The render-contract catalog imports the old module's immutable schema ID.
// Rollup retains that constant only; reject the actual old evaluator/adapter.
const oldPresentation =
  'src/nativeReference/games/block-placement/presentation/legacyPresentationAdapter.ts';
const oldPresentationExports = chunks.flatMap((chunk) =>
  Object.entries(chunk.modules)
    .filter(([name]) => relative(process.cwd(), name).replaceAll('\\', '/') === oldPresentation)
    .flatMap(([, info]) => info.renderedExports),
);
const forbiddenPresentation = oldPresentationExports.filter(
  (name) => name !== 'BLOCK_PLACEMENT_PRESENTATION_SCHEMA_ID',
);
const referenceLegacy = [
  ...(forbiddenPresentation.length
    ? [`${oldPresentation}: ${forbiddenPresentation.join(', ')}`]
    : []),
  ...['src/nativeReference/games/block-placement/migrations/blockPlacementV1.ts'].filter(rendered),
];
const candidates = [
  'src/reference2d/Reference2DScene.ts',
  'src/nativeReference/games/block-placement/render/BlockPlacementReferenceScene.ts',
  'src/games/block-placement/rendering/authoredScene.ts',
  'src/games/block-placement/rendering/BBScene2D.ts',
  'src/games/block-placement/calibrated/scene.ts',
].filter(existing);
// Do not count a genuine transport adapter as another complete scene. Verify
// that it constructs the canonical class and forwards sampled frames without
// owning a canvas context or a second painting pipeline.
const observedAdapter = 'src/games/block-placement/calibrated/scene.ts';
const adapterSource = existing(observedAdapter) ? await readFile(observedAdapter, 'utf8') : '';
const adapterIsTransport =
  adapterSource.includes('new BBScene2D(') &&
  adapterSource.includes('scene.renderAt(readBBFrame(packet))') &&
  !adapterSource.includes('getContext(') &&
  !adapterSource.includes('paintObserved');
const scenes = candidates.filter((path) => path !== observedAdapter || !adapterIsTransport);
const server = await createServer({
  configFile: 'vite.config.ts',
  logLevel: 'silent',
  server: { middlewareMode: true, ws: false },
  appType: 'custom',
});
let runtime;
try {
  const { compileNativeTake } = await server.ssrLoadModule('/src/contracts/compileNativeTake.ts');
  const { prepareCalibratedRenderer } = await server.ssrLoadModule(
    '/src/contracts/calibratedRenderer.ts',
  );
  const { inlineBrowserStudioReferences } = await server.ssrLoadModule(
    '/src/contracts/browserAssetReferences.ts',
  );
  const { createBBTimelineSource, readBBFrame } = await server.ssrLoadModule(
    '/src/games/block-placement/planning/timelineFrameSource.ts',
  );
  const {
    createNativeWork,
    createNativeTake,
    appendNativeMove,
    generateNativeMachineTake,
    nativeTakeState,
  } = await server.ssrLoadModule('/src/contracts/nativeWorkAuthor.ts');
  let work = await createNativeTake(await createNativeWork(), 'human-drag');
  const first = nativeTakeState(work, 'human-drag').pieces[0];
  if (!first) throw new Error('Synthetic work is missing its first candidate.');
  work = await appendNativeMove(work, 'human-drag', first.id, 0, 0, 'human', [
    { frameOffset: 0, x: 0.2, y: 0.8 },
    { frameOffset: 15, x: 0.2, y: 0.2 },
  ]);
  work = await generateNativeMachineTake(work, 'machine', 1);
  const ordinary = work.project;
  const { syntheticObservedFixture } = await server.ssrLoadModule(
    '/tests/fixtures/syntheticObserved.ts',
  );
  const observed = (await syntheticObservedFixture()).document;
  const human = compileNativeTake(ordinary, 'human-drag').timelinePlan,
    machine = compileNativeTake(ordinary, 'machine').timelinePlan;
  const observation = prepareCalibratedRenderer(
    (await inlineBrowserStudioReferences(observed, {})).document,
    'observed-take',
  );
  const inputs = [
    { name: 'human', plan: human, source: createBBTimelineSource(human) },
    { name: 'machine', plan: machine, source: createBBTimelineSource(machine) },
    { name: 'observed', plan: observation.timelinePlan, source: observation.frameSource },
  ];
  runtime = inputs.map(({ name, plan, source }) => {
    const first = plan.actions[0];
    if (!first) throw new Error(`${name}: missing action`);
    const start = Math.min(
        source.totalFrames - 1,
        Math.ceil(first.startSeconds * source.fps - 1e-7),
      ),
      commit = Math.min(source.totalFrames - 1, Math.ceil(first.commitSeconds * source.fps - 1e-7));
    const packet = source.evaluate(start),
      frame = readBBFrame(packet),
      committed = source
        .evaluate(commit)
        .semanticEvents.some((event) => event.type === 'block-placement.placement-committed');
    return {
      name,
      payloadSchemaId: packet.payloadSchemaId,
      totalFrames: source.totalFrames,
      fps: source.fps,
      sampledFrame: frame.frameIndex,
      activeActionId: frame.activeAction?.actionId ?? null,
      expectedActionId: first.actionId,
      drag: frame.drag !== null,
      committed,
      logicalStateHash: frame.rules.logicalStateHash,
      rackDrawables: frame.rackDrawables.length,
    };
  });
} finally {
  await server.close();
}
const schemas = [...new Set(runtime.map((item) => item.payloadSchemaId))];
const findings = [];
// A common scene class is not enough while whole board/rack/piece drawing is
// still selected by the observation origin. Keep this as a failing structural
// assertion until those responsibilities are unified as independent layers.
const sceneSource = await readFile('src/games/block-placement/rendering/BBScene2D.ts', 'utf8');
if (
  /if\s*\(\s*observed\s*&&\s*observedLook\s*\)\s*observed\.(?:boardLayer|pieces|rack)\s*\(/.test(
    sceneSource,
  )
)
  (demo ? notices : findings).push(
    '观察和普通外观仍使用不同绘制层；展示检查接受共用规则、计划、帧、会话和导出下的外观层差异，严格绘制层合并检查仍未通过。',
  );
const authorSource = await readFile('src/components/NativeWorkAuthor.tsx', 'utf8');
if (/const\s+locked\s*=\s*!!work\.source\s*\|\|\s*!!work\.pointer/.test(authorSource)) {
  const referenceEditor = await readFile('src/components/ReferenceVideoNotes.tsx', 'utf8');
  if (
    !demo ||
    !existing('src/contracts/mergeObservedEdit.ts') ||
    !referenceEditor.includes('继续编辑当前复刻作品')
  )
    findings.push('含来源或指针的作品缺少恢复、重确认及保留素材的编辑入口。');
  else notices.push('复刻动作在观察编辑器重新确认；普通录制面板不会绕过已确认轨道。');
}
if (legacy.length) findings.push(`旧工作台/供给仍进入生产构建：${legacy.join('、')}`);
if (referenceLegacy.length)
  findings.push(
    `参考适配器仍向生产构建引入旧完整帧源或 V1 迁移模块：${referenceLegacy.join('、')}`,
  );
if (!adapterIsTransport) findings.push('观察驱动尚未证明只转交共同帧与唯一场景。');
if (scenes.length !== 1)
  findings.push(`生产构建中仍有 ${scenes.length} 个已知完整 BB 2D 场景：${scenes.join('、')}`);
if (schemas.length !== 1) findings.push(`实际普通与观察帧合同仍不同：${schemas.join('、')}`);
if (
  runtime.some(
    (item) => item.activeActionId !== item.expectedActionId || !item.drag || !item.committed,
  )
)
  findings.push('共同帧探针没有同时观察到动作身份、拖动和提交事件。');
// A single label or a renamed wrapper alone is not sufficient: until a
// canonical plan/evaluator and scene have real cross-input evidence, fail.
if (
  !existing('src/games/block-placement/planning/bbTimelinePlan.ts') ||
  !existing('src/games/block-placement/planning/timelineFrameSource.ts') ||
  !existing('src/games/block-placement/rendering/BBScene2D.ts')
)
  findings.push('尚未检测到进入生产构建的唯一完整 2D 场景；不可仅凭共同帧或合同名称判定通过。');
for (const path of [
  'src/components/BBPlaybackControls.tsx',
  'src/components/BBTimelinePlayerContext.tsx',
  'src/components/useBBTimelinePlayer.ts',
])
  if (!existing(path)) findings.push(`生产构建缺少共同播放器：${path}`);
// Run the real browser workflow from the current source. It records the actual
// evaluator and scene calls, switches two independently calibrated Takes, and
// independently decodes newly exported mono/stereo audio and video. A stale
// stored report or a renamed wrapper is not accepted as evidence.
let browserEvidence = null;
let observationEvidence = null;
if (!demo) {
  const browser = spawnSync(process.execPath, ['scripts/verify-browser-workbench.mjs'], {
    encoding: 'utf8',
    timeout: 600000,
    maxBuffer: 8_000_000,
  });
  if (browser.status !== 0) {
    findings.push(
      `浏览器主线验证失败（退出码 ${browser.status ?? '无'}）：${(browser.stderr || browser.error?.message || browser.stdout || '没有诊断').slice(-1600)}`,
    );
  } else
    try {
      const report = JSON.parse(browser.stdout);
      const phases = [
        'human-drag-preview',
        'human-drag-export',
        'machine-preview',
        'machine-export',
        'observed-preview',
        'observed-export',
      ];
      if (
        report.legacyWorkbenchRenders !== 0 ||
        !report.multiTake?.firstHash ||
        !report.multiTake?.alternateHash ||
        report.multiTake.firstHash === report.multiTake.alternateHash ||
        phases.some(
          (name) =>
            !report.probe?.some(
              (item) =>
                item.phase === name &&
                item.scene === 'BBScene2D' &&
                item.evaluations > 0 &&
                item.draws > 0,
            ),
        ) ||
        ['human', 'machine', 'observedFirst', 'observedAlternate', 'synthetic'].some(
          (name) => !report.audioChecks?.[name]?.events?.length,
        )
      )
        throw new Error('缺少实际帧、场景、多 Take 或音频事件证据');
      browserEvidence = {
        browser: report.browser,
        viewportWidth: report.viewportWidth,
        deviceScaleFactor: report.deviceScaleFactor,
        humanSamples: report.humanSamples,
        multiTake: report.multiTake,
        probe: report.probe,
        audioChecks: report.audioChecks,
      };
    } catch (error) {
      findings.push(`浏览器证据无效：${error instanceof Error ? error.message : String(error)}`);
    }
  const observation = spawnSync(process.execPath, ['scripts/verify-blank-observation.mjs'], {
    encoding: 'utf8',
    timeout: 300000,
    maxBuffer: 4_000_000,
  });
  if (observation.status !== 0)
    findings.push(
      `空白观察表浏览器验证失败（退出码 ${observation.status ?? '无'}）：${(observation.stderr || observation.error?.message || observation.stdout || '没有诊断').slice(-1600)}`,
    );
  else
    try {
      const report = JSON.parse(observation.stdout);
      if (
        report.actions !== 3 ||
        !report.source ||
        report.previewFrame <= 0 ||
        !report.audio?.events?.some((item) => item.id.includes('placement')) ||
        !report.audio?.events?.some((item) => item.id.includes('clear'))
      )
        throw new Error('缺少三步输入、预览或声音证据');
      observationEvidence = {
        browser: report.browser,
        source: report.source,
        actions: report.actions,
        entry: report.entry,
        previewFrame: report.previewFrame,
        audio: report.audio,
      };
    } catch (error) {
      findings.push(`观察输入证据无效：${error instanceof Error ? error.message : String(error)}`);
    }
}
console.log(
  JSON.stringify(
    {
      mode: demo ? 'demo-workflow' : 'strict-painting-unification',
      status: findings.length ? 'failed' : 'passed',
      notices,
      legacy,
      referenceLegacy,
      scenes,
      runtime,
      browserEvidence,
      observationEvidence,
      findings,
    },
    null,
    2,
  ),
);
if (findings.length) process.exitCode = 1;
