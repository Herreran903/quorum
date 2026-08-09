"use client";

/**
 * Todo el estado del chat compartido, reducido desde el canal.
 *
 * Esta es la única fuente de verdad: el agente no guarda nada, LEE de acá
 * (ver `agente-chat.ts`). Por eso da igual en qué pestaña se escriba algo, y
 * por eso cualquiera puede tomar el mando sin perder contexto.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  Artefacto,
  Mensaje,
  OpcionVoto,
  Sobre,
  TrozoArtefacto,
  Votacion,
} from "./protocolo";
import { canalDeSala } from "./protocolo";
import { apodo } from "./apodo";
import { useIdentidad } from "./useIdentidad";
import { AgenteChat, VENTANA_VOTACION_MS, ganadoraDe, nuevoId, type VistaAgente } from "./agente-chat";
import type { Intervencion } from "./modelo-turno";
import {
  PRESENCIA_VACIA,
  alguienEscribe,
  crearTransporte,
  otrosEn,
  transporteActivo,
  transporteDeLaUrl,
  type ClaseTransporte,
  type EstadoConexion,
  type Presencia,
  type Transporte,
} from "./transporte";

/** Un mensaje con quién lo escribió y cuándo — el emisor no viaja en el cuerpo. */
export interface MensajeEnChat extends Mensaje {
  emisor: string;
  at: number;
}

/** Un voto con quién lo emitió y cuándo. */
export interface VotoEnChat {
  votacionId: string;
  opcionId: string;
  emisor: string;
  at: number;
}

export interface EstadoChat {
  tarea: string | undefined;
  /** quién arrancó la sesión, y cuándo: es el conductor inicial */
  tareaPor: string | undefined;
  tareaAt: number;
  mensajes: MensajeEnChat[];
  /** trozos recibidos, por `${id}:${version}` */
  trozos: Map<string, TrozoArtefacto[]>;
  votaciones: Votacion[];
  votos: VotoEnChat[];
  /** ids de instrucciones (mensajes humanos) que su autor retiró */
  retiros: Set<string>;
}

export const VACIO: EstadoChat = {
  tarea: undefined,
  tareaPor: undefined,
  tareaAt: 0,
  mensajes: [],
  trozos: new Map(),
  votaciones: [],
  votos: [],
  retiros: new Set(),
};

export function reducir(estado: EstadoChat, sobre: Sobre): EstadoChat {
  const c = sobre.cuerpo;
  switch (c.tipo) {
    case "tarea":
      // La primera gana: la tarea no se redefine a mitad de sesión.
      return estado.tarea
        ? estado
        : { ...estado, tarea: c.tarea.texto, tareaPor: sobre.emisor, tareaAt: sobre.at };

    case "mensaje": {
      if (estado.mensajes.some((m) => m.id === c.mensaje.id)) return estado;
      const m: MensajeEnChat = { ...c.mensaje, emisor: sobre.emisor, at: sobre.at };
      return { ...estado, mensajes: [...estado.mensajes, m] };
    }

    case "artefacto": {
      const clave = `${c.trozo.id}:${c.trozo.version}`;
      const previos = estado.trozos.get(clave) ?? [];
      if (previos.some((t) => t.parte === c.trozo.parte)) return estado;
      const trozos = new Map(estado.trozos);
      trozos.set(clave, [...previos, c.trozo]);
      return { ...estado, trozos };
    }

    case "votacion":
      if (estado.votaciones.some((v) => v.id === c.votacion.id)) return estado;
      return { ...estado, votaciones: [...estado.votaciones, c.votacion] };

    case "voto": {
      // Un voto por persona y votación; el último reemplaza al anterior.
      const i = estado.votos.findIndex(
        (v) => v.votacionId === c.voto.votacionId && v.emisor === sobre.emisor,
      );
      const votos = [...estado.votos];
      const nuevo: VotoEnChat = { ...c.voto, emisor: sobre.emisor, at: sobre.at };
      if (i >= 0) votos[i] = nuevo;
      else votos.push(nuevo);
      return { ...estado, votos };
    }

    case "retiro": {
      const { instruccionId } = c.retiro;
      if (estado.retiros.has(instruccionId)) return estado;
      const original = estado.mensajes.find((m) => m.id === instruccionId);
      // Solo el propio autor retira su pedido, y solo si el agente todavía
      // no lo aplicó — lo ya incorporado no se puede desandar retroactivo.
      if (!original || original.deAgente || original.emisor !== sobre.emisor) return estado;
      const yaAplicada = estado.mensajes.some(
        (m) => m.deAgente && m.atendio?.includes(instruccionId),
      );
      if (yaAplicada) return estado;
      const retiros = new Set(estado.retiros);
      retiros.add(instruccionId);
      return { ...estado, retiros };
    }

    default:
      // Los tipos de Acta no son de esta sala.
      return estado;
  }
}

