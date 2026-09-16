import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { SiteNav } from "@/components/site-nav";

import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Parity — fair value for tokenized pre-IPO stocks",
  description:
    "Every PreStock has two prices: what it's backed by, and what it trades for. Parity shows the gap and lets you act on it.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="bg-canvas text-ink flex min-h-full flex-col">
        <SiteNav />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}

function SiteFooter() {
  return (
    <footer className="border-hairline mt-24 border-t">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 md:px-8">
        <p className="text-ink-faint max-w-prose text-xs leading-relaxed">
          Parity reads prices from the public PreStocks API and routes trades through Jupiter on
          Solana mainnet. Not financial advice. A discount to fair value does not guarantee a
          profit — a private company&rsquo;s token can trade below its backing indefinitely.
        </p>
      </div>
    </footer>
  );
}
