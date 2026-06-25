/* El Manijero · panel.js v1.2
   Audio propio desde Google Drive + YouTube como fallback
   Visualizaciones de audio · Gauges segmentados · Knob touch corregido
   ─────────────────────────────────────────────────────────────────────── */

const GAS_URL        = 'https://script.google.com/macros/s/AKfycbw5NVX8ICStvL-jp4XvuA21SD0JOLYPoHWuDsalDGZh8bpmoMzuMcPquFxLrZihsdGj/exec';
const CAMARA_GAS_URL = 'https://script.google.com/macros/s/AKfycbxvoJEdKQRpFxGyV_umkuJEV9zr3Tp4D4CM8s1ZDH4VHH-fyz_ukcJFtXHtwX3FDrf96Q/exec';

const CORTINA_DURACION_SEG = 45;
const POLLING_INTERVAL_MS  = 30000;
const PISTA_POLLING_MS     = 30000;
const ABANDONO_UMBRAL_PCT  = 25;
const ABANDONO_VENTANA_MIN = 5;

// ── Estado global ──────────────────────────────────────────────────────────
let biblioteca    = [];
let indexActual   = 0;
let ytPlayer      = null;
let ytReady       = false;
let estadoPanel   = 'idle';
let progressTimer = null;
let cortinaTimer  = null;
let pollingTimer  = null;

let historialPista    = [];
let pistaPollingTimer = null;

let energiaHistory = [];
const MAX_ENERGIA_HISTORY = 60;

// ── NUEVO: audio nativo ────────────────────────────────────────────────────
let audioEl = null;   // elemento <audio> para archivos propios de Drive

// ══════════════════════════════════════════════════════════════════════════
// AUDIO PROPIO — Google Drive
// ══════════════════════════════════════════════════════════════════════════

function reproducirConAudioEl(tema) {
  detenerAudio();

  audioEl             = new Audio();
  audioEl.crossOrigin = 'anonymous';
  audioEl.src         = tema.AudioURL;
  audioEl.volume      = knobValue / 100;
  audioEl.preload     = 'auto';

  audioEl.addEventListener('canplaythrough', function onReady() {
    audioEl.removeEventListener('canplaythrough', onReady);
    audioEl.play().catch(function(err) {
      console.warn('Error al reproducir audio de Drive:', err);
      avanzarTema();
    });
    iniciarProgressAudio();
    startAudioSimulation();
    activarRing(true);
  }, { once: true });

  audioEl.addEventListener('ended', avanzarTema);

  audioEl.addEventListener('error', function() {
    console.warn('Error cargando audio desde Drive — avanzando al siguiente');
    avanzarTema();
  });

  // Progreso real (sobreescribe el timer de iniciarProgress)
  audioEl.addEventListener('timeupdate', function() {
    if (!audioEl || !audioEl.duration) return;
    var pct = (audioEl.currentTime / audioEl.duration) * 100;
    var pf  = document.getElementById('progress-fill');
    if (pf) pf.style.width = pct.toFixed(1) + '%';
    var cur = Math.floor(audioEl.currentTime);
    setEl('time-current',
      Math.floor(cur / 60) + ':' + (cur % 60).toString().padStart(2, '0'));
    var rest = Math.floor(audioEl.duration - audioEl.currentTime);
    setEl('m-tiempo',
      Math.floor(rest / 60) + ':' + (rest % 60).toString().padStart(2, '0'));
  });
}

function detenerAudio() {
  if (audioEl) {
    audioEl.pause();
    audioEl.src = '';
    audioEl     = null;
  }
}

// Iniciar barra de progreso para audio propio (sin timer — lo maneja timeupdate)
function iniciarProgressAudio() {
  if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
  // La duración real la pone el evento timeupdate; solo reseteamos el display
  var pf = document.getElementById('progress-fill');
  if (pf) pf.style.width = '0%';
  setEl('time-current', '0:00');
  if (audioEl && audioEl.duration) {
    var tot = Math.floor(audioEl.duration);
    setEl('time-total', Math.floor(tot / 60) + ':' + (tot % 60).toString().padStart(2, '0'));
  }
}

// ══════════════════════════════════════════════════════════════════════════
// GAUGE EN ARCO SEGMENTADO
// ══════════════════════════════════════════════════════════════════════════

