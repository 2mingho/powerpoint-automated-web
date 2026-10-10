"use client";
import { useState } from "react";
import { Check, Plus, Trash2, X } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { Entrada } from "@/components/ui/campo";
import { cx } from "@/components/ui/cx";
import { Dialogo } from "@/components/ui/dialogo";
import { useAvisos } from "@/components/ui/avisos";
import { mensajeDe, pedir } from "@/lib/admin/cliente";
import { claseCelda, claseFila, Tabla, Th } from "../../_componentes/comunes";

type Rol = { id: number; codigo: string; nombre: string; descripcion: string; usuarios: number };

/* Roles: edicion en linea (nombre y descripcion); el codigo no cambia porque las cuentas lo guardan. */
export function Roles({ roles, adminUsuarios, onCambio }: { roles: Rol[]; adminUsuarios: number; onCambio: () => Promise<void> }) {
  const { avisar } = useAvisos();
  const [editando, setEditando] = useState<number | "nuevo" | null>(null);
  const [borrar, setBorrar] = useState<Rol | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  async function guardar(id: number | "nuevo", datos: { codigo?: string; nombre: string; descripcion: string }) {
    try {
      if (id === "nuevo") await pedir("/api/admin/roles", { cuerpo: datos });
      else await pedir(`/api/admin/roles/${id}`, { metodo: "PATCH", cuerpo: datos });
      avisar(id === "nuevo" ? `Rol ${datos.codigo} creado.` : "Rol actualizado.", { tipo: "exito" });
      setEditando(null);
      await onCambio();
      return null;
    } catch (e) { return mensajeDe(e); }
  }

  async function eliminar() {
    if (!borrar) return;
    setTrabajando(true);
    try {
      await pedir(`/api/admin/roles/${borrar.id}`, { metodo: "DELETE" });
      avisar(`Rol ${borrar.codigo} eliminado.`, { tipo: "exito" });
      setBorrar(null);
      await onCambio();
    } catch (e) { avisar(mensajeDe(e), { tipo: "error" }); } finally { setTrabajando(false); }
  }

  return (
    <Tabla
      etiqueta="Roles"
      cabecera={<>
        <h2 className="font-rotulo text-sm font-semibold uppercase tracking-[0.14em]">Roles</h2>
        <span className="text-sm text-texto-3">Etiquetan la función de cada persona; los permisos salen de sus herramientas.</span>
        <div className="ml-auto"><Boton variante="secundario" tamano="sm" icono={<Plus className="size-4" aria-hidden />} onClick={() => setEditando("nuevo")} disabled={editando === "nuevo"}>Nuevo rol</Boton></div>
      </>}
    >
      <table className="w-full border-collapse text-sm">
        <thead className="hidden border-b border-hilo md:table-header-group">
          <tr><Th className="w-32">Código</Th><Th>Nombre</Th><Th className="hidden md:table-cell">Descripción</Th><Th className="w-24 text-right">Personas</Th><Th className="w-28"><span className="sr-only">Acciones</span></Th></tr>
        </thead>
        <tbody>
          {editando === "nuevo" && <FilaEdicion nuevo onGuardar={(d) => guardar("nuevo", d)} onCancelar={() => setEditando(null)} />}
          <tr className={claseFila}>
            <td className={cx(claseCelda, "font-mono text-xs")}>admin</td>
            <td className={claseCelda}>Administración</td>
            <td className={cx(claseCelda, "hidden text-texto-3 md:table-cell")}>Reservado: entra a todo y gestiona esta sección.</td>
            <td className={cx(claseCelda, "text-right font-mono cifras")}>{adminUsuarios || "—"}</td>
            <td className={claseCelda} />
          </tr>
          {roles.map((r) => editando === r.id
            ? <FilaEdicion key={r.id} rol={r} onGuardar={(d) => guardar(r.id, d)} onCancelar={() => setEditando(null)} />
            : (
              <tr key={r.id} className={claseFila}>
                <td className={cx(claseCelda, "font-mono text-xs")}>{r.codigo}</td>
                <td className={claseCelda}>
                  <button type="button" onClick={() => setEditando(r.id)} className="text-left hover:underline">{r.nombre}</button>
                </td>
                <td className={cx(claseCelda, "hidden max-w-0 truncate text-texto-2 md:table-cell")}>{r.descripcion || <span className="text-texto-3">—</span>}</td>
                <td className={cx(claseCelda, "text-right font-mono cifras")}>{r.usuarios}</td>
                <td className={cx(claseCelda, "text-right")}>
                  <button type="button" onClick={() => setBorrar(r)} disabled={r.usuarios > 0} aria-label={`Eliminar el rol ${r.codigo}`}
                    title={r.usuarios > 0 ? `Lo tienen ${r.usuarios} persona(s)` : "Eliminar"}
                    className="inline-grid size-10 place-items-center rounded-sm text-texto-3 hover:bg-hundida hover:text-alerta disabled:opacity-30 disabled:hover:bg-transparent">
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
      <Dialogo abierto={!!borrar} onCerrar={() => setBorrar(null)} titulo="Eliminar rol" ancho="sm"
        pie={<><Boton variante="fantasma" onClick={() => setBorrar(null)}>Cancelar</Boton><Boton variante="peligro" cargando={trabajando} onClick={eliminar}>Eliminar rol</Boton></>}>
        <p>El rol <strong className="font-mono">{borrar?.codigo}</strong> ({borrar?.nombre}) desaparece del catálogo. Nadie lo tiene asignado.</p>
      </Dialogo>
    </Tabla>
  );
}

function FilaEdicion({ rol, nuevo, onGuardar, onCancelar }: {
  rol?: Rol; nuevo?: boolean; onGuardar: (d: { codigo?: string; nombre: string; descripcion: string }) => Promise<string | null>; onCancelar: () => void;
}) {
  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState(rol?.nombre ?? "");
  const [descripcion, setDescripcion] = useState(rol?.descripcion ?? "");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function enviar() {
    if (nuevo && !/^[A-Za-z0-9_-]+$/.test(codigo.trim())) return setError("Código: letras, números, guion o guion bajo.");
    if (!nombre.trim()) return setError("El nombre es obligatorio.");
    setGuardando(true);
    const e = await onGuardar({ ...(nuevo ? { codigo: codigo.trim().toUpperCase() } : {}), nombre, descripcion });
    setGuardando(false);
    setError(e);
  }

  return (
    <tr className="border-b border-hilo bg-superficie-2">
      <td colSpan={5} className="px-4 py-2">
        <div className="flex flex-wrap items-center gap-2" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void enviar(); } if (e.key === "Escape") onCancelar(); }}>
          {nuevo ? <Entrada aria-label="Código" placeholder="Código" value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} maxLength={30} className="w-28 font-mono" autoFocus />
            : <span className="w-28 font-mono text-xs">{rol?.codigo}</span>}
          <Entrada aria-label="Nombre" placeholder="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={100} className="w-full sm:w-52" autoFocus={!nuevo} />
          <Entrada aria-label="Descripción" placeholder="Descripción (opcional)" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} maxLength={500} className="w-full flex-1 sm:min-w-56" />
          <Boton variante="primario" tamano="sm" cargando={guardando} icono={<Check className="size-4" aria-hidden />} onClick={enviar}>{nuevo ? "Crear rol" : "Guardar"}</Boton>
          <button type="button" onClick={onCancelar} aria-label="Cancelar" className="grid size-10 place-items-center rounded-sm text-texto-3 hover:bg-hundida"><X className="size-4" aria-hidden /></button>
        </div>
        {error && <p role="alert" className="mt-1 text-sm text-alerta">{error}</p>}
      </td>
    </tr>
  );
}
