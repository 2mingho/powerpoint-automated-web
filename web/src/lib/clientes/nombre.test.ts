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

import { parecido, parecidos } from "./nombre";

describe("parecido entre clientes", () => {
  it("la puntuacion sola no los distingue", () => {
    expect(parecido("claro.", "claro")).toBe(3);
    expect(parecido("banco popular, s.a.", "banco popular sa")).toBe(3);
    expect(parecido("grupo-ramos", "grupo ramos")).toBe(3);
  });

  it("uno es el comienzo del otro, por palabras", () => {
    expect(parecido("claro", "claro rd")).toBe(2);
    expect(parecido("claro rd", "claro")).toBe(2);
    expect(parecido("banco popular", "banco popular dominicano")).toBe(2);
  });

  it("no confunde prefijos que no son palabra completa ni nombres cortos", () => {
    expect(parecido("claro", "claros")).toBe(0);
    expect(parecido("al", "al banco")).toBe(0);
    expect(parecido("altice", "altos")).toBe(0);
  });

  it("una letra de diferencia solo cuenta en nombres largos", () => {
    expect(parecido("cerveceria nacional", "cervecria nacional")).toBe(1);
    expect(parecido("arajet", "arajat")).toBe(1);
    expect(parecido("claro", "clara")).toBe(0);
    // Dos letras ya dan falsos parecidos entre nombres largos.
    expect(parecido("cerveceria nacional", "cerveria nacional")).toBe(0);
    expect(parecido("activo mv1fgz873451", "inactivo mv1fgz873451")).toBe(0);
  });

  it("lo distinto o lo igual no se sugiere", () => {
    expect(parecido("claro", "altice")).toBe(0);
    expect(parecido("claro", "claro")).toBe(0);
    expect(parecido("peña", "pena")).toBe(0);
  });

  it("parecidos ordena del mas al menos parecido y limita", () => {
    const otros = [{ clave: "claro rd" }, { clave: "altice" }, { clave: "claro." }, { clave: "claro mobile" }, { clave: "claro tv" }];
    expect(parecidos("claro", otros).map((x) => x.clave)).toEqual(["claro.", "claro mobile", "claro rd"]);
    expect(parecidos("claro", otros, 1).map((x) => x.clave)).toEqual(["claro."]);
    expect(parecidos("zzz", otros)).toEqual([]);
  });
});
