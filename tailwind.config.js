import preset from './tailwind.preset.js';

/** @type {import('tailwindcss').Config} */
export default {
  presets: [preset],
  content: ['./frontend/**/*.{ts,tsx,js,jsx}'],
  // Base + components already ship in the core CSS bundle that Oscarr loads globally — we only
  // need utilities here. Keep this config lean to avoid bloating the plugin's CSS bundle.
  corePlugins: { preflight: false },
  plugins: [],
};
