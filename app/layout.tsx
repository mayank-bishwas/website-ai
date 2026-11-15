import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Website Assistant | Shahi Meva x iSellOnline",
    template: "Website Assistant | Shahi Meva x iSellOnline",
  },
  description: "A conversational website and inventory assistant for Shahi Meva.",
  icons: {
    icon: ["/favicon.svg", "/favicon.ico", "/favicon.png"],
    shortcut: "/favicon.svg",
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "Website Assistant | Shahi Meva x iSellOnline",
    description: "A conversational website and inventory assistant for Shahi Meva.",
    images: [
      {
        url: "/og_image.png",
        width: 2880,
        height: 1566,
        alt: "Shahi Meva Website Assistant",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Website Assistant | Shahi Meva x iSellOnline",
    description: "A conversational website and inventory assistant for Shahi Meva.",
    images: ["/og_image.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Work+Sans:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
