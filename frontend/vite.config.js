import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
    plugins: [
        react(),
        VitePWA({
            registerType: "autoUpdate",
            includeAssets: ["ncms-icon.svg"],
            manifest: {
                name: "National Case Management System",
                short_name: "NCMS",
                description: "Offline-capable child protection case management workspace.",
                theme_color: "#008c7a",
                background_color: "#eef2f5",
                display: "standalone",
                scope: "/",
                start_url: "/",
                icons: [
                    {
                        src: "/ncms-icon.svg",
                        sizes: "any",
                        type: "image/svg+xml",
                        purpose: "any maskable",
                    },
                ],
            },
            workbox: {
                globPatterns: ["**/*.{js,css,html,svg,woff2}"],
                runtimeCaching: [
                    {
                        urlPattern: function (_a) {
                            var url = _a.url;
                            return url.pathname.startsWith("/api/");
                        },
                        handler: "NetworkFirst",
                        options: {
                            cacheName: "ncms-api-cache",
                            networkTimeoutSeconds: 5,
                            expiration: {
                                maxEntries: 120,
                                maxAgeSeconds: 60 * 60 * 24,
                            },
                        },
                    },
                    {
                        urlPattern: function (_a) {
                            var request = _a.request;
                            return request.destination === "image";
                        },
                        handler: "CacheFirst",
                        options: {
                            cacheName: "ncms-image-cache",
                            expiration: {
                                maxEntries: 80,
                                maxAgeSeconds: 60 * 60 * 24 * 30,
                            },
                        },
                    },
                ],
            },
            devOptions: {
                enabled: true,
            },
        }),
    ],
    server: {
        host: "0.0.0.0",
        port: 5173,
        proxy: {
            "/api": {
                target: process.env.VITE_API_PROXY_TARGET || "http://localhost:8002",
                changeOrigin: true,
            },
        },
    },
});
