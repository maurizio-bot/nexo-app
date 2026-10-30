/**
 * NEXO — Estado compartido del chat (sacado de main.js en la ronda 2752, sin cambios): a qué contacto pertenece cada
 * mensaje enviado (msgId → NEXO ID).
 */

export var _msgContactMap = {};

// Build 2835 (pedido del dueño): confirmaciones de lectura (el ✓✓ AZUL que mandás). Por defecto encendidas, como
// WhatsApp. Apagadas → este teléfono NO manda acuses de lectura, así que a tus contactos nunca les llega el ✓✓ azul
// de tus mensajes (el «entregado» gris sigue igual). Se guarda por teléfono en localStorage (no viaja).
export function readReceiptsOn() { try { return localStorage.getItem('nexo_read_receipts') !== '0'; } catch (e) { return true; } }
export function setReadReceiptsOn(on) { try { localStorage.setItem('nexo_read_receipts', on ? '1' : '0'); } catch (e) {} }
