import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Linklet — Systems Engineering URL Shortener",
  description: "Production-grade, high-concurrency URL shortener and performance laboratory",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased bg-[#0a0c14] text-slate-100 selection:bg-indigo-500/30">
        {children}
      </body>
    </html>
  );
}

