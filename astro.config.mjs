import { defineConfig, envField } from "astro/config"
import storyblok from '@storyblok/astro'
import tailwind from '@astrojs/tailwind'
import node from '@astrojs/node';
import mkcert from 'vite-plugin-mkcert'


export default defineConfig({
  env: {
    schema: {
      STORYBLOK_API_TOKEN: envField.string({ context: "server", access: "secret" }),
    }
  },

  integrations: [
    storyblok({
      accessToken: process.env.STORYBLOK_API_TOKEN,
      contentLayer: true,
      // enableFallbackComponent: true,
      apiOptions: {
        region: 'eu',
      },
      // livePreview: true,
      // bridge: {
      //   customParent: 'https://app.storyblok.com',
      // },
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
