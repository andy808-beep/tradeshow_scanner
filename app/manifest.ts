import type { MetadataRoute } from "next";
import { zh } from "@/lib/i18n/zh-cn";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: zh.app.fullName,
    short_name: zh.app.shortName,
    description: zh.app.description,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#254663",
    theme_color: "#254663",
    lang: "zh-CN",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
