import Link from "next/link";

const DEMO = "demo";

export default function Inicio() {
  return (
    <main className="flex min-h-screen flex-col bg-papel text-tinta">
      <header className="bg-campo text-papel">
        <div className="mx-auto w-full max-w-3xl px-6 py-10">
          <h1
            className="text-acta"
            style={{ fontFamily: "var(--font-acta)", fontWeight: 700 }}
          >
            Acta
          </h1>
          <p className="mt-2 text-rotulo uppercase tracking-[0.08em] text-campo-tenue">
            sesión de agente deliberada en público
          </p>
        </div>
      </header>

      <div className="mx-auto w-full max-w-3xl grow px-6 py-10">
        <p
          className="max-w-prose text-paso"
          style={{ fontFamily: "var(--font-acta)" }}
        >
          Un agente trabaja. Varias personas lo ven en vivo y pueden intervenirlo. Lo
          que cambia es que el agente <em>decide cuándo hablar</em> según quién esté
          mirando la sala.
        </p>

        <dl className="mt-8 border-t border-filete">
          {[
            ["nadie mira", "avanza solo y encola sus dudas"],
            ["hay testigos y el paso es arriesgado", "se detiene y consulta"],
            ["alguien escribe", "se calla y espera"],
            ["vuelves", "confiesa lo que hizo sin ti"],
          ].map(([caso, conducta]) => (
            <div
              key={caso}
              className="grid gap-1 border-b border-filete py-3 sm:grid-cols-[16rem_1fr] sm:gap-6"
            >
              <dt className="text-rotulo uppercase tracking-[0.08em] text-mina">
                {caso}
              </dt>
              <dd className="text-paso" style={{ fontFamily: "var(--font-acta)" }}>
                {conducta}
              </dd>
            </div>
          ))}
        </dl>

        <Link
          href={`/sesion/${DEMO}`}
          className="mt-8 inline-block border border-tinta bg-tinta px-4 py-2 text-rotulo uppercase tracking-[0.08em] text-papel transition-colors duration-150 hover:bg-transparent hover:text-tinta"
        >
          abrir la sesión
        </Link>

        <p className="mt-6 max-w-prose text-rotulo uppercase tracking-[0.08em] text-mina">
          ábrela en dos pestañas para ver la conducta cambiar. cierra los ojos en una y
          el agente se creerá solo.
        </p>
      </div>
    </main>
  );
}
