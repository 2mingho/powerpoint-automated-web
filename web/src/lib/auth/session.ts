import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getIronSession, type SessionOptions } from "iron-session";
import { db } from "@/lib/db";

export type DatosSesion = { userId?: number; token?: string };

export const opcionesSesion: SessionOptions = {
  password: process.env.SESSION_SECRET as string,
  cookieName: "nl_sesion",
  // El sello caduca con la cookie: sin ttl, iron-session sella para 14 dias y
  // una cookie copiada seguiria valiendo mucho despues de que el navegador la tire.
  ttl: 60 * 60 * 12,
  cookieOptions: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 12,
  },
};

export async function obtenerSesion() {
  // La sesion es dato de peticion: nunca entra en el prerenderizado.
  await connection();
  return getIronSession<DatosSesion>(await cookies(), opcionesSesion);
}

export const HERRAMIENTAS = {
  reports: "Generar Reporte",
  classification: "Clasificación de Data",
  file_merge: "Unión de Archivos",
  csv_analysis: "Análisis Rápido CSV",
  tasks: "Gestión de Tareas",
} as const;
export type Herramienta = keyof typeof HERRAMIENTAS;

export type UsuarioActual = {
  id: number;
  username: string;
  email: string;
  role: string;
  isAdmin: boolean;
  areaId: number | null;
  areaName: string | null;
  managerId: number | null;
  herramientas: Herramienta[];
  tourCompletado: boolean;
};

function herramientasDe(role: string, permitidas: string | null): Herramienta[] {
  const todas = Object.keys(HERRAMIENTAS) as Herramienta[];
  if (role === "admin" || !permitidas) return todas;
  try {
    const lista = JSON.parse(permitidas);
    return Array.isArray(lista) ? todas.filter((h) => lista.includes(h)) : todas;
  } catch {
    return todas;
  }
}

/*
 * El usuario de la peticion, o null. Memorizado por peticion con cache():
 * un layout, una pagina y tres componentes de servidor lo piden y solo se
 * consulta una vez.
 *
 * Reproduce las dos puertas de Flask: cuenta desactivada y cierre forzado de
 * sesion (session_token rotado por un admin) dejan la sesion sin efecto.
 */
export const usuarioActual = cache(async (): Promise<UsuarioActual | null> => {
  const sesion = await obtenerSesion();
  if (!sesion.userId) return null;

  const u = await db.users.findUnique({
    where: { id: sesion.userId },
    include: { areas: { select: { name: true } } },
  });
  if (!u || !u.is_active) return null;
  if (u.force_logout) return null;
  if (u.session_token && sesion.token !== u.session_token) return null;

  return {
    id: u.id,
    username: u.username,
    email: u.email,
    role: u.role,
    isAdmin: u.role === "admin",
    areaId: u.area_id,
    areaName: u.areas?.name ?? null,
    managerId: u.manager_id,
    herramientas: herramientasDe(u.role, u.allowed_tools),
    tourCompletado: !!u.tour_completed_at,
  };
});

/* Para paginas: sin sesion, a /login. */
export async function exigirUsuario(): Promise<UsuarioActual> {
  const u = await usuarioActual();
  if (!u) redirect("/login");
  return u;
}

export function tieneHerramienta(u: UsuarioActual, h: Herramienta) {
  return u.isAdmin || u.herramientas.includes(h);
}
