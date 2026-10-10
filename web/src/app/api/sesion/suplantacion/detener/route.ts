import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { origenAjeno } from "@/lib/api";
import { registrarActividad } from "@/lib/actividad";
import { esAdminProtegido } from "@/lib/admin/protegido";
import { obtenerSesion } from "@/lib/auth/session";

/*
 * Volver a la cuenta de administracion (stop_impersonation). Es un POST como el cierre
 * de sesion: un GET con efectos lo dispararia cualquier pagina ajena. Si la sesion del
 * administrador ya no vale (la cerraron o se desactivo), no se le devuelve nada: login.
 */
export async function POST(req: Request) {
  if (origenAjeno(req)) return NextResponse.json({ error: "Petición rechazada: no viene de esta aplicación." }, { status: 403 });
  const sesion = await obtenerSesion();
  const origen = sesion.suplantadoPor;
  if (!origen) return new Response(null, { status: 303, headers: { Location: "/" } });
  const a = await db.users.findUnique({ where: { id: origen.id }, select: { id: true, username: true, email: true, role: true, is_active: true, force_logout: true, session_token: true } });
  if (!a || !a.is_active || a.force_logout || a.role !== "admin" || !esAdminProtegido(a.email) || !a.session_token || a.session_token !== origen.token) {
    sesion.destroy();
    return new Response(null, { status: 303, headers: { Location: "/login" } });
  }
  sesion.userId = a.id;
  sesion.token = a.session_token;
  sesion.suplantadoPor = undefined;
  await sesion.save();
  await registrarActividad(a.id, "impersonate_stop", "Regreso a cuenta admin");
  return new Response(null, { status: 303, headers: { Location: "/admin/personas" } });
}

export function GET() {
  return NextResponse.json({ error: "Para volver a tu cuenta usa el botón del aviso." }, { status: 405, headers: { Allow: "POST" } });
}
