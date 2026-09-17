import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Koei Porcelain Trade Show",
    short_name: "Koei Show",
    description: "Internal Koei employee tool for product lookup at trade shows.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#254663",
    theme_color: "#254663",
    lang: "en",
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
