import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { estadoDelEsquema, HISTORIAL, REVISION_ESPERADA } from "./esquema";

/* La cadena de revisiones real de Alembic, leida de migrations/versions. */
function cadenaDeAlembic(): string[] {
  const dir = path.join(__dirname, "..", "..", "..", "migrations", "versions");
  const hijas = new Map<string | null, string>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".py"))) {
    const t = readFileSync(path.join(dir, f), "utf8");
    const rev = /^revision\s*=\s*'([^']+)'/m.exec(t)?.[1];
    const down = /^down_revision\s*=\s*(?:'([^']+)'|None)/m.exec(t);
    if (rev) hijas.set(down?.[1] ?? null, rev);
  }
  const cadena: string[] = [];
  for (let r = hijas.get(null); r; r = hijas.get(r)) cadena.push(r);
  return cadena;
}

describe("esquema esperado", () => {
  it("la lista coincide con las migraciones de Alembic: si añades una migracion, añadela a HISTORIAL", () => {
    expect([...HISTORIAL]).toEqual(cadenaDeAlembic());
  });

  it("la revision esperada es la ultima", () => {
    expect(REVISION_ESPERADA).toBe(cadenaDeAlembic().at(-1));
  });

  it("al dia, atrasado, por delante o sin migrar", () => {
    expect(estadoDelEsquema(REVISION_ESPERADA)).toBe("al_dia");
    expect(estadoDelEsquema("0016_clientes")).toBe("atrasado");
    expect(estadoDelEsquema("0001_baseline")).toBe("atrasado");
    expect(estadoDelEsquema("0019_algo_nuevo")).toBe("por_delante");
    expect(estadoDelEsquema(null)).toBe("sin_migrar");
    expect(estadoDelEsquema("")).toBe("sin_migrar");
  });
});
