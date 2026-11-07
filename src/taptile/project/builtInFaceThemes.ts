import { stableHash } from './stableHash';
import type {
  AssetManifestEntry,
  FaceAssembly,
  FacePart,
  TapTileProjectV2,
  ThemeVariant,
  TileArchetype,
} from './types';

export const CHAIN_COMBO_UI_THEME_ID = 'chain-combo-ui-v1';

interface ChainComboFaceAssetSpec {
  id: string;
  name: string;
  fileName: string;
  contentHash: string;
}

interface ChainComboFaceTreatment {
  id: string;
  name: string;
  assetId: string;
  transform: FacePart['transform'];
}

export const CHAIN_COMBO_FACE_ASSETS: readonly ChainComboFaceAssetSpec[] = Object.freeze([
  { id: 'chain-combo-watermelon', name: '西瓜', fileName: 'theme_fruitorchard_1.png', contentHash: '691d73fdec9f97f5b7c093743d3878a8e7705197b24d503191e0702743961497' },
  { id: 'chain-combo-cherries', name: '樱桃', fileName: 'theme_fruitorchard_2.png', contentHash: '0f662e9fa3a25a0bb31b81a8d847223c91bbc010e84f0c9dad357646018b64c3' },
  { id: 'chain-combo-banana', name: '香蕉', fileName: 'theme_fruitorchard_3.png', contentHash: '6de6eeb7f41ea62a3d481348f416b1eb8992c4de7fa71c2227b55fe9a4fad14b' },
  { id: 'chain-combo-mango', name: '芒果', fileName: 'theme_fruitorchard_4.png', contentHash: '2dfd4fb30a93b9d7cc1b033d83c98d3c20ff09a0c07ed0b6c38315e65f608e4f' },
  { id: 'chain-combo-pear', name: '梨', fileName: 'theme_fruitorchard_5.png', contentHash: '9c276ab53e83a518fc567a7bef6219e8e12be8447c9ed0c67adc295029a0cb90' },
  { id: 'chain-combo-kiwi', name: '猕猴桃', fileName: 'theme_fruitorchard_6.png', contentHash: '90c1af9d8ca7f001717ac0d1173b7af1e565ad7ac8998a5800909f7e1bd5dd55' },
  { id: 'chain-combo-mangosteen', name: '山竹', fileName: 'theme_fruitorchard_7.png', contentHash: '601f107048dd71b5f3521f430c4c36887a5bd80199af1e1fb9be4fdd0baf9396' },
  { id: 'chain-combo-grapes', name: '葡萄', fileName: 'theme_fruitorchard_8.png', contentHash: '468512196fd44606d398e12a28d1afb1acefeeaaf7f46156f2dcfbdfb04565e5' },
  { id: 'chain-combo-blueberries', name: '蓝莓', fileName: 'theme_fruitorchard_9.png', contentHash: '19414b5fc0f4a17f232a66809f6ed6528c04c07e4cca5a4d579a71cdfd1662b5' },
  { id: 'chain-combo-blue-fruit', name: '蓝色海果', fileName: 'theme_seaside_7.png', contentHash: 'c6d7f65bc3a4679966d9eb30957266fa69cbe81f54cac3ddca4edd7fc70e17b4' },
  { id: 'chain-combo-sprout', name: '嫩芽', fileName: 'theme_seasongarden_5.png', contentHash: '58cef1dcaefd393298e7898eedbb6332e57ca1d53ed3409174984fe8a64dfba5' },
  { id: 'chain-combo-acorn', name: '橡果', fileName: 'theme_seasongarden_7.png', contentHash: '31535b61e1cb2b1cec5cf1e599d425acd7d8c461d87c97a33d381f08626c258b' },
  { id: 'chain-combo-maple-leaf', name: '枫叶', fileName: 'theme_seasongarden_8.png', contentHash: '732a267898ac099093ce53e0e78f6beec285669652da53da835efff4dc83c597' },
  { id: 'chain-combo-butterfly', name: '蝴蝶', fileName: 'theme_seasongarden_9.png', contentHash: 'dceed4312cd51261c5bb9fbb790e3e18c96359861e611834f39e145a3226ab92' },
]);

function assetEntry(spec: ChainComboFaceAssetSpec): AssetManifestEntry {
  return {
    id: spec.id,
    kind: 'image',
    source: { type: 'builtin', uri: `/assets/taptile/faces/chain-combo-ui/${spec.fileName}` },
    width: 256,
    height: 256,
    hasAlpha: true,
    contentHash: spec.contentHash,
    version: '1',
  };
}

function faceAssemblyId(archetype: TileArchetype): string {
  return `face-chain-combo-${archetype.id.replace(/[^a-z0-9_-]+/giu, '-')}`;
}

