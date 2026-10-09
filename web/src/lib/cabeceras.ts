/*
 * Cabeceras de seguridad comunes. Las aplica next.config.ts a todo lo que
 * sirve Next, y el proxy a las respuestas que fabrica el mismo (el 403 de
 * /admin), que no pasan por la configuracion.
 *
 * La CSP no restringe script-src: Next mete scripts en linea (la carga del
 * RSC y el arranque del tema) y hacerlo bien exige nonces por peticion. Lo que
 * si cierra: enmarcar la app, cambiar la base de las URL, plugins y enviar
 * formularios (o seguir sus redirecciones) a otro origen.
 */
export const CABECERAS_SEGURIDAD: { key: string; value: string }[] = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];
