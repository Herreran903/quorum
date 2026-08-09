"use client";

/** Las piezas visuales de la sala. Sin estado propio: todo entra por props. */

import { useEffect, useRef, useState } from "react";

import type { Artefacto, OpcionVoto, Votacion } from "@/lib/protocolo";
import type { Instruccion, MensajeEnChat, Perfil, VotoEnChat } from "@/lib/useChat";

/** Tonos de los avatares. Elegidos para leerse sobre fondo oscuro. */
const TONOS = [
  "#f0a35e",
  "#6cb6ff",
  "#c58af9",
  "#7ee787",
  "#ff9492",
  "#f2cc60",
  "#79dccb",
  "#fca7ea",
];

function tono(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return TONOS[h % TONOS.length];
}

/** Las iniciales de un nombre real: "Nicolás Herrera" → "NH". */
function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2);
  return partes[0][0] + partes[partes.length - 1][0];
}

export function Avatar({
  perfil,
  tam = 28,
  anillo,
}: {
  perfil: Perfil;
  tam?: number;
  /** halo encendido: está escribiendo */
  anillo?: boolean;
}) {
  const c = tono(perfil.id);
  const borde = `1px solid ${c}55`;
  const halo = anillo ? `0 0 0 3px ${c}33` : undefined;

  if (perfil.avatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- el host lo elige el proveedor de identidad; declarar dominios arbitrarios en next/image no compensa
      <img
        src={perfil.avatar}
        alt={perfil.nombre}
        title={perfil.nombre}
        className="sala-aparece shrink-0 rounded-full object-cover transition-shadow duration-300"
        style={{ width: tam, height: tam, border: borde, boxShadow: halo }}
      />
    );
  }

  return (
    <span
      title={perfil.nombre}
      className="sala-aparece flex shrink-0 items-center justify-center rounded-full font-semibold uppercase transition-shadow duration-300"
      style={{
        width: tam,
        height: tam,
        fontSize: tam * 0.36,
        background: `${c}22`,
        color: c,
        border: borde,
        boxShadow: halo,
      }}
    >
      {iniciales(perfil.nombre)}
    </span>
  );
}

/** El avatar de la máquina. Distinto de todos: no es una persona más. */
export function AvatarAgente({ tam = 28 }: { tam?: number }) {
  return (
    <span
      title="agente"
      className="flex shrink-0 items-center justify-center rounded-full border border-acento/40 bg-acento-hondo text-acento"
      style={{ width: tam, height: tam }}
    >
      <svg width={tam * 0.5} height={tam * 0.5} viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 0l1.8 4.6L14.4 6.4 9.8 8.2 8 12.8 6.2 8.2 1.6 6.4 6.2 4.6z" />
        <circle cx="13" cy="12.5" r="1.8" />
      </svg>
    </span>
  );
}

