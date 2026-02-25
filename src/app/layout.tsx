import type { Metadata } from "next";
import Link from "next/link";
import { Noto_Sans_JP, Noto_Serif_JP } from "next/font/google";
import "./globals.css";

const bodyFont = Noto_Sans_JP({
  variable: "--font-body",
  subsets: ["latin"],
});

const headingFont = Noto_Serif_JP({
  variable: "--font-heading",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "EDINET Screening Studio",
  description: "EDINET財務データを収集し、条件スクリーニングを行うローカル分析環境",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className={`${bodyFont.variable} ${headingFont.variable}`}>
        <div className="app-root">
          <header className="topbar">
            <div>
              <p className="topbar-eyebrow">Local Quant Workspace</p>
              <h1>EDINET Screening Studio</h1>
            </div>
            <nav className="topbar-nav" aria-label="主要メニュー">
              <Link href="/screening">絞り込み検索</Link>
              <Link href="/settings">重み・条件設定</Link>
            </nav>
          </header>
          <main className="page-shell">{children}</main>
        </div>
      </body>
    </html>
  );
}
