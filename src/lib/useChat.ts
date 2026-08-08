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
import { AgenteChat, ganadoraDe, nuevoId, type VistaAgente } from "./agente-chat";
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

/** Un voto con quién lo emitió. */
export interface VotoEnChat {
  votacionId: string;
  opcionId: string;
  emisor: string;
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
}

export const VACIO: EstadoChat = {
  tarea: undefined,
  tareaPor: undefined,
  tareaAt: 0,
  mensajes: [],
  trozos: new Map(),
  votaciones: [],
  votos: [],
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
      const nuevo: VotoEnChat = { ...c.voto, emisor: sobre.emisor };
      if (i >= 0) votos[i] = nuevo;
      else votos.push(nuevo);
      return { ...estado, votos };
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

function derivarInstrucciones(estado: EstadoChat): Instruccion[] {
  const atendidos = new Set<string>();
  for (const m of estado.mensajes) {
    if (!m.deAgente) continue;
    for (const id of m.atendio ?? []) atendidos.add(id);
  }
  return estado.mensajes
    .filter((m) => !m.deAgente)
    .map((m) => ({
      id: m.id,
      emisor: m.emisor,
      texto: m.texto,
      at: m.at,
      aplicada: atendidos.has(m.id),
    }));
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
function derivarResueltas(estado: EstadoChat, ahora: number): Resuelta[] {
  return estado.votaciones
    .filter((v) => ahora >= v.cierraEn)
    .map((v) => {
      const conteo = contar(estado, v);
      return { votacion: v, ganadora: ganadoraDe(v, conteo), conteo };
    });
}

function textoDecision(r: Resuelta): string {
  return `Sobre "${r.votacion.motivo}", el equipo eligió: ${r.ganadora.texto}`;
}

/** Lo que el agente necesita saber, en el instante en que lo pregunta. */
function derivarVista(
  estado: EstadoChat,
  presencia: Presencia,
  ahora: number,
  yo: string | undefined,
): VistaAgente {
  const perfil = derivarPerfil(estado, presencia);
  const instrucciones = derivarInstrucciones(estado);
  const votacionAbierta = estado.votaciones.find((v) => ahora < v.cierraEn);
  const conductor = derivarConductor(estado, ahora);

  // El modelo ve los nombres reales: así puede decir "le agrego lo que pidió
  // Nicolás" en vez de referirse a un id.
  const conversacion: Intervencion[] = estado.mensajes.map((m) => ({
    id: m.id,
    autor: m.deAgente ? "agente" : perfil(m.emisor).nombre,
    texto: m.texto,
    deAgente: Boolean(m.deAgente),
  }));

  const humanos = estado.mensajes.filter((m) => !m.deAgente);
  const ultimo = humanos.at(-1);
  const anterior = [...humanos].reverse().find((m) => ultimo && m.emisor !== ultimo.emisor);
  const corto = (m: MensajeEnChat) => ({
    id: m.id,
    autor: perfil(m.emisor).nombre,
    emisor: m.emisor,
    texto: m.texto,
    at: m.at,
  });

  return {
    tarea: estado.tarea ?? "",
    conversacion,
    pendientes: instrucciones.filter((i) => !i.aplicada).map((i) => i.id),
    decisiones: derivarResueltas(estado, ahora).map(textoDecision),
    artefacto: armarArtefacto(estado.trozos),
    votacionAbierta,
    conteo: votacionAbierta ? contar(estado, votacionAbierta) : {},
    // Se recalcula contra el reloj al leer, no cuando llegó el evento: ver
    // `alguienEscribe` en transporte.ts.
    escribiendo: alguienEscribe(presencia),
    debeCeder: Boolean(conductor && yo && conductor !== yo),
    ultimoPar: ultimo && anterior ? { a: corto(anterior), b: corto(ultimo) } : undefined,
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
  ponerAVotacion: (motivo: string, opciones: { id: string; texto: string; propuestaPor?: string }[]) => void;
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

  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // ------------------------------------------------------------- derivados

  const artefacto = useMemo(() => armarArtefacto(estado.trozos), [estado.trozos]);

  const perfil = useMemo(() => derivarPerfil(estado, presencia), [estado, presencia]);

  const instrucciones = useMemo(() => derivarInstrucciones(estado), [estado]);

  const votacionAbierta = useMemo(
    () => estado.votaciones.find((v) => ahora < v.cierraEn),
    [estado.votaciones, ahora],
  );

  const conteo = useMemo(
    () => (votacionAbierta ? contar(estado, votacionAbierta) : {}),
    [estado, votacionAbierta],
  );

  const votantes = useMemo(
    () => (votacionAbierta ? estado.votos.filter((v) => v.votacionId === votacionAbierta.id) : []),
    [votacionAbierta, estado.votos],
  );

  const resueltas = useMemo(() => derivarResueltas(estado, ahora), [estado, ahora]);

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

  const tecleando = useMemo(
    () => presencia.espectadores.filter((e) => !e.soyYo && e.escribiendo).map((e) => e.id),
    [presencia],
  );

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
    };
    // Al cambiar la identidad hay que reconectar: el token viejo ya no es
    // quien sos, y una sesión con identidad rancia no puede quedar viva.
  }, [idSala, identidad]);

  // ------------------------------------------------------------- acciones

  const yoRef = useRef(yo);
  useEffect(() => {
    yoRef.current = yo;
  }, [yo]);

  const arrancarAgente = useCallback((forzar = false) => {
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
      derivarVista(estadoRef.current, presenciaRef.current, Date.now(), yoRef.current);
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
    },
    [identidad.nombre],
  );

  const votar = useCallback((votacionId: string, opcionId: string) => {
    void transporteRef.current?.publicar({ tipo: "voto", voto: { votacionId, opcionId } });
  }, []);

  const ponerAVotacion = useCallback(
    (motivo: string, opciones: { id: string; texto: string; propuestaPor?: string }[]) => {
      void transporteRef.current?.publicar({
        tipo: "votacion",
        votacion: { id: nuevoId(), motivo, opciones, cierraEn: Date.now() + 20_000 },
      });
    },
    [],
  );

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
    avisarEscribiendo,
  };
}

/** Cuánta gente hay además de mí. */
export function otros(p: Presencia): number {
  return otrosEn(p);
}
