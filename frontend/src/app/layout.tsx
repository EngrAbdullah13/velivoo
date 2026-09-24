import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./marketing-overrides.css";
import "./landing-expansion.css";
import "./landing-more.css";
import "./landing-motion.css";
import "./landing-palette.css";
export const metadata: Metadata={title:"Velivoo | Email marketing built for momentum",description:"Campaigns, automation, and customer data for teams that want to grow without the busywork.",icons:{icon:[{url:"/brand/velivoo-mark.png",type:"image/png"}],apple:"/brand/velivoo-mark.png"}};
export default function RootLayout({children}:{children:ReactNode}){return <html lang="en"><body>{children}</body></html>}
