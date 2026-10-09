import { describe, expect, it } from "vitest";
import { rutaInterna } from "./rutas";

describe("rutaInterna", () => {
  it("acepta rutas propias con busqueda y ancla", () => {
    expect(rutaInterna("/")).toBe("/");
    expect(rutaInterna("/tareas?tarea=4#detalle")).toBe("/tareas?tarea=4#detalle");
    expect(rutaInterna("/admin/../tareas")).toBe("/tareas");
  });

  it("rechaza todo lo que el navegador llevaria a otro origen", () => {
    for (const malo of [
      "//evil.com", "/\\evil.com", "/\\/evil.com", "\\\\evil.com", "/\t/evil.com", "/\n/evil.com",
      "https://evil.com", "javascript:alert(1)", "evil.com", "", "/%5C%5Cevil.com/..//evil.com",
    ]) {
      const r = rutaInterna(malo);
      expect(r === null || (r.startsWith("/") && !r.startsWith("//")), malo).toBe(true);
    }
    expect(rutaInterna("/\\evil.com")).toBeNull();
    expect(rutaInterna("/\t/evil.com")).toBeNull();
    expect(rutaInterna(null)).toBeNull();
    expect(rutaInterna(42)).toBeNull();
  });
});
