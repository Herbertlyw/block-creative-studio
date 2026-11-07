import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUDIT_ROOT = path.join(ROOT, 'docs', 'reference', 'v2');

function readJson(name) {
  const file = path.join(AUDIT_ROOT, name);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function unique(values, label) {
  const seen = new Set();
  for (const value of values) {
    invariant(typeof value === 'string' && value.length > 0, `${label} contains an invalid ID.`);
    invariant(!seen.has(value), `${label} contains duplicate ID: ${value}`);
    seen.add(value);
  }
  return seen;
}

const states = readJson('FULL_FRAME_STATE_INDEX_V1.json');
const events = readJson('EVENT_INSTANCE_INDEX_V1.json');
const lineage = readJson('ASSET_LINEAGE_V2.json');
const profile = readJson('REFERENCE_PROFILE_V2.json');
const mapping = readJson('FIXED_CAMERA_RENDERER_MAPPING_V1.json');
const golden = readJson('GOLDEN_SCENE_INDEX_V1.json');

const sourceSha = states.sourceVideo?.sha256;
invariant(/^[0-9a-f]{64}$/u.test(sourceSha), 'Frame index source SHA-256 is invalid.');
for (const [label, sha] of [
  ['event index', events.sourceVideoSha256],
  ['asset lineage', lineage.sourceVideoSha256],
  ['reference profile', profile.sourceVideoSha256],
  ['golden scenes', golden.sourceVideoSha256],
]) {
  invariant(sha === sourceSha, `${label} source SHA does not match the frame index.`);
}

const frameCount = states.sourceVideo?.frameCount;
invariant(Number.isInteger(frameCount) && frameCount > 0, 'Source frameCount must be a positive integer.');
invariant(Array.isArray(states.intervals) && states.intervals.length > 0, 'Frame index has no intervals.');
let expectedFrame = 0;
let coveredFrames = 0;
const intervalIds = [];
for (const interval of states.intervals) {
  intervalIds.push(interval.id);
  invariant(interval.startFrame === expectedFrame,
    `Frame coverage gap/overlap before ${interval.id}: expected ${expectedFrame}, found ${interval.startFrame}.`);
  invariant(Number.isInteger(interval.endFrame) && interval.endFrame >= interval.startFrame,
    `Invalid frame range for ${interval.id}.`);
  invariant(Array.isArray(interval.activeSystems) && interval.activeSystems.includes('scene.base'),
    `${interval.id} must include scene.base.`);
  coveredFrames += interval.endFrame - interval.startFrame + 1;
  expectedFrame = interval.endFrame + 1;
}
unique(intervalIds, 'frame interval IDs');
invariant(expectedFrame === frameCount, `Frame coverage ends at ${expectedFrame - 1}; expected ${frameCount - 1}.`);
invariant(coveredFrames === frameCount, 'Covered frame count does not equal source frame count.');
invariant(states.coverage?.firstFrame === 0, 'Coverage firstFrame must be 0.');
invariant(states.coverage?.lastFrame === frameCount - 1, 'Coverage lastFrame is inconsistent.');
invariant(states.coverage?.coveredFrames === frameCount, 'Coverage summary is inconsistent.');
invariant(states.coverage?.gapFrames === 0 && states.coverage?.overlapFrames === 0,
  'Committed full-frame index must have zero gaps and overlaps.');
invariant(states.coverage?.intervalCount === states.intervals.length, 'Interval count summary is inconsistent.');

invariant(Array.isArray(events.events), 'Event index events must be an array.');
unique(events.events.map((event) => event.id), 'event IDs');
let reviewedCount = 0;
for (const event of events.events) {
  invariant(Number.isInteger(event.startFrame) && Number.isInteger(event.peakFrame) && Number.isInteger(event.endFrame),
    `Event ${event.id} has non-integer frame bounds.`);
  invariant(0 <= event.startFrame && event.startFrame <= event.peakFrame && event.peakFrame <= event.endFrame,
    `Event ${event.id} has invalid frame ordering.`);
  invariant(event.endFrame < frameCount, `Event ${event.id} exceeds source frame range.`);
  if (event.reviewStatus === 'reviewed') {
    reviewedCount += 1;
    invariant(event.confidence === 'manual-reviewed', `Reviewed event ${event.id} must be manual-reviewed.`);
  }
}
invariant(events.eventCount === events.events.length, 'eventCount summary is inconsistent.');
invariant(events.reviewedEventCount === reviewedCount, 'reviewedEventCount summary is inconsistent.');

invariant(Array.isArray(lineage.atoms) && lineage.atoms.length > 0, 'Asset lineage has no atoms.');
const atomIds = unique(lineage.atoms.map((atom) => atom.id), 'semantic atom IDs');
const vocabulary = Object.fromEntries(
  Object.entries(lineage.vocabularies ?? {}).map(([name, values]) => [name, new Set(values)]),
);
for (const atom of lineage.atoms) {
  invariant(vocabulary.kind?.has(atom.kind), `${atom.id} has unknown kind ${atom.kind}.`);
  invariant(vocabulary.status?.has(atom.status), `${atom.id} has unknown evidence status ${atom.status}.`);
  invariant(vocabulary.replaceability?.has(atom.replaceability),
    `${atom.id} has unknown replaceability ${atom.replaceability}.`);
  invariant(vocabulary.engineRequirement?.has(atom.requirement?.engine),
    `${atom.id} has unknown engine requirement.`);
  invariant(vocabulary.triggerRequirement?.has(atom.requirement?.whenTriggered),
    `${atom.id} has unknown trigger requirement.`);
  invariant(vocabulary.referenceRequirement?.has(atom.requirement?.referenceProfile),
    `${atom.id} has unknown reference requirement.`);
  invariant(vocabulary.implementationStatus?.has(atom.implementationStatus),
    `${atom.id} has unknown implementation status ${atom.implementationStatus}.`);
  invariant(atom.requirement && typeof atom.requirement === 'object', `${atom.id} has no requirement policy.`);
  invariant(atom.spatialRepresentations && typeof atom.spatialRepresentations === 'object',
    `${atom.id} has no renderer representation mapping.`);
  invariant(typeof atom.allowsNone === 'boolean', `${atom.id} has no allowsNone policy.`);
  invariant(Array.isArray(atom.dependencies), `${atom.id} dependencies must be an array.`);
  for (const dependency of atom.dependencies) {
    invariant(atomIds.has(dependency), `${atom.id} depends on unknown atom ${dependency}.`);
    invariant(dependency !== atom.id, `${atom.id} cannot depend on itself.`);
  }
}
invariant(lineage.summary?.atomCount === lineage.atoms.length, 'Asset lineage atomCount is inconsistent.');
invariant(lineage.summary?.observedCount === lineage.atoms.filter((atom) => atom.status === 'observed').length,
  'Asset lineage observedCount is inconsistent.');
invariant(lineage.summary?.inferredCount === lineage.atoms.filter((atom) => atom.status === 'inferred').length,
  'Asset lineage inferredCount is inconsistent.');
invariant(lineage.summary?.unresolvedCount === lineage.atoms.filter((atom) => atom.status === 'unresolved').length,
  'Asset lineage unresolvedCount is inconsistent.');
invariant(lineage.summary?.coreRequiredCount === lineage.atoms.filter((atom) => atom.requirement.engine === 'core-required').length,
  'Asset lineage coreRequiredCount is inconsistent.');
invariant(lineage.summary?.referenceRequiredCount === lineage.atoms.filter((atom) => atom.requirement.referenceProfile === 'required').length,
  'Asset lineage referenceRequiredCount is inconsistent.');
invariant(lineage.observedPalette?.colorCount === lineage.observedPalette?.tokens?.length,
  'Observed palette colorCount is inconsistent.');
invariant(lineage.observedPalette?.tokens?.includes('rose'), 'Full-video audit must preserve the observed rose token.');

for (const group of lineage.groupConstraints ?? []) {
  invariant(group.id && Array.isArray(group.members) && group.members.length > 0, 'Invalid group constraint.');
  for (const member of group.members) {
    invariant(atomIds.has(member), `Group ${group.id} references unknown atom ${member}.`);
  }
}

const profileIds = unique([
  ...(profile.requiredAtoms ?? []),
  ...(profile.optionalAtoms ?? []),
  ...(profile.captureOnlyAtoms ?? []),
], 'reference profile atom IDs');
invariant(profileIds.size === atomIds.size, 'Reference profile must classify every semantic atom exactly once.');
for (const atomId of atomIds) invariant(profileIds.has(atomId), `Reference profile does not classify ${atomId}.`);
for (const atomId of profileIds) invariant(atomIds.has(atomId), `Reference profile references unknown atom ${atomId}.`);
for (const group of profile.minimumFeedbackGroups ?? []) {
  for (const member of group.members ?? []) {
    invariant(atomIds.has(member), `Reference feedback group ${group.id} references unknown atom ${member}.`);
  }
}

const mappedIds = [];
for (const [representation, ids] of Object.entries(mapping.mappingByRepresentation ?? {})) {
  invariant(Array.isArray(ids), `Mapping ${representation} must be an array.`);
  for (const atomId of ids) {
    invariant(atomIds.has(atomId), `Renderer mapping references unknown atom ${atomId}.`);
    mappedIds.push(atomId);
  }
}
const uniqueMappedIds = unique(mappedIds, 'fixed-camera renderer atom mappings');
invariant(uniqueMappedIds.size === atomIds.size, 'Every atom must have exactly one primary fixed-camera representation.');
for (const atomId of atomIds) invariant(uniqueMappedIds.has(atomId), `Renderer mapping omits ${atomId}.`);

for (const slice of mapping.migrationOrder ?? []) {
  invariant(Number.isInteger(slice.slice) && slice.slice > 0, 'Migration slice index must be positive.');
  for (const atomId of slice.atoms ?? []) {
    invariant(atomIds.has(atomId), `Migration slice ${slice.name} references unknown atom ${atomId}.`);
  }
}

unique((golden.scenes ?? []).map((scene) => scene.id), 'Golden Scene IDs');
for (const scene of golden.scenes ?? []) {
  invariant(0 <= scene.startFrame && scene.startFrame <= scene.peakFrame && scene.peakFrame <= scene.endFrame,
    `Golden Scene ${scene.id} has invalid frame ordering.`);
  invariant(scene.endFrame < frameCount, `Golden Scene ${scene.id} exceeds source frame range.`);
  invariant(Array.isArray(scene.expectedAtoms) && scene.expectedAtoms.length > 0,
    `Golden Scene ${scene.id} has no expected atoms.`);
  for (const atomId of scene.expectedAtoms) {
    invariant(atomIds.has(atomId), `Golden Scene ${scene.id} references unknown atom ${atomId}.`);
  }
}

console.log(`✓ full-frame reference audit covers ${frameCount.toLocaleString('en-US')} frames with no gaps`);
console.log(`✓ validated ${events.events.length} event windows (${reviewedCount} manually reviewed)`);
console.log(`✓ validated ${lineage.atoms.length} semantic atoms and complete requirement classification`);
console.log(`✓ every atom has one fixed-camera cinematic representation mapping`);
console.log(`✓ validated ${(golden.scenes ?? []).length} Golden Scene definitions`);
