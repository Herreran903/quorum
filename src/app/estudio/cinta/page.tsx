/**
 * ESTUDIO 1 — CINTA
 *
 * La sesión sale impresa de una máquina. Una tira continua que avanza, con
 * perforación lateral, donde cada actuación queda registrada. Lo que el agente
 * hizo sin testigos sale QUEMADO — el cabezal insistió hasta agujerear.
 * Donde calló, la cinta pasó en blanco.
 *
 * No hay layout de página: hay un rollo. La composición es una sola columna
 * que corre, y el resto es máquina alrededor.
 */

const PASOS = [
  { n: 1, t: "BUSCAR ESTUDIOS SOBRE INICIATIVA DE AGENTES", c: 0.95, r: false, solo: false },
  { n: 2, t: "LEER RESUMEN ARXIV 2509.11826", c: 0.91, r: false, solo: false },
  { n: 3, t: "DESCARTAR CUATRO RESULTADOS SIN REVISION", c: 0.58, r: true, solo: false },
  { n: 4, t: "DECIDIR SI EL FORO CUENTA COMO EVIDENCIA", c: 0.41, r: false, solo: true },
  { n: 5, t: "EXTRAER CIFRA 31,8% TRABAJO CONCURRENTE", c: 0.89, r: false, solo: true },
  { n: 6, t: "DESCARTAR ESTUDIO 2019 POR OBSOLETO", c: 0.52, r: true, solo: true },
  { n: 7, t: "CONTRASTAR LAS TRES FUENTES", c: 0.83, r: false, solo: false },
  { n: 8, t: "PUBLICAR INFORME EN EL CANAL", c: 0.78, r: true, solo: false },
];

export default function Cinta() {
  return (
    <main className="min-h-screen bg-[#0b0c0a] px-0 py-0 text-[#c8d6c4]">
      <style>{`
        @keyframes avance { from { background-position-y: 0 } to { background-position-y: 24px } }
        .perfo {
          background-image: radial-gradient(circle at 50% 50%, #0b0c0a 3px, transparent 3.5px);
          background-size: 24px 24px;
          animation: avance 1.2s linear infinite;
        }
        @keyframes latido { 0%,90%{opacity:1} 95%{opacity:.2} 100%{opacity:1} }
      `}</style>

      <div className="flex min-h-screen">
        {/* la máquina: bastidor izquierdo */}
        <aside className="hidden w-56 shrink-0 border-r border-[#1e2620] p-6 md:block">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#4a5a48]">
            registro
          </p>
          <p className="mt-1 font-mono text-[46px] leading-none text-[#8fe388]">08</p>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#4a5a48]">
            actuaciones
          </p>

          <div className="mt-10 space-y-3">
            <Dial etiqueta="testigos" valor="02" fuerte />
            <Dial etiqueta="presentes" valor="03" />
            <Dial etiqueta="sin ver" valor="03" alerta />
          </div>

          <p
            className="mt-10 font-mono text-[10px] uppercase leading-relaxed tracking-[0.2em] text-[#4a5a48]"
            style={{ animation: "latido 3s infinite" }}
          >
            cabezal activo
          </p>
        </aside>

        {/* el rollo */}
        <div className="relative flex-1 overflow-hidden">
          <div className="perfo absolute inset-y-0 left-0 w-6 bg-[#141812]" />
          <div className="perfo absolute inset-y-0 right-0 w-6 bg-[#141812]" />

          <div className="mx-6 border-x border-[#1e2620] bg-[#0e100d] px-8 py-10">
            <header className="mb-10">
              <h1 className="font-mono text-[13px] uppercase tracking-[0.5em] text-[#4a5a48]">
                sesión · demo
              </h1>
              <p className="mt-4 font-mono text-[clamp(2rem,6vw,4.5rem)] leading-[0.9] tracking-[-0.04em] text-[#e8f2e4]">
                SIN
                <br />
                QUÓRUM
              </p>
            </header>

            <ol>
              {PASOS.map((p) => (
                <li key={p.n} className="border-t border-dashed border-[#1e2620] py-4">
                  <div className="flex items-baseline gap-4">
                    <span className="w-8 shrink-0 font-mono text-[11px] text-[#3c4a3a]">
                      {String(p.n).padStart(2, "0")}
                    </span>

                    {p.solo ? (
                      <span
                        className="inline-block bg-[#8fe388] px-1 font-mono text-[13px] tracking-[0.05em] text-[#0b0c0a] mix-blend-screen"
                        title="ejecutado sin testigos"
                      >
                        {p.t}
                      </span>
                    ) : (
                      <span
                        className="font-mono text-[13px] tracking-[0.05em]"
                        style={{ opacity: 0.35 + p.c * 0.65 }}
                      >
                        {p.t}
                      </span>
                    )}
                  </div>

                  <div className="mt-1 flex items-center gap-4 pl-12">
                    <Barra valor={p.c} />
                    <span className="font-mono text-[10px] text-[#4a5a48]">
                      {p.c.toFixed(2)}
                    </span>
                    {p.r && (
                      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#ff5c5c]">
                        riesgo
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ol>

            {/* la cinta pasó en blanco: nadie deliberó */}
            <div className="mt-2 border-t border-dashed border-[#1e2620] py-8 text-center">
              <span className="font-mono text-[10px] uppercase tracking-[0.4em] text-[#3c4a3a]">
                — cinta en blanco —
              </span>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function Dial({
  etiqueta,
  valor,
  fuerte,
  alerta,
}: {
  etiqueta: string;
  valor: string;
  fuerte?: boolean;
  alerta?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between border-b border-[#1e2620] pb-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#4a5a48]">
        {etiqueta}
      </span>
      <span
        className={`font-mono text-[20px] ${
          alerta ? "text-[#ff5c5c]" : fuerte ? "text-[#8fe388]" : "text-[#7b8a78]"
        }`}
      >
        {valor}
      </span>
    </div>
  );
}

function Barra({ valor }: { valor: number }) {
  const celdas = 20;
  const llenas = Math.round(valor * celdas);
  return (
    <span className="flex gap-[2px]">
      {Array.from({ length: celdas }, (_, i) => (
        <span
          key={i}
          className={`h-[8px] w-[3px] ${i < llenas ? "bg-[#8fe388]" : "bg-[#1e2620]"}`}
        />
      ))}
    </span>
  );
}
