# Browser Asset Store v1

## Purpose

The Web Variant Workspace can now accept real binary artifacts instead of only JSON manifests. Binary bytes are stored separately from gameplay/project JSON and are addressed by their SHA-256 digest.

```text
File selected by human or external Agent
        ↓
SHA-256 + media inspection
        ↓
IndexedDB content-addressed blob store
        ↓
bcs-asset://sha256/<digest>
        ↓
versioned Asset Manifest
        ↓
derived Look Pack + Variant Recipe
        ↓
Variant Compiler + Quality Gate
        ↓
runtime binding / preview / offline export
```

BCS still does not interpret prompts or call a generator. Upstream tools may produce an image, GLB, Flipbook, audio file, texture, or any other supported artifact; this store is the strict browser-side ingestion boundary.

## Persistence model

The browser database is named `block-creative-studio-assets` and contains two stores:

- `blobs`: raw `Blob` values keyed by `sha256:…`;
- `metadata`: filename, MIME type, byte length, media class, dimensions and creation time.

The same bytes are stored once even if they are reused in several semantic slots. Manifests and Variant Recipes remain in LocalStorage because they are small JSON documents. Large binary data never enters LocalStorage.

The storage is local to the current browser profile and site origin. GitHub Pages, localhost and another domain do not share one IndexedDB database. Exporting a manifest without exporting its binary bytes will therefore produce a resolvable contract but a missing-runtime-asset error on another machine.

## URI contract

Stored content is referenced through:

```text
bcs-asset://sha256/<64 lowercase hexadecimal characters>
```

The manifest also carries the corresponding `sha256:<digest>` as `contentHash`. The browser runtime refuses to treat a filename or mutable URL as an immutable production identity.

## Supported authoring roles

### Runtime-previewable in v1

- `background-image`
  - replaces `background.base`;
  - supports PNG, JPEG, WebP and AVIF;
  - previews in `reference-2d` and the current fixed-camera Three.js experiment;
  - is included in browser offline video export.
- `tile-face-image`
  - replaces `tile.face` independently from tile material and tile geometry;
  - supports transparent PNG, WebP and AVIF;
  - previews in `reference-2d` and is included in its offline export.

### Stored and contract-valid, but not rendered by the current Web passes

- `particle-sprite`;
- `flipbook` or transparent video;
- `audio`;
- `geometry-3d` (self-contained GLB only in v1);
- `texture-map`.

These roles can already be versioned, compiled and handed to a future/external renderer. The Web workspace deliberately reports them as **compilable** rather than falsely drawing a legacy fallback.

## Upload transaction

A successful upload performs the following operations:

1. reject empty or over-budget files;
2. compute SHA-256 with Web Crypto;
3. inspect image dimensions when supported;
4. store/deduplicate bytes in IndexedDB;
5. create a strict Asset Manifest;
6. copy the active Look Pack and replace one semantic slot;
7. create a new Variant Recipe referencing the derived Look;
8. compile the Variant and run the structural Quality Gate;
9. resolve the local Blob to an object URL for the active renderer.

A failure after step 4 does not discard the immutable blob automatically. This allows a corrected manifest to reference the same uploaded content without re-uploading it.

## Runtime binding

`RuntimeAssetBindings` is the bridge between a renderer-neutral Render Plan and browser-only object URLs. The Variant Compiler resolves a complete dependency closure, so binary assets referenced by Material Pack texture channels or Effect Pack layers are included even when they are not direct Look slots. It contains separate channels for:

- background image;
- tile-face image;
- particle sprites;
- texture maps;
- other binary assets;
- missing or unsupported bindings.

Object URLs are revoked whenever the active Render Plan changes or the component unmounts. Render stages wait for active images during `warmup()`, so offline video export cannot race ahead of asset decoding.

## Deletion semantics

Deleting a stored blob also removes imported manifests whose content hash directly refers to it, Browser-generated Look Packs that reference those manifests, and imported Variant Recipes that reference those Looks. Deletion is blocked when an unrelated Material Pack, Effect Pack, Look Pack or Variant still references the asset. A currently selected derived Variant falls back to `Current project Look`.

Built-in assets are not stored in IndexedDB and are not affected.

## Security boundary

- Files are treated as inert bytes until a declared renderer adapter consumes them.
- JavaScript, Web Worker and WASM execution remains disabled.
- SVG is rejected in v1 until a dedicated sanitizer/rasterizer exists; runtime-previewable images must be inert raster files.
- Plain `.gltf` is intentionally rejected because its external buffers/textures would make a single-file import incomplete. v1 accepts self-contained `.glb` only.
- MIME type and file extension are both checked against the selected semantic role. Runtime images are decoded before registration and constrained by edge/pixel budgets; GLB imports must contain a valid 2.0 header whose declared length matches the file.
- Formal video export is blocked when an active Render Plan references missing local bytes.

## Current limits

- No portable ZIP/project package containing both manifests and binary bytes yet.
- No thumbnail/contact-sheet generator for stored assets.
- No garbage collector based on global project references; deletion is explicit.
- No renderer pass for GLB, Flipbook, audio, texture-map or uploaded particle Sprite yet.
- No cloud synchronization or multi-user asset library.
- No perceptual quality scoring of uploaded art.

The next renderer-facing step is to make additional passes consume the same bindings rather than adding file-format-specific fields back into `ProjectSpec`.