/** Rearma el artefacto: la última versión que tenga TODOS sus trozos. */
export function armarArtefacto(
  trozos: Map<string, TrozoArtefacto[]>,
): Artefacto | undefined {
  let mejor: Artefacto | undefined;
  for (const partes of trozos.values()) {
    const cabeza = partes[0];
    if (!cabeza || partes.length !== cabeza.total) continue;
    if (mejor && cabeza.version <= mejor.version) continue;
    const ordenadas = [...partes].sort((x, y) => x.parte - y.parte);
    mejor = {
      id: cabeza.id,
      version: cabeza.version,
      tipo: cabeza.tipo,
      titulo: cabeza.titulo,
      lenguaje: cabeza.lenguaje,
      contenido: ordenadas.map((t) => t.texto).join(""),
    };
  }
  return mejor;
}

/** Una instrucción humana y en qué estado está respecto del agente. */
export interface Instruccion {
  id: string;
  emisor: string;
  texto: string;
  at: number;
  /** el agente ya la incorporó en algún turno */
  aplicada: boolean;
  /**
   * El equipo la descartó votando: perdió contra otra que la contradecía.
   *
   * No es lo mismo que retirada (eso lo hace su autor) ni que aplicada. Sigue
   * a la vista —la sala decidió algo y tiene que verse— pero el agente no la
   * vuelve a tocar.
   */
  descartada: boolean;
}

// ------------------------------------------------------------- derivaciones
// Puras, y fuera del hook a propósito: las usa el render (vía useMemo) y
// también el agente, que lee el estado crudo por ref en el momento exacto de
// decidir. Una sola definición para los dos, sin duplicar la lógica.

/**
 * El directorio: id → cómo mostrar a esa persona.
 *
 * Dos fuentes, en este orden:
 *  1. la presencia, que trae el nombre VERIFICADO del token — pero solo de
 *     quien está conectado ahora;
 *  2. el `autor` guardado en sus mensajes, que cubre a quien ya se fue.
 *
 * Y si no hay ninguna de las dos, un apodo derivado del id: es lo que pasa en
 * anónimo, y deja claro que ahí no hay identidad real.
 */
function derivarPerfil(estado: EstadoChat, presencia: Presencia): (id: string) => Perfil {
  const directorio = new Map<string, Perfil>();

  for (const m of estado.mensajes) {
    if (m.deAgente || !m.autor) continue;
    directorio.set(m.emisor, { id: m.emisor, nombre: m.autor, verificado: false });
  }

  for (const e of presencia.espectadores) {
    if (!e.nombre) {
      // Sin nombre verificado, pero sí puede haber foto.
      if (!e.avatar) continue;
      const previo = directorio.get(e.id);
      directorio.set(e.id, {
        id: e.id,
        nombre: previo?.nombre ?? apodo(e.id),
        avatar: e.avatar,
        verificado: previo?.verificado ?? false,
      });
      continue;
    }
    directorio.set(e.id, {
      id: e.id,
      nombre: e.nombre,
      avatar: e.avatar,
      verificado: e.anonimo !== true,
    });
  }

  return (id) => directorio.get(id) ?? { id, nombre: apodo(id), verificado: false };
}

/**
 * Cuánto vale una conducción sin señales antes de darla por abandonada.
 *
 * Generoso a propósito: un turno puede tardar lo que tarde el modelo (hasta
 * ~30s), y declarar vacante el puesto mientras alguien está pensando pondría
 * a dos agentes a publicar a la vez. Quien quiera adelantarse tiene el botón
 * de tomar el control.
 */
export const VENTANA_CONDUCCION_MS = 45_000;

/**
 * Cuánto se sigue ignorando la señal de "escribiendo" de alguien después de
 * que mandó un mensaje.
 *
 * El transporte no apaga esa señal al instante — Portal la expira del lado
 * del cliente, no bien "enviar" (~5s, fuera de nuestro control) — así que sin
 * esto la burbuja de "escribiendo" sigue un rato aunque el mensaje ya esté en
 * el chat.
 */
const MARGEN_POST_ENVIO_MS = 1500;

/**
 * Quién está conduciendo al agente, derivado del canal.
 *
 * No hay latido ni mensaje de "yo conduzco": el conductor ES quien publicó lo
 * último que publicó el agente. Un latido propio tendría que ser persistente
 * — los efímeros no cruzan en Portal 0.1.5, ver `transporte-portal.ts` — y
 * ensuciaría la historia con una fila cada pocos segundos.
 *
 * Al principio, cuando el agente todavía no habló, manda quien creó la tarea.
 */
export function derivarConductor(estado: EstadoChat, ahora: number): string | undefined {
  for (let i = estado.mensajes.length - 1; i >= 0; i--) {
    const m = estado.mensajes[i];
    if (!m.deAgente) continue;
    return ahora - m.at < VENTANA_CONDUCCION_MS ? m.emisor : undefined;
  }
  if (estado.tareaPor && ahora - estado.tareaAt < VENTANA_CONDUCCION_MS) {
    return estado.tareaPor;
  }
  return undefined;
}

