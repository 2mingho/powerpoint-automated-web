import type { Herramienta } from "@/lib/auth/session";

export type ItemNav = {
  href: string;
  rotulo: string;
  icono: string; // nombre de lucide-react
  herramienta?: Herramienta;
  soloEquipo?: boolean;
  soloAdmin?: boolean;
  grupo: "trabajo" | "datos" | "sistema";
  movil?: boolean; // aparece en la barra inferior del movil
};

/*
 * Una sola lista de navegacion para la barra lateral, la barra inferior del
 * movil y la paleta de comandos. Agrupada por lo que la persona viene a hacer,
 * no por como esta hecho por dentro.
 */
export const NAVEGACION: ItemNav[] = [
  { href: "/", rotulo: "Inicio", icono: "LayoutDashboard", grupo: "trabajo", movil: true },
  { href: "/tareas", rotulo: "Mis tareas", icono: "ListChecks", herramienta: "tasks", grupo: "trabajo", movil: true },
  { href: "/solicitudes", rotulo: "Solicitudes", icono: "ArrowLeftRight", grupo: "trabajo", movil: true },
  { href: "/equipo", rotulo: "Equipo", icono: "Users", herramienta: "tasks", soloEquipo: true, grupo: "trabajo" },
  { href: "/reportes/nuevo", rotulo: "Generar reporte", icono: "FileChartColumn", herramienta: "reports", grupo: "datos" },
  { href: "/reportes", rotulo: "Mis reportes", icono: "FolderOpen", herramienta: "reports", grupo: "datos" },
  { href: "/clasificacion", rotulo: "Clasificación", icono: "Tags", herramienta: "classification", grupo: "datos" },
  { href: "/union", rotulo: "Unión de archivos", icono: "Combine", herramienta: "file_merge", grupo: "datos" },
  { href: "/analisis", rotulo: "Análisis CSV", icono: "Sheet", herramienta: "csv_analysis", grupo: "datos" },
  { href: "/admin", rotulo: "Administración", icono: "Settings", soloAdmin: true, grupo: "sistema" },
];

export const GRUPOS: Record<ItemNav["grupo"], string> = {
  trabajo: "Trabajo",
  datos: "Datos",
  sistema: "Sistema",
};
