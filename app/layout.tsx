import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import BottomNav from "@/components/bottom-nav";
import { InquiryProvider } from "@/components/inquiry-store";
import SiteHeader from "@/components/site-header";
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
  title: "Koei Porcelain · Trade show",
  description: "Internal tool for looking up products and building inquiries at trade shows.",
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
          <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-white shadow-sm print:max-w-none print:shadow-none">
            <SiteHeader />
            <main className="flex-1 px-4 pt-4 pb-24 print:p-0">{children}</main>
            <BottomNav />
          </div>
        </InquiryProvider>
      </body>
    </html>
  );
}
