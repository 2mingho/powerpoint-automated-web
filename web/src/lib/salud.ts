/*
 * Salud del servicio (/healthz). El orquestador pregunta cada pocos segundos y la
 * base (Neon) se factura por el tiempo que pasa despierta: preguntarle a la base
 * en cada sonda la mantendria despierta para siempre. La regla, la misma que usaba
 * Flask:
 *   - con actividad reciente (alguien uso la aplicacion hace menos de `ttlUso`), se
 *     comprueba la base, como mucho una vez cada `ttlSondeo`: si esta en uso, ya esta despierta;
 *   - sin actividad, se responde "ocioso" sin tocarla: sin trafico no hay a quien servir mal,
 *     y en cuanto llegue una peticion real la siguiente sonda lo comprobara;
 *   - tras un fallo se vuelve a comprobar cada `ttlFallo`, haya trafico o no, para recuperarse;
 *   - al arrancar, sin ningun dato, se comprueba una vez.
 * Las consultas de la propia sonda no cuentan como actividad.
 */
export type Salud = { codigo: 200 | 503; cuerpo: { status: "ok" | "error"; database: "reachable" | "idle" | "unreachable"; schema?: "ok" | "atrasado" | "sin_migrar" } };

/* Lo que devuelve la sonda cuando la base responde: si el esquema es el que espera este codigo. */
export type ResultadoSonda = { schema: "ok" | "atrasado" | "sin_migrar" };

type Opciones = { ttlUso: number; ttlSondeo: number; ttlFallo: number; limite: number; ahora?: () => number };

export function crearMonitor({ ttlUso, ttlSondeo, ttlFallo, limite, ahora = Date.now }: Opciones) {
  let ultimoUso = 0;
  let sondeo: { momento: number; ok: boolean; schema?: ResultadoSonda["schema"] } | null = null;
  let sondeando = false;
  let enCurso: Promise<Salud> | null = null;

  const respuesta = (ok: boolean, database: Salud["cuerpo"]["database"], schema?: ResultadoSonda["schema"]): Salud => ({
    codigo: ok ? 200 : 503, cuerpo: { status: ok ? "ok" : "error", database, ...(schema ? { schema } : {}) },
  });
  const deSondeo = (s: NonNullable<typeof sondeo>) => respuesta(s.ok, s.schema || s.ok ? "reachable" : "unreachable", s.schema);

  async function sondear(sonda: () => Promise<ResultadoSonda | void>): Promise<Salud> {
    sondeando = true;
    let ok = true;
    let schema: ResultadoSonda["schema"] | undefined;
    let alcanzable = true;
    try {
      const r = await Promise.race([sonda(), new Promise<never>((_, rechazar) => setTimeout(() => rechazar(new Error("tiempo agotado")), limite).unref?.())]);
      if (r && r.schema !== "ok") { ok = false; schema = r.schema; } // la base responde, pero con un esquema que este codigo no puede usar
      else if (r) schema = "ok";
    } catch {
      ok = false;
      alcanzable = false;
    } finally {
      sondeando = false;
    }
    sondeo = { momento: ahora(), ok, schema: alcanzable ? schema : undefined };
    return deSondeo(sondeo);
  }

  return {
    /* Una consulta real de la aplicacion: la base esta en uso. */
    registrarUso() {
      if (!sondeando) ultimoUso = ahora();
    },
    async comprobar(sonda: () => Promise<ResultadoSonda | void>): Promise<Salud> {
      const t = ahora();
      if (sondeo && t - sondeo.momento < (sondeo.ok ? ttlSondeo : ttlFallo)) return deSondeo(sondeo);
      const sinDatos = ultimoUso === 0 && sondeo === null;
      const reciente = ttlUso <= 0 || t - ultimoUso < ttlUso;
      const falloPrevio = sondeo !== null && !sondeo.ok;
      if (!sinDatos && !reciente && !falloPrevio) return respuesta(true, "idle");
      // Dos sondas a la vez comparten la misma comprobacion.
      enCurso ??= sondear(sonda).finally(() => { enCurso = null; });
      return enCurso;
    },
  };
}

const segundos = (v: string | undefined, porDefecto: number) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) * 1000 : porDefecto);

/* Un monitor por proceso, con los plazos configurables (HEALTHZ_DB_TTL en segundos; 0 comprueba siempre). */
export const monitor = crearMonitor({
  ttlUso: segundos(process.env.HEALTHZ_DB_TTL, 120_000),
  ttlSondeo: 30_000,
  ttlFallo: 5_000,
  limite: 5_000,
});
