# asset-designer

Standalone tool for building and polishing the **placeable assets** (buildings
and props) that go onto RMRF maps — the same role the `vehicle-designer/` plays
for vehicles.

## What it does
- Renders each asset from the shared manifest in isolation so it can be tuned.
- Measures each asset's bounding box to compute its real grid **footprint**.
- Writes/updates the shared manifest (id, name, footprint, HP, accent, category).

## The contract
- The shared manifest lives in the **game** project:
  `../riposte-run/js/assets.manifest.js`. Both this tool and the game read it.
- **Dependency is one-way:** this tool imports from `../riposte-run/`; the
  shipped game NEVER imports from here. (The game stays self-contained for
  Amplify; these dev tools are not deployed.)

## Status
Scaffold only. The manifest exists and indexes the current `Buildings.js`
makers; the viewer UI is not built yet.
