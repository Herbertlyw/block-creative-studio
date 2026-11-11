# Third-party notices

Block Creative Studio is distributed under the MIT License. Runtime and development dependencies remain subject to their own licenses.

| Dependency              | Version pinned by this repository | License                                        | Purpose                                                                  |
| ----------------------- | --------------------------------: | ---------------------------------------------- | ------------------------------------------------------------------------ |
| React / React DOM       |                            19.2.8 | MIT                                            | Human-first editor UI                                                    |
| Three.js                |                           0.185.1 | MIT                                            | 3D scene, PBR materials, lighting, camera, particles and post-processing |
| Mediabunny              |                            1.54.0 | Mozilla Public License 2.0                     | Browser-side WebCodecs integration and MP4 muxing                        |
| @mediabunny/aac-encoder |                            1.54.0 | MPL-2.0; bundled FFmpeg AAC: LGPL-2.1-or-later | Optional software AAC encoder when native browser AAC is unavailable     |
| Vite                    |                             8.2.2 | MIT                                            | Development server and production bundling                               |
| Vitest                  |                            4.1.11 | MIT                                            | Automated tests                                                          |
| TypeScript              |                             5.8.3 | Apache-2.0                                     | Static typing and compilation                                            |

The repository does not vendor these packages. `npm install` retrieves them from the configured package registry. Review each dependency's license text before redistribution, especially when producing a bundled commercial application. Mediabunny's MPL-2.0 obligations apply to modifications of MPL-covered files; this project imports the package without copying or modifying its source.

The AAC extension includes a WebAssembly build of FFmpeg's AAC encoder. Its wrapper is copyright 2026-present Vanilagy and contributors under MPL-2.0; FFmpeg remains under its own LGPL-2.1-or-later terms. This project uses the unmodified, version-pinned package. The extension's source, bridge and build instructions are available at [Mediabunny v1.54.0](https://github.com/Vanilagy/mediabunny/tree/v1.54.0/packages/aac-encoder); FFmpeg's [source](https://github.com/FFmpeg/FFmpeg), [license](https://github.com/FFmpeg/FFmpeg/blob/master/COPYING.LGPLv2.1) and [redistribution information](https://www.ffmpeg.org/legal.html) are maintained upstream. Replacing or rebuilding the extension does not require changing project media or the studio's audio contract. Binary distributors must provide the corresponding FFmpeg source and build information with their distribution, as required by those terms; the npm wrapper's MPL metadata does not replace FFmpeg's license.
