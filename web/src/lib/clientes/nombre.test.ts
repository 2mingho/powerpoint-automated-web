import { describe, expect, it } from "vitest";
import casos from "./claves-casos.json";
import { agruparVariantes, claveDeCliente, nombreLimpio } from "./nombre";

describe("clave de cliente", () => {
  it.each(casos.map((c) => [JSON.stringify(c.entrada), c.entrada, c.clave] as const))("%s", (_t, entrada, clave) => {
    expect(claveDeCliente(entrada)).toBe(clave);
  });

  it("no une lo que solo se parece: puntuacion, siglas y otra letra", () => {
    const claves = new Set(["Claro", "Claro.", "Claro RD", "Peña", "Pena"].map(claveDeCliente));
    expect(claves.size).toBe(5);
  });
});

describe("nombre limpio", () => {
  it("colapsa espacios y conserva mayusculas y acentos", () => {
    expect(nombreLimpio("  Banco \t Popular\n")).toBe("Banco Popular");
    expect(nombreLimpio("Nestlé")).toBe("Nestlé");
  });
});

describe("agrupar variantes", () => {
  it("une las que difieren en mayusculas, acentos y espacios; elige la mas usada", () => {
    const g = agruparVariantes([
      { nombre: "claro", n: 3 }, { nombre: "Claro", n: 10 }, { nombre: "CLARO ", n: 1 },
      { nombre: "Nestlé", n: 2 }, { nombre: "Nestle", n: 2 },
      { nombre: "Claro RD", n: 4 },
    ]);
    expect(g.map((x) => [x.clave, x.nombre, x.total])).toEqual([["claro", "Claro", 14], ["claro rd", "Claro RD", 4], ["nestle", "Nestlé", 4]]);
    expect(g[0].variantes.map((v) => v.nombre)).toEqual(["Claro", "claro", "CLARO"]);
  });

  it("en empate gana el orden alfabetico (la mayuscula primero) y suma lo repetido tras limpiar", () => {
    const g = agruparVariantes([{ nombre: "claro", n: 2 }, { nombre: "Claro", n: 1 }, { nombre: "Claro  ", n: 1 }]);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ nombre: "Claro", total: 4 });
    expect(g[0].variantes).toEqual([{ nombre: "Claro", n: 2 }, { nombre: "claro", n: 2 }]);
  });

  it("ignora los textos vacios", () => {
    expect(agruparVariantes([{ nombre: "", n: 5 }, { nombre: "  ", n: 1 }])).toEqual([]);
  });
});
