import "server-only";
import { ErrorApi } from "@/lib/api";
import type { UsuarioActual } from "@/lib/auth/session";

/*
 * Cliente del servicio de analisis (Flask, blueprints/interno.py). Solo de
 * servidor: el token no puede llegar nunca al navegador.
 *
 * Cada llamada lleva el token de servicio y el id del usuario de la sesion de
 * Next; el servicio carga a ese usuario y aplica sus permisos (herramientas y
 * propiedad), igual que las paginas Flask.
 */

function configuracion() {
  const url = process.env.ANALYTICS_URL;
  const token = process.env.ANALYTICS_TOKEN;
  if (!url || !token) {
    throw new ErrorApi(503, "El servicio de análisis no está configurado (ANALYTICS_URL y ANALYTICS_TOKEN).");
  }
  return { url: url.replace(/\/+$/, ""), token };
}

function cabeceras(u: Pick<UsuarioActual, "id">, extra?: Record<string, string>) {
  const { token } = configuracion();
  return { Authorization: `Bearer ${token}`, "X-Usuario-Id": String(u.id), Accept: "application/json", ...extra };
}

const NO_RESPONDE = "El servicio de análisis no responde. Intenta de nuevo en unos minutos.";

async function pedir(ruta: string, u: Pick<UsuarioActual, "id">, init: RequestInit & { duplex?: "half" } = {}) {
  const { url } = configuracion();
  try {
    return await fetch(`${url}/api/interno${ruta}`, {
      ...init,
      cache: "no-store",
      headers: cabeceras(u, init.headers as Record<string, string> | undefined),
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new ErrorApi(499, "Petición cancelada.");
    console.error("[datos] servicio inaccesible", e);
    throw new ErrorApi(503, NO_RESPONDE);
  }
}

/*
 * Errores del servicio con el mismo { error } en espanol. Un 401 del servicio
 * no es "tu sesion caduco" (eso ya lo filtro conUsuario): es que el token de
 * servicio no cuadra, un fallo de despliegue.
 */
async function comoError(r: Response): Promise<ErrorApi> {
  let datos: Record<string, unknown> = {};
  try { datos = await r.json(); } catch { /* cuerpo no JSON */ }
  if (r.status === 401) {
    console.error("[datos] el servicio rechazo la autenticacion", datos);
    return new ErrorApi(502, "El servicio de análisis rechazó la conexión. Avisa a un administrador.");
  }
  if (r.status >= 500) return new ErrorApi(502, typeof datos.error === "string" ? datos.error : NO_RESPONDE);
  const { error, ...extra } = datos;
  return new ErrorApi(r.status, typeof error === "string" ? error : "No se pudo completar la operación.", extra);
}

/* JSON del servicio o ErrorApi. */
export async function servicioJson<T>(ruta: string, u: Pick<UsuarioActual, "id">, init: RequestInit = {}): Promise<{ status: number; datos: T }> {
  const r = await pedir(ruta, u, init);
  if (!r.ok) throw await comoError(r);
  return { status: r.status, datos: (await r.json()) as T };
}

export function servicioGet<T>(ruta: string, u: Pick<UsuarioActual, "id">) {
  return servicioJson<T>(ruta, u).then((r) => r.datos);
}

export function servicioPost<T>(ruta: string, u: Pick<UsuarioActual, "id">, cuerpo?: unknown) {
  return servicioJson<T>(ruta, u, {
    method: "POST",
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    headers: cuerpo === undefined ? undefined : { "Content-Type": "application/json" },
  });
}

/*
 * Reenvia una subida multipart tal cual llega, en streaming: el cuerpo pasa
 * de la peticion del navegador a la del servicio sin cargarse entero en
 * memoria. El limite se comprueba con Content-Length antes de abrir nada.
 */
export async function reenviarSubida(req: Request, ruta: string, u: Pick<UsuarioActual, "id">, limite: number) {
  const tipo = req.headers.get("content-type") ?? "";
  if (!tipo.toLowerCase().startsWith("multipart/form-data")) {
    throw new ErrorApi(400, "Se esperaba un formulario con archivos.");
  }
  const largo = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(largo) && largo > limite) {
    throw new ErrorApi(413, `Los archivos superan el máximo de ${Math.round(limite / (1024 * 1024))} MB.`);
  }
  if (!req.body) throw new ErrorApi(400, "No llegó ningún archivo.");

  const extra: Record<string, string> = { "Content-Type": tipo };
  if (largo > 0) extra["Content-Length"] = String(largo);
  const r = await pedir(ruta, u, { method: "POST", body: req.body, headers: extra, duplex: "half", signal: req.signal });
  if (!r.ok) throw await comoError(r);
  return Response.json(await r.json(), { status: r.status });
}

/* Descarga en streaming: el archivo pasa del servicio al navegador sin parar en memoria. */
export async function reenviarDescarga(ruta: string, u: Pick<UsuarioActual, "id">) {
  const r = await pedir(ruta, u, { headers: { Accept: "*/*" } });
  if (!r.ok) throw await comoError(r);
  const cabeceras = new Headers();
  for (const h of ["content-type", "content-disposition", "content-length"]) {
    const v = r.headers.get(h);
    if (v) cabeceras.set(h, v);
  }
  cabeceras.set("Cache-Control", "private, no-store");
  return new Response(r.body, { status: 200, headers: cabeceras });
}
