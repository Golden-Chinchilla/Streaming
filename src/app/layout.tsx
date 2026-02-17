import type { Metadata } from "next";
import { Inter, Outfit, JetBrains_Mono, Syne } from "next/font/google";
import "./globals.css";
import "@/plugins"; // Auto-register diagram plugins


const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Streaming",
  description: "Professional visualization studio",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="dark">
      <body
        className={`${inter.variable} ${outfit.variable} ${syne.variable} ${jetbrainsMono.variable} style-demo-theme antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
