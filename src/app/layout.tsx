import type { Metadata } from "next";
import { Quicksand } from "next/font/google";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import AppSidebar from "@/components/ui/app-sidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

const quicksand = Quicksand({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Pluto AI",
  description: "AI that leaves no detail behind & does beyond summarisation.",
  applicationName: "Pluto",
  authors: { name: "Divyansh Maurya", url: "https://github.com/DivyanshMauryaaa" },
  category: "AI Researcher for Founders",
  generator: "Next Js",
  abstract: "Dont let your company go down because of bad research, use Pluto AI.",
  appleWebApp: { capable: true, title: "Pluto AI", statusBarStyle: "black-translucent" },
  assets: "/Logo_banner.png",
  classification: "AI Research tool",
  icons: {
    icon: "/logo.svg",
    apple: "/logo.png",
    shortcut: "/logo.png",
  },
  keywords: [
    'AI',
    'artificial intelligence',
    'research',
    'summarisation',
    'automation',
    'knowledge management',
    'founder tools',
    'startup tools',
    'efficient research',
    'AI research assistant',
    'business research',
    'competitive analysis',
    'Pluto AI',
    'fast research',
    'accurate research',
    'document analysis',
    'productivity',
    'web app',
    'SaaS'
  ],
  openGraph: {
    type: 'website',
    description: 'Improve your research quality & efficiency by 70%',
    countryName: 'US',
    images: ['/Logo_banner.png', 'logo.png'],
  }
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className={`${quicksand.className} antialiased`}>
          <SidebarProvider>
            <AppSidebar />
            <SidebarTrigger />
            <main className='w-full p-6'>
              {children}
            </main>
          </SidebarProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