export function derivarInstrucciones(
  estado: EstadoChat,
  ahora: number,
  notados: ReadonlyMap<string, number> = new Map(),
): Instruccion[] {
  const atendidos = new Set<string>();
  for (const m of estado.mensajes) {
    if (!m.deAgente) continue;
    for (const id of m.atendio ?? []) atendidos.add(id);
  }

  /**
   * Lo que perdió una votación deja de ser un pedido vivo.
   *
   * Sin esto la votación era decorativa: el agente aplicaba la ganadora y, un
   * turno después, la perdedora seguía siendo el pedido más viejo sin atender
   * y también la aplicaba — pisando justo lo que el equipo acababa de elegir.
   * El par ya está en `#paresRevisados`, así que ni siquiera se volvía a
   * votar: la decisión se deshacía sola y en silencio.
   */
  const descartadas = new Set<string>();
  for (const r of derivarResueltas(estado, ahora, notados)) {
    for (const o of r.votacion.opciones) {
      if (o.id !== r.ganadora.id) descartadas.add(o.id);
    }
  }

  return estado.mensajes
    .filter((m) => !m.deAgente && !estado.retiros.has(m.id))
    .map((m) => ({
      id: m.id,
      emisor: m.emisor,
      texto: m.texto,
      at: m.at,
      aplicada: atendidos.has(m.id),
      descartada: descartadas.has(m.id),
    }));
}

/**
 * La cola de pedidos que el agente todavía puede tomar, del más viejo al más
 * nuevo. UNA sola definición de "vivo", a propósito.
 *
 * El agente usa las dos puntas de esto: la cabeza es el pedido que va a
 * aplicar (`pendienteActivo`) y la cola entera es lo que mira para detectar
 * choques. Cuando cada uno filtraba por su lado, se desincronizaron: la
 * perdedora de una votación salía de una lista pero no de la otra, y el
 * detector terminó comparando todo contra un pedido que la sala ya había
 * rechazado. Derivar ambas de acá lo vuelve imposible.
 *
 * El resto queda pausado —visible en el consolidado, cancelable con el
 * retiro— hasta que le llegue el turno: dos pedidos que se pisan nunca se
 * procesan juntos, gana el que llegó primero.
 */
export function pendientesVivos(instrucciones: Instruccion[]): Instruccion[] {
  return instrucciones
    .filter((i) => !i.aplicada && !i.descartada)
    .sort((a, b) => a.at - b.at);
}

export function pendienteActivo(instrucciones: Instruccion[]): Instruccion | undefined {
  return pendientesVivos(instrucciones)[0];
}

/** Las opciones de una votación cuya petición original no fue retirada. */
function opcionesVivas(v: Votacion, estado: EstadoChat): OpcionVoto[] {
  return v.opciones.filter((o) => !estado.retiros.has(o.id));
}

/** Cuánto se acorta el cierre una vez que ya votaron todos los presentes. */
const CIERRE_TODOS_VOTARON_MS = 3_000;

/** Cuánta gente distinta hay conectada ahora — el "todos" de una votación. */
function totalPresentes(presencia: Presencia): number {
  return presencia.detallada ? presencia.espectadores.length : presencia.total;
}

/**
 * El cierre real de una votación: el programado, o `CIERRE_TODOS_VOTARON_MS`
 * después de que ESTE cliente notó que ya votaron todos los presentes — lo
 * que llegue antes.
 *
 * Pura y de solo lectura a propósito: consulta `notados` (por votación, el
 * `ahora` LOCAL en que se detectó el consenso) pero nunca lo escribe. Eso lo
 * hace `notarConsensoDeVoto`.
 *
 * El ancla es SIEMPRE el reloj de quien consulta, nunca el `at` de un voto
 * ajeno: ese `at` puede venir del reloj de otra persona o del servidor, y
 * comparado contra el propio `Date.now()`, cualquier diferencia angosta la
 * ventana de 3s — con poca diferencia alcanza para dejarla en cero y que la
 * votación se cierre casi al instante, sin que nadie llegue a cambiar su voto.
 */
export function cierreEfectivo(v: Votacion, notados: ReadonlyMap<string, number>): number {
  const notadoEn = notados.get(v.id);
  return notadoEn === undefined ? v.cierraEn : Math.min(v.cierraEn, notadoEn + CIERRE_TODOS_VOTARON_MS);
}

