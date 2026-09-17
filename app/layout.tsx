import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { InquiryProvider } from "@/components/inquiry-store";
import PwaRegister from "@/components/pwa-register";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://tradeshow.koeico.com"),
  title: "Koei Porcelain · Trade show",
  description:
    "Internal tool for looking up products and building inquiries at trade shows.",
  applicationName: "Koei Porcelain Trade Show",
  appleWebApp: {
    capable: true,
    title: "Koei Show",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export const viewport: Viewport = {
  themeColor: "#254663",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">
        <InquiryProvider>
          <PwaRegister />
          <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-white shadow-sm print:max-w-none print:shadow-none">
            {children}
          </div>
        </InquiryProvider>
      </body>
    </html>
  );
}
