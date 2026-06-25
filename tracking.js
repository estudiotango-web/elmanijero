/* MilongIA · tracking.js v0.2
   Calibrado para ~4fps (230ms/frame en celular gama media).
   Heurística simplificada: cuerpo que se desplazó más de MOVIMIENTO_MIN_PX_TOTAL
   en los últimos HISTORIAL_SEGUNDOS segundos = está bailando.
   Dos cuerpos bailando que están cerca entre sí = pareja.
*/

// ── Parámetros calibrados para 4fps ─────────────────────────────────────
const TRACK_HISTORIAL_SEGUNDOS  = 4;    // ventana de tiempo para evaluar movimiento
const TRACK_DIST_MAX_ASOCIAR    = 120;  // px máx. para considerar "mismo cuerpo" entre frames (más tolerante)
const TRACK_FRAMES_SIN_VER_MAX  = 12;   // ~3 segundos a 4fps antes de eliminar track
const MOVIMIENTO_MIN_PX_TOTAL   = 30;   // px totales en HISTORIAL_SEGUNDOS para confirmar "está bailando"
const PAREJA_DIST_MAX           = 150;  // px máx. entre centros para considerar "pareja"


let proximoId = 1;
let tracks    = [];
// tracks: [{ id, centro: {x,y}, historial: [{x,y,t}], framesSinVer, colores }]

// ── Punto de entrada: procesar un frame nuevo ────────────────────────────
// detecciones: array de {bbox:[x,y,w,h], score, class} de coco-ssd
// Devuelve: { personasEnPista, parejas, sueltosConMovimiento, totalTracks, tracksActivos }
function procesarFrame(detecciones) {
  const ahora   = performance.now();
  const personas = detecciones.filter(d => d.class === 'person' && d.score >= 0.45);
  const centros  = personas.map(p => centroDeBbox(p.bbox));

  asociarDetecciones(centros, ahora);
  limpiarTracksViejos();

  const { parejas, sueltosConMovimiento } = agruparParejas(ahora);
  const personasEnPista = parejas.length * 2 + sueltosConMovimiento.length;

  return {
    personasEnPista,
    parejas:              parejas.length,
    sueltosConMovimiento: sueltosConMovimiento.length,
    totalTracks:          tracks.length,
    tracksActivos:        tracks
  };
}

// ── Asociar centros detectados con tracks existentes ────────────────────
function asociarDetecciones(centros, t) {
  const asignados = new Set();

  // Para cada track, buscar la detección más cercana disponible
  tracks.forEach(function (track) {
    let mejorIdx  = -1;
    let mejorDist = Infinity;

    centros.forEach(function (c, idx) {
      if (asignados.has(idx)) return;
      const d = dist(track.centro, c);
      if (d < mejorDist) { mejorDist = d; mejorIdx = idx; }
    });

    if (mejorIdx !== -1 && mejorDist <= TRACK_DIST_MAX_ASOCIAR) {
      asignados.add(mejorIdx);
      const c = centros[mejorIdx];
      track.centro = c;
      track.historial.push({ x: c.x, y: c.y, t });
      // Mantener solo historial dentro de la ventana de tiempo
      const ventanaMs = TRACK_HISTORIAL_SEGUNDOS * 1000;
      track.historial = track.historial.filter(h => t - h.t <= ventanaMs);
      track.framesSinVer = 0;
    } else {
      track.framesSinVer++;
    }
  });

  // Nuevas detecciones sin track → crear track
  centros.forEach(function (c, idx) {
    if (asignados.has(idx)) return;
    tracks.push({
      id:           proximoId++,
      centro:       c,
      historial:    [{ x: c.x, y: c.y, t }],
      framesSinVer: 0,
      color:        colorAleatorio()
    });
  });
}

// ── Eliminar tracks perdidos ─────────────────────────────────────────────
function limpiarTracksViejos() {
  tracks = tracks.filter(t => t.framesSinVer <= TRACK_FRAMES_SIN_VER_MAX);
}

// ── ¿Este track se desplazó suficiente en la ventana de tiempo? ──────────
function estaBailando(track) {
  const h = track.historial;
  if (h.length < 2) return false;

  // Sumar desplazamiento total acumulado en la ventana
  let total = 0;
  for (let i = 1; i < h.length; i++) {
    total += Math.hypot(h[i].x - h[i-1].x, h[i].y - h[i-1].y);
  }
  return total >= MOVIMIENTO_MIN_PX_TOTAL;
}

// ── Agrupar tracks bailando en parejas por proximidad ───────────────────
function agruparParejas(ahora) {
  const bailando = tracks.filter(estaBailando);
  const usados   = new Set();
  const parejas  = [];

  for (let i = 0; i < bailando.length; i++) {
    if (usados.has(bailando[i].id)) continue;
    for (let j = i + 1; j < bailando.length; j++) {
      if (usados.has(bailando[j].id)) continue;
      if (dist(bailando[i].centro, bailando[j].centro) <= PAREJA_DIST_MAX) {
        parejas.push([bailando[i].id, bailando[j].id]);
        usados.add(bailando[i].id);
        usados.add(bailando[j].id);
        break;
      }
    }
  }

  const sueltosConMovimiento = bailando.filter(t => !usados.has(t.id));
  return { parejas, sueltosConMovimiento };
}

// ── Helpers ──────────────────────────────────────────────────────────────
function centroDeBbox(bbox) {
  const [x, y, w, h] = bbox;
  return { x: x + w / 2, y: y + h / 2 };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function colorAleatorio() {
  const colores = ['#E8B86D', '#C0272D', '#4CAF7D', '#EF9F27', '#5DCAA5'];
  return colores[Math.floor(Math.random() * colores.length)];
}

// ── Reset (al iniciar/detener detección) ────────────────────────────────
function resetTracking() {
  tracks     = [];
  proximoId  = 1;
}