function drawGaugeArc(canvasId, pct, colors) {
  var canvas = document.getElementById(canvasId);
  if (!canvas) return;

  var W        = canvas.width;
  var H        = canvas.height;
  var ctx      = canvas.getContext('2d');
  var cx       = W / 2;
  var cy       = H * 0.88;
  var r        = Math.min(W, H * 2) * 0.44;
  var segments = 24;
  var startDeg = 210;
  var endDeg   = 330;
  var totalArc = endDeg - startDeg;
  var gap      = 3.5;
  var segArc   = (totalArc / segments) - gap;
  var filled   = Math.round((pct / 100) * segments);
  var lineW    = r * 0.22;

  ctx.clearRect(0, 0, W, H);

  for (var j = 0; j < segments; j++) {
    var aStart = (startDeg + j * (totalArc / segments)) * Math.PI / 180;
    var aEnd   = aStart + (segArc * Math.PI / 180);
    var zone   = j / segments;
    var active = j < filled;

    var c;
    if (!active) {
      c = 'rgba(255,255,255,0.07)';
    } else if (colors.length === 1) {
      c = colors[0];
    } else if (zone < 0.4) {
      c = colors[0];
    } else if (zone < 0.75) {
      c = colors[1];
    } else {
      c = colors[2];
    }

    ctx.beginPath();
    ctx.arc(cx, cy, r - lineW / 2, aStart, aEnd);
    ctx.strokeStyle = c;
    ctx.lineWidth   = lineW;
    ctx.lineCap     = 'butt';
    ctx.stroke();
  }
}

var GAUGE_COLORS = {
  energia:  ['#7A1A1A', '#C4403A', '#E85050'],
  densidad: ['#5A3A08', '#A8742A', '#C9924A'],
  fatiga:   ['#0A3A18', '#2A8A4A', '#4CAF7D'],
  conexion: ['#6A0A28', '#B03060', '#E87090'],
};

function updateGaugeCanvas(id, pct) {
  var key = id.replace('gauge-', '');
  drawGaugeArc(id, pct, GAUGE_COLORS[key] || ['#C9924A']);
}

// ══════════════════════════════════════════════════════════════════════════
// KNOB
// ══════════════════════════════════════════════════════════════════════════

var knobValue    = 72;
var knobDragging = false;
var knobStartY   = 0;
var knobStartVal = 72;

function drawKnob(value) {
  var canvas = document.getElementById('knob-canvas');
  if (!canvas) return;
  var W   = canvas.width;
  var H   = canvas.height;
  var ctx = canvas.getContext('2d');
  var cx  = W / 2;
  var cy  = H / 2;
  var r   = W * 0.38;
  var lw  = W * 0.075;

  ctx.clearRect(0, 0, W, H);

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0.75 * Math.PI, 2.25 * Math.PI);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth   = lw;
  ctx.lineCap     = 'round';
  ctx.stroke();

  var grad = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
  grad.addColorStop(0, '#5C0E0E');
  grad.addColorStop(1, '#C9924A');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0.75 * Math.PI, (0.75 + (value / 100) * 1.5) * Math.PI);
  ctx.strokeStyle = grad;
  ctx.lineWidth   = lw;
  ctx.lineCap     = 'round';
  ctx.stroke();

  var angle = (0.75 + (value / 100) * 1.5) * Math.PI;
  ctx.beginPath();
  ctx.arc(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r, lw * 0.7, 0, Math.PI * 2);
  ctx.fillStyle = '#E8B870';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.42, 0, Math.PI * 2);
  ctx.fillStyle = '#1A1008';
  ctx.fill();
  ctx.strokeStyle = 'rgba(201,146,74,0.2)';
  ctx.lineWidth = 1;
  ctx.stroke();

  var db = -40 + (value / 100) * 52;
  setEl('knob-db', (db > 0 ? '+' : '') + db.toFixed(1) + ' dB');
}

function getEventY(e) {
  if (e.touches && e.touches.length > 0)             return e.touches[0].clientY;
  if (e.changedTouches && e.changedTouches.length > 0) return e.changedTouches[0].clientY;
  return e.clientY;
}

function knobOnStart(e) {
  knobDragging = true;
  knobStartY   = getEventY(e);
  knobStartVal = knobValue;
  e.preventDefault();
}
function knobOnMove(e) {
  if (!knobDragging) return;
  var delta = (knobStartY - getEventY(e)) * 0.6;
  knobValue  = Math.max(0, Math.min(100, knobStartVal + delta));
  drawKnob(knobValue);
  var s = document.getElementById('vol');
  var o = document.getElementById('vol-out');
  if (s) s.value       = Math.round(knobValue);
  if (o) o.textContent = Math.round(knobValue);
  // Controla AMBOS reproductores
  if (audioEl) audioEl.volume = Math.round(knobValue) / 100;
  if (ytPlayer && ytReady) ytPlayer.setVolume(Math.round(knobValue));
  e.preventDefault();
}
function knobOnEnd() { knobDragging = false; }

function initKnob() {
  var canvas = document.getElementById('knob-canvas');
  if (!canvas) return;
  drawKnob(knobValue);
  canvas.addEventListener('mousedown',  knobOnStart);
  window.addEventListener('mousemove',  knobOnMove);
  window.addEventListener('mouseup',    knobOnEnd);
  canvas.addEventListener('touchstart', knobOnStart, { passive: false });
  canvas.addEventListener('touchmove',  knobOnMove,  { passive: false });
  canvas.addEventListener('touchend',   knobOnEnd);
}

