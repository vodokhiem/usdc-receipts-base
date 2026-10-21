import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "USDC receipts on Base",
  description: "A small indexer that turns confirmed USDC transfers on Base into receipts you can link to.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        <header className="border-b border-neutral-200 dark:border-neutral-800">
          <div className="mx-auto max-w-4xl px-4 py-3 flex items-center justify-between">
            <Link href="/" className="font-medium">
              USDC receipts <span className="text-neutral-500">· Base</span>
            </Link>
            <a className="text-sm underline decoration-neutral-400" href="https://github.com/vodokhiem/usdc-receipts-base" target="_blank" rel="noreferrer">
              source
            </a>
          </div>
        </header>
        <main className="mx-auto w-full max-w-4xl px-4 py-8 flex-1">{children}</main>
        <footer className="mx-auto max-w-4xl px-4 py-6 text-xs text-neutral-500">
          Reads only. Rows are written once a transfer has 12 confirmations; each run re-scans the last 32 blocks so a shallow reorg is corrected.
        </footer>
      </body>
    </html>
  );
}
