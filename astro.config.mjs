// @ts-check
import { defineConfig, fontProviders } from "astro/config";
import node from "@astrojs/node";

// https://astro.build/config
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  security: {
    allowedDomains: [
      { hostname: "umamc.duckdns.org", protocol: "https" },
    ],
  },
  fonts: [
    {
      provider: fontProviders.local(),
      name: "AsapFont",
      cssVariable: "--FontAsap",
      options: {
        variants: [
            { weight: 400, style: "normal", src: ["./src/assets/fonts/Asap/Asap-Regular.woff2"] },
            { weight: 700, style: "normal", src: ["./src/assets/fonts/Asap/Asap-Bold.woff2"] },
            { weight: 400, style: "italic", src: ["./src/assets/fonts/Asap/Asap-Italic.woff2"] },
        ],
      },
    },
  ],
});