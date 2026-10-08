import "server-only";
import { NextResponse } from "next/server";
import { usuarioActual, tieneHerramienta, type Herramienta, type UsuarioActual } from "@/lib/auth/session";

/*
 * Envoltorio para rutas de API: sesion valida, herramienta permitida y
 * errores con forma { error } en espanol. Toda ruta de /api usa esto.
 */
export class ErrorApi extends Error {
  constructor(public status: number, mensaje: string, public extra?: Record<string, unknown>) { super(mensaje); }
}

export function ok<T>(datos: T, status = 200) { return NextResponse.json(datos, { status }); }

export function conUsuario<C>(
  manejador: (req: Request, u: UsuarioActual, ctx: C) => Promise<Response>,
  opts: { herramienta?: Herramienta; soloAdmin?: boolean } = {},
) {
  return async (req: Request, ctx: C): Promise<Response> => {
    const u = await usuarioActual();
    if (!u) return NextResponse.json({ error: "Sesión requerida." }, { status: 401 });
    if (opts.soloAdmin && !u.isAdmin) return NextResponse.json({ error: "Sin permisos." }, { status: 403 });
    if (opts.herramienta && !tieneHerramienta(u, opts.herramienta)) {
      return NextResponse.json({ error: "No tienes acceso a esta herramienta." }, { status: 403 });
    }
    try {
      return await manejador(req, u, ctx);
    } catch (e) {
      if (e instanceof ErrorApi) return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status });
      console.error("[api]", e);
      return NextResponse.json({ error: "Error inesperado. Intenta de nuevo." }, { status: 500 });
    }
  };
}

/* Cuerpo JSON como objeto; cualquier otra cosa (lista, texto, vacio) es {}. */
export async function cuerpo(req: Request): Promise<Record<string, unknown>> {
  try {
    const d = await req.json();
    return d && typeof d === "object" && !Array.isArray(d) ? d : {};
  } catch {
    return {};
  }
}
