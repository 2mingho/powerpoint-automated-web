/*
 * fetch JSON para el cliente con la forma de error de las rutas de /api
 * ({ error: "mensaje" }). Nunca lanza: devuelve ok o el mensaje para pintar.
 */
export type Respuesta<T> = { ok: true; datos: T; status: number } | { ok: false; error: string; status: number };

export async function pedir<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<Respuesta<T>> {
  const { json, ...resto } = init ?? {};
  try {
    const r = await fetch(url, {
      ...resto,
      headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...resto.headers },
      body: json !== undefined ? JSON.stringify(json) : resto.body,
      cache: "no-store",
    });
    const datos = await r.json().catch(() => null);
    if (!r.ok) {
      const error = datos && typeof datos.error === "string" ? datos.error : r.status === 401
        ? "Tu sesión terminó. Vuelve a entrar."
        : "No se pudo completar. Intenta de nuevo.";
      return { ok: false, error, status: r.status };
    }
    return { ok: true, datos: datos as T, status: r.status };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return { ok: false, error: "", status: 0 };
    return { ok: false, error: "Sin conexión con el servidor. Revisa tu red y vuelve a intentarlo.", status: 0 };
  }
}