const NORMAL_FACE_TRANSFORM: FacePart['transform'] = Object.freeze({
  x: 0.5,
  y: 0.51,
  scaleX: 0.9,
  scaleY: 0.9,
  rotationDeg: 0,
  opacity: 1,
});

const CHAIN_COMBO_FACE_TREATMENTS: readonly ChainComboFaceTreatment[] = Object.freeze([
  ...CHAIN_COMBO_FACE_ASSETS.map((spec) => ({
    id: spec.id,
    name: spec.name,
    assetId: spec.id,
    transform: NORMAL_FACE_TRANSFORM,
  })),
  {
    id: 'chain-combo-maple-diagonal',
    name: '斜向枫叶',
    assetId: 'chain-combo-maple-leaf',
    transform: { x: 0.5, y: 0.51, scaleX: 0.72, scaleY: 0.72, rotationDeg: -38, opacity: 1 },
  },
  {
    id: 'chain-combo-blue-fruit-sideways',
    name: '横向蓝色海果',
    assetId: 'chain-combo-blue-fruit',
    transform: { x: 0.5, y: 0.51, scaleX: 0.72, scaleY: 0.72, rotationDeg: 90, opacity: 1 },
  },
]);

function shuffledFaceTreatments(seed: string | number): ChainComboFaceTreatment[] {
  return [...CHAIN_COMBO_FACE_TREATMENTS].sort((left, right) => {
    const leftScore = stableHash({ seed, treatmentId: left.id }, 'face-shuffle');
    const rightScore = stableHash({ seed, treatmentId: right.id }, 'face-shuffle');
    return leftScore.localeCompare(rightScore) || left.id.localeCompare(right.id);
  });
}

function imagePart(id: string, assetId: string, transform: FacePart['transform']): FacePart {
  return { id, source: { kind: 'image', assetId }, transform };
}

function assemblyFor(
  archetype: TileArchetype,
  treatment: ChainComboFaceTreatment,
): FaceAssembly {
  return {
    id: faceAssemblyId(archetype),
    name: `${archetype.displayName} · ${treatment.name}`,
    mode: 'overlay-on-body',
    bodyInteraction: 'show-body',
    parts: [imagePart(`${archetype.id}-face`, treatment.assetId, treatment.transform)],
  };
}

function applyRandomizedBindings(project: TapTileProjectV2, seed: string | number): void {
  const archetypes = Object.values(project.visuals.archetypes).sort((left, right) => left.id.localeCompare(right.id));
  const orderedTreatments = shuffledFaceTreatments(seed);
  const bodyStyleIds = Object.keys(project.visuals.bodyStyles).sort();
  if (bodyStyleIds.length === 0) throw new Error('CHAIN_COMBO_THEME_BODY_STYLE_MISSING');
  const bindings: ThemeVariant['bindings'] = {};
  for (const [index, archetype] of archetypes.entries()) {
    const treatment = orderedTreatments[index % orderedTreatments.length]!;
    const assembly = assemblyFor(archetype, treatment);
    project.visuals.faceAssemblies[assembly.id] = assembly;
    bindings[archetype.id] = {
      faceAssemblyId: assembly.id,
      bodyStyleId: bodyStyleIds[index % bodyStyleIds.length]!,
    };
  }
  project.visuals.themes[CHAIN_COMBO_UI_THEME_ID] = {
    id: CHAIN_COMBO_UI_THEME_ID,
    name: '连消彩绘素材',
    bindings,
  };
}

export function randomizeChainComboFaceTheme(project: TapTileProjectV2, seed: string | number): void {
  for (const spec of CHAIN_COMBO_FACE_ASSETS) project.assets.entries[spec.id] = assetEntry(spec);
  applyRandomizedBindings(project, seed);
}

export function ensureChainComboFaceTheme(project: TapTileProjectV2): TapTileProjectV2 {
  const next = structuredClone(project);
  let needsBindings = !next.visuals.themes[CHAIN_COMBO_UI_THEME_ID];
  for (const spec of CHAIN_COMBO_FACE_ASSETS) {
    const expected = assetEntry(spec);
    if (JSON.stringify(next.assets.entries[spec.id]) !== JSON.stringify(expected)) {
      next.assets.entries[spec.id] = expected;
    }
  }
  const existingTheme = next.visuals.themes[CHAIN_COMBO_UI_THEME_ID];
  for (const archetype of Object.values(next.visuals.archetypes)) {
    const binding = existingTheme?.bindings[archetype.id];
    if (!binding || !next.visuals.faceAssemblies[binding.faceAssemblyId]) {
      needsBindings = true;
      break;
    }
  }
  if (needsBindings) {
    randomizeChainComboFaceTheme(next, stableHash({ projectId: next.id, seed: next.director.seed }, 'chain-combo-default'));
  }
  return JSON.stringify(next) === JSON.stringify(project) ? project : next;
}
