import { describe, expect, it, vi } from "vitest";
import { conCaducidad, porObjeto } from "./memo";

describe("porObjeto", () => {
  it("una sola ejecucion por objeto, aunque se pida varias veces a la vez", async () => {
    const fn = vi.fn(async (u: { id: number }) => u.id * 2);
    const m = porObjeto(fn);
    const u = { id: 3 };
    expect(await Promise.all([m(u), m(u), m(u)])).toEqual([6, 6, 6]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("otro objeto, aunque igual por dentro, es otra peticion: no comparte nada", async () => {
    const fn = vi.fn(async (u: { id: number }) => u.id);
    const m = porObjeto(fn);
    await m({ id: 1 });
    await m({ id: 1 });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("un fallo no se queda guardado: el siguiente intento lo vuelve a probar", async () => {
    let n = 0;
    const m = porObjeto(async (_: object) => { void _; if (++n === 1) throw new Error("se cayo"); return "bien"; });
    const u = {};
    await expect(m(u)).rejects.toThrow("se cayo");
    await expect(m(u)).resolves.toBe("bien");
  });
});

describe("conCaducidad", () => {
  it("reutiliza el valor hasta que caduca y despues lo vuelve a leer", async () => {
    vi.useFakeTimers();
    const fn = vi.fn(async () => "x");
    const c = conCaducidad(fn, 1000);
    await c.leer(); await c.leer();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1001);
    await c.leer();
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("invalidar fuerza una lectura nueva al instante", async () => {
    const fn = vi.fn(async () => "x");
    const c = conCaducidad(fn, 60_000);
    await c.leer();
    c.invalidar();
    await c.leer();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("un fallo no se guarda", async () => {
    let n = 0;
    const c = conCaducidad(async () => { if (++n === 1) throw new Error("no"); return n; }, 60_000);
    await expect(c.leer()).rejects.toThrow();
    await expect(c.leer()).resolves.toBe(2);
  });
});
