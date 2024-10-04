import { defineConfig, envField } from "astro/config"
import storyblok from '@storyblok/astro'
import tailwind from '@astrojs/tailwind'
import node from '@astrojs/node';
import mkcert from 'vite-plugin-mkcert'

const { STORYBLOK_API_TOKEN, STORYBLOK_PREVIEW } = process.env

export default defineConfig({
  env: {
    schema: {
      STORYBLOK_API_TOKEN: envField.string({ context: "server", access: "secret" }),
      STORYBLOK_PREVIEW: envField.boolean({ context: "server", access: "secret", default: false }),
    }
  },

  integrations: [
    storyblok({
      accessToken: STORYBLOK_API_TOKEN,
      apiOptions: {
        region: 'eu',
      },
      livePreview: true,
      bridge: STORYBLOK_PREVIEW,
      // contentLayer: STORYBLOK_PREVIEW,
      enableFallbackComponent: true,
      customFallbackComponent: 'storyblok/Fallback',
      components: {
        page: 'storyblok/Page',
        feature: 'storyblok/Feature',
        grid: 'storyblok/Grid',
        teaser: 'storyblok/Teaser',
      },
    }),
    tailwind(),
  ],

  output: 'server',
  adapter: node({
    mode: 'standalone',
  }),

  vite: {
    plugins: [mkcert()],
  },
})
