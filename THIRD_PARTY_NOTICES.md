# Third-party notices

Block Creative Studio is distributed under the MIT License. Runtime and development dependencies remain subject to their own licenses.

| Dependency        | Version pinned by this repository | License                    | Purpose                                                                  |
| ----------------- | --------------------------------: | -------------------------- | ------------------------------------------------------------------------ |
| React / React DOM |                            19.2.8 | MIT                        | Human-first editor UI                                                    |
| Three.js          |                           0.185.1 | MIT                        | 3D scene, PBR materials, lighting, camera, particles and post-processing |
| Mediabunny        |                            1.54.0 | Mozilla Public License 2.0 | Browser-side WebCodecs integration and MP4 muxing                        |
| Vite              |                             8.2.2 | MIT                        | Development server and production bundling                               |
| Vitest            |                            4.1.11 | MIT                        | Automated tests                                                          |
| TypeScript        |                             5.8.3 | Apache-2.0                 | Static typing and compilation                                            |

The repository does not vendor these packages. `npm install` retrieves them from the configured package registry. Review each dependency's license text before redistribution, especially when producing a bundled commercial application. Mediabunny's MPL-2.0 obligations apply to modifications of MPL-covered files; this project imports the package without copying or modifying its source.