/**
 * Revisa si algún voto abierto ya juntó a todos los presentes y, si es la
 * primera vez que lo nota, lo anota contra `ahora` — SIEMPRE el reloj de
 * quien llama, nunca el de un voto ajeno.
 *
 * Devuelve el mismo `notados` (misma referencia) si no hay nada que cambiar
 * — el llamador (el cuerpo del componente, ver `useChat`) compara por
 * referencia para decidir si hace falta `setState`, siguiendo el patrón que
 * React documenta para ajustar estado durante el render sin el commit-de-más
 * de un efecto que llama `setState` sin condición.
 *
 * Cambiar de opción una vez notado el consenso NO lo reinicia — si
 * reiniciara, dos personas alternando voto podrían dejar la votación abierta
 * para siempre. Si en cambio se suma alguien presente que todavía no votó, el
 * consenso anotado se olvida: vuelve a haber algo por esperar.
 */
export function notarConsensoDeVoto(
  estado: EstadoChat,
  presencia: Presencia,
  notados: ReadonlyMap<string, number>,
  ahora: number,
): ReadonlyMap<string, number> {
  const total = totalPresentes(presencia);
  if (total <= 0) return notados;

  let siguiente: Map<string, number> | undefined;
  for (const v of estado.votaciones) {
    if (ahora >= v.cierraEn || opcionesVivas(v, estado).length <= 1) continue;

    const votantesUnicos = new Set(
      estado.votos.filter((vo) => vo.votacionId === v.id).map((vo) => vo.emisor),
    );
    const yaNotado = (siguiente ?? notados).has(v.id);

    if (votantesUnicos.size < total) {
      if (yaNotado) {
        siguiente = new Map(siguiente ?? notados);
        siguiente.delete(v.id);
      }
      continue;
    }
    if (!yaNotado) {
      siguiente = new Map(siguiente ?? notados);
      siguiente.set(v.id, ahora);
    }
  }
  return siguiente ?? notados;
}

/**
 * Si ya no queda más de una opción viva, la votación no tiene nada que
 * dirimir: no hace falta esperar el reloj para darla por resuelta.
 *
 * `notados` es opcional: sin él (p. ej. en un test que no arma una sala
 * entera) nunca hay un consenso registrado, así que se comporta como antes —
 * cierre fijo por reloj.
 */
function estaResuelta(
  v: Votacion,
  estado: EstadoChat,
  ahora: number,
  notados: ReadonlyMap<string, number> = new Map(),
): boolean {
  return ahora >= cierreEfectivo(v, notados) || opcionesVivas(v, estado).length <= 1;
}

function contar(estado: EstadoChat, v: Votacion): Record<string, number> {
  const c: Record<string, number> = {};
  for (const o of v.opciones) c[o.id] = 0;
  for (const voto of estado.votos) {
    if (voto.votacionId === v.id && voto.opcionId in c) c[voto.opcionId] += 1;
  }
  return c;
}

export interface Resuelta {
  votacion: Votacion;
  ganadora: OpcionVoto;
  conteo: Record<string, number>;
}

/**
 * Lo ya resuelto. Se deriva, no se anuncia: todos los clientes llegan a la
 * misma decisión sin depender de que alguien la haya publicado — ni de que
 * hubiera alguien conduciendo al agente cuando venció el plazo.
 */
function derivarResueltas(
  estado: EstadoChat,
  ahora: number,
  notados: ReadonlyMap<string, number> = new Map(),
): Resuelta[] {
  return estado.votaciones
    .filter((v) => estaResuelta(v, estado, ahora, notados))
    .map((v) => {
      const conteo = contar(estado, v);
      // Si a alguien le retiraron TODAS las opciones (los dos lados se
      // bajaron), no hay entre qué elegir: la primera queda como testigo.
      const vivas = opcionesVivas(v, estado);
      const ganadora = ganadoraDe(vivas.length > 0 ? { ...v, opciones: vivas } : v, conteo);
      // El cierre efectivo queda en el registro: la transcripción y el resto
      // de la UI lo leen de `votacion.cierraEn` sin saber que se acortó.
      const votacion = { ...v, cierraEn: cierreEfectivo(v, notados) };
      return { votacion, ganadora, conteo };
    });
}

function textoDecision(r: Resuelta): string {
  return `Sobre "${r.votacion.motivo}", el equipo eligió: ${r.ganadora.texto}`;
}

/**
 * Lo que el agente necesita saber, en el instante en que lo pregunta.
 *
 * `notados` es el MISMO mapa que usa el resto del hook — así el "todos
 * votaron" que nota el agente y el que nota la UI son un único momento, no
 * dos relojes corriendo por separado. Ver `cierreEfectivo`/`notarConsensoDeVoto`.
 */
