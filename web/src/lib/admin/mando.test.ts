import { describe, expect, it } from "vitest";
import { arbolDeMando, cadenaHaciaArriba, calcularAlcances, creariaBucle, type PersonaOrg } from "./mando";
import { enmascararClave } from "./mascara";
import { esPptxValido, nombreSeguro, nombresDelZip } from "./pptx";

/* Marta lleva la unidad 1, Luis la 2 y Sara manda sobre los dos; Ana es empleada de Marta. */
const p = (id: number, nombre: string, unidadId: number | null, managerId: number | null): PersonaOrg => ({ id, nombre, unidadId, managerId, activo: true });
const personas = [p(1, "Sara", null, null), p(2, "Marta", 1, 1), p(3, "Luis", 2, 1), p(4, "Ana", 1, 2), p(5, "Eva", 3, null)];
const unidades = [{ id: 1, nombre: "Uno" }, { id: 2, nombre: "Dos" }, { id: 3, nombre: "Tres" }];
const lideres = [{ userId: 2, unidadId: 1 }, { userId: 3, unidadId: 2 }];

describe("alcance deducido", () => {
  const { alcance, papel, aCargo } = calcularAlcances(personas, lideres);
  it("el director hereda las unidades de sus managers", () => {
    expect(alcance.get(1)?.sort()).toEqual([1, 2]);
    expect(papel.get(1)).toBe("director");
    expect(aCargo.get(1)).toBe(3);
  });
  it("el manager solo ve la suya y el empleado ninguna", () => {
    expect(alcance.get(2)).toEqual([1]);
    expect(papel.get(2)).toBe("manager");
    expect(alcance.get(4)).toEqual([]);
    expect(papel.get(4)).toBe("empleado");
  });
  it("un ciclo no cuelga", () => {
    const ciclo = [p(1, "A", null, 2), p(2, "B", null, 1)];
    expect(calcularAlcances(ciclo, [{ userId: 2, unidadId: 9 }]).alcance.get(1)).toEqual([9]);
    expect(cadenaHaciaArriba(ciclo, 1).map((x) => x.nombre)).toEqual(["B"]);
  });
});

describe("bucles en la cadena", () => {
  it("rechaza ser su propio superior y colgar de alguien que ya cuelga de uno", () => {
    expect(creariaBucle(personas, 4, 4)).toBe(true);
    expect(creariaBucle(personas, 1, 4)).toBe(true); // Sara reportando a Ana, que cuelga de Sara
    expect(creariaBucle(personas, 4, 3)).toBe(false);
  });
});

describe("arbol de mando", () => {
  it("director -> managers -> unidades -> personas, y aparte lo que no cuelga de nadie", () => {
    const a = arbolDeMando(personas, unidades, lideres);
    expect(a.raices).toHaveLength(1);
    const sara = a.raices[0];
    expect(sara.persona.nombre).toBe("Sara");
    expect(sara.subordinados.map((s) => s.persona.nombre)).toEqual(["Luis", "Marta"]);
    const marta = sara.subordinados[1];
    expect(marta.unidades[0].unidad.nombre).toBe("Uno");
    expect(marta.unidades[0].miembros.map((m) => m.nombre)).toEqual(["Ana"]);
    expect(marta.directos).toEqual([]); // Ana ya sale en su unidad
    expect(a.sinLider.map((u) => u.unidad.nombre)).toEqual(["Tres"]);
    expect(a.sinLider[0].miembros.map((m) => m.nombre)).toEqual(["Eva"]);
    expect(a.sueltas).toEqual([]);
  });
});

describe("plantillas PPTX", () => {
  it("acepta un zip con [Content_Types].xml y una parte ppt/", () => {
    const zip = zipMinimo(["[Content_Types].xml", "ppt/presentation.xml"]);
    expect(nombresDelZip(zip)).toEqual(["[Content_Types].xml", "ppt/presentation.xml"]);
    expect(esPptxValido(zip)).toBe(true);
  });
  it("rechaza lo que no es zip y un zip que no es PowerPoint", () => {
    expect(esPptxValido(new TextEncoder().encode("esto no es un zip"))).toBe(false);
    expect(esPptxValido(zipMinimo(["[Content_Types].xml", "word/document.xml"]))).toBe(false);
  });
  it("limpia el nombre de archivo", () => {
    expect(nombreSeguro("../../Reporte Cliente ñ.pptx")).toBe("Reporte_Cliente_n.pptx");
  });
  it("la clave enmascarada solo deja ver los cuatro ultimos caracteres", () => {
    expect(enmascararClave("gsk_abcdefghijkl1234")).toBe("••••1234");
    expect(enmascararClave("corta")).toBe("••••");
  });
});

/* Zip "stored" minimo: cabecera local + directorio central + EOCD. */
function zipMinimo(nombres: string[]): Uint8Array {
  const enc = new TextEncoder();
  const locales: number[] = [];
  const central: number[] = [];
  const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  for (const n of nombres) {
    const b = [...enc.encode(n)];
    const offset = locales.length;
    locales.push(...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(0), ...u32(0), ...u16(b.length), ...u16(0), ...b);
    central.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(0), ...u32(0),
      ...u16(b.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...b);
  }
  const eocd = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(nombres.length), ...u16(nombres.length), ...u32(central.length), ...u32(locales.length), ...u16(0)];
  return new Uint8Array([...locales, ...central, ...eocd]);
}
