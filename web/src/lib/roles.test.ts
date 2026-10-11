import { describe, expect, it } from "vitest";
import { esRol, nombreDeRol, ROLES } from "./roles";

describe("cargos", () => {
  it("son cinco, fijos", () => expect(ROLES.map((r) => r.codigo)).toEqual(["coordinador", "analista", "ejecutiva", "gerente", "director"]));
  it("administrar no es un cargo", () => {
    expect(esRol("admin")).toBe(false);
    expect(esRol("DI")).toBe(false);
    expect(esRol("Gerente")).toBe(false);
    expect(esRol("gerente")).toBe(true);
    expect(esRol(null)).toBe(false);
  });
  it("el nombre para mostrar lleva mayúscula; lo desconocido se ve tal cual", () => {
    expect(nombreDeRol("ejecutiva")).toBe("Ejecutiva");
    expect(nombreDeRol("DI")).toBe("DI");
  });
});
