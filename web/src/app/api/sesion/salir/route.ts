import { NextResponse } from "next/server";
import { obtenerSesion, usuarioActual } from "@/lib/auth/session";
import { registrarActividad } from "@/lib/actividad";

export async function GET(req: Request) {
  const u = await usuarioActual();
  if (u) await registrarActividad(u.id, "logout", `Cierre de sesión: ${u.username}`);
  const sesion = await obtenerSesion();
  sesion.destroy();
  return NextResponse.redirect(new URL("/login", req.url));
}
