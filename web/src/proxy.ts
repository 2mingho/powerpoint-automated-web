import { NextResponse, type NextRequest } from "next/server";
import { unsealData } from "iron-session";
import { db } from "@/lib/db";
import { CABECERAS_SEGURIDAD } from "@/lib/cabeceras";

const sinPermiso = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Sin permisos · Newlink</title><style>
:root{color-scheme:light dark;font-family:system-ui,sans-serif;background:#eceef1;color:#0b0d10}
body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;box-sizing:border-box}
main{max-width:480px;background:#fff;border:1px solid #d6d9de;padding:32px}
h1{font-size:1.7rem;margin:0 0 12px}p{line-height:1.5;margin:0 0 24px}
a{color:#0b0d10;font-weight:700;text-underline-offset:4px}a:focus-visible{outline:2px solid currentColor;outline-offset:4px}
@media(prefers-color-scheme:dark){:root{background:#0d1014;color:#eef0f3}main{background:#151a20;border-color:#39424d}a{color:#eef0f3}}
</style></head><body><main><h1>Sin permisos</h1><p>Esta sección es solo para administración. Si necesitas cambiar algo de tu cuenta o de tu unidad, pídeselo a un administrador.</p><a href="/">Volver al inicio</a></main></body></html>`;

/*
 * Comprobacion optimista: sin cookie de sesion, a /login antes de renderizar.
 * No es la autorizacion: cada pagina y cada ruta de API vuelve a validar la
 * sesion contra la base (usuarioActual), que es la que decide.
 */
export async function proxy(req: NextRequest) {
  if (!req.cookies.has("nl_sesion")) {
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Sesión requerida." }, { status: 401 });
    }
    const url = new URL("/login", req.url);
    url.searchParams.set("destino", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }
  const ruta = req.nextUrl.pathname;
  if (ruta === "/admin" || ruta.startsWith("/admin/")) {
    const sesion = await unsealData<{ userId?: number; token?: string; suplantadoPor?: unknown }>(req.cookies.get("nl_sesion")!.value, {
      password: process.env.SESSION_SECRET!,
    }).catch((): { userId?: number; token?: string; suplantadoPor?: unknown } => ({}));
    const usuario = sesion.userId ? await db.users.findUnique({
      where: { id: sesion.userId },
      select: { is_admin: true, is_active: true, force_logout: true, session_token: true },
    }) : null;
    // Con suplantacion la validez la decide la sesion de quien suplanta (usuarioActual); aqui solo el rol de la persona vista.
    if (!usuario || !usuario.is_active || (!sesion.suplantadoPor && (usuario.force_logout ||
        (usuario.session_token && sesion.token !== usuario.session_token)))) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
    if (!usuario.is_admin) {
      const cabeceras = new Headers({ "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex", "Cache-Control": "no-store" });
      for (const { key, value } of CABECERAS_SEGURIDAD) cabeceras.set(key, value);
      return new Response(sinPermiso, { status: 403, headers: cabeceras });
    }
  }
  return NextResponse.next();
}

/*
 * /api/datos queda fuera: con proxy, Next copia el cuerpo de cada peticion en
 * memoria y lo corta en silencio a 16 MB (proxyClientMaxBodySize). Una subida
 * de 150 MB llegaria truncada al servicio de analisis. Esas rutas validan la
 * sesion igual, con conUsuario, y responden 401 en JSON.
 */
export const config = {
  matcher: ["/((?!login|healthz|_next/static|_next/image|favicon.ico|logo-newlink.png|api/interno|api/datos).*)"],
};