export function BarraPresencia({
  ids,
  tecleando,
  perfil,
}: {
  ids: string[];
  tecleando: string[];
  perfil: (id: string) => Perfil;
}) {
  const teclea = new Set(tecleando);
  return (
    <div className="flex items-center gap-3">
      {ids.length === 0 ? (
        <span className="text-xs text-tinta-baja">Estás solo</span>
      ) : (
        <div className="flex -space-x-1.5">
          {ids.map((id) => (
            <Avatar key={id} perfil={perfil(id)} anillo={teclea.has(id)} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Quién está tecleando, como un turno más del chat: avatar(es) + puntos. */
export function Tecleando({
  ids,
  perfil,
}: {
  ids: string[];
  perfil: (id: string) => Perfil;
}) {
  if (ids.length === 0) return null;
  return (
    <li className="sala-entra flex items-center gap-3 px-5 py-2 text-tinta-baja">
      <div className="flex -space-x-1.5">
        {ids.map((id) => (
          <Avatar key={id} perfil={perfil(id)} tam={24} anillo />
        ))}
      </div>
      <Puntos />
    </li>
  );
}

export function Puntos() {
  return (
    <span className="sala-puntos inline-flex gap-[3px]">
      <span className="h-1 w-1 rounded-full bg-current" />
      <span className="h-1 w-1 rounded-full bg-current" />
      <span className="h-1 w-1 rounded-full bg-current" />
    </span>
  );
}

/** Un turno del chat: el agente o una persona. */
export function Burbuja({
  mensaje,
  instrucciones,
  perfil,
}: {
  mensaje: MensajeEnChat;
  /** para poder nombrar a quién le hizo caso este turno */
  instrucciones: Instruccion[];
  perfil: (id: string) => Perfil;
}) {
  const esAgente = Boolean(mensaje.deAgente);
  const atendidos = (mensaje.atendio ?? [])
    .map((id) => instrucciones.find((i) => i.id === id))
    .filter((i): i is Instruccion => Boolean(i));
  const autores = [...new Set(atendidos.map((i) => perfil(i.emisor).nombre))];
  const quien = esAgente ? undefined : perfil(mensaje.emisor);

  return (
    <li className="sala-entra flex gap-3 px-5 py-3">
      {quien ? <Avatar perfil={quien} /> : <AvatarAgente />}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className={`text-[13px] font-semibold ${esAgente ? "text-acento" : "text-tinta"}`}
          >
            {quien ? quien.nombre : "Agente"}
          </span>
          {mensaje.actividad && (
            <span className="truncate text-[11px] text-tinta-baja">{mensaje.actividad}</span>
          )}
        </div>

        <p
          className={`mt-0.5 whitespace-pre-wrap text-[14px] leading-relaxed ${
            esAgente ? "text-tinta-media" : "text-tinta"
          }`}
        >
          {mensaje.texto}
        </p>

        {/* La prueba de que el chat cambia lo que hace la máquina. */}
        {autores.length > 0 && (
          <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-acento-hondo px-2 py-1 text-[11px] text-acento">
            <Tilde />
            aplicó lo que pidió {autores.join(" y ")}
          </p>
        )}
      </div>
    </li>
  );
}

function Tilde() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4">
      <path d="M3 8.5l3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Una votación ya resuelta, como parte de la transcripción. */
export function Decision({
  votacion,
  ganadora,
  conteo,
}: {
  votacion: Votacion;
  ganadora: OpcionVoto;
  conteo: Record<string, number>;
}) {
  const total = Object.values(conteo).reduce((s, n) => s + n, 0);
  return (
    <li className="sala-entra px-5 py-3">
      <div className="rounded-lg border border-linea bg-panel px-4 py-3">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-voto">
          <Balanza />
          El equipo decidió
        </p>
        <p className="mt-1.5 text-[13px] text-tinta">{ganadora.texto}</p>
        <p className="mt-1 text-[11px] text-tinta-baja">
          {votacion.motivo} ·{" "}
          {total === 0
            ? "nadie votó, siguió el primer pedido"
            : `${conteo[ganadora.id] ?? 0} de ${total} ${total === 1 ? "voto" : "votos"}`}
        </p>
      </div>
    </li>
  );
}

function Balanza() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M8 2v12M3 5h10M4.5 5L2.5 9.5h4zM11.5 5L9.5 9.5h4z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * El consolidado: qué pidió cada quien y si el agente ya lo tomó.
 *
 * Agrupado por persona a propósito — la pregunta que contesta es "¿qué aportó
 * cada uno?", no "¿qué pasó?". Eso último ya lo cuenta el chat.
 */
export function Consolidado({
  instrucciones,
  perfil,
  yo,
  onEliminar,
}: {
  instrucciones: Instruccion[];
  perfil: (id: string) => Perfil;
  /** para saber cuáles pedidos son míos: solo esos se pueden eliminar */
  yo: string | undefined;
  onEliminar: (instruccionId: string) => void;
}) {
  const porPersona = new Map<string, Instruccion[]>();
  for (const i of instrucciones) {
    porPersona.set(i.emisor, [...(porPersona.get(i.emisor) ?? []), i]);
  }
  const gente = [...porPersona.entries()];

  return (
    <section className="flex min-h-0 flex-col">
      <Rotulo>
        Lo que pidió el equipo
        {instrucciones.length > 0 && (
          <span className="ml-auto font-normal text-tinta-baja">
            {/* lo descartado por votación no cuenta: ya no está en juego */}
            {instrucciones.filter((i) => i.aplicada).length}/
            {instrucciones.filter((i) => !i.descartada).length} aplicado
          </span>
        )}
      </Rotulo>

      {gente.length === 0 ? (
        <p className="px-4 pb-4 text-[13px] text-tinta-baja">
          Todavía nadie le pidió nada. Escribile abajo y aparece acá.
        </p>
      ) : (
        <ul className="min-h-0 overflow-y-auto px-4 pb-4">
          {gente.map(([emisor, suyas]) => (
            <li key={emisor} className="mb-3 last:mb-0">
              <div className="mb-1.5 flex items-center gap-2">
                <Avatar perfil={perfil(emisor)} tam={20} />
                <span className="text-[13px] font-medium text-tinta">
                  {perfil(emisor).nombre}
                </span>
                <span className="text-[11px] text-tinta-baja">
                  {suyas.length} {suyas.length === 1 ? "pedido" : "pedidos"}
                </span>
              </div>
              <ul className="ml-2.5 border-l border-linea pl-3">
                {suyas.map((i) => (
                  <li
                    key={i.id}
                    title={i.descartada ? "El equipo eligió la otra opción" : undefined}
                    className={`flex gap-2 rounded py-1 text-[13px] leading-snug ${
                      i.descartada
                        ? "text-tinta-baja line-through decoration-tinta-baja/50"
                        : i.aplicada
                          ? "sala-aplicada text-tinta-media"
                          : "text-tinta"
                    }`}
                  >
                    <span
                      className={
                        i.descartada ? "text-voto" : i.aplicada ? "text-acento" : "text-tinta-baja"
                      }
                    >
                      {i.descartada ? <IconoDescartada /> : i.aplicada ? <Tilde /> : <Reloj />}
                    </span>
                    <span className="min-w-0 flex-1">{i.texto}</span>
                    {/* lo que perdió la votación ya no es de nadie: no se retira */}
                    {!i.aplicada && !i.descartada && i.emisor === yo && (
                      <button
                        onClick={() => onEliminar(i.id)}
                        title="Eliminar este pedido"
                        className="shrink-0 text-voto transition-opacity hover:opacity-70"
                      >
                        <IconoEliminar />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Reloj() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 4.6V8l2.4 1.6" strokeLinecap="round" />
    </svg>
  );
}

/** Lo que perdió una votación: descartado por el equipo, no por su autor. */
function IconoDescartada() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="8" cy="8" r="6.2" />
      <path d="M5.4 5.4l5.2 5.2" strokeLinecap="round" />
    </svg>
  );
}

function IconoEliminar() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" strokeLinecap="round" />
    </svg>
  );
}

export function Rotulo({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 px-4 pb-2 pt-4 text-[11px] font-semibold uppercase tracking-wider text-tinta-baja">
      {children}
    </h2>
  );
}

/** El entregable: un archivo de código o un documento. */
export function PanelArtefacto({ artefacto }: { artefacto: Artefacto | undefined }) {
  if (!artefacto) {
    return (
      <section className="flex min-h-0 flex-1 flex-col border-t border-linea">
        <Rotulo>Resultado</Rotulo>
        <div className="flex flex-1 items-center justify-center px-6 pb-6">
          <p className="text-center text-[13px] leading-relaxed text-tinta-baja">
            Acá va a aparecer lo que el agente construya —<br />
            el código o el documento — y se actualiza solo.
          </p>
        </div>
      </section>
    );
  }

  const esCodigo = artefacto.tipo === "codigo";
  return (
    <section className="flex min-h-0 flex-1 flex-col border-t border-linea">
      <Rotulo>
        Resultado
        <span className="ml-auto font-normal normal-case tracking-normal text-tinta-baja">
          v{artefacto.version}
        </span>
      </Rotulo>

      <div className="mx-4 mb-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-linea bg-noche">
        <div className="flex items-center gap-2 border-b border-linea bg-panel-alto px-3 py-2">
          {esCodigo ? <IconoCodigo /> : <IconoDoc />}
          <span className="truncate text-[12px] text-tinta-media" style={{ fontFamily: esCodigo ? "var(--font-codigo)" : undefined }}>
            {artefacto.titulo}
          </span>
          {artefacto.lenguaje && (
            <span className="ml-auto rounded bg-panel px-1.5 py-0.5 text-[10px] uppercase text-tinta-baja">
              {artefacto.lenguaje}
            </span>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-3">
          {esCodigo ? (
            <Codigo texto={artefacto.contenido} />
          ) : (
            <Documento texto={artefacto.contenido} />
          )}
        </div>
      </div>
    </section>
  );
}

function IconoCodigo() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" className="shrink-0 text-acento">
      <path d="M5.5 4L2 8l3.5 4M10.5 4L14 8l-3.5 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconoDoc() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" className="shrink-0 text-acento">
      <path d="M4 2h5l3 3v9H4z" strokeLinejoin="round" />
      <path d="M6 8h4M6 10.5h4" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Código con un resaltado deliberadamente mínimo: comentarios, cadenas y
 * números. Es lo que se puede acertar sin un parser de verdad — un
 * resaltador a medias, que pinta mal las palabras clave, se ve peor que
 * ninguno.
 */
function Codigo({ texto }: { texto: string }) {
  const lineas = texto.split("\n");
  return (
    <pre
      className="text-[12px] leading-[1.6] text-tinta-media"
      style={{ fontFamily: "var(--font-codigo)" }}
    >
      {lineas.map((l, i) => (
        <div key={i} className="flex">
          <span className="mr-3 w-7 shrink-0 select-none text-right text-tinta-baja/50">
            {i + 1}
          </span>
          <code className="min-w-0 whitespace-pre-wrap break-words">{resaltar(l)}</code>
        </div>
      ))}
    </pre>
  );
}

function resaltar(linea: string): React.ReactNode {
  const limpia = linea.trim();
  if (limpia.startsWith("//") || limpia.startsWith("#") || limpia.startsWith("*")) {
    return <span className="text-tinta-baja/70">{linea}</span>;
  }
  // Cadenas y números; todo lo demás queda en el color base.
  const partes = linea.split(/("[^"]*"|'[^']*'|`[^`]*`|\b\d+(?:\.\d+)?\b)/g);
  return partes.map((p, i) => {
    if (i % 2 === 0) return p;
    const esNumero = /^\d/.test(p);
    return (
      <span key={i} className={esNumero ? "text-[#f0a35e]" : "text-[#7ee787]"}>
        {p}
      </span>
    );
  });
}

/** Documento en texto plano con `## ` para subtítulos y `- ` para viñetas. */
function Documento({ texto }: { texto: string }) {
  const lineas = texto.split("\n");
  return (
    <div className="text-[13px] leading-relaxed text-tinta-media">
      {lineas.map((l, i) => {
        const t = l.trim();
        if (!t) return <div key={i} className="h-2" />;
        if (t.startsWith("## ")) {
          return (
            <h3 key={i} className="mb-1 mt-3 text-[13px] font-semibold text-tinta first:mt-0">
              {t.slice(3)}
            </h3>
          );
        }
        if (t.startsWith("# ")) {
          return (
            <h2 key={i} className="mb-1.5 mt-3 text-[15px] font-semibold text-tinta first:mt-0">
              {t.slice(2)}
            </h2>
          );
        }
        if (t.startsWith("- ") || t.startsWith("* ")) {
          return (
            <div key={i} className="flex gap-2 py-0.5">
              <span className="text-acento">·</span>
              <span className="min-w-0 flex-1">{t.slice(2)}</span>
            </div>
          );
        }
        return (
          <p key={i} className="py-0.5">
            {t}
          </p>
        );
      })}
    </div>
  );
}

/**
 * La votación, encima de todo.
 *
 * Se toma la pantalla a propósito: es el único momento en que la sala tiene
 * que decidir junta, y dejarla como un panel más la volvería ignorable.
 */
export function ModalVotacion({
  votacion,
  conteo,
  votantes,
  yo,
  perfil,
  onVotar,
}: {
  votacion: Votacion;
  conteo: Record<string, number>;
  votantes: VotoEnChat[];
  yo: string | undefined;
  perfil: (id: string) => Perfil;
  onVotar: (opcionId: string) => void;
}) {
  // El inicializador va como función: leer el reloj en el cuerpo del render
  // no es puro, y el valor se recalcularía distinto en cada re-render.
  const [restante, setRestante] = useState(() => votacion.cierraEn - Date.now());
  useEffect(() => {
    const t = setInterval(() => setRestante(votacion.cierraEn - Date.now()), 200);
    return () => clearInterval(t);
  }, [votacion.cierraEn]);

  const miVoto = votantes.find((v) => v.emisor === yo)?.opcionId;
  const total = Object.values(conteo).reduce((s, n) => s + n, 0) || 1;
  const seg = Math.max(0, Math.ceil(restante / 1000));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-noche/80 p-4 backdrop-blur-sm">
      <div className="sala-aparece w-full max-w-lg overflow-hidden rounded-xl border border-voto/40 bg-panel shadow-2xl">
        <div className="flex items-center gap-2 border-b border-linea bg-voto-hondo px-5 py-3">
          <span className="sala-pulso h-2 w-2 rounded-full bg-voto" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-voto">
            Hay que decidir
          </span>
          <span className="ml-auto font-mono text-[12px] text-voto">{seg}s</span>
        </div>

        <div className="px-5 py-4">
          <p className="text-[14px] text-tinta">{votacion.motivo}</p>

          <div className="mt-4 space-y-2">
            {votacion.opciones.map((o) => {
              const n = conteo[o.id] ?? 0;
              const elegida = miVoto === o.id;
              const quienes = votantes.filter((v) => v.opcionId === o.id);
              return (
                <button
                  key={o.id}
                  onClick={() => onVotar(o.id)}
                  className={`relative w-full overflow-hidden rounded-lg border px-4 py-3 text-left transition-colors ${
                    elegida
                      ? "border-voto bg-voto-hondo"
                      : "border-linea bg-panel-alto hover:border-linea-viva"
                  }`}
                >
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 bg-voto/10 transition-all duration-500"
                    style={{ width: `${(n / total) * 100}%` }}
                  />
                  <span className="relative flex items-start gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] leading-snug text-tinta">{o.texto}</span>
                      {o.propuestaPor && (
                        <span className="mt-1 block text-[11px] text-tinta-baja">
                          lo pidió {perfil(o.propuestaPor).nombre}
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {quienes.map((v) => (
                        <Avatar key={v.emisor} perfil={perfil(v.emisor)} tam={20} />
                      ))}
                      <span className="ml-1 text-[13px] font-semibold text-tinta">{n}</span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <p className="mt-3 text-[11px] text-tinta-baja">
            Gana la mayoría. El agente no avanza hasta que se resuelva.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Baja solo si ya estabas al final: no arrastra a quien está leyendo arriba. */
export function useAutoScroll(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const pegado = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const alFinal = () => {
      pegado.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener("scroll", alFinal, { passive: true });
    return () => el.removeEventListener("scroll", alFinal);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (el && pegado.current) el.scrollTop = el.scrollHeight;
  }, [dep]);

  return ref;
}
