import { describe, expect, it } from "vitest";
import { alternarOrden, ordenarPor } from "./orden";

const t = (nombre: Parameters<typeof ordenarPor>[1] extends (x: never) => infer R ? R : never, n?: number) => ({ nombre, n });

describe("ordenarPor", () => {
  it("texto sin distinguir mayusculas ni tildes", () => {
    const l = ["árbol", "Zeta", "alfa", "Álamo", "beta"].map((x) => ({ x }));
    expect(ordenarPor(l, (e) => e.x, "asc").map((e) => e.x)).toEqual(["Álamo", "alfa", "árbol", "beta", "Zeta"]);
    expect(ordenarPor(l, (e) => e.x, "desc").map((e) => e.x)).toEqual(["Zeta", "beta", "árbol", "alfa", "Álamo"]);
  });

  it("los numeros dentro del texto cuentan por su valor", () => {
    const l = ["Paso 10", "Paso 2", "Paso 1"].map((x) => ({ x }));
    expect(ordenarPor(l, (e) => e.x, "asc").map((e) => e.x)).toEqual(["Paso 1", "Paso 2", "Paso 10"]);
  });

  it("los numeros se ordenan como numeros", () => {
    const l = [10, 9, 100, 1.5].map((n) => ({ n }));
    expect(ordenarPor(l, (e) => e.n, "asc").map((e) => e.n)).toEqual([1.5, 9, 10, 100]);
    expect(ordenarPor(l, (e) => e.n, "desc").map((e) => e.n)).toEqual([100, 10, 9, 1.5]);
  });

  it("lo vacio queda al final en las dos direcciones", () => {
    const l = [t(null, 3), t("b", 2), t(undefined, 4), t("a", 1), t("", 5), t("c", 6)];
    expect(ordenarPor(l, (e) => e.nombre, "asc").map((e) => e.n)).toEqual([1, 2, 6, 3, 4, 5]);
    expect(ordenarPor(l, (e) => e.nombre, "desc").map((e) => e.n)).toEqual([6, 2, 1, 3, 4, 5]);
    expect(ordenarPor([{ n: NaN }, { n: 2 }, { n: 1 }], (e) => e.n, "asc").map((e) => e.n)).toEqual([1, 2, NaN]);
  });

  it("es estable: los empates conservan el orden de entrada, tambien al invertir", () => {
    const l = [t("a", 1), t("b", 2), t("a", 3), t("b", 4)];
    expect(ordenarPor(l, (e) => e.nombre, "asc").map((e) => e.n)).toEqual([1, 3, 2, 4]);
    expect(ordenarPor(l, (e) => e.nombre, "desc").map((e) => e.n)).toEqual([2, 4, 1, 3]);
  });

  it("no toca la lista original", () => {
    const l = [{ n: 2 }, { n: 1 }];
    ordenarPor(l, (e) => e.n, "asc");
    expect(l.map((e) => e.n)).toEqual([2, 1]);
  });
});

describe("alternarOrden", () => {
  it("primera vez ordena, segunda invierte, tercera quita", () => {
    let o = alternarOrden(null, "a");
    expect(o).toEqual({ col: "a", dir: "asc" });
    o = alternarOrden(o, "a");
    expect(o).toEqual({ col: "a", dir: "desc" });
    expect(alternarOrden(o, "a")).toBeNull();
  });

  it("otra columna empieza de nuevo", () => {
    expect(alternarOrden({ col: "a", dir: "desc" }, "b")).toEqual({ col: "b", dir: "asc" });
  });

  it("una columna de importes puede empezar de mayor a menor", () => {
    let o = alternarOrden(null, "monto", "desc");
    expect(o).toEqual({ col: "monto", dir: "desc" });
    o = alternarOrden(o, "monto", "desc");
    expect(o).toEqual({ col: "monto", dir: "asc" });
    expect(alternarOrden(o, "monto", "desc")).toBeNull();
  });
});
