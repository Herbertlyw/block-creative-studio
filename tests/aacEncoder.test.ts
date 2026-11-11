import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  native: true,
  registered: false,
  attempts: 0,
  failRegistration: false,
  softwareSupported: true,
  registrationGate: undefined as Promise<void> | undefined,
  probes: [] as unknown[],
}));
vi.mock('mediabunny', () => ({
  Quality: class {
    constructor(readonly options: unknown) {}
  },
  canEncodeAudio: async (_codec: string, options: unknown) => {
    state.probes.push(options);
    return state.native || (state.registered && state.softwareSupported);
  },
}));
vi.mock('@mediabunny/aac-encoder', () => ({
  registerAacEncoder: async () => {
    state.attempts++;
    await state.registrationGate;
    if (state.failRegistration) throw new Error('synthetic software encoder load failure');
    state.registered = true;
  },
}));
const options = () => ({ channels: 2 as const, bitrate: 192_000 });

beforeEach(() => {
  vi.resetModules();
  Object.assign(state, {
    native: true,
    registered: false,
    attempts: 0,
    failRegistration: false,
    softwareSupported: true,
    registrationGate: undefined,
    probes: [],
  });
});

it('retains the native encoder and probes the actual output channels, rate and bitrate', async () => {
  const { prepareAacEncoder } = await import('../src/exporter/aacEncoder');
  expect(await prepareAacEncoder(options())).toBe('browser');
  expect(state.attempts).toBe(0);
  expect(state.probes).toEqual([
    { numberOfChannels: 2, sampleRate: 48_000, quality: { options: { bitrate: 192_000 } } },
  ]);
});

it('loads once when native AAC is missing and keeps cancellation local to its export', async () => {
  state.native = false;
  let release!: () => void;
  state.registrationGate = new Promise<void>((resolve) => (release = resolve));
  const { prepareAacEncoder } = await import('../src/exporter/aacEncoder');
  const controller = new AbortController(),
    phases: string[] = [];
  let entered!: () => void;
  const enteringFallback = new Promise<void>((resolve) => (entered = resolve));
  const cancelled = prepareAacEncoder({
    ...options(),
    signal: controller.signal,
    onPhase: (phase) => {
      phases.push(phase);
      entered();
    },
  });
  const cancellation = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
  await enteringFallback;
  const other = prepareAacEncoder(options());
  controller.abort();
  await cancellation;
  release();
  expect(await other).toBe('software');
  expect(await prepareAacEncoder(options())).toBe('software');
  expect(state.attempts).toBe(1);
  expect(phases).toEqual(['audio-fallback']);
});

it('reports software preparation failure without poisoning an unchanged retry', async () => {
  state.native = false;
  state.failRegistration = true;
  const { prepareAacEncoder } = await import('../src/exporter/aacEncoder');
  await expect(prepareAacEncoder(options())).rejects.toMatchObject({
    code: 'AAC_ENCODER_LOAD_FAILED',
    phase: 'audio-fallback',
  });
  state.failRegistration = false;
  expect(await prepareAacEncoder(options())).toBe('software');
  expect(state.attempts).toBe(2);
});

it('reports an explicit unsupported codec when neither encoder can consume the output configuration', async () => {
  state.native = false;
  state.softwareSupported = false;
  const { prepareAacEncoder } = await import('../src/exporter/aacEncoder');
  await expect(prepareAacEncoder(options())).rejects.toMatchObject({
    phase: 'codec',
    code: 'ENCODER_UNSUPPORTED',
  });
});
