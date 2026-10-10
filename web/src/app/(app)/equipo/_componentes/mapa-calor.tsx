"use client";
import { cx } from "@/components/ui/cx";
import { fDia } from "@/lib/admin/formato";
import type { CalorEquipo } from "@/lib/equipo/calor";
import type { CeldaCalor, FilaCalor } from "@/lib/seguimiento/mapa-calor";

/*
 * Mapa de calor de carga: personas x 4 semanas. El numero (horas) y el
 * porcentaje van siempre escritos: el color refuerza, nunca es lo unico que
 * dice. El nivel 3 y el 4 ademas se leen en palabras para lectores de pantalla.
 */

const FONDO = ["bg-superficie-2", "bg-bien/15", "bg-bien/35", "bg-aviso/40", "bg-alerta/40"] as const;
const NIVELES = ["Libre", "Cómoda", "Llena", "Al límite", "Sobrecargada"] as const;
const RANGOS = ["< 40 %", "40–75 %", "75–95 %", "95–110 %", "> 110 %"] as const;

function describir(f: FilaCalor, c: CeldaCalor, actual: boolean) {
  const base = `${f.nombre}, semana del ${fDia(c.semana)}${actual ? " (esta semana)" : ""}: ${c.horas} h de ${f.capacidad} (${Math.round(c.razon * 100)} %), ${NIVELES[c.nivel].toLowerCase()}`;
  const tareas = c.tareas ? `. ${c.tareas} tarea${c.tareas === 1 ? "" : "s"}${c.sinEstimar ? `, ${c.sinEstimar} sin estimar (cuentan 4 h cada una)` : ""}` : ". Sin tareas";
  return base + tareas;
}

export function MapaDeCalor({ calor, activa, onPersona }: { calor: CalorEquipo; activa: number | null; onPersona: (id: number) => void }) {
  if (!calor.filas.length) {
    return <p className="px-4 py-8 text-texto-2">Nadie con capacidad semanal en este alcance. Cuando haya personas activas en tus unidades, aquí verás cuánta carga tienen las próximas cuatro semanas.</p>;
  }
  // Las personas sin una sola hora en las cuatro semanas no pintan nada: se pliegan para no tapar a quien si tiene carga.
  const conCarga = calor.filas.filter((f) => f.celdas.some((c) => c.horas > 0));
  const libres = calor.filas.filter((f) => !f.celdas.some((c) => c.horas > 0));
  const hayEstimaciones = conCarga.some((f) => f.celdas.some((c) => c.sinEstimar));
  return (
    <div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 border-b border-hilo px-4 py-2 text-xs text-texto-2" aria-label="Leyenda del mapa de calor">
        {NIVELES.map((n, i) => (
          <li key={n} className="flex items-center gap-1.5">
            <span aria-hidden className={cx("size-3 rounded-[2px] border border-hilo", FONDO[i])} />{n}<span className="font-mono cifras text-texto-3">{RANGOS[i]}</span>
          </li>
        ))}
      </ul>
      {conCarga.length === 0 ? (
        <p className="px-4 py-6 text-texto-2">Nadie tiene horas abiertas en las próximas cuatro semanas.</p>
      ) : (
        <table className="w-full table-fixed border-collapse text-sm">
          <thead>
            <tr className="border-b border-hilo">
              <th scope="col" className="rotulo w-[6.75rem] px-3 py-2 text-left sm:w-48 sm:px-4">Persona</th>
              {calor.semanas.map((s, i) => (
                <th key={s} scope="col" className="rotulo px-0.5 py-2 text-center">
                  <span className="font-mono cifras">{fDia(s)}</span>
                  {i === 0 && <span className="block text-[0.6875rem] font-normal normal-case tracking-normal text-texto-3">esta semana</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {conCarga.map((f) => (
              <tr key={f.personaId} className="border-b border-hilo last:border-b-0">
                <th scope="row" className="px-3 py-1.5 text-left font-normal sm:px-4">
                  <button type="button" onClick={() => onPersona(f.personaId)} aria-pressed={activa === f.personaId} title="Ver sus tareas"
                    className={cx("block w-full truncate text-left hover:underline", activa === f.personaId && "font-semibold")}>{f.nombre}</button>
                  <span className="font-mono text-xs cifras text-texto-3">{f.capacidad} h/sem</span>
                </th>
                {f.celdas.map((c, i) => (
                  <td key={c.semana} className="p-0.5">
                    <div tabIndex={0} role="img" aria-label={describir(f, c, i === 0)} title={describir(f, c, i === 0)}
                      className={cx("flex h-11 flex-col items-center justify-center rounded-sm leading-tight", FONDO[c.nivel], c.nivel >= 3 && "font-semibold")}>
                      <span className="font-mono cifras">{c.horas ? `${c.horas} h` : "—"}</span>
                      <span className="font-mono text-[0.6875rem] cifras text-texto-2">
                        {c.horas ? `${Math.round(c.razon * 100)} %` : ""}{c.sinEstimar ? <span aria-hidden title="Incluye tareas sin estimar"> *</span> : null}
                      </span>
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {libres.length > 0 && (
        <details className="border-t border-hilo px-4 py-2 text-sm">
          <summary className="cursor-pointer text-texto-2">{libres.length === 1 ? "1 persona sin carga" : `${libres.length} personas sin carga`} en estas semanas</summary>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-texto-2">
            {libres.map((f) => (
              <li key={f.personaId}>
                <button type="button" onClick={() => onPersona(f.personaId)} className="hover:underline" title="Ver sus tareas">{f.nombre}</button>
                <span className="font-mono text-xs cifras text-texto-3"> {f.capacidad} h</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {hayEstimaciones && <p className="border-t border-hilo px-4 py-2 text-xs text-texto-3">* Incluye tareas sin estimar: cuentan 4 h cada una hasta que alguien les ponga horas.</p>}
    </div>
  );
}
