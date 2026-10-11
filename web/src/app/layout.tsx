import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Sugerencias } from "@/components/ui/sugerencias";

/*
 * Tres voces, como un panel de salidas: Barlow para leer, Barlow Condensed en
 * mayusculas para rotulos y titulares de panel, JetBrains Mono solo para datos
 * (horas, fechas, ids, contadores). next/font las descarga al compilar y las
 * sirve desde la propia app: ninguna peticion a Google en tiempo de uso.
 */
const cuerpo = Barlow({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--fuente-cuerpo" });
const rotulo = Barlow_Condensed({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--fuente-rotulo" });
const datos = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--fuente-datos" });

export const metadata: Metadata = {
  title: { default: "Newlink · Data Intelligence", template: "%s · Newlink" },
  description: "Reportes de social listening y coordinación de trabajo entre unidades.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eceef1" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1014" },
  ],
};

/* Antes de pintar: tema guardado o el del sistema. Evita el destello claro en modo oscuro. */
const arranqueTema = `try{var t=localStorage.getItem('nl-tema');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${cuerpo.variable} ${rotulo.variable} ${datos.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: arranqueTema }} />
      </head>
      <body className="min-h-dvh">
        {children}
        <Sugerencias />
      </body>
    </html>
  );
}
