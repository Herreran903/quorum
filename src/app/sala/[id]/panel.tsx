"use client";

import { useState } from "react";

import { useChat } from "@/lib/useChat";
import {
  BarraPresencia,
  Burbuja,
  Consolidado,
  Decision,
  ModalVotacion,
  PanelArtefacto,
  Puntos,
  Tecleando,
  useAutoScroll,
} from "@/components/sala/piezas";
import { ControlSesion, Puerta } from "@/components/sala/sesion";

export function Panel({ idSala }: { idSala: string }) {
  return (
    <Puerta>
      <Sala idSala={idSala} />
    </Puerta>
  );
}

function Sala({ idSala }: { idSala: string }) {
  const s = useChat(idSala);
  const scroll = useAutoScroll(s.items.length + (s.pensando ? 1 : 0) + s.tecleando.length);

  // `bloqueado` es terminal: Portal rechazó la conexión y no va a reintentar.
  // Merece una pantalla propia — si no, la sala se queda en blanco sin decir
  // por qué, que es justo lo que pasa cuando la config de auth del canal y la
  // del cliente no coinciden.
  if (s.conexion === "bloqueado") {
    return <Bloqueada />;
  }

  if (!s.tarea) {
    return <Arranque onEmpezar={s.empezar} conexion={s.conexion} />;
  }

  const otros = s.presencia.espectadores.filter((e) => !e.soyYo).map((e) => e.id);

  return (
    // En ancho de escritorio la pantalla no scrollea y cada columna maneja lo
    // suyo; más angosto, se apila y scrollea la página — antes el panel
    // derecho simplemente desaparecía y con él el resultado.
    <main className="sala-raiz flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      {/* -------------------------------------------------------- cabecera */}
      <header className="flex shrink-0 items-center gap-4 border-b border-linea px-5 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="sala-pulso h-1.5 w-1.5 shrink-0 rounded-full bg-ok" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-tinta-baja">
              Sesión en vivo
            </span>
          </div>
          <h1 className="mt-0.5 truncate text-[15px] font-medium text-tinta">{s.tarea}</h1>
        </div>

        <BarraPresencia ids={otros} tecleando={s.tecleando} perfil={s.perfil} />

        <Mando
          conduzco={s.conduzco}
          otroConduce={s.otroConduce}
          quien={s.conductor ? s.perfil(s.conductor).nombre : undefined}
          onPausar={s.pausar}
          onRetomar={s.retomar}
        />

        <ControlSesion />
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* ----------------------------------------------------- el chat */}
        <section className="flex min-h-[55vh] flex-col border-linea lg:min-h-0 lg:border-r">
          <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto py-2">
            <ul>
              {s.items.map((it) =>
                it.clase === "mensaje" ? (
                  <Burbuja
                    key={it.mensaje.id}
                    mensaje={it.mensaje}
                    instrucciones={s.instrucciones}
                    perfil={s.perfil}
                  />
                ) : (
                  <Decision
                    key={`d${it.votacion.id}`}
                    votacion={it.votacion}
                    ganadora={it.ganadora}
                    conteo={it.conteo}
                  />
                ),
              )}
              <Tecleando ids={s.tecleando} perfil={s.perfil} />
            </ul>

            {s.pensando && (
              <p className="flex items-center gap-2 px-5 py-3 text-[13px] text-tinta-baja">
                El agente está trabajando <Puntos />
              </p>
            )}

            {!s.conduzco && !s.pensando && s.mensajes.length === 0 && (
              <p className="px-5 py-6 text-[13px] text-tinta-baja">
                La sesión está en pausa. Dale a <b className="text-tinta-media">Retomar</b> para que
                el agente siga.
              </p>
            )}
          </div>

          <Compositor
            onEnviar={s.enviar}
            onEscribiendo={s.avisarEscribiendo}
            puedeVotar={sePuedeVotar(s.instrucciones)}
            onVotar={() => escalar(s)}
          />
        </section>

        {/* -------------------------------- consolidado + lo que construye */}
        <aside className="flex min-h-0 flex-col border-t border-linea bg-panel lg:border-t-0">
          <Consolidado instrucciones={s.instrucciones} perfil={s.perfil} />
          <PanelArtefacto artefacto={s.artefacto} />
        </aside>
      </div>

      {s.votacionAbierta && (
        <ModalVotacion
          votacion={s.votacionAbierta}
          conteo={s.conteo}
          votantes={s.votantes}
          yo={s.yo}
          perfil={s.perfil}
          onVotar={(opcionId) => s.votar(s.votacionAbierta!.id, opcionId)}
        />
      )}

      {s.degradado && (
        <p className="shrink-0 border-t border-linea px-5 py-1.5 text-center text-[11px] text-tinta-baja">
          El modelo no respondió — la sesión sigue en modo de respaldo.
        </p>
      )}
    </main>
  );
}

/** Hacen falta dos pedidos de personas distintas para que haya algo que dirimir. */
function sePuedeVotar(instrucciones: { emisor: string }[]): boolean {
  return new Set(instrucciones.map((i) => i.emisor)).size >= 2;
}

/** Pone a votación los dos últimos pedidos de personas distintas. */
function escalar(s: ReturnType<typeof useChat>): void {
  const ultimo = s.instrucciones.at(-1);
  if (!ultimo) return;
  const otro = [...s.instrucciones].reverse().find((i) => i.emisor !== ultimo.emisor);
  if (!otro) return;
  const a = s.perfil(otro.emisor).nombre;
  const b = s.perfil(ultimo.emisor).nombre;
  s.ponerAVotacion(`${a} y ${b} pidieron cosas distintas`, [
    { id: otro.id, texto: otro.texto, propuestaPor: otro.emisor },
    { id: ultimo.id, texto: ultimo.texto, propuestaPor: ultimo.emisor },
  ]);
}

