"use client";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { AlertTriangle, GripVertical, Pencil, Plus, Trash2, X } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { Entrada } from "@/components/ui/campo";
import { cx } from "@/components/ui/cx";
import { Dialogo } from "@/components/ui/dialogo";
import { CeldaEstado, PuntoTono, type Tono } from "@/components/ui/estado";
import { useAvisos } from "@/components/ui/avisos";
import { mensajeDe, pedir } from "@/lib/admin/cliente";
import type { DatosCatalogo } from "@/lib/admin/consultas";

type Item = { id: number; nombre: string; color: string; uso: number; esInicial?: boolean; esFinal?: boolean; esDefecto?: boolean };
type Tipo = "estados" | "prioridades";

const TONOS: { tono: Tono; nombre: string }[] = [
  { tono: "neutro", nombre: "Acero" }, { tono: "info", nombre: "Azul" }, { tono: "aviso", nombre: "Ámbar" },
  { tono: "alerta", nombre: "Rojo" }, { tono: "bien", nombre: "Verde" }, { tono: "violeta", nombre: "Violeta" },
];
const MAX = { estados: 30, prioridades: 10 };

export function PantallaCatalogo({ inicial }: { inicial: DatosCatalogo }) {
  const router = useRouter();
  const [datos, setDatos] = useState(inicial);
  const recargar = async () => { setDatos(await pedir<DatosCatalogo>("/api/admin/catalogo")); router.refresh(); };
  return (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
      <Lista tipo="estados" titulo="Estados" items={datos.estados} onCambio={recargar}
        ayuda="El inicial es el de toda tarea nueva (solo hay uno). Los que terminan cuentan como hechos: sin al menos uno, nada vence ni se completa." />
      <Lista tipo="prioridades" titulo="Prioridades" items={datos.prioridades} onCambio={recargar}
        ayuda="Arriba la más importante. La marcada por defecto es la que traen los formularios." />
    </div>
  );
}

function Lista({ tipo, titulo, items: inicial, ayuda, onCambio }: { tipo: Tipo; titulo: string; items: Item[]; ayuda: string; onCambio: () => Promise<void> }) {
  const { avisar } = useAvisos();
  const [orden, setOrden] = useState(inicial);
  const [previo, setPrevio] = useState(inicial);
  const [editando, setEditando] = useState<number | "nuevo" | null>(null);
  const [borrar, setBorrar] = useState<Item | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const idDnd = useId();
  const sensores = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  // Los datos del servidor mandan cuando cambian (patron "estado derivado").
  if (previo !== inicial) { setPrevio(inicial); setOrden(inicial); }

  async function soltar(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const antes = orden;
    const nuevo = arrayMove(orden, orden.findIndex((x) => x.id === e.active.id), orden.findIndex((x) => x.id === e.over!.id));
    setOrden(nuevo);
    try {
      await pedir(`/api/admin/catalogo/${tipo}/orden`, { cuerpo: { ids: nuevo.map((x) => x.id) } });
      avisar(`Orden de ${titulo.toLowerCase()} guardado.`, {
        tipo: "exito",
        deshacer: async () => { setOrden(antes); await pedir(`/api/admin/catalogo/${tipo}/orden`, { cuerpo: { ids: antes.map((x) => x.id) } }); await onCambio(); },
      });
      await onCambio();
    } catch (er) {
      setOrden(antes);
      avisar(mensajeDe(er), { tipo: "error" });
    }
  }

  async function guardar(id: number | "nuevo", d: Partial<Item>) {
    const url = id === "nuevo" ? `/api/admin/catalogo/${tipo}` : `/api/admin/catalogo/${tipo}/${id}`;
    const r = await pedir<{ mensaje: string }>(url, { metodo: id === "nuevo" ? "POST" : "PATCH", cuerpo: d });
    avisar(r.mensaje, { tipo: "exito" });
    setEditando(null);
    await onCambio();
  }

  async function eliminar() {
    if (!borrar) return;
    setTrabajando(true);
    try {
      await pedir(`/api/admin/catalogo/${tipo}/${borrar.id}`, { metodo: "DELETE" });
      avisar(`${borrar.nombre} eliminado.`, { tipo: "exito" });
      setBorrar(null);
      await onCambio();
    } catch (e) { avisar(mensajeDe(e), { tipo: "error" }); } finally { setTrabajando(false); }
  }

  return (
    <section aria-labelledby={`t-${tipo}`} className="min-w-0 rounded-md border border-hilo bg-superficie shadow-1">
      <header className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-hilo px-4 py-2">
        <h2 id={`t-${tipo}`} className="font-rotulo text-sm font-semibold uppercase tracking-[0.14em]">{titulo}</h2>
        <Boton variante="secundario" tamano="sm" icono={<Plus className="size-4" aria-hidden />} onClick={() => setEditando("nuevo")} disabled={editando === "nuevo"}>
          {tipo === "estados" ? "Nuevo estado" : "Nueva prioridad"}
        </Boton>
      </header>
      <p className="border-b border-hilo px-4 py-2 text-sm text-texto-2">{ayuda}</p>
      <DndContext id={idDnd} sensors={sensores} collisionDetection={closestCenter} onDragEnd={soltar}>
        <SortableContext items={orden.map((x) => x.id)} strategy={verticalListSortingStrategy}>
          <ol aria-label={`${titulo}, en orden`}>
            {orden.map((it, i) => editando === it.id
              ? <Edicion key={it.id} tipo={tipo} item={it} onGuardar={(d) => guardar(it.id, d)} onCancelar={() => setEditando(null)} />
              : <FilaOrdenable key={it.id} tipo={tipo} item={it} posicion={i + 1} total={orden.length} onEditar={() => setEditando(it.id)} onBorrar={() => setBorrar(it)} />)}
          </ol>
        </SortableContext>
      </DndContext>
      {editando === "nuevo" && <ol><Edicion tipo={tipo} onGuardar={(d) => guardar("nuevo", d)} onCancelar={() => setEditando(null)} /></ol>}

      <Dialogo abierto={!!borrar} onCerrar={() => setBorrar(null)} titulo={tipo === "estados" ? "Eliminar estado" : "Eliminar prioridad"} ancho="sm"
        pie={<><Boton variante="fantasma" onClick={() => setBorrar(null)}>Cancelar</Boton><Boton variante="peligro" cargando={trabajando} onClick={eliminar}>Eliminar</Boton></>}>
        <p><strong>{borrar?.nombre}</strong> desaparece de los formularios y filtros. Ninguna tarea lo usa.</p>
      </Dialogo>
    </section>
  );
}

