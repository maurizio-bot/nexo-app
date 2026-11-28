// Fase 1 del contrato de los caminos (docs/CONTRATO_CAMINOS_28-11.md §A.6, §B.2.4, §B.4.1): las LISTAS CERRADAS que usan el calendario,
// el estado por contacto y los diagnósticos. PURO (solo datos y traducciones). PORQUÉ: con listas cerradas cada «no» de un camino cae en
// un cajón conocido y hace siempre lo mismo; un `DESCONOCIDO` en un diagnóstico es un fallo a tipificar, no un caso que se arregla con
// otro parche. Kotlin usa los mismos nombres (vectores tests/vectores/calendario.json).

// A.6.1 Causas de un error de camino
export const CAUSAS = Object.freeze(['ENLACE_CAIDO', 'SIN_AVANCE', 'LIMITADO', 'CASTIGADO', 'POLITICA', 'INVALIDO', 'OCUPADO_LOCAL',
  'OCUPADO_REMOTO', 'APP_CALLA', 'CIFRADO_DESFASE', 'EXCEDE_TAMANO', 'SIN_CAPACIDAD', 'RADIO_APAGADA', 'SIN_PERMISO', 'SIN_RED', 'SIN_RUTA',
  'MTU_MINIMA', 'CANCELADO', 'CUPO_PROPIO', 'DESCONOCIDO']);

// A.6.2 El tipo de error de cada causa (lo que hace el calendario con él)
var TIPO_DE = {
  OCUPADO_LOCAL: 'OCUPADO', OCUPADO_REMOTO: 'OCUPADO',
  ENLACE_CAIDO: 'FALLO', SIN_AVANCE: 'FALLO', INVALIDO: 'FALLO', CIFRADO_DESFASE: 'FALLO', DESCONOCIDO: 'FALLO', MTU_MINIMA: 'FALLO',
  LIMITADO: 'LIMITADO', CASTIGADO: 'LIMITADO', CUPO_PROPIO: 'LIMITADO',
  APP_CALLA: 'DORMIDO',
  SIN_RUTA: 'SIN_CAMINO', RADIO_APAGADA: 'SIN_CAMINO', SIN_RED: 'SIN_CAMINO', SIN_PERMISO: 'SIN_CAMINO',
  POLITICA: 'NO_REINTENTAR', EXCEDE_TAMANO: 'NO_REINTENTAR', SIN_CAPACIDAD: 'NO_REINTENTAR',
  CANCELADO: 'CANCELADO',
};
export const TIPOS_ERROR = Object.freeze(['OCUPADO', 'FALLO', 'LIMITADO', 'DORMIDO', 'SIN_CAMINO', 'NO_REINTENTAR', 'CANCELADO']);
export function tipoDe(causa) { return TIPO_DE[causa] || 'FALLO'; }
// ¿Cuenta como fallo del camino con ESE contacto? Solo FALLO (lo del relé, lo ocupado o el que duerme no es culpa del camino)
export function cuentaComoFallo(causa) { return tipoDe(causa) === 'FALLO'; }

// Un ErrorCamino completo (A.6.2)
export function error(causa, esperaMs, alcance) {
  if (CAUSAS.indexOf(causa) < 0) causa = 'DESCONOCIDO';
  var t = tipoDe(causa);
  return { tipo: t, causa: causa, esperaMs: typeof esperaMs === 'number' ? esperaMs : null,
    alcance: alcance || (t === 'LIMITADO' || t === 'NO_REINTENTAR' ? 'carril-todos' : t === 'SIN_CAMINO' ? 'contacto' : 'envio'),
    reintentable: t !== 'NO_REINTENTAR' && t !== 'CANCELADO' };
}

// La respuesta de un relé Nostr («OK id true/false msg») → { aceptado } o { error } (A.6.2, última tabla)
export function deRele(ok, msg) {
  var m = String(msg || '');
  if (ok || /^duplicate:/i.test(m)) return { aceptado: true };
  if (/^invalid:/i.test(m)) return { error: error('INVALIDO') };
  if (/web of trust|not in our|policy|pubkey is not|whitelist|allowlist|paid|payment|^pow:|^blocked:|^restricted:/i.test(m)) return { error: error('POLITICA') };
  if (/banned/i.test(m)) return { error: error('CASTIGADO') };
  if (/rate.?limit|slow down|too many|too fast/i.test(m)) return { error: error('LIMITADO') };
  if (/^auth-required:/i.test(m)) return { error: error('DESCONOCIDO'), auth: true };
  return { error: error('DESCONOCIDO') };
}

// B.2.4 Causas de CAMBIO de camino (cualquier otra cosa no es causa)
export const CAMBIOS = Object.freeze(['CAIDA', 'SIN_ACK', 'SIN_AVANCE', 'RECHAZO', 'RECHAZO_TODOS', 'DEGRADADO_SOSTENIDO', 'MEJOR_ESTABLE',
  'CAPACIDAD', 'COSTE', 'SALTO_FALLA', 'RELE_PERDIO', 'LISTA_NUEVA', 'CADUCA', 'USUARIO', 'FIJADO_ANTIOSCILACION']);
// Las que rompen la permanencia y el freno de oscilación (B.3.3/B.3.4)
export const CAMBIOS_FORZOSOS = Object.freeze(['CAIDA', 'SIN_AVANCE', 'USUARIO']);
// Las que solo valen para lo GUARDADO (republicar el MISMO evento en otro relé de su lista)
export const REPUBLICAR_POR = Object.freeze(['RELE_PERDIO', 'LISTA_NUEVA', 'CADUCA']);

// B.4.1 Estados de un mensaje y motivos de pausa
export const ESTADOS = Object.freeze(['CREADO', 'EN_CAMINO', 'PAUSADO', 'GUARDADO', 'ENTREGADO', 'LEIDO']);
export const PAUSAS = Object.freeze(['SIN_CAMINO', 'LIMITADO', 'ESPERA_WIFI', 'SIN_CAPACIDAD', 'CUPO']);
// Lo que ve el usuario de cada estado
export function marca(estado) { return estado === 'LEIDO' ? 'leido' : estado === 'ENTREGADO' ? '✓✓' : estado === 'GUARDADO' ? '✓' : 'pendiente'; }
// UNA sola definición de «reenviable» (B.4.5: reemplaza a _isResendable y a vaultGetPendingMessages)
export function reenviable(m) { return !!m && !m.borrado && m.estado !== 'ENTREGADO' && m.estado !== 'LEIDO'; }