function derivarVista(
  estado: EstadoChat,
  presencia: Presencia,
  ahora: number,
  yo: string | undefined,
  notados: ReadonlyMap<string, number>,
): VistaAgente {
  const perfil = derivarPerfil(estado, presencia);
  const instrucciones = derivarInstrucciones(estado, ahora, notados);
  const votacionAbierta = estado.votaciones.find((v) => !estaResuelta(v, estado, ahora, notados));
  const conductor = derivarConductor(estado, ahora);

  // El modelo ve los nombres reales: así puede decir "le agrego lo que pidió
  // Nicolás" en vez de referirse a un id.
  // Lo retirado no se le cuenta al modelo: si lo sigue leyendo en la
  // conversación, lo aplica igual aunque su autor lo haya dado de baja.
  const conversacion: Intervencion[] = estado.mensajes
    .filter((m) => !estado.retiros.has(m.id))
    .map((m) => ({
      id: m.id,
      autor: m.deAgente ? "agente" : perfil(m.emisor).nombre,
      texto: m.texto,
      deAgente: Boolean(m.deAgente),
    }));

  // Una sola cola para las dos cosas: la cabeza es lo que el agente aplica,
  // el resto es lo que mira para detectar choques. Ver `pendientesVivos`.
  const vivos = pendientesVivos(instrucciones);
  const activo = vivos[0];

  return {
    tarea: estado.tarea ?? "",
    conversacion,
    pendientes: activo ? [activo.id] : [],
    // La cola completa, con autor: es lo que deja ver si el que sigue
    // contradice al que se está por aplicar. Ver `#quizasAbrirVotacion`.
    enEspera: vivos.map((i) => ({
      id: i.id,
      emisor: i.emisor,
      autor: perfil(i.emisor).nombre,
      texto: i.texto,
    })),
    decisiones: derivarResueltas(estado, ahora, notados).map(textoDecision),
    artefacto: armarArtefacto(estado.trozos),
    votacionAbierta,
    conteo: votacionAbierta ? contar(estado, votacionAbierta) : {},
    // Se recalcula contra el reloj al leer, no cuando llegó el evento: ver
    // `alguienEscribe` en transporte.ts.
    escribiendo: alguienEscribe(presencia),
    debeCeder: Boolean(conductor && yo && conductor !== yo),
  };
}

/**
 * El chat, en orden: los mensajes y las votaciones ya resueltas.
 *
 * El resultado de una votación no viaja como mensaje — se deriva de los votos
 * y del reloj. Así queda en la transcripción aunque en ese momento nadie
 * estuviera conduciendo al agente.
 */
export type ItemChat =
  | { clase: "mensaje"; at: number; mensaje: MensajeEnChat }
  | {
      clase: "decision";
      at: number;
      votacion: Votacion;
      ganadora: OpcionVoto;
      conteo: Record<string, number>;
    };

/** Cómo se muestra una persona: nombre, foto, y si su nombre está verificado. */
export interface Perfil {
  id: string;
  nombre: string;
  avatar?: string;
  /** el nombre viene del token firmado, no de lo que declaró el cliente */
  verificado: boolean;
}

export interface UseChat {
  tarea: string | undefined;
  mensajes: MensajeEnChat[];
  /** cómo mostrar a cada participante, por id */
  perfil: (id: string) => Perfil;
  /** mensajes + decisiones, en orden cronológico: es lo que se pinta */
  items: ItemChat[];
  artefacto: Artefacto | undefined;
  /** el consolidado: qué pidió cada quien y si el agente ya lo tomó */
  instrucciones: Instruccion[];
  votacionAbierta: Votacion | undefined;
  /** conteo por opción de la votación abierta */
  conteo: Record<string, number>;
  /** qué votó cada persona en la votación abierta */
  votantes: VotoEnChat[];
  /** lo que la sala ya resolvió votando */
  decisiones: string[];

  presencia: Presencia;
  conexion: EstadoConexion;
  yo: string | undefined;
  transporte: ClaseTransporte;
  /** quiénes están tecleando ahora, sin contarme */
  tecleando: string[];

  /** el agente corre EN ESTA pestaña */
  conduzco: boolean;
  /** quién lo conduce ahora mismo, si alguien; sale del canal, no de acá */
  conductor: string | undefined;
  /** lo conduce OTRA persona: esta pestaña no debe arrancarlo */
  otroConduce: boolean;
  /** el agente está tomando un turno ahora mismo */
  pensando: boolean;
  fuente: string | undefined;
  degradado: string | undefined;

  empezar: (tarea: string) => void;
  /** `forzar` arrebata el mando aunque otro lo tenga */
  retomar: (forzar?: boolean) => void;
  pausar: () => void;
  enviar: (texto: string) => void;
  votar: (votacionId: string, opcionId: string) => void;
  /** abre una votación a mano; hoy no hay ningún disparador automático que la use */
  ponerAVotacion: (motivo: string, opciones: { id: string; texto: string; propuestaPor?: string }[]) => void;
  /** retira una petición propia; solo si el agente no la aplicó todavía */
  retirarPeticion: (instruccionId: string) => void;
  avisarEscribiendo: () => void;
}

