import { storyblokLoader } from "@storyblok/astro";
import { defineCollection } from "astro:content";
import { STORYBLOK_API_TOKEN } from "astro:env/server";

const storyblokCollection = defineCollection({
  loader: storyblokLoader({
    accessToken: STORYBLOK_API_TOKEN,
    apiOptions: {
      region: "eu",
    },
    version: "draft",
  }),
});

export const collections = {
  storyblok: storyblokCollection,
};
