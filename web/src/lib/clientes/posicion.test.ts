import { describe, expect, it } from "vitest";
import { posicionarFicha } from "./posicion";

const VENTANA = { w: 1000, h: 700 };
const FICHA = { w: 320, h: 260 };
const ancla = (left: number, top: number, ancho = 120, alto = 20) => ({ left, top, right: left + ancho, bottom: top + alto });

describe("posicion de la ficha", () => {
  it("a la derecha del nombre y alineada con el", () => {
    expect(posicionarFicha(ancla(100, 200), FICHA, VENTANA)).toEqual({ left: 228, top: 200 });
  });

  it("si a la derecha no cabe, va a la izquierda", () => {
    expect(posicionarFicha(ancla(800, 200), FICHA, VENTANA)).toEqual({ left: 800 - 8 - 320, top: 200 });
  });

  it("si cabe justo a la derecha, no se mueve", () => {
    // right = 600 -> left = 608; 608 + 320 = 928 <= 992
    expect(posicionarFicha(ancla(480, 100), FICHA, VENTANA).left).toBe(608);
  });

  it("se sube lo justo si se saldria por abajo", () => {
    expect(posicionarFicha(ancla(100, 600), FICHA, VENTANA).top).toBe(700 - 8 - 260);
  });

  it("nunca sale por arriba ni por los lados, ni en ventanas pequenas", () => {
    expect(posicionarFicha(ancla(0, -50), FICHA, VENTANA).top).toBe(8);
    const p = posicionarFicha(ancla(150, 10, 100), { w: 320, h: 260 }, { w: 400, h: 300 });
    expect(p.left).toBeGreaterThanOrEqual(8);
    expect(p.left + 320).toBeLessThanOrEqual(400 - 8);
    expect(posicionarFicha(ancla(10, 10), { w: 500, h: 100 }, { w: 300, h: 300 }).left).toBe(8);
  });
});