export function useChat(idSala: string): UseChat {
  const identidad = useIdentidad();
  const [estado, setEstado] = useState<EstadoChat>(VACIO);
  const [presencia, setPresencia] = useState<Presencia>(PRESENCIA_VACIA);
  const [conexion, setConexion] = useState<EstadoConexion>("conectando");
  const [yo, setYo] = useState<string | undefined>();
  const [clase, setClase] = useState<ClaseTransporte>("mock");
  const [conduzco, setConduzco] = useState(false);
  const [pensando, setPensando] = useState(false);
  const [fuente, setFuente] = useState<string | undefined>();
  const [degradado, setDegradado] = useState<string | undefined>();
  /**
   * El reloj, como estado normal.
   *
   * Las votaciones vencen por tiempo, no por un evento que llegue: sin un
   * reloj que provoque render, el modal se quedaría abierto para siempre.
   * Va como estado y no como `Date.now()` metido en un array de dependencias
   * — eso último no es puro y el compilador de React lo rechaza, con razón.
   */
  const [ahora, setAhora] = useState(() => Date.now());

  const transporteRef = useRef<Transporte | null>(null);
  const agenteRef = useRef<AgenteChat | null>(null);
  /**
   * El estado crudo, espejado fuera de React.
   *
   * El agente lee de acá EN EL MOMENTO de decidir, no cuando React volvió a
   * renderizar: entre que llega un mensaje y se corre el render hay una
   * ventana en la que decidiría con la conversación vieja, y justo ahí es
   * donde se perdería el pedido que alguien acaba de escribir.
   *
   * Se escriben en los callbacks del transporte, nunca durante el render.
   */
  const estadoRef = useRef<EstadoChat>(VACIO);
  const presenciaRef = useRef<Presencia>(PRESENCIA_VACIA);

  /**
   * Por votación: el `ahora` LOCAL en que este cliente notó que ya votaron
   * todos los presentes. Ver `cierreEfectivo`.
   *
   * Va como estado, no como ref: leer un ref durante el render es justo la
   * clase de lectura impura que React rechaza — puede quedar desincronizada
   * del resto del render.
   *
   * Se ajusta DURANTE el render, no en un `useEffect`: es el patrón que React
   * documenta para "derivar estado de un cambio" sin el commit-de-más que
   * deja un efecto llamando `setState` sin condición. `notarConsensoDeVoto`
   * devuelve la MISMA referencia cuando no hay nada nuevo que notar, así que
   * esto es un no-op en la enorme mayoría de los renders.
   *
   * El ancla es `ahora` —el reloj de 1s que ya vive en estado, arriba— y no
   * `Date.now()`: React exige que el render sea puro, y `Date.now()` no lo
   * es. El costo es hasta ~1s de holgura en cuándo se nota el consenso, nunca
   * más — de sobra para una ventana pensada en segundos.
   */
  const [notados, setNotados] = useState<ReadonlyMap<string, number>>(() => new Map());
  const notadosAhora = notarConsensoDeVoto(estado, presencia, notados, ahora);
  if (notadosAhora !== notados) setNotados(notadosAhora);

  /** Espejo para `ver()`, igual que `estadoRef`/`presenciaRef`: el agente lee fuera del render. */
  const notadosRef = useRef(notados);

  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    notadosRef.current = notados;
  }, [notados]);

  // ------------------------------------------------------------- derivados

  const artefacto = useMemo(() => armarArtefacto(estado.trozos), [estado.trozos]);

  const perfil = useMemo(() => derivarPerfil(estado, presencia), [estado, presencia]);

  const instrucciones = useMemo(
    () => derivarInstrucciones(estado, ahora, notados),
    [estado, ahora, notados],
  );

  const votacionAbierta = useMemo(() => {
    const v = estado.votaciones.find((vv) => !estaResuelta(vv, estado, ahora, notados));
    if (!v) return undefined;
    // La UI solo debe ofrecer las opciones vivas: la retirada ya no se vota.
    // El cierre acortado también va acá: es lo que lee la cuenta regresiva
    // del modal, sin que este tenga que saber nada de "todos votaron".
    return { ...v, opciones: opcionesVivas(v, estado), cierraEn: cierreEfectivo(v, notados) };
  }, [estado, ahora, notados]);

  const conteo = useMemo(
    () => (votacionAbierta ? contar(estado, votacionAbierta) : {}),
    [estado, votacionAbierta],
  );

  const votantes = useMemo(
    () => (votacionAbierta ? estado.votos.filter((v) => v.votacionId === votacionAbierta.id) : []),
    [votacionAbierta, estado.votos],
  );

  const resueltas = useMemo(
    () => derivarResueltas(estado, ahora, notados),
    [estado, ahora, notados],
  );

  const decisiones = useMemo(() => resueltas.map(textoDecision), [resueltas]);

  const items = useMemo<ItemChat[]>(() => {
    const lista: ItemChat[] = estado.mensajes.map((m) => ({
      clase: "mensaje",
      at: m.at,
      mensaje: m,
    }));
    for (const r of resueltas) {
      lista.push({ clase: "decision", at: r.votacion.cierraEn, ...r });
    }
    return lista.sort((a, b) => a.at - b.at);
  }, [estado.mensajes, resueltas]);

  const tecleando = useMemo(() => {
    const ultimoMensaje = new Map<string, number>();
    for (const m of estado.mensajes) {
      if (m.deAgente) continue;
      ultimoMensaje.set(m.emisor, m.at);
    }
    return presencia.espectadores
      .filter((e) => {
        if (e.soyYo || !e.escribiendo) return false;
        // El transporte puede tardar unos segundos en apagar la señal de
        // tecleo — Portal la expira en el cliente, no al toque. Si esta
        // persona ya mandó el mensaje, para quien mira ya "dejó de escribir",
        // así que no esperamos a que el transporte se entere.
        const ultimo = ultimoMensaje.get(e.id);
        return ultimo === undefined || ahora - ultimo > MARGEN_POST_ENVIO_MS;
      })
      .map((e) => e.id);
  }, [presencia, estado.mensajes, ahora]);

  const conductor = useMemo(() => derivarConductor(estado, ahora), [estado, ahora]);
  const otroConduce = Boolean(conductor && yo && conductor !== yo);

  // ------------------------------------------------------------- conexión

  useEffect(() => {
    let vivo = true;
    let creado: Transporte | null = null;
    const forzar = transporteDeLaUrl();

    void (async () => {
      const t = await crearTransporte({
        canalId: canalDeSala(idSala),
        forzar,
        token: identidad.token,
        // El nombre NO va acá cuando hay sesión: lo pone Portal desde el
        // token. Va solo para el mock, que no tiene servidor que lo firme.
        metadata: {
          ...(identidad.avatar ? { avatar: identidad.avatar } : {}),
          ...(identidad.nombre ? { nombre: identidad.nombre } : {}),
        },
      });
      setClase(transporteActivo(forzar));
      if (!vivo) {
        t.desconectar();
        return;
      }
      creado = t;
      transporteRef.current = t;

      t.suscribir((sobre) =>
        setEstado((prev) => {
          const siguiente = reducir(prev, sobre);
          // El espejo se actualiza acá, en el callback del transporte, y no
          // en el render: es lo más temprano posible y no rompe la regla de
          // no tocar refs mientras se renderiza.
          estadoRef.current = siguiente;
          return siguiente;
        }),
      );
      t.presencia((p) => {
        presenciaRef.current = p;
        setPresencia(p);
        setYo(t.yo);
      });
      t.conexion(setConexion);
      setYo(t.yo);
    })();

    return () => {
      vivo = false;
      agenteRef.current?.detener();
      agenteRef.current = null;
      creado?.desconectar();
      transporteRef.current = null;
      // El agente murió con la conexión: si la UI siguiera creyendo que "yo
      // conduzco", jamás ofrecería "Retomar" y la sala moriría en silencio.
      setConduzco(false);
    };
    // Al cambiar la identidad hay que reconectar: el token viejo ya no es
    // quien sos, y una sesión con identidad rancia no puede quedar viva.
    // (La identidad de Clerk ya llega reducida a primitivos — ver
    // useIdentidad — así que esto solo dispara con cambios de verdad.)
  }, [idSala, identidad]);

  // ------------------------------------------------------------- acciones

  const yoRef = useRef(yo);
  useEffect(() => {
    yoRef.current = yo;
  }, [yo]);

  /**
   * "Pausar" es una orden, no un estado técnico.
   *
   * Sin esto, el despertador de más abajo revive al agente en cuanto entra un
   * pedido y el botón de pausa deja de significar nada.
   */
  const pausadoAMano = useRef(false);

  const arrancarAgente = useCallback((forzar = false) => {
    pausadoAMano.current = false;
    const t = transporteRef.current;
    // El guardia mira si está CORRIENDO, no si existe: un agente que dio la
    // tarea por terminada sigue en la ref, y con `if (agenteRef.current)`
    // "Retomar" no hacía nada — justo cuando llega un pedido nuevo y hay que
    // volver a arrancar.
    if (!t || agenteRef.current?.corriendo) return;

    // Se lee del espejo y no del estado de React: acá interesa el ahora, no
    // el último render.
    const conduceOtro = () => {
      const c = derivarConductor(estadoRef.current, Date.now());
      return Boolean(c && c !== yoRef.current);
    };

    if (conduceOtro()) {
      // Sin forzar no se arranca: dos agentes publicando en paralelo
      // duplican todo.
      if (!forzar) return;

      // Forzando hay que anunciarlo ANTES de arrancar. El conductor se deriva
      // de quién publicó lo último del agente, así que sin este mensaje el
      // otro seguiría figurando al mando y el agente recién arrancado
      // cedería de inmediato contra quien acaba de ser relevado.
      const quien = derivarPerfil(estadoRef.current, presenciaRef.current)(
        yoRef.current ?? "",
      ).nombre;
      void t.publicar({
        tipo: "mensaje",
        mensaje: {
          id: nuevoId(),
          texto: `${quien} tomó el control de la sesión.`,
          deAgente: true,
        },
      });
    }

    agenteRef.current?.detener();

    const ver = () =>
      derivarVista(
        estadoRef.current,
        presenciaRef.current,
        Date.now(),
        yoRef.current,
        notadosRef.current,
      );
    const agente = new AgenteChat(t, ver, {
      onPensando: setPensando,
      onFuente: (f, d) => {
        setFuente(f);
        setDegradado(d);
      },
      onFin: () => {
        agenteRef.current = null;
        setConduzco(false);
      },
    });
    agenteRef.current = agente;
    agente.arrancar();
    setConduzco(true);
  }, []);

  /**
   * Un pedido que llega después de que el agente se dio por terminado tiene
   * que despertarlo, lo haya escrito quien lo haya escrito.
   *
   * El agujero que esto tapa: `enviar` revive al agente SOLO en la pestaña de
   * quien escribió, y ahí `arrancarAgente` se frena si conduce otro. O sea
   * que si el agente cerró la tarea conduciendo Ana y el pedido nuevo lo hace
   * Beto, la pestaña de Beto no puede arrancar (conduce Ana) y la de Ana no
   * se entera de nada: el pedido queda colgado hasta que alguien note el
   * botón "Retomar". En una demo eso se ve como un agente que ignora a la
   * gente.
   *
   * Revive el conductor —o cualquiera si ya no hay— y una sola vez por
   * pedido: si el modelo insiste en cerrar sin atenderlo, se queda quieto en
   * vez de rearrancar en bucle contra la API.
   */
  const revividoPor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (pausadoAMano.current || agenteRef.current?.corriendo) return;
    const activo = pendienteActivo(instrucciones);
    if (!activo || revividoPor.current === activo.id) return;

    const conductor = derivarConductor(estado, Date.now());
    if (conductor && conductor !== yo) return;

    revividoPor.current = activo.id;
    arrancarAgente();
  }, [instrucciones, estado, yo, arrancarAgente]);

  const empezar = useCallback(
    (tarea: string) => {
      const texto = tarea.trim();
      if (!texto || !transporteRef.current) return;
      void transporteRef.current.publicar({ tipo: "tarea", tarea: { texto } });
      arrancarAgente();
    },
    [arrancarAgente],
  );

  const pausar = useCallback(() => {
    pausadoAMano.current = true;
    agenteRef.current?.detener();
    agenteRef.current = null;
    setConduzco(false);
    setPensando(false);
  }, []);

  const enviar = useCallback(
    (texto: string) => {
      const t = texto.trim();
      if (!t) return;
      void transporteRef.current?.publicar({
        tipo: "mensaje",
        // `autor` viaja con el mensaje para que la transcripción siga legible
        // cuando quien lo escribió ya no esté conectado. Ver `Mensaje.autor`.
        mensaje: { id: nuevoId(), texto: t, autor: identidad.nombre },
      });
      // Si el agente se había dado por terminado (`turno.fin`), un pedido
      // nuevo lo tiene que revivir solo — si no, queda pendiente para
      // siempre esperando que alguien note el botón "Retomar" y lo apriete.
      // `arrancarAgente` ya es un no-op si sigue corriendo o si lo conduce
      // otra pestaña.
      arrancarAgente();
    },
    [identidad.nombre, arrancarAgente],
  );

  const votar = useCallback((votacionId: string, opcionId: string) => {
    void transporteRef.current?.publicar({ tipo: "voto", voto: { votacionId, opcionId } });
  }, []);

  const ponerAVotacion = useCallback(
    (motivo: string, opciones: { id: string; texto: string; propuestaPor?: string }[]) => {
      void transporteRef.current?.publicar({
        tipo: "votacion",
        votacion: { id: nuevoId(), motivo, opciones, cierraEn: Date.now() + VENTANA_VOTACION_MS },
      });
    },
    [],
  );

  const retirarPeticion = useCallback((instruccionId: string) => {
    void transporteRef.current?.publicar({ tipo: "retiro", retiro: { instruccionId } });
  }, []);

  const avisarEscribiendo = useCallback(() => {
    transporteRef.current?.escribiendo();
  }, []);

  return {
    tarea: estado.tarea,
    mensajes: estado.mensajes,
    perfil,
    items,
    artefacto,
    instrucciones,
    votacionAbierta,
    conteo,
    votantes,
    decisiones,
    presencia,
    conexion,
    yo,
    transporte: clase,
    tecleando,
    conduzco,
    conductor,
    otroConduce,
    pensando,
    fuente,
    degradado,
    empezar,
    retomar: arrancarAgente,
    pausar,
    enviar,
    votar,
    ponerAVotacion,
    retirarPeticion,
    avisarEscribiendo,
  };
}

/** Cuánta gente hay además de mí. */
export function otros(p: Presencia): number {
  return otrosEn(p);
}
