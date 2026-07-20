import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'BirdRadar',
    short_name: 'BirdRadar',
    description: 'Live birding radar with lifer chase odds and push alerts',
    start_url: '/',
    display: 'standalone',
    background_color: '#F8F9FA',
    theme_color: '#1B4332',
    orientation: 'portrait',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
