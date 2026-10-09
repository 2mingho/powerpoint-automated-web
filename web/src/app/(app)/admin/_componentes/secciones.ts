export type Seccion = { href: string; rotulo: string; icono: string; descripcion: string };

/* Una sola lista: la navegacion de seccion y el indice de la portada salen de aqui. */
export const SECCIONES: Seccion[] = [
  { href: "/admin/personas", rotulo: "Personas", icono: "UserRound", descripcion: "Cuentas, roles, herramientas permitidas y sesiones." },
  { href: "/admin/organizacion", rotulo: "Organización", icono: "Network", descripcion: "Unidades, quién las lidera y a quién reporta cada persona." },
  { href: "/admin/catalogo", rotulo: "Catálogo", icono: "ListOrdered", descripcion: "Estados y prioridades de tarea." },
  { href: "/admin/plantillas", rotulo: "Plantillas", icono: "Presentation", descripcion: "Plantillas PowerPoint para los reportes." },
  { href: "/admin/ia", rotulo: "IA", icono: "Cpu", descripcion: "Conexiones a proveedores y consumo." },
  { href: "/admin/actividad", rotulo: "Actividad", icono: "History", descripcion: "Registro de lo que se hace en la aplicación." },
];
