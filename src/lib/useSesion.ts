"use client";

/**
 * Une transporte + estado de la sala para la UI.
 *
 * Todo lo que entra por el canal se reduce aquí a una vista plana. El hook no
 * sabe si detrás hay BroadcastChannel o Portal.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  Interrupcion,
  Paso,
  Pregunta,
  Respuesta,
  Restriccion,
  Sobre,
  Volante,
} from "./protocolo";
import { canalDeSesion } from "./protocolo";
import type { Sala } from "./iniciativa";
import { AgenteSimulado } from "./simulador";
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

export interface EstadoSesion {
  pasos: Paso[];
  preguntas: Pregunta[];
  respuestas: Respuesta[];
  interrupciones: Interrupcion[];
  restricciones: Restriccion[];
  volantes: Volante[];
}

const VACIO: EstadoSesion = {
  pasos: [],
  preguntas: [],
  respuestas: [],
  interrupciones: [],
  restricciones: [],
  volantes: [],
};

function reducir(estado: EstadoSesion, sobre: Sobre): EstadoSesion {
  const c = sobre.cuerpo;
  switch (c.tipo) {
    case "paso": {
      // El último estado de un paso gana; los pasos se identifican por `n`.
      const i = estado.pasos.findIndex((p) => p.n === c.paso.n);
      const pasos = [...estado.pasos];
      if (i >= 0) pasos[i] = c.paso;
      else pasos.push(c.paso);
      return { ...estado, pasos };
    }
    case "pregunta":
      if (estado.preguntas.some((p) => p.id === c.pregunta.id)) return estado;
      return { ...estado, preguntas: [...estado.preguntas, c.pregunta] };
    case "respuesta":
      return { ...estado, respuestas: [...estado.respuestas, c.respuesta] };
    case "interrupcion":
      return { ...estado, interrupciones: [...estado.interrupciones, c.interrupcion] };
    case "restriccion":
      if (estado.restricciones.some((r) => r.id === c.restriccion.id)) return estado;
      return { ...estado, restricciones: [...estado.restricciones, c.restriccion] };
    case "volante":
      if (estado.volantes.some((v) => v.id === c.volante.id)) return estado;
      return { ...estado, volantes: [...estado.volantes, c.volante] };
    case "atencion":
      // La atención se lee de la presencia, no del historial.
      return estado;
  }
}

export interface UseSesion {
  estado: EstadoSesion;
  presencia: Presencia;
  conexion: EstadoConexion;
  /** cómo ve la política a esta sala, ahora mismo */
  sala: Sala;
  yo: string | undefined;
  transporte: ClaseTransporte;
  agenteCorriendo: boolean;
  /** la pregunta que tiene frenado al agente en ESTA pestaña, si la hay */
  preguntaAbierta: Pregunta | undefined;
  ultimaDecision: string | undefined;
  /** el modelo que produjo el plan, o "guion" si se cayó */
  fuente: string | undefined;
  /** mensaje del fallo cuando se degradó al guion */
  degradado: string | undefined;
  /** true mientras el modelo arma el plan */
  planeando: boolean;
  /** Testigo: cerré los ojos, sigo conectado pero no cuento como testigo */
  ojosCerrados: boolean;
  cerrarOjos: (cerrados: boolean) => void;
  /** lo que el agente hizo mientras no mirabas; undefined si no hay nada */
  confesion:
    | {
        pasos: Paso[];
        aSolas: number;
        arriesgados: number;
        volantes: Volante[];
      }
    | undefined;
  descartarConfesion: () => void;

  arrancarAgente: () => void;
  pararAgente: () => void;
  responder: (preguntaId: string, texto: string) => void;
  interrumpir: (motivo: string) => void;
  fijarRestriccion: (texto: string) => void;
  avisarEscribiendo: () => void;
  mirar: (n: number | undefined) => void;
}