function Compositor({
  onEnviar,
  onEscribiendo,
  puedeVotar,
  onVotar,
}: {
  onEnviar: (texto: string) => void;
  onEscribiendo: () => void;
  puedeVotar: boolean;
  onVotar: () => void;
}) {
  const [valor, setValor] = useState("");
  const enviar = () => {
    const t = valor.trim();
    if (!t) return;
    onEnviar(t);
    setValor("");
  };

  return (
    <div className="shrink-0 border-t border-linea px-5 py-3">
      <div className="flex items-center gap-2">
        <input
          value={valor}
          onChange={(e) => {
            setValor(e.target.value);
            onEscribiendo();
          }}
          onKeyDown={(e) => e.key === "Enter" && enviar()}
          placeholder="Escribile al agente para corregirlo o pedirle algo…"
          className="min-w-0 flex-1 rounded-lg border border-linea bg-panel-alto px-3.5 py-2.5 text-[14px] text-tinta placeholder:text-tinta-baja focus:border-linea-viva focus:outline-none"
        />
        <button
          onClick={onVotar}
          disabled={!puedeVotar}
          title={
            puedeVotar
              ? "Poner los dos últimos pedidos a votación"
              : "Hacen falta pedidos de dos personas distintas"
          }
          className="shrink-0 rounded-lg border border-linea px-3 py-2.5 text-[12px] text-tinta-media transition-colors hover:border-voto/50 hover:text-voto disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-linea disabled:hover:text-tinta-media"
        >
          Votar
        </button>
        <button
          onClick={enviar}
          disabled={!valor.trim()}
          className="shrink-0 rounded-lg bg-acento px-4 py-2.5 text-[13px] font-semibold text-noche transition-opacity hover:opacity-90 disabled:opacity-30"
        >
          Enviar
        </button>
      </div>
    </div>
  );
}

/**
 * Quién maneja al agente.
 *
 * Tres estados y no dos: además de conducir o no, está el caso de que lo
 * conduzca otro. Ahí el botón no puede decir "Retomar" como si nada — el
 * puesto es de uno solo, y arrebatarlo tiene que ser una decisión.
 */
function Mando({
  conduzco,
  otroConduce,
  quien,
  onPausar,
  onRetomar,
}: {
  conduzco: boolean;
  otroConduce: boolean;
  quien: string | undefined;
  onPausar: () => void;
  onRetomar: (forzar?: boolean) => void;
}) {
  const base =
    "shrink-0 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors";

  if (conduzco) {
    return (
      <button
        onClick={onPausar}
        className={`${base} border-linea bg-panel-alto text-tinta hover:border-linea-viva`}
      >
        Pausar
      </button>
    );
  }

  if (otroConduce) {
    return (
      <div className="flex shrink-0 items-center gap-2">
        <span className="hidden text-[11px] text-tinta-baja sm:inline">
          lo conduce {quien}
        </span>
        <button
          onClick={() => onRetomar(true)}
          title="El agente pasa a correr en esta pestaña; la otra se detiene sola."
          className={`${base} border-linea text-tinta-media hover:border-acento/50 hover:text-acento`}
        >
          Tomar el control
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => onRetomar()}
      className={`${base} border-linea bg-panel-alto text-tinta hover:border-linea-viva`}
    >
      Retomar
    </button>
  );
}

function Bloqueada() {
  return (
    <main className="sala-raiz flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <h1 className="text-[18px] font-semibold text-tinta">
          Portal rechazó la conexión
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-tinta-media">
          Suele ser que la configuración del canal no coincide con la del cliente. Si acabás de
          activar el inicio de sesión, falta desplegar la config de Portal:
        </p>
        <code className="mt-3 block rounded-lg border border-linea bg-panel px-3 py-2 text-left text-[12px] text-acento">
          npx portal deploy
        </code>
      </div>
    </main>
  );
}

function Arranque({
  onEmpezar,
  conexion,
}: {
  onEmpezar: (tarea: string) => void;
  conexion: string;
}) {
  const [texto, setTexto] = useState("");
  const listo = conexion === "listo";

  return (
    <main className="sala-raiz flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-lg">
        <h1 className="text-[22px] font-semibold tracking-tight text-tinta">
          ¿Qué querés que haga el agente?
        </h1>
        <p className="mt-1.5 text-[14px] leading-relaxed text-tinta-media">
          Va a trabajar en un chat que todo el equipo ve. Cualquiera puede escribirle para
          corregirlo, y si hay desacuerdo se vota.
        </p>

        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={3}
          autoFocus
          placeholder="Escribí un componente de carrito en React con manejo de stock…"
          className="mt-5 w-full resize-none rounded-xl border border-linea bg-panel p-4 text-[14px] leading-relaxed text-tinta placeholder:text-tinta-baja focus:border-linea-viva focus:outline-none"
        />

        <button
          onClick={() => texto.trim() && onEmpezar(texto.trim())}
          disabled={!texto.trim() || !listo}
          className="mt-3 w-full rounded-xl bg-acento px-4 py-3 text-[14px] font-semibold text-noche transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
        >
          {listo ? "Empezar" : "Conectando…"}
        </button>

        <p className="mt-3 text-center text-[12px] text-tinta-baja">
          Compartí el link de esta página para que se sumen.
        </p>
      </div>
    </main>
  );
}
