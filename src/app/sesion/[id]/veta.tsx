"use client";

/**
 * LA VETA — la presencia física de la máquina en la página.
 *
 * Una banda de luz que cruza el papel en diagonal, hecha con el truco del
 * gradiente de Stripe: ruido simplex fBm en un fragment shader y la diagonal
 * por transform CSS. Sin three.js — WebGL crudo, ~10KB de código.
 *
 * No es decoración: la veta ES el estado del agente.
 *   trabaja  → fluye
 *   ESPERA   → SE CONGELA (uTime deja de avanzar: contiene la respiración)
 *   SOLA     → se enfría a gris humo
 *   VISTA    → arde en los análogos del sistema (berenjena → vino → rosa)
 *   PREGUNTA → vino encendido
 *   QUIETA   → apenas un aliento
 */

import { useEffect, useRef } from "react";

type EstadoVeta = "QUIETA" | "SOLA" | "VISTA" | "ESPERA" | "PREGUNTA";

/** tres paradas de color por estado, en RGB 0..1 */
const PALETAS: Record<EstadoVeta, [number[], number[], number[]]> = {
  // la paleta del portafolio del dueño: un solo mundo cálido
  VISTA: [
    [0.16, 0.08, 0.14], // berenjena
    [0.63, 0.18, 0.27], // vino
    [0.91, 0.51, 0.56], // rosa
  ],
  PREGUNTA: [
    [0.35, 0.07, 0.14],
    [0.75, 0.15, 0.25],
    [0.98, 0.72, 0.6],
  ],
  SOLA: [
    // humo: la máquina sin nadie delante no merece color
    [0.42, 0.41, 0.4],
    [0.62, 0.6, 0.58],
    [0.8, 0.78, 0.75],
  ],
  ESPERA: [
    [0.2, 0.12, 0.18],
    [0.5, 0.25, 0.32],
    [0.85, 0.62, 0.6],
  ],
  QUIETA: [
    [0.88, 0.86, 0.83],
    [0.92, 0.9, 0.87],
    [0.85, 0.82, 0.8],
  ],
};

const VERT = `attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`;

/** simplex 2D de Ashima + fBm de 3 octavas + mezcla de 3 paradas */
const FRAG = `precision mediump float;
uniform vec2 uRes;uniform float uT;uniform vec3 uA;uniform vec3 uB;uniform vec3 uC;
vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec2 mod289(vec2 x){return x-floor(x*(1./289.))*289.;}
vec3 permute(vec3 x){return mod289(((x*34.)+10.)*x);}
float snoise(vec2 v){
const vec4 C=vec4(.211324865405187,.366025403784439,-.577350269189626,.024390243902439);
vec2 i=floor(v+dot(v,C.yy));vec2 x0=v-i+dot(i,C.xx);
vec2 i1=(x0.x>x0.y)?vec2(1.,0.):vec2(0.,1.);
vec4 x12=x0.xyxy+C.xxzz;x12.xy-=i1;i=mod289(i);
vec3 p=permute(permute(i.y+vec3(0.,i1.y,1.))+i.x+vec3(0.,i1.x,1.));
vec3 m=max(.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.);
m=m*m;m=m*m;
vec3 x=2.*fract(p*C.www)-1.;vec3 h=abs(x)-.5;vec3 ox=floor(x+.5);vec3 a0=x-ox;
m*=1.79284291400159-.85373472095314*(a0*a0+h*h);
vec3 g;g.x=a0.x*x0.x+h.x*x0.y;g.yz=a0.yz*x12.xz+h.yz*x12.yw;
return 130.*dot(m,g);}
float fbm(vec2 q){float s=0.,a=.55;
for(int i=0;i<3;i++){s+=a*snoise(q);q=q*2.1+vec2(3.7,1.3);a*=.5;}return s;}
void main(){
vec2 uv=gl_FragCoord.xy/uRes;
float t=uT*.06;
float n=fbm(vec2(uv.x*2.2+t,uv.y*1.6-t*.7));
float m=fbm(vec2(uv.x*1.4-t*.5,uv.y*2.8+t*.3));
float v=n*.6+m*.4+.5;
vec3 col=v<.5?mix(uA,uB,smoothstep(0.,.5,v)):mix(uB,uC,smoothstep(.5,1.,v));
float borde=smoothstep(0.,.22,uv.y)*smoothstep(1.,.78,uv.y);
gl_FragColor=vec4(col,borde*.9);}`;

export function Veta({
  estado,
  congelada,
}: {
  estado: EstadoVeta;
  /** true = el tiempo del shader se detiene: la máquina calla */
  congelada: boolean;
}) {
  const lienzo = useRef<HTMLCanvasElement>(null);
  const estadoRef = useRef(estado);
  const congeladaRef = useRef(congelada);

  useEffect(() => {
    estadoRef.current = estado;
    congeladaRef.current = congelada;
  }, [estado, congelada]);

  useEffect(() => {
    const cv = lienzo.current;
    if (!cv) return;
    const gl = cv.getContext("webgl", { alpha: true, antialias: false });
    if (!gl) return; // el fallback CSS del padre queda debajo

    // Hay WebGL: el fallback estático estorba (se ve a través del canvas y
    // tiñe la paleta). Solo existe para cuando no hay contexto.
    const fallback = cv.previousElementSibling as HTMLElement | null;
    if (fallback) fallback.style.display = "none";

    const mk = (tipo: number, src: string) => {
      const s = gl.createShader(tipo)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, mk(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, "uRes");
    const uT = gl.getUniformLocation(prog, "uT");
    const uA = gl.getUniformLocation(prog, "uA");
    const uB = gl.getUniformLocation(prog, "uB");
    const uC = gl.getUniformLocation(prog, "uC");

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // los colores persiguen a la paleta objetivo: el cambio de estado se ve
    // como la luz cambiando de ánimo, nunca como un corte
    const color = PALETAS[estadoRef.current].map((c) => [...c]);

    const reducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let tiempo = Math.random() * 100;
    let vivo = true;
    let raf = 0;

    const medir = () => {
      const r = cv.getBoundingClientRect();
      const escala = Math.min(window.devicePixelRatio, 1.5) * 0.5; // media res: es un blur
      cv.width = Math.max(1, Math.round(r.width * escala));
      cv.height = Math.max(1, Math.round(r.height * escala));
      gl.viewport(0, 0, cv.width, cv.height);
    };
    medir();
    window.addEventListener("resize", medir);

    const pintar = () => {
      if (!vivo) return;
      // congelada: el tiempo no avanza — la veta contiene la respiración
      if (!congeladaRef.current && !reducido) tiempo += 1 / 60;

      const objetivo = PALETAS[estadoRef.current];
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++)
          color[i][j] += (objetivo[i][j] - color[i][j]) * 0.04;

      gl.uniform2f(uRes, cv.width, cv.height);
      gl.uniform1f(uT, tiempo);
      gl.uniform3fv(uA, color[0]);
      gl.uniform3fv(uB, color[1]);
      gl.uniform3fv(uC, color[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(pintar);
    };
    raf = requestAnimationFrame(pintar);

    return () => {
      vivo = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", medir);
    };
  }, []);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-[-10%] top-[6%] h-[46vh]"
      style={{ transform: "skewY(-7deg)", filter: "blur(28px) saturate(1.15)" }}
    >
      {/* fallback si WebGL falta: el mismo mundo, quieto */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(100deg, #29152300 5%, #29152366 30%, #a02d4555 55%, #e9818e44 75%, #f5f3ef00 95%)",
        }}
      />
      <canvas ref={lienzo} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