function Marcas({ tipo, it }: { tipo: Tipo; it: Item }) {
  const m = tipo === "estados"
    ? [it.esInicial && "Inicial", it.esFinal && "Termina"].filter(Boolean)
    : [it.esDefecto && "Por defecto"].filter(Boolean);
  return <>{m.map((x) => <span key={String(x)} className="rounded-sm border border-hilo-fuerte px-1.5 font-rotulo text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-texto-2">{x}</span>)}</>;
}

function FilaOrdenable({ tipo, item: it, posicion, total, onEditar, onBorrar }: {
  tipo: Tipo; item: Item; posicion: number; total: number; onEditar: () => void; onBorrar: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: it.id });
  const bloqueadoBorrar = it.uso > 0 || it.esInicial || it.esDefecto;
  const motivo = it.uso > 0 ? `Lo usan ${it.uso} tarea(s)` : it.esInicial ? "Es el estado inicial" : it.esDefecto ? "Es la prioridad por defecto" : "Eliminar";
  return (
    <li
      ref={setNodeRef}
      style={{ transform: transform ? `translate3d(0, ${Math.round(transform.y)}px, 0)` : undefined, transition }}
      className={cx("relative flex min-h-11 items-center gap-2 border-b border-hilo bg-superficie px-2 last:border-0",
        isDragging && "z-10 shadow-2 motion-safe:scale-[1.01]")}
    >
      <button type="button" {...attributes} {...listeners} aria-label={`Mover ${it.nombre} (posición ${posicion} de ${total})`}
        className="grid size-10 cursor-grab touch-none place-items-center rounded-sm text-texto-3 hover:bg-superficie-2 hover:text-texto active:cursor-grabbing">
        <GripVertical className="size-4" aria-hidden />
      </button>
      <span className="hidden w-6 font-mono text-xs text-texto-3 cifras sm:inline">{String(posicion).padStart(2, "0")}</span>
      <CeldaEstado texto={it.nombre} tono={it.color as Tono} />
      <span className="flex min-w-0 flex-wrap gap-1"><Marcas tipo={tipo} it={it} /></span>
      <span className="ml-auto whitespace-nowrap text-sm text-texto-3"><span className="font-mono text-texto cifras">{it.uso}</span><span className="hidden sm:inline"> tarea{it.uso === 1 ? "" : "s"}</span></span>
      <button type="button" onClick={onEditar} aria-label={`Editar ${it.nombre}`} className="grid size-10 place-items-center rounded-sm text-texto-3 hover:bg-superficie-2 hover:text-texto"><Pencil className="size-4" aria-hidden /></button>
      <button type="button" onClick={onBorrar} disabled={bloqueadoBorrar} title={motivo} aria-label={`Eliminar ${it.nombre}${bloqueadoBorrar ? ` (no disponible: ${motivo.toLowerCase()})` : ""}`}
        className="grid size-10 place-items-center rounded-sm text-texto-3 hover:bg-superficie-2 hover:text-alerta disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-texto-3"><Trash2 className="size-4" aria-hidden /></button>
    </li>
  );
}

