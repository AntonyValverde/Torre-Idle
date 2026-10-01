import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// `npm run icons` genera favicon e iconos PWA desde public/icon.svg.
// El adaptable de Android y el de iPhone van a sangre con el fondo del juego
// (el sistema los recorta), en vez del margen blanco del preset.
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, padding: 0, resizeOptions: { background: '#12102a' } },
    apple: { ...minimal2023Preset.apple, padding: 0, resizeOptions: { background: '#12102a' } },
  },
  images: ['public/icon.svg'],
});
