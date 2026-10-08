"use client";
import { useActionState } from "react";
import { iniciarSesion, type EstadoLogin } from "./acciones";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada } from "@/components/ui/campo";

export function FormularioLogin({ destino }: { destino: string }) {
  const [estado, accion, enviando] = useActionState<EstadoLogin, FormData>(iniciarSesion, {});
  return (
    <form action={accion} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="destino" value={destino} />
      <Campo etiqueta="Correo">
        {(a) => <Entrada {...a} name="email" type="email" autoComplete="username" required defaultValue={estado.email} autoFocus />}
      </Campo>
      <Campo etiqueta="Contraseña" error={estado.error}>
        {(a) => <Entrada {...a} name="password" type="password" autoComplete="current-password" required />}
      </Campo>
      <Boton type="submit" variante="primario" cargando={enviando} className="mt-2 w-full">
        {enviando ? "Entrando" : "Entrar"}
      </Boton>
    </form>
  );
}