function Edicion({ tipo, item, onGuardar, onCancelar }: { tipo: Tipo; item?: Item; onGuardar: (d: Partial<Item>) => Promise<void>; onCancelar: () => void }) {
  const [nombre, setNombre] = useState(item?.nombre ?? "");
  const [color, setColor] = useState<Tono>((item?.color as Tono) ?? "neutro");
  const [esInicial, setInicial] = useState(!!item?.esInicial);
  const [esFinal, setFinal] = useState(!!item?.esFinal);
  const [esDefecto, setDefecto] = useState(!!item?.esDefecto);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const renombra = !!item && nombre.trim() !== item.nombre && nombre.trim() !== "";

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return setError("El nombre es obligatorio.");
    setGuardando(true);
    try {
      await onGuardar(tipo === "estados" ? { nombre: nombre.trim(), color, esInicial, esFinal } : { nombre: nombre.trim(), color, esDefecto });
    } catch (er) { setError(mensajeDe(er)); } finally { setGuardando(false); }
  }

  return (
    <li className="border-b border-hilo bg-superficie-2 px-4 py-3 last:border-0">
      <form onSubmit={enviar} onKeyDown={(e) => { if (e.key === "Escape") onCancelar(); }} noValidate className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Entrada aria-label="Nombre" value={nombre} maxLength={MAX[tipo]} onChange={(e) => setNombre(e.target.value)} autoFocus className="flex-1"
            placeholder={tipo === "estados" ? "Nombre del estado" : "Nombre de la prioridad"} />
          <button type="button" onClick={onCancelar} aria-label="Cancelar" className="grid size-10 place-items-center rounded-sm text-texto-3 hover:bg-hundida"><X className="size-4" aria-hidden /></button>
        </div>
        {tipo === "prioridades" && <p className="-mt-1 text-xs text-texto-3">Hasta {MAX.prioridades} caracteres: es lo que cabe en la tarea.</p>}
        {renombra && item!.uso > 0 && (
          <p role="status" className="flex items-start gap-2 rounded-sm border border-aviso/40 px-3 py-2 text-sm text-texto">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-aviso" aria-hidden />
            <span>Renombrar afecta a <strong className="font-mono cifras">{item!.uso}</strong> tarea{item!.uso === 1 ? "" : "s"}: pasarán de «{item!.nombre}» a «{nombre.trim()}».</span>
          </p>
        )}
        <fieldset className="flex flex-wrap items-center gap-1">
          <legend className="rotulo mb-1.5">Tono</legend>
          {TONOS.map((t) => (
            <label key={t.tono} className={cx("flex min-h-10 cursor-pointer items-center gap-1.5 rounded-sm border px-2.5 text-sm", color === t.tono ? "border-texto bg-superficie" : "border-transparent hover:bg-superficie")}>
              <input type="radio" name={`tono-${item?.id ?? "nuevo"}`} className="sr-only" checked={color === t.tono} onChange={() => setColor(t.tono)} />
              <PuntoTono tono={t.tono} />{t.nombre}
            </label>
          ))}
        </fieldset>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          {tipo === "estados" ? (
            <>
              <label className="flex min-h-10 items-center gap-2"><input type="checkbox" className="size-4 accent-[var(--texto)]" checked={esInicial} disabled={!!item?.esInicial} onChange={(e) => setInicial(e.target.checked)} />Inicial</label>
              <label className="flex min-h-10 items-center gap-2"><input type="checkbox" className="size-4 accent-[var(--texto)]" checked={esFinal} onChange={(e) => setFinal(e.target.checked)} />Termina la tarea</label>
            </>
          ) : (
            <label className="flex min-h-10 items-center gap-2"><input type="checkbox" className="size-4 accent-[var(--texto)]" checked={esDefecto} disabled={!!item?.esDefecto} onChange={(e) => setDefecto(e.target.checked)} />Por defecto</label>
          )}
          <span className="ml-auto flex items-center gap-2 text-sm text-texto-3">Vista previa <CeldaEstado texto={nombre.trim() || "—"} tono={color} /></span>
        </div>
        {item?.esInicial && <p className="text-xs text-texto-3">Es el inicial: marca otro como inicial y este dejará de serlo.</p>}
        {esInicial && !item?.esInicial && <p className="text-xs text-texto-3">El inicial actual dejará de serlo.</p>}
        {error && <p role="alert" className="text-sm text-alerta">{error}</p>}
        <div><Boton type="submit" variante="primario" tamano="sm" cargando={guardando}>{item ? "Guardar" : tipo === "estados" ? "Crear estado" : "Crear prioridad"}</Boton></div>
      </form>
    </li>
  );
}