// ══════════════════════════════════════════════════════════════════════════
// AUDIO SIMULATION + WAVEFORM + VU
// ══════════════════════════════════════════════════════════════════════════

var simPhase       = 0;
var simEnergy      = 0.65;
var simTarget      = 0.65;
var simBeat        = 0;
var simAudioAnimId = null;

function startAudioSimulation() {
  if (simAudioAnimId) cancelAnimationFrame(simAudioAnimId);
  loopAudio();
}
function stopAudioSimulation() {
  if (simAudioAnimId) cancelAnimationFrame(simAudioAnimId);
  simAudioAnimId = null;
  clearWaveform();
  clearVU();
}

function loopAudio() {
  simAudioAnimId = requestAnimationFrame(loopAudio);
  if (estadoPanel !== 'playing') { clearWaveform(); clearVU(); return; }

  simPhase += 0.008;
  simBeat  += 0.04;
  if (Math.random() < 0.005) simTarget = 0.4 + Math.random() * 0.55;
  simEnergy += (simTarget - simEnergy) * 0.01;

  var beat  = Math.abs(Math.sin(simBeat * Math.PI * 2));
  var baseL = Math.max(0, Math.min(1, simEnergy * (0.7 + beat * 0.25) + (Math.random() * 0.06 - 0.03)));
  var baseR = Math.max(0, Math.min(1, simEnergy * (0.7 + beat * 0.25) + (Math.random() * 0.06 - 0.03)));

  drawWaveform(simEnergy, simPhase, beat);
  drawVUHorizontal(baseL, baseR);
  updateVUVertical(baseL, baseR);

  if (Math.random() < 0.008) {
    var lufs = (-23 + simEnergy * 10).toFixed(1);
    var tp   = (-3  + simEnergy * 2).toFixed(1);
    setEl('meta-lufs', lufs + ' LUFS');
    setEl('meta-gain', '+' + (simEnergy * 4).toFixed(1) + ' dB');
    setEl('meta-tp',   tp + ' dB');
    setEl('meta-rd',   (8 + simEnergy * 4).toFixed(1));
    setEl('aj-gain', 'GAIN +' + (simEnergy * 4).toFixed(1) + ' dB');
    setEl('aj-eq',   'EQ Vintage Warm');
    setEl('aj-lufs', 'LUFS ' + lufs);
    setEl('aj-tp',   'TP ' + tp + ' dB');
  }

  if (Math.random() < 0.003) {
    energiaHistory.push(Math.round(simEnergy * 100));
    if (energiaHistory.length > MAX_ENERGIA_HISTORY) energiaHistory.shift();
    drawEvolucionChart();
    updateAllGauges(simEnergy, beat);
  }
}

