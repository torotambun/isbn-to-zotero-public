import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ISBN to Zotero Mobile",
  description: "Resolve Indonesian and older book ISBNs, compare editions, and add the selected record to Zotero.",
  applicationName: "ISBN to Zotero",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "ISBN → Zotero" },
  other: { "codex-preview": "development", "mobile-web-app-capable": "yes" },
  icons: { icon: "/app-icon.svg", shortcut: "/app-icon.svg", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f5efe3",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
