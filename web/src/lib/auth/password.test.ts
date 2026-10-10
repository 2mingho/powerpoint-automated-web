import { describe, expect, it } from "vitest";
import { generarHash, verificarCuenta } from "./password";

function medir(f: () => void) {
  const t0 = performance.now();
  f();
  return performance.now() - t0;
}

describe("verificarCuenta", () => {
  const hash = generarHash("demo1234");

  it("acepta la contrasena correcta y rechaza el resto", () => {
    expect(verificarCuenta(hash, "demo1234")).toBe(true);
    expect(verificarCuenta(hash, "otra")).toBe(false);
    expect(verificarCuenta(null, "demo1234")).toBe(false);
  });

  it("sin cuenta tarda lo mismo que con una contrasena equivocada", () => {
    verificarCuenta(null, "x"); // el relleno se genera una vez
    const conCuenta = Math.min(...[0, 1, 2].map(() => medir(() => verificarCuenta(hash, "equivocada"))));
    const sinCuenta = Math.min(...[0, 1, 2].map(() => medir(() => verificarCuenta(null, "equivocada"))));
    expect(sinCuenta).toBeGreaterThan(conCuenta * 0.5);
  });
});
