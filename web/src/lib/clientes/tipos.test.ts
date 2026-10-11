import { describe, expect, it } from "vitest";
import { leerTipoCliente, TIPOS_CLIENTE } from "./tipos";

describe("tipo de cliente", () => {
  it("son tres: Privado, Público e Interno", () => expect([...TIPOS_CLIENTE]).toEqual(["Privado", "Público", "Interno"]));
  it("sin valor es «sin tipo»", () => {
    for (const v of [null, undefined, "", "   "]) expect(leerTipoCliente(v)).toEqual({ ok: true, valor: null });
  });
  it("acepta cada tipo, con o sin tilde y sin importar mayúsculas, y lo guarda bien escrito", () => {
    expect(leerTipoCliente("privado")).toEqual({ ok: true, valor: "Privado" });
    expect(leerTipoCliente("PUBLICO")).toEqual({ ok: true, valor: "Público" });
    expect(leerTipoCliente(" Público ")).toEqual({ ok: true, valor: "Público" });
    expect(leerTipoCliente("interno")).toEqual({ ok: true, valor: "Interno" });
  });
  it("rechaza cualquier otro", () => {
    for (const v of ["Corporativo", "Pyme", "Gobierno", "Externo", 3, {}]) expect(leerTipoCliente(v).ok, String(v)).toBe(false);
  });
});
