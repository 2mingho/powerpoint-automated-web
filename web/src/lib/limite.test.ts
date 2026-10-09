import { afterEach, describe, expect, it, vi } from "vitest";
import { clavesEnMemoria, permitir } from "./limite";

describe("permitir", () => {
  afterEach(() => vi.useRealTimers());

  it("corta al pasar el maximo dentro de la ventana y vuelve a abrir despues", () => {
    vi.useFakeTimers();
    for (let i = 0; i < 5; i++) expect(permitir("login:cuenta:a@b.c", 5, 60_000)).toBe(true);
    expect(permitir("login:cuenta:a@b.c", 5, 60_000)).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect(permitir("login:cuenta:a@b.c", 5, 60_000)).toBe(true);
  });

  it("no acumula claves vencidas: miles de correos inventados no hacen crecer la memoria", () => {
    vi.useFakeTimers();
    for (let i = 0; i < 5_000; i++) permitir(`login:cuenta:falso${i}@x.y`, 5, 60_000);
    vi.advanceTimersByTime(61_000);
    for (let i = 0; i < 1_000; i++) permitir(`login:cuenta:otro${i}@x.y`, 5, 60_000);
    expect(clavesEnMemoria()).toBeLessThanOrEqual(1_100);
  });
});
