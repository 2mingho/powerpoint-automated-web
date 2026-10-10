import { describe, expect, it, vi } from "vitest";
import { crearMonitor } from "./salud";

function banco(sobre: Partial<Parameters<typeof crearMonitor>[0]> = {}) {
  let t = 1_000_000;
  const m = crearMonitor({ ttlUso: 120_000, ttlSondeo: 30_000, ttlFallo: 5_000, limite: 200, ahora: () => t, ...sobre });
  const sonda = vi.fn(async () => {});
  return { m, sonda, avanzar: (ms: number) => { t += ms; } };
}

describe("monitor de salud", () => {
  it("al arrancar, sin datos, comprueba la base una vez", async () => {
    const { m, sonda } = banco();
    expect(await m.comprobar(sonda)).toEqual({ codigo: 200, cuerpo: { status: "ok", database: "reachable" } });
    expect(sonda).toHaveBeenCalledTimes(1);
  });

  it("con actividad reciente comprueba como mucho una vez cada 30 s", async () => {
    const { m, sonda, avanzar } = banco();
    await m.comprobar(sonda);
    m.registrarUso();
    for (let i = 0; i < 5; i++) { avanzar(5_000); await m.comprobar(sonda); }
    expect(sonda).toHaveBeenCalledTimes(1);
    avanzar(10_000);
    m.registrarUso();
    await m.comprobar(sonda);
    expect(sonda).toHaveBeenCalledTimes(2);
  });

  it("sin actividad reciente responde ocioso y no toca la base: la deja dormir", async () => {
    const { m, sonda, avanzar } = banco();
    await m.comprobar(sonda);
    m.registrarUso();
    avanzar(300_000); // cinco minutos sin nadie
    expect(await m.comprobar(sonda)).toEqual({ codigo: 200, cuerpo: { status: "ok", database: "idle" } });
    avanzar(30_000);
    await m.comprobar(sonda);
    expect(sonda).toHaveBeenCalledTimes(1);
  });

  it("al volver la actividad, la siguiente sonda la comprueba", async () => {
    const { m, sonda, avanzar } = banco();
    await m.comprobar(sonda);
    avanzar(300_000);
    await m.comprobar(sonda); // ocioso
    m.registrarUso();
    await m.comprobar(sonda);
    expect(sonda).toHaveBeenCalledTimes(2);
  });

  it("la propia sonda no cuenta como actividad", async () => {
    const { m, avanzar } = banco();
    let veces = 0;
    const sonda = async () => { veces++; m.registrarUso(); }; // la consulta de la sonda pasa por el pool
    await m.comprobar(sonda);
    avanzar(300_000);
    await m.comprobar(sonda);
    expect(veces).toBe(1); // sin actividad real, no se vuelve a preguntar
  });

  it("un fallo da 503, se vuelve a comprobar a los 5 s aunque no haya trafico y se recupera", async () => {
    const { m, avanzar } = banco();
    const mala = vi.fn(async () => { throw new Error("sin conexion"); });
    expect(await m.comprobar(mala)).toEqual({ codigo: 503, cuerpo: { status: "error", database: "unreachable" } });
    avanzar(2_000);
    await m.comprobar(mala);
    expect(mala).toHaveBeenCalledTimes(1); // aun vigente
    avanzar(4_000);
    avanzar(300_000); // y sin actividad
    const buena = vi.fn(async () => {});
    expect(await m.comprobar(buena)).toEqual({ codigo: 200, cuerpo: { status: "ok", database: "reachable" } });
    expect(buena).toHaveBeenCalledTimes(1);
  });

  it("una sonda que no responde a tiempo cuenta como fallo", async () => {
    const { m } = banco({ limite: 20 });
    const colgada = () => new Promise<void>(() => {});
    expect((await m.comprobar(colgada)).codigo).toBe(503);
  });

  it("dos sondas a la vez comparten una sola comprobacion", async () => {
    const { m } = banco();
    let veces = 0;
    const lenta = async () => { veces++; await new Promise((r) => setTimeout(r, 30)); };
    const [a, b] = await Promise.all([m.comprobar(lenta), m.comprobar(lenta)]);
    expect(veces).toBe(1);
    expect(a).toEqual(b);
  });

  it("la base responde pero el esquema esta atrasado: 503, con la base como alcanzable", async () => {
    const { m } = banco();
    const r = await m.comprobar(async () => ({ schema: "atrasado" as const }));
    expect(r).toEqual({ codigo: 503, cuerpo: { status: "error", database: "reachable", schema: "atrasado" } });
    expect((await m.comprobar(async () => ({ schema: "sin_migrar" as const }))).codigo).toBe(503); // aun vigente el fallo: no vuelve a preguntar
  });

  it("un esquema atrasado se recomprueba a los 5 s y, ya migrado, vuelve a 200", async () => {
    const { m, avanzar } = banco();
    await m.comprobar(async () => ({ schema: "atrasado" as const }));
    avanzar(6_000);
    expect(await m.comprobar(async () => ({ schema: "ok" as const }))).toEqual({ codigo: 200, cuerpo: { status: "ok", database: "reachable", schema: "ok" } });
  });

  it("con ttlUso 0 comprueba siempre (respetando los 30 s)", async () => {
    const { m, sonda, avanzar } = banco({ ttlUso: 0 });
    await m.comprobar(sonda);
    avanzar(300_000);
    await m.comprobar(sonda);
    expect(sonda).toHaveBeenCalledTimes(2);
  });
});
