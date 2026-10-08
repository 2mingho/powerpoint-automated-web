import { NextResponse, type NextRequest } from "next/server";

/*
 * Comprobacion optimista: sin cookie de sesion, a /login antes de renderizar.
 * No es la autorizacion: cada pagina y cada ruta de API vuelve a validar la
 * sesion contra la base (usuarioActual), que es la que decide.
 */
export function proxy(req: NextRequest) {
  if (!req.cookies.has("nl_sesion")) {
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Sesión requerida." }, { status: 401 });
    }
    const url = new URL("/login", req.url);
    url.searchParams.set("destino", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico|logo-newlink.png|api/interno).*)"],
};
