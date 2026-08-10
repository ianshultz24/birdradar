'use client';

import { useEffect, useCallback } from 'react';
import { useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';

interface RadarPositionSyncProps {
  geoCenter: [number, number];
  radiusKm: number;
  onUpdate: (centerX: number, centerY: number, radiusPx: number) => void;
}

export default function RadarPositionSync({ geoCenter, radiusKm, onUpdate }: RadarPositionSyncProps) {
  const map = useMap();

  const sync = useCallback(() => {
    const centerPoint = map.latLngToContainerPoint(L.latLng(geoCenter[0], geoCenter[1]));

    // Compute the radius in pixels by projecting a point radiusKm north of center
    // and measuring the vertical pixel distance (north = decreasing lat → higher on screen)
    const dLat = (radiusKm / 6371) * (180 / Math.PI);
    const edgePoint = map.latLngToContainerPoint(
      L.latLng(geoCenter[0] + dLat, geoCenter[1])
    );
    const radiusPx = Math.abs(edgePoint.y - centerPoint.y);

    onUpdate(centerPoint.x, centerPoint.y, radiusPx);
  }, [map, geoCenter, radiusKm, onUpdate]);

  // Sync whenever props change (center or radius)
  useEffect(() => {
    sync();
  }, [sync]);

  // Sync on every map interaction that changes the pixel coordinates
  useMapEvents({
    move: sync,
    zoom: sync,
    zoomend: sync,
    resize: sync,
  });

  return null;
}
