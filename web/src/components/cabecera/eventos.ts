/*
 * Contrato global de la cabecera. Cualquier pantalla puede usarlo sin saber
 * donde viven la paleta, el tour o el formulario de solicitud:
 *
 *   ?solicitar=1             en cualquier URL autenticada abre "Solicitar a
 *                            otra unidad" (el parametro se retira al abrir).
 *   abrirSolicitud()         lo mismo desde codigo (evento "solicitud:abrir").
 *   "solicitud:enviada"      se emite en window al crear una solicitud;
 *                            detail = { id, destino }. Quien liste solicitudes
 *                            lo escucha para refrescar.
 *   iniciarTour()            relanza el tour de bienvenida ("tour:iniciar").
 *   abrirPaleta()            abre la paleta de comandos ("paleta:abrir");
 *                            tambien Ctrl/Cmd + K.
 */
export const EVENTO_ABRIR_SOLICITUD = "solicitud:abrir";
export const EVENTO_SOLICITUD_ENVIADA = "solicitud:enviada";
export const EVENTO_INICIAR_TOUR = "tour:iniciar";
export const EVENTO_ABRIR_PALETA = "paleta:abrir";

export type DetalleSolicitudEnviada = { id: number; destino: string };

export function abrirSolicitud() { window.dispatchEvent(new CustomEvent(EVENTO_ABRIR_SOLICITUD)); }
export function iniciarTour() { window.dispatchEvent(new CustomEvent(EVENTO_INICIAR_TOUR)); }
export function abrirPaleta() { window.dispatchEvent(new CustomEvent(EVENTO_ABRIR_PALETA)); }
