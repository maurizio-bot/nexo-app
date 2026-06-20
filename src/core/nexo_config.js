/**
 * NEXO Configuration v1.0
 * ÚNICA fuente de verdad para constantes, UUIDs, estados y validaciones.
 * Si necesitas cambiar algo, cambia aquí. No hardcodees en otros archivos.
 */

var NEXO_CONFIG = (function() {
    'use strict';

    // ============================================
    // BLE UUIDs (16-bit como strings completos)
    // ============================================
    var UUIDS = {
        SERVICE: '0000abcd-0000-1000-8000-00805f9b34fb',
        RX: '0000abce-0000-1000-8000-00805f9b34fb',
        TX: '0000abcf-0000-1000-8000-00805f9b34fb',
        CCCD: '00002902-0000-1000-8000-00805f9b34fb'
    };

    // ============================================
    // Estados de dispositivo BLE
    // ============================================
    var DEVICE_STATE = {
        DISCONNECTED: 0,
        CONNECTING: 1,
        CONNECTED: 2,
        READY: 3,
        ERROR: -1
    };

    // ============================================
    // Estados de scan
    // ============================================
    var SCAN_STATE = {
        IDLE: 0,
        SCANNING: 1,
        STOPPED: 2
    };

    // ============================================
    // Estados de advertise
    // ============================================
    var ADVERTISE_STATE = {
        IDLE: 0,
        ADVERTISING: 1,
        STOPPED: 2
    };

    // ============================================
    // Eventos del plugin nativo
    // ============================================
    var EVENTS = {
        ON_DEVICE_FOUND: 'onDeviceFound',
        ON_PAYLOAD_RECEIVED: 'onPayloadReceived',
        ON_ADVERTISE_STARTED: 'onAdvertiseStarted',
        ON_SERVER_READY: 'onServerReady',
        ON_SCAN_FAILED: 'onScanFailed',
        ON_DEVICE_CONNECTED: 'onDeviceConnected',
        ON_DEVICE_DISCONNECTED: 'onDeviceDisconnected',
        ON_SERVICES_READY: 'onServicesReady',
        ON_NOTIFICATIONS_ENABLED: 'onNotificationsEnabled',
        ON_REM_LOG: 'onRemLog',
        ON_PERMISSION_STATUS_CHANGED: 'onPermissionStatusChanged',
        ON_ADVERTISE_FAILED: 'onAdvertiseFailed',
        ON_CONNECTION_FAILED: 'onConnectionFailed'
    };

    // ============================================
    // Permisos BLE
    // ============================================
    var PERMISSIONS = {
        BLUETOOTH: 'android.permission.BLUETOOTH',
        BLUETOOTH_ADMIN: 'android.permission.BLUETOOTH_ADMIN',
        BLUETOOTH_SCAN: 'android.permission.BLUETOOTH_SCAN',
        BLUETOOTH_CONNECT: 'android.permission.BLUETOOTH_CONNECT',
        BLUETOOTH_ADVERTISE: 'android.permission.BLUETOOTH_ADVERTISE',
        ACCESS_FINE_LOCATION: 'android.permission.ACCESS_FINE_LOCATION',
        ACCESS_COARSE_LOCATION: 'android.permission.ACCESS_COARSE_LOCATION'
    };

    // ============================================
    // Validaciones
    // ============================================
    function isValidMac(mac) {
        if (!mac || typeof mac !== 'string') return false;
        // MAC address format: XX:XX:XX:XX:XX:XX
        var macRegex = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;
        return macRegex.test(mac);
    }

    function isValidDeviceId(id) {
        return id !== null && id !== undefined && (typeof id === 'string' || typeof id === 'number');
    }

    function isValidUUID(uuid) {
        if (!uuid || typeof uuid !== 'string') return false;
        var uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        return uuidRegex.test(uuid);
    }

    function isValidMessage(msg) {
        return msg !== null && msg !== undefined && typeof msg === 'string' && msg.length > 0;
    }

    // ============================================
    // Assert para debugging (no rompe en producción)
    // ============================================
    function assert(condition, message) {
        if (!condition) {
            var errorMsg = '[NEXO ASSERT] ' + (message || 'Condición fallida');
            console.error(errorMsg);
            
            // Si estamos en desarrollo web, alerta
            if (typeof window !== 'undefined' && window.location && window.location.hostname === 'localhost') {
                // Solo alert en localhost, nunca en APK
                try {
                    // Silencioso en producción
                } catch (e) {}
            }
            
            // Log adicional para diagnóstico
            if (typeof console !== 'undefined' && console.trace) {
                console.trace();
            }
        }
        return condition;
    }

    // Assert que lanza error (para casos críticos)
    function assertCritical(condition, message) {
        if (!condition) {
            var errorMsg = '[NEXO CRITICAL] ' + (message || 'Error crítico');
            console.error(errorMsg);
            throw new Error(errorMsg);
        }
        return condition;
    }

    // ============================================
    // Helpers de conversión
    // ============================================
    function macToId(mac) {
        if (!isValidMac(mac)) return null;
        return mac.toLowerCase().replace(/:/g, '');
    }

    function idToMac(id) {
        if (!id || typeof id !== 'string' || id.length !== 12) return null;
        return id.match(/.{1,2}/g).join(':').toUpperCase();
    }

    // ============================================
    // Timeout defaults (ms)
    // ============================================
    var TIMEOUTS = {
        SCAN: 10000,           // 10 segundos
        CONNECT: 15000,        // 15 segundos
        DISCOVER_SERVICES: 5000, // 5 segundos
        SEND_MESSAGE: 5000,    // 5 segundos
        SPLASH_HIDE: 3000      // 3 segundos
    };

    // ============================================
    // Colores NEXO (para referencia centralizada)
    // ============================================
    var COLORS = {
        BACKGROUND: '#000000',
        OWN_MESSAGE: '#4169E1',      // Royal Blue
        DEVICE_MESSAGE: '#191970',     // Midnight Navy
        TEXT_PRIMARY: '#FFFFFF',
        TEXT_SECONDARY: '#AAAAAA',
        ACCENT: '#00FF88',
        ERROR: '#FF4444',
        WARNING: '#FFAA00'
    };

    // ============================================
    // Versión
    // ============================================
    var VERSION = {
        MAJOR: 9,
        MINOR: 1,
        PATCH: 0,
        BUILD: 1273,
        toString: function() {
            return this.MAJOR + '.' + this.MINOR + '.' + this.PATCH + '-b' + this.BUILD;
        }
    };

    // ============================================
    // API pública
    // ============================================
    return {
        UUIDS: UUIDS,
        DEVICE_STATE: DEVICE_STATE,
        SCAN_STATE: SCAN_STATE,
        ADVERTISE_STATE: ADVERTISE_STATE,
        EVENTS: EVENTS,
        PERMISSIONS: PERMISSIONS,
        TIMEOUTS: TIMEOUTS,
        COLORS: COLORS,
        VERSION: VERSION,
        
        // Validaciones
        isValidMac: isValidMac,
        isValidDeviceId: isValidDeviceId,
        isValidUUID: isValidUUID,
        isValidMessage: isValidMessage,
        
        // Asserts
        assert: assert,
        assertCritical: assertCritical,
        
        // Helpers
        macToId: macToId,
        idToMac: idToMac
    };

})();