export function useSesion(idSesion: string): UseSesion {
  const [estado, setEstado] = useState<EstadoSesion>(VACIO);
  const [presencia, setPresencia] = useState<Presencia>(PRESENCIA_VACIA);
  const [conexion, setConexion] = useState<EstadoConexion>("conectando");
  const [yo, setYo] = useState<string | undefined>(undefined);
  const [agenteCorriendo, setAgenteCorriendo] = useState(false);
  const [ultimaDecision, setUltimaDecision] = useState<string | undefined>();
  /** qué modelo produjo el plan actual; se muestra para que no parezca guion */
  const [fuente, setFuente] = useState<string | undefined>();
  /** mensaje del fallo si el modelo se cayó y respondió el guion */
  const [degradado, setDegradado] = useState<string | undefined>();
  const [planeando, setPlaneando] = useState(false);
  /** qué transporte quedó activo; se resuelve al montar, ya en el navegador */
  const [clase, setClase] = useState<ClaseTransporte>("mock");

  const transporteRef = useRef<Transporte | null>(null);
  const agenteRef = useRef<AgenteSimulado | null>(null);
  /**
   * La última presencia cruda, sin pasar por React. El agente deriva la sala
   * de aquí EN EL MOMENTO de decidir, no cuando llegó el evento: así
   * "alguien escribe" caduca contra el reloj aunque la pestaña del otro esté
   * en segundo plano y sus timers estén throttleados.
   */
  const presenciaRef = useRef<Presencia>(PRESENCIA_VACIA);
  const leerSala = useCallback((): Sala => {
    const p = presenciaRef.current;
    return { espectadores: otrosEn(p), escribiendo: alguienEscribe(p) };
  }, []);

  useEffect(() => {
    let vivo = true;
    let creado: Transporte | null = null;

    const forzar = transporteDeLaUrl();

    void (async () => {
      const t = await crearTransporte({ canalId: canalDeSesion(idSesion), forzar });
      // Se resuelve aquí, no en el cuerpo del efecto: la clase solo se conoce
      // en el navegador, y fijarla sincrónicamente encadena renders.
      setClase(transporteActivo(forzar));
      if (!vivo) {
        t.desconectar();
        return;
      }
      creado = t;
      transporteRef.current = t;

      t.suscribir((sobre) => setEstado((prev) => reducir(prev, sobre)));

      t.presencia((p) => {
        // El agente no se cuenta a sí mismo como espectador: la pestaña que
        // lo corre sigue siendo una persona mirando, pero el "espectadores"
        // de la política significa "gente distinta del agente".
        presenciaRef.current = p;
        setPresencia(p);
        setYo(t.yo);
        void agenteRef.current?.alCambiarLaSala();
      });

      t.conexion(setConexion);
      setYo(t.yo);
    })();

    return () => {
      vivo = false;
      agenteRef.current?.parar();
      agenteRef.current = null;
      creado?.desconectar();
      transporteRef.current = null;
    };
  }, [idSesion]);

  // La pregunta abierta no es estado propio: se deriva del canal. Es la
  // última pregunta que todavía no tiene respuesta.
  const preguntaAbierta = useMemo(() => {
    const respondidas = new Set(estado.respuestas.map((r) => r.preguntaId));
    return [...estado.preguntas].reverse().find((p) => !respondidas.has(p.id));
  }, [estado.preguntas, estado.respuestas]);

  const arrancarAgente = useCallback(() => {
    const t = transporteRef.current;
    if (!t || agenteRef.current) return;
    const agente = new AgenteSimulado(t, leerSala, {
      onDecision: ({ paso, decision, pendientes, fuente, degradado }) => {
        setUltimaDecision(
          `paso ${paso.n} → ${decision}` +
            (pendientes > 0 ? ` · ${pendientes} en cola` : ""),
        );
        if (fuente !== "reintento") setFuente(fuente);
        setDegradado(degradado);
      },
      onPlaneando: setPlaneando,
      onFin: () => setAgenteCorriendo(false),
    });
    agenteRef.current = agente;
    agente.arrancar();
    setAgenteCorriendo(true);
  }, [leerSala]);

  const pararAgente = useCallback(() => {
    agenteRef.current?.parar();
    setAgenteCorriendo(false);
  }, []);

  const responder = useCallback((preguntaId: string, texto: string) => {
    void transporteRef.current?.publicar({
      tipo: "respuesta",
      respuesta: { preguntaId, texto },
    });
    void agenteRef.current?.responder(preguntaId);
  }, []);

  const interrumpir = useCallback((motivo: string) => {
    const agente = agenteRef.current;
    if (agente) {
      // Desviar, no matar: el agente sigue corriendo por otra línea.
      void agente.interrumpir(motivo);
      setAgenteCorriendo(true);
      return;
    }
    // Esta pestaña no corre el agente: publica la interrupción igual, para
    // que la vea quien sí lo corre.
    void transporteRef.current?.publicar({ tipo: "interrupcion", interrupcion: { motivo } });
  }, []);

  const fijarRestriccion = useCallback((texto: string) => {
    // La regla viaja al canal para que la vea toda la sala, Y al agente, que
    // se la pasa al modelo en el próximo paso.
    agenteRef.current?.fijarRestriccion(texto);
    void transporteRef.current?.publicar({
      tipo: "restriccion",
      restriccion: { id: Math.random().toString(36).slice(2, 10), texto },
    });
  }, []);

  const avisarEscribiendo = useCallback(() => {
    transporteRef.current?.escribiendo();
  }, []);

  const mirar = useCallback((n: number | undefined) => {
    transporteRef.current?.mirando(n);
  }, []);

  /**
   * Testigo: cerrar los ojos.
   *
   * No desconecta ni pausa nada — sigues viendo todo llegar. Simplemente
   * dejas de contar como testigo, y la política empieza a decidir como si la
   * sala estuviera vacía. Es la forma de ver el comportamiento solitario del
   * agente sin tener que cerrar la pestaña.
   */
  const [ojosCerrados, setOjosCerrados] = useState(false);
  /** el `n` del último paso visto al cerrar los ojos; corta la confesión */
  const marcaRef = useRef(0);
  const [confesionDesde, setConfesionDesde] = useState<number | undefined>();

  // Espejo de los pasos sin pasar por el render, para poder marcar el corte
  // en el instante exacto en que se cierran los ojos.
  const ultimoPasoRef = useRef(0);
  useEffect(() => {
    ultimoPasoRef.current = estado.pasos.reduce((max, p) => Math.max(max, p.n), 0);
  }, [estado.pasos]);

  const cerrarOjos = useCallback((cerrados: boolean) => {
    setOjosCerrados(cerrados);
    transporteRef.current?.atender(!cerrados);
    if (cerrados) {
      marcaRef.current = ultimoPasoRef.current;
      setConfesionDesde(undefined);
      return;
    }
    // Al abrirlos: el agente confiesa, y lo que acumuló a solas sale como
    // UNA sola pregunta.
    setConfesionDesde(marcaRef.current);
    void agenteRef.current?.alCambiarLaSala();
  }, []);

  const descartarConfesion = useCallback(() => setConfesionDesde(undefined), []);

  /** Lo que el agente hizo mientras tenías los ojos cerrados. */
  const confesion = useMemo(() => {
    if (confesionDesde === undefined) return undefined;
    const pasos = estado.pasos.filter((p) => p.n > confesionDesde);
    if (pasos.length === 0) return undefined;
    const nuevos = new Set(pasos.map((p) => p.n));
    return {
      pasos,
      aSolas: pasos.filter((p) => p.sinTestigos).length,
      arriesgados: pasos.filter((p) => p.riesgo === "alto").length,
      volantes: estado.volantes.filter((v) => v.pasos.some((n) => nuevos.has(n))),
    };
  }, [confesionDesde, estado.pasos, estado.volantes]);

  const sala = useMemo<Sala>(
    () => ({ espectadores: otrosEn(presencia), escribiendo: alguienEscribe(presencia) }),
    [presencia],
  );

  return {
    estado,
    presencia,
    conexion,
    sala,
    yo,
    transporte: clase,
    agenteCorriendo,
    preguntaAbierta,
    ultimaDecision,
    fuente,
    degradado,
    planeando,
    ojosCerrados,
    cerrarOjos,
    confesion,
    descartarConfesion,
    arrancarAgente,
    pararAgente,
    responder,
    interrumpir,
    fijarRestriccion,
    avisarEscribiendo,
    mirar,
  };
}