function drawWaveform(energy, phase, beat) {
  var canvas = document.getElementById('waveform-canvas');
  if (!canvas) return;
  var W = canvas.offsetWidth || 400;
  if (canvas.width !== W) canvas.width = W;
  var H   = canvas.height;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  var mid = H / 2;
  var pts = Math.floor(W / 2);

  for (var i = 0; i < pts; i++) {
    var t   = i / pts;
    var amp = (
      Math.sin(t * 60 + phase * 4)  * 0.4 +
      Math.sin(t * 120 + phase * 7) * 0.25 +
      Math.sin(t * 30 + phase * 2)  * 0.2 +
      (Math.random() * 2 - 1)       * 0.15
    ) * energy * mid * 0.85;

    var abs = Math.abs(amp) / (mid * 0.85);
    var r2  = Math.round(76  + (226 - 76)  * Math.min(abs * 2, 1));
    var g2  = Math.round(175 + (75  - 175) * Math.min(abs * 2, 1));
    var b2  = Math.round(125 + (74  - 125) * Math.min(abs * 2, 1));
    ctx.strokeStyle = 'rgb(' + r2 + ',' + g2 + ',' + b2 + ')';
    ctx.lineWidth   = 1.5;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(i * 2, mid - amp);
    ctx.lineTo(i * 2, mid + amp);
    ctx.stroke();
  }

  var pf = document.getElementById('progress-fill');
  if (pf) {
    var pct = parseFloat(pf.style.width) / 100;
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth   = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(pct * W, 0);
    ctx.lineTo(pct * W, H);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.globalAlpha = 1;
}

function clearWaveform() {
  var c = document.getElementById('waveform-canvas');
  if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
}

function drawVUHorizontal(L, R) { drawVUSide('vu-left', L); drawVUSide('vu-right', R); }
function drawVUSide(id, level) {
  var canvas = document.getElementById(id);
  if (!canvas) return;
  var W = canvas.width, H = canvas.height, ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  var segs = 16, segW = Math.floor(W / segs) - 1, filled = Math.round(level * segs);
  for (var i = 0; i < segs; i++) {
    ctx.fillStyle = i < filled
      ? (i < segs * 0.6 ? '#4CAF7D' : i < segs * 0.85 ? '#EFC14A' : '#E84040')
      : 'rgba(255,255,255,0.06)';
    ctx.fillRect(i * (segW + 1), 1, segW, H - 2);
  }
}

function updateVUVertical(L, R) {
  var fl = document.getElementById('vu-vf-left');
  var fr = document.getElementById('vu-vf-right');
  if (fl) fl.style.height = (L * 100).toFixed(1) + '%';
  if (fr) fr.style.height = (R * 100).toFixed(1) + '%';
}
function clearVU() {
  drawVUSide('vu-left', 0); drawVUSide('vu-right', 0);
  updateVUVertical(0, 0);
}

function updateAllGauges(energy, beat) {
  var pista    = historialPista.length ? historialPista[historialPista.length - 1] : null;
  var personas = pista && pista.personas ? pista.personas : 0;

  var ePct = Math.round(energy * 100);
  var dPct = personas > 0 ? Math.min(Math.round(personas * 1.2), 100) : Math.round(energy * 65);
  var fPct = Math.max(10, Math.round(100 - ePct * 0.6 - beat * 20));
  var cPct = Math.min(100, Math.round(ePct * 0.85 + personas * 0.5 + beat * 15));

  updateGaugeCanvas('gauge-energia',  ePct);
  updateGaugeCanvas('gauge-densidad', dPct);
  updateGaugeCanvas('gauge-fatiga',   fPct);
  updateGaugeCanvas('gauge-conexion', cPct);

  setEl('g-energia',      ePct + '%');
  setEl('g-densidad',     dPct + '%');
  setEl('g-fatiga',       fPct + '%');
  setEl('g-conexion',     cPct + '%');
  setEl('g-energia-sub',  ePct >= 70 ? 'Alta'      : ePct >= 40 ? 'Media'   : 'Baja');
  setEl('g-densidad-sub', dPct >= 60 ? 'Media'     : 'Poca');
  setEl('g-fatiga-sub',   fPct <= 35 ? 'Baja'      : 'Alta');
  setEl('g-conexion-sub', cPct >= 70 ? 'Muy buena' : 'Buena');

  if (ePct >= 70) {
    setEl('ia-texto',    'La energía de la pista está en ascenso. Buen momento para una tanda rítmica.');
    setEl('rec-proxima', 'Próximo: D\'Arienzo 1937 · La Cumparsita');
    setEl('ventana-val', '2 temas más');
  } else if (ePct < 40) {
    setEl('ia-texto',    'La pista está tranquila. Ideal para una tanda lírica o un vals.');
    setEl('rec-proxima', 'Próximo: Di Sarli · Vals');
    setEl('ventana-val', '1 tema más');
  } else {
    setEl('ia-texto',    'Energía moderada. Mantener el ritmo actual.');
    setEl('rec-proxima', 'Próximo: Troilo · A media luz');
    setEl('ventana-val', '3 temas más');
  }
}

function drawEvolucionChart() {
  var canvas = document.getElementById('evolucion-canvas');
  if (!canvas || energiaHistory.length < 2) return;
  var W = canvas.offsetWidth || 300;
  if (canvas.width !== W) canvas.width = W;
  var H = canvas.height, ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  [0.25, 0.5, 0.75].forEach(function(y) {
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(0, H * y); ctx.lineTo(W, H * y); ctx.stroke();
  });

  var grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(201,146,74,0.35)');
  grad.addColorStop(1, 'rgba(201,146,74,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  energiaHistory.forEach(function(v, i) {
    var x = (i / (energiaHistory.length - 1)) * W;
    var y = H - (v / 100) * H * 0.9;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();

  ctx.beginPath();
  ctx.strokeStyle = 'rgba(201,146,74,0.8)'; ctx.lineWidth = 1.5;
  energiaHistory.forEach(function(v, i) {
    var x = (i / (energiaHistory.length - 1)) * W;
    var y = H - (v / 100) * H * 0.9;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
}

// ══════════════════════════════════════════════════════════════════════════
// YOUTUBE (fallback cuando no hay AudioURL)
// ══════════════════════════════════════════════════════════════════════════

function initYouTubePlayer(videoId) {
  if (ytPlayer) { ytPlayer.loadVideoById(videoId); return; }
  ytPlayer = new YT.Player('yt-player', {
    height: '150', width: '200', videoId: videoId,
    playerVars: { autoplay: 1, controls: 0, origin: location.origin, enablejsapi: 1 },
    events: { onReady: onPlayerReady, onStateChange: onPlayerStateChange, onError: onPlayerError }
  });
}

function onPlayerReady() {
  ytReady = true;
  var tema = biblioteca[indexActual];
  if (tema && estadoPanel === 'playing') { iniciarProgress(tema); startAudioSimulation(); activarRing(true); }
}
function onPlayerStateChange(event) {
  if (event.data === YT.PlayerState.PLAYING && ytReady) {
    var tema = biblioteca[indexActual];
    if (tema && estadoPanel === 'playing') { iniciarProgress(tema); startAudioSimulation(); activarRing(true); }
  }
  if (event.data === YT.PlayerState.PAUSED) activarRing(false);
  if (event.data === YT.PlayerState.ENDED)  avanzarTema();
}
function onPlayerError(event) { console.warn('YT error:', event.data); setTimeout(avanzarTema, 1500); }
window.onYouTubeIframeAPIReady = function() { console.log('El Manijero: YouTube API lista'); };

// ══════════════════════════════════════════════════════════════════════════
// LÓGICA DE MILONGA
// ══════════════════════════════════════════════════════════════════════════

function activarRing(on) {
  var r = document.querySelector('.album-spinning-ring');
  if (r) r.classList[on ? 'add' : 'remove']('active');
}

function iniciarPolling() {
  if (pollingTimer) return;
  pollingTimer = setInterval(fetchBiblioteca, POLLING_INTERVAL_MS);
}

async function fetchBiblioteca() {
  var esPrimera = biblioteca.length === 0;
  if (esPrimera) mostrarEstadoCarga('Cargando temas desde la biblioteca…');
  try {
    var res  = await fetch(GAS_URL + '?action=getBiblioteca');
    var data = await res.json();
    if (esPrimera) {
      biblioteca = data;
      mostrarEstadoCarga(null);
      renderBibliotecaCargada();
      actualizarBotones();
      iniciarPolling();
    } else {
      var temaActual    = biblioteca[indexActual];
      var yaReprod      = biblioteca.slice(0, indexActual + 1);
      var idsYa         = new Set(yaReprod.map(function(t){ return t.ID; }));
      var colaNueva     = data.filter(function(t){ return !idsYa.has(t.ID); });
      var longitudAntes = biblioteca.length;
      biblioteca = yaReprod.concat(colaNueva);
      var nuevoIdx = biblioteca.findIndex(function(t){ return t.ID === temaActual.ID; });
      if (nuevoIdx !== -1 && nuevoIdx !== indexActual) indexActual = nuevoIdx;
      var diff = biblioteca.length - longitudAntes;
      if (diff !== 0) {
        mostrarToast((diff > 0 ? '+' : '') + diff + ' tema' + (Math.abs(diff) > 1 ? 's' : '') + (diff > 0 ? ' agregado' : ' eliminado') + (Math.abs(diff) > 1 ? 's' : ''));
        if (estadoPanel === 'playing') { renderCola(biblioteca.slice(indexActual + 1, indexActual + 6)); actualizarContadorTemas(); }
      }
    }
  } catch(e) {
    console.warn('Error cargando biblioteca:', e);
    if (esPrimera) mostrarEstadoCarga('Error al conectar con la biblioteca.');
  }
}

function iniciarMilonga() {
  if (!biblioteca.length) return;
  if (estadoPanel === 'paused') { reanudar(); return; }
  estadoPanel = 'playing';
  indexActual = 0;
  actualizarBotones(); actualizarLiveBadge();
  reproducirTema(indexActual);
}

function pausarMilonga() {
  if (estadoPanel !== 'playing') return;
  estadoPanel = 'paused';
  // Pausar audio propio o YouTube según cuál esté activo
  if (audioEl && !audioEl.paused) audioEl.pause();
  if (ytPlayer && ytReady) ytPlayer.pauseVideo();
  detenerTimers(); stopAudioSimulation(); activarRing(false);
  actualizarBotones(); actualizarLiveBadge();
  setEl('ia-texto', 'Milonga en pausa.');
}

function reanudar() {
  estadoPanel = 'playing';
  if (audioEl && audioEl.paused) audioEl.play();
  if (ytPlayer && ytReady) ytPlayer.playVideo();
  actualizarBotones(); actualizarLiveBadge();
  startAudioSimulation(); activarRing(true);
}

function stopMilonga() {
  estadoPanel = 'stopped';
  detenerAudio();                           // detiene audio propio
  if (ytPlayer && ytReady) ytPlayer.stopVideo();
  detenerTimers(); stopAudioSimulation(); activarRing(false);
  actualizarBotones(); actualizarLiveBadge(); resetProgressUI();
  setEl('now-name', '—'); setEl('now-orq', '—');
  setEl('ia-texto', 'Milonga detenida.'); renderCola([]);
}

// ── Reproducir tema — prioridad: Drive > YouTube > saltar ─────────────────
function reproducirTema(index) {
  if (index >= biblioteca.length) { finDeLaNoche(); return; }
  var tema = biblioteca[index];

  detenerTimers();
  detenerAudio();                           // limpiar audio anterior si lo hay
  renderTemaActual(tema, index);
  renderCola(biblioteca.slice(index + 1, index + 6));

  if (esCortina(tema)) {
    cortinaTimer = setTimeout(avanzarTema, CORTINA_DURACION_SEG * 1000);
    startAudioSimulation();
    activarRing(true);
    return;
  }

  if (tema.AudioURL) {
    // ✅ Audio propio desde Google Drive
    reproducirConAudioEl(tema);
  } else if (tema.URL) {
    // ⬇️ Fallback a YouTube
    var videoId = extraerVideoId(tema.URL);
    if (videoId) initYouTubePlayer(videoId);
    else avanzarTema();
  } else {
    // Sin fuente — saltar
    console.warn('Tema sin AudioURL ni URL de YouTube:', tema.Titulo);
    avanzarTema();
  }
}

function avanzarTema() {
  if (estadoPanel !== 'playing') return;
  indexActual++;
  reproducirTema(indexActual);
}

function esCortina(t) {
  return (t.Estilo || '').toLowerCase() === 'cortina';
}

// ══════════════════════════════════════════════════════════════════════════
// RENDER UI
// ══════════════════════════════════════════════════════════════════════════

function renderBibliotecaCargada() {
  setEl('now-name', 'Listo para iniciar');
  setEl('now-orq',  biblioteca.length + ' temas cargados');
  setEl('now-year', '');
  actualizarContadorTemas();
  setEl('ia-texto', 'Sin datos de pista aún. Reproducirá en orden de biblioteca.');
  var chips = document.getElementById('now-chips');
  if (chips) chips.innerHTML = '<span class="chip ch-cortina">Sin datos aún</span>';
  renderCola(biblioteca.slice(0, 5));

  // Mostrar cuántos tienen audio propio vs YouTube
  var conDrive = biblioteca.filter(function(t){ return !!t.AudioURL; }).length;
  var badge    = document.getElementById('live-badge');
  if (badge) {
    var info = conDrive > 0
      ? biblioteca.length + ' temas · ' + conDrive + ' en Drive'
      : biblioteca.length + ' temas listos';
    badge.innerHTML = '<div class="live-dot" style="background:#c9a84c;box-shadow:none"></div><span> ' + info + '</span>';
  }
  setEl('badge-temas', biblioteca.length + ' temas');
  setEl('badge-sub',   conDrive > 0 ? conDrive + ' en Drive' : 'Biblioteca cargada');
}

function renderTemaActual(tema, index) {
  setEl('now-name', tema.Titulo);
  setEl('now-orq',  'Orquesta ' + tema.Orquesta);
  setEl('now-year', tema.Anio + ' · ' + tema.Estilo);
  setEl('m-tanda-sub', tema.Estilo + ' · ' + tema.Orquesta);
  setEl('m-tanda',     (index + 1) + ' / ' + biblioteca.length);
  setEl('ia-footer-text', 'Tema ' + (index + 1) + ' de ' + biblioteca.length + ' · analizando…');
  setEl('badge-temas', (index + 1) + ' / ' + biblioteca.length);
  setEl('badge-sub',   'Tanda 1 · ' + tema.Estilo);
  setEl('time-total',  esCortina(tema) ? '0:' + CORTINA_DURACION_SEG : tema.Duracion);

  var fuente = tema.AudioURL ? '🎵 Drive' : '▶ YouTube';
  var html = '<span class="chip ch-' + (tema.Estilo||'').toLowerCase() + '">' + tema.Estilo + '</span>';
  if (tema.BPM > 0) html += '<span class="chip ch-gold">' + tema.BPM + ' BPM</span>';
  html += '<span class="chip ch-gold">Energía ' + (tema.Energia||'').toLowerCase() + '</span>';
  if (!esCortina(tema)) {
    html += '<span class="chip ch-cortina">Calidad: ' + (tema.Calidad||'Buena') + '</span>';
    html += '<span class="chip ch-cortina">' + (tema.Audio||'Mono') + '</span>';
    html += '<span class="chip ch-green">' + fuente + '</span>';
  }
  var chips = document.getElementById('now-chips');
  if (chips) chips.innerHTML = html;

  setEl('ia-texto', esCortina(tema)
    ? 'Cortina activa · se cortará automáticamente a los ' + CORTINA_DURACION_SEG + 's.'
    : 'Analizando la pista… la IA se actualizará en breve.');
  setEl('meta-lufs', '-16.1 LUFS'); setEl('meta-gain', '+2.8 dB');
  setEl('meta-tp',   '-1.2 dB');    setEl('meta-rd',   '9.4');
}

function actualizarContadorTemas() {
  setEl('m-tanda', (estadoPanel === 'playing' ? (indexActual + 1) : '0') + ' / ' + biblioteca.length);
}

function renderCola(temas) {
  var lista = document.getElementById('queue-list');
  if (!lista) return;
  if (!temas.length) {
    lista.innerHTML = '<div class="q-item"><div class="q-info"><div class="q-track">Cola vacía</div></div></div>';
    return;
  }
  lista.innerHTML = temas.map(function(t, i) {
    var esNext = i === 0, num = indexActual + i + 2;
    return '<div class="q-item ' + (esNext ? 'q-next' : '') + '">' +
      (esNext ? '<i class="ti ti-arrow-right q-arrow"></i>' : '<span class="q-num">' + num + '</span>') +
      '<div class="q-info"><div class="q-track">' + t.Titulo + ' · ' + t.Orquesta + '</div>' +
      '<div class="q-orq">' + (esCortina(t) ? '0:45' : t.Duracion) + ' · ' + (t.Energia||'').toLowerCase() + '</div></div>' +
      '<span class="chip ch-' + (t.Estilo||'').toLowerCase() + '">' + t.Estilo + '</span></div>';
  }).join('');
  renderProximaTanda(temas);
}

function renderProximaTanda(temas) {
  var lista = document.getElementById('proxima-list');
  if (!lista || !temas.length) return;
  var sug    = temas.filter(function(t){ return !esCortina(t); }).slice(0, 2);
  if (!sug.length) return;
  var badges = ['Alta conexión', 'Energía ideal'];
  lista.innerHTML = sug.map(function(t, i) {
    return '<div class="prox-item">' +
      '<div class="prox-info"><div class="prox-track">' + t.Titulo + ' · ' + t.Orquesta + '</div>' +
      '<div class="prox-orq">' + t.Estilo + ' · ' + t.Anio + '</div></div>' +
      '<span class="prox-badge">' + (badges[i]||'') + '</span></div>';
  }).join('');
}

function actualizarBotones() {
  var bi = document.getElementById('btn-iniciar');
  var bp = document.getElementById('btn-pausar');
  var bs = document.getElementById('btn-stop');
  if (!bi) return;
  if (estadoPanel === 'idle' || estadoPanel === 'stopped') {
    bi.disabled = !biblioteca.length; bi.innerHTML = '<i class="ti ti-player-play"></i> Iniciar Tanda';
    bp.disabled = true; bs.disabled = true;
  } else if (estadoPanel === 'playing') {
    bi.disabled = true; bp.disabled = false; bs.disabled = false;
    bp.innerHTML = '<i class="ti ti-player-pause"></i> Pausar';
  } else if (estadoPanel === 'paused') {
    bi.disabled = false; bi.innerHTML = '<i class="ti ti-player-play"></i> Continuar';
    bp.disabled = true; bs.disabled = false;
  }
}

function actualizarLiveBadge() {
  var b = document.getElementById('live-badge');
  if (!b) return;
  if (estadoPanel === 'playing')
    b.innerHTML = '<div class="live-dot"></div><span> En vivo · reproduciendo</span>';
  else if (estadoPanel === 'paused')
    b.innerHTML = '<div class="live-dot" style="background:#c9a84c;animation:none"></div><span> En pausa</span>';
  else
    b.innerHTML = '<div class="live-dot" style="background:#555;animation:none"></div><span> Detenido</span>';
}

// ── Progreso para YouTube (timer-based) ───────────────────────────────────
function iniciarProgress(tema) {
  if (progressTimer) clearInterval(progressTimer);
  var durStr   = esCortina(tema) ? '0:' + CORTINA_DURACION_SEG : (tema.Duracion || '0:00');
  var partes   = durStr.split(':');
  var totalSeg = (+partes[0]) * 60 + (+(partes[1] || 0));
  var curSeg   = 0;
  setEl('time-total', durStr);
  progressTimer = setInterval(function() {
    curSeg++;
    var pct = Math.min((curSeg / totalSeg) * 100, 100);
    var pf  = document.getElementById('progress-fill');
    var tc  = document.getElementById('time-current');
    if (pf) pf.style.width   = pct.toFixed(1) + '%';
    if (tc) tc.textContent   = Math.floor(curSeg / 60) + ':' + (curSeg % 60).toString().padStart(2, '0');
    var rest = totalSeg - curSeg;
    setEl('m-tiempo', Math.floor(rest / 60) + ':' + (rest % 60).toString().padStart(2, '0'));
    if (curSeg >= totalSeg) clearInterval(progressTimer);
  }, 1000);
}

function resetProgressUI() {
  var pf = document.getElementById('progress-fill');
  var tc = document.getElementById('time-current');
  var tt = document.getElementById('time-total');
  if (pf) pf.style.width = '0%';
  if (tc) tc.textContent = '0:00';
  if (tt) tt.textContent = '0:00';
  setEl('m-tiempo', '—');
}

function detenerTimers() {
  if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
  if (cortinaTimer)  { clearTimeout(cortinaTimer);   cortinaTimer  = null; }
}

// ══════════════════════════════════════════════════════════════════════════
// LECTURA DE PISTA (cámara)
// ══════════════════════════════════════════════════════════════════════════

async function fetchPista() {
  try {
    var res  = await fetch(CAMARA_GAS_URL + '?action=getPista');
    var data = await res.json();
    if (!Array.isArray(data)) return;
    historialPista = data; actualizarUIPista();
  } catch(e) { console.warn('Error leyendo pista:', e); }
}

function iniciarPollingPista() {
  if (pistaPollingTimer) return;
  fetchPista();
  pistaPollingTimer = setInterval(fetchPista, PISTA_POLLING_MS);
}

function actualizarUIPista() {
  if (!historialPista.length) return;
  var ultimo = historialPista[historialPista.length - 1];
  setEl('m-pista',    ultimo.personas != null ? ultimo.personas : '—');
  setEl('m-personas', ultimo.personas != null ? ultimo.personas : '—');
  var ref = buscarConteoHaceMinutos(ABANDONO_VENTANA_MIN);
  if (ref == null || !ultimo.personas) { setEl('m-pista-sub', 'sin referencia aún'); return; }
  var caida = ref > 0 ? Math.round(((ref - ultimo.personas) / ref) * 100) : 0;
  setEl('m-pista-sub', caida >= ABANDONO_UMBRAL_PCT
    ? '↓ ' + caida + '% · posible abandono'
    : ref + ' hace ' + ABANDONO_VENTANA_MIN + 'min');
  marcarAbandono(caida >= ABANDONO_UMBRAL_PCT, caida);
}

function buscarConteoHaceMinutos(min) {
  if (historialPista.length < 2) return null;
  var ahora = new Date(historialPista[historialPista.length - 1].timestamp);
  var obj   = ahora.getTime() - min * 60000;
  var mejor = null, menorD = Infinity;
  historialPista.forEach(function(r) {
    var d = Math.abs(new Date(r.timestamp).getTime() - obj);
    if (d < menorD) { menorD = d; mejor = r; }
  });
  return mejor ? mejor.personas : null;
}

function marcarAbandono(activo, pct) {
  var bar = document.getElementById('bar-abandono');
  var val = document.getElementById('pv-abandono');
  if (bar) bar.style.width = Math.min(Math.max(pct, 0), 100) + '%';
  if (val) val.textContent  = pct + '%';
}

// ══════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════

function extraerVideoId(url) {
  if (!url) return null;
  var m = url.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function setEl(id, val) {
  var el = document.getElementById(id);
  if (el) el.textContent = val;
}

function mostrarToast(msg) {
  var t = document.getElementById('manijero-toast');
  if (!t) {
    t = document.createElement('div'); t.id = 'manijero-toast';
    t.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#1A1008;color:#C9924A;border:1px solid rgba(201,146,74,0.4);border-radius:6px;padding:10px 18px;font-size:13px;z-index:9999;opacity:0;transition:opacity .3s;font-family:Oswald,sans-serif;letter-spacing:1px';
    document.body.appendChild(t);
  }
  t.textContent = msg; t.style.opacity = '1';
  setTimeout(function(){ t.style.opacity = '0'; }, 3000);
}

function mostrarEstadoCarga(msg) {
  var el = document.getElementById('carga-estado');
  if (!el) return;
  el.textContent = msg || ''; el.style.display = msg ? 'block' : 'none';
}

function finDeLaNoche() {
  estadoPanel = 'stopped';
  detenerAudio();
  actualizarBotones(); actualizarLiveBadge(); stopAudioSimulation(); activarRing(false);
  setEl('now-name', 'Fin de la milonga'); setEl('now-orq', 'Todos los temas reproducidos');
  setEl('ia-texto', '¡La noche terminó! Hasta la próxima.'); renderCola([]);
}

function updateClock() {
  var now   = new Date();
  var dias  = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  var meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  setEl('evento-hora',  now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0'));
  setEl('evento-fecha', dias[now.getDay()] + ' ' + now.getDate() + ' ' + meses[now.getMonth()]);
}

function initSliders() {
  ['vol','bass','treble'].forEach(function(id) {
    var s = document.getElementById(id);
    var o = document.getElementById(id + '-out');
    if (!s || !o) return;
    s.addEventListener('input', function() {
      o.textContent = Math.round(s.value);
      if (id === 'vol') {
        knobValue = parseInt(s.value);
        drawKnob(knobValue);
        if (audioEl) audioEl.volume = knobValue / 100;          // audio propio
        if (ytPlayer && ytReady) ytPlayer.setVolume(knobValue); // YouTube fallback
      }
    });
  });
}

function handleResize() {
  var wf = document.getElementById('waveform-canvas');
  var ev = document.getElementById('evolucion-canvas');
  if (wf) wf.width = wf.offsetWidth || 400;
  if (ev) { ev.width = ev.offsetWidth || 300; drawEvolucionChart(); }
}

// ── Arranque ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  updateClock();
  setInterval(updateClock, 30000);
  initSliders();
  initKnob();
  actualizarBotones();
  fetchBiblioteca();
  iniciarPollingPista();
  window.addEventListener('resize', handleResize);
  setTimeout(handleResize, 100);
});

console.log('El Manijero panel v1.2 · Drive audio + YouTube fallback · ¡A bailar!');
