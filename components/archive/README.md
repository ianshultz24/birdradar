# Archived components

Nothing in this directory is rendered by the app. The files are kept **intact and unmodified** so the
feature can be reinstated later if we change our mind.

## `RadarOverlay.tsx` + `RadarPositionSync.tsx`

The rotating radar sweep that used to be drawn over the map, gated by the `showRadarAnimation` setting.

**Why it was removed**

1. *Product.* The sweep reads as gimmicky for a field tool — it decorates the map without telling a
   birder anything the dotted search-radius circle doesn't already say.
2. *Rendering.* `RadarPositionSync` subscribed to Leaflet's `move` and `zoom` events and called
   `onUpdate` → `setRadarCenter({ x, y })` in `Map.tsx` on **every animation frame**. That re-rendered
   the entire map subtree mid-zoom, which in turn called `setLatLng()` on all ~400 markers and
   clobbered Leaflet's in-flight zoom-animation transforms — the markers visibly drifted out of sync
   with the tiles. It was also the app's only unbounded `requestAnimationFrame` loop.

**What would have to change to bring it back**

The overlay must never drive React state from a map event. Keep the container position in a ref that
the `move`/`zoom` handlers write to directly, and let `RadarOverlay`'s existing rAF loop read that ref
each frame. Alternatively, render the sweep inside a Leaflet pane (via `L.DomUtil` / a custom layer) so
Leaflet's own zoom animation transforms it along with the tiles, and drop `RadarPositionSync` entirely.

The `showRadarAnimation` key is still present in `AppSettings` (`lib/ebird.ts`), marked deprecated, so
stored and cross-device-synced settings blobs are unaffected.
