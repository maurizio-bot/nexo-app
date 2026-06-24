/**
 * ble_interface.js v5.1.0-ACK-ES5
 * Dual GATT + ACK + Read Receipt + Retry Queue
 */
var bleInterface = (function() {
    'use strict';

    var nativePlugin = null;
    var isScanning = false;
    var foundDevices = {};
    var connectedDevices = {};
    var callbacks = {};
    var _pendingQueue = [];
    var _messageListeners = [];
    var _ackListeners = [];
    var _readListeners = [];
    var _connListeners = [];

    // UUIDs 16-bit NEXO
    var SERVICE_UUID = '0000abcd-0000-1000-8000-00805f9b34fb';
    var RX_CHAR_UUID = '0000abce-0000-1000-8000-00805f9b34fb';
    var TX_CHAR_UUID = '0000abcf-0000-1000-8000-00805f9b34fb';
    var CCCD_UUID = '00002902-0000-1000-8000-00805f9b34fb';

    function _generateMessageId() {
        return 'msg_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
    }

    function _macWithColons(mac) {
        if (!mac) return '';
        var m = mac.toString().toLowerCase().replace(/[^a-f0-9]/g, '');
        if (m.length !== 12) return mac;
        return m.match(/.{1,2}/g).join(':');
    }

    function _safeNativeCall(method, args) {
        if (!nativePlugin || typeof nativePlugin[method] !== 'function') {
            return Promise.reject('Native plugin not ready: ' + method);
        }
        try {
            if (args && typeof args === 'object' && !Array.isArray(args)) {
                return nativePlugin[method](args);
            }
            return nativePlugin[method](args);
        } catch (e) {
            return Promise.reject(e);
        }
    }

    function _notify(type, data) {
        if (type === 'message') {
            _messageListeners.forEach(function(fn) { try { fn(data); } catch(e) {} });
        } else if (type === 'ack') {
            _ackListeners.forEach(function(fn) { try { fn(data); } catch(e) {} });
        } else if (type === 'read') {
            _readListeners.forEach(function(fn) { try { fn(data); } catch(e) {} });
        } else if (type === 'connected') {
            _connListeners.forEach(function(fn) { try { fn(data); } catch(e) {} });
        }
    }

    function _parseIncomingPayload(raw) {
        try {
            var payload = JSON.parse(raw);
            if (!payload || !payload.t) return null;
            return payload;
        } catch (e) {
            // Legacy plain text fallback
            return { t: 'MSG', id: _generateMessageId(), body: raw, ts: Date.now() };
        }
    }

    function _sendAck(mac, messageId) {
        var ack = JSON.stringify({ t: 'ACK', id: messageId, ts: Date.now() });
        _safeNativeCall('sendMessage', { deviceId: mac, message: ack }).catch(function() {});
    }

    function _sendReadReceipt(mac, messageIds) {
        if (!messageIds || messageIds.length === 0) return;
        var read = JSON.stringify({ t: 'READ', ids: messageIds, ts: Date.now() });
        _safeNativeCall('sendMessage', { deviceId: mac, message: read }).catch(function() {});
    }

    function _enqueuePending(messageId, mac, payload) {
        var exists = _pendingQueue.some(function(item) {
            return item.messageId === messageId;
        });
        if (!exists) {
            _pendingQueue.push({
                messageId: messageId,
                mac: mac,
                payload: payload,
                retries: 0,
                ts: Date.now()
            });
        }
    }

    function _processPendingQueue() {
        if (_pendingQueue.length === 0) return;
        var queue = _pendingQueue.slice();
        _pendingQueue = [];
        queue.forEach(function(item) {
            if (item.retries < 5) {
                item.retries += 1;
                sendChatMessage(item.mac, null, item.payload, item.messageId).catch(function() {
                    _enqueuePending(item.messageId, item.mac, item.payload);
                });
            }
        });
    }

    function init() {
        nativePlugin = Capacitor && Capacitor.Plugins && Capacitor.Plugins.NexoBLE;
        if (!nativePlugin) {
            console.warn('[BLE] NexoBLE plugin not found');
            return false;
        }

        nativePlugin.addListener('onDeviceFound', function(result) {
            var mac = _macWithColons(result.deviceId || result.address);
            if (!mac || foundDevices[mac]) return;
            foundDevices[mac] = {
                mac: mac,
                name: result.name || 'NEXO Peer',
                rssi: result.rssi || 0,
                uuid: result.uuid || ''
            };
            if (callbacks.onDeviceFound) callbacks.onDeviceFound(foundDevices[mac]);
        });

        nativePlugin.addListener('onDeviceConnected', function(result) {
            var mac = _macWithColons(result.deviceId || result.address);
            if (!mac) return;
            connectedDevices[mac] = { mac: mac, connected: true, ts: Date.now() };
            _notify('connected', { mac: mac, status: 'connected' });
            if (callbacks.onDeviceConnected) callbacks.onDeviceConnected(mac);
            // Retry queued messages upon reconnection
            setTimeout(_processPendingQueue, 800);
        });

        nativePlugin.addListener('onDeviceDisconnected', function(result) {
            var mac = _macWithColons(result.deviceId || result.address);
            if (!mac) return;
            if (connectedDevices[mac]) connectedDevices[mac].connected = false;
            _notify('connected', { mac: mac, status: 'disconnected' });
            if (callbacks.onDeviceDisconnected) callbacks.onDeviceDisconnected(mac);
        });

        nativePlugin.addListener('onPayloadReceived', function(result) {
            var mac = _macWithColons(result.deviceId || result.address);
            var raw = result.payload || result.message || '';
            var payload = _parseIncomingPayload(raw);
            if (!payload) return;

            if (payload.t === 'MSG') {
                // Auto-ACK
                if (mac && payload.id) {
                    _sendAck(mac, payload.id);
                }
                _notify('message', {
                    mac: mac,
                    messageId: payload.id,
                    body: payload.body || raw,
                    ts: payload.ts || Date.now(),
                    isOwn: false
                });
                if (callbacks.onPayloadReceived) {
                    callbacks.onPayloadReceived(mac, payload.body || raw);
                }
            } else if (payload.t === 'ACK') {
                _notify('ack', { messageId: payload.id, mac: mac, ts: payload.ts });
            } else if (payload.t === 'READ') {
                _notify('read', { messageIds: payload.ids || [], mac: mac, ts: payload.ts });
            }
        });

        nativePlugin.addListener('onScanFailed', function() {
            isScanning = false;
            if (callbacks.onScanFailed) callbacks.onScanFailed();
        });

        nativePlugin.addListener('onAdvertiseStarted', function() {
            if (callbacks.onAdvertiseStarted) callbacks.onAdvertiseStarted();
        });

        nativePlugin.addListener('onServerReady', function() {
            if (callbacks.onServerReady) callbacks.onServerReady();
        });

        nativePlugin.addListener('onConnectionFailed', function(result) {
            var mac = _macWithColons(result.deviceId || result.address);
            if (callbacks.onConnectionFailed) callbacks.onConnectionFailed(mac);
        });

        return true;
    }

    function requestPermissions() {
        return _safeNativeCall('checkBLEStatus', {}).then(function(status) {
            if (status && status.allGranted) return status;
            return _safeNativeCall('initializeBLE', {});
        });
    }

    function startScan() {
        if (isScanning) return Promise.resolve();
        isScanning = true;
        foundDevices = {};
        return _safeNativeCall('startScan', { serviceUuid: SERVICE_UUID });
    }

    function stopScan() {
        isScanning = false;
        return _safeNativeCall('stopScan', {});
    }

    function connectToDevice(mac) {
        var cleanMac = _macWithColons(mac);
        return _safeNativeCall('connectToDevice', { deviceId: cleanMac }).then(function() {
            connectedDevices[cleanMac] = { mac: cleanMac, connected: true, ts: Date.now() };
            return cleanMac;
        });
    }

    function disconnectDevice(mac) {
        var cleanMac = _macWithColons(mac);
        return _safeNativeCall('disconnectDevice', { deviceId: cleanMac }).then(function() {
            if (connectedDevices[cleanMac]) connectedDevices[cleanMac].connected = false;
            return cleanMac;
        });
    }

    /**
     * sendChatMessage(mac, text, prebuiltPayload, prebuiltId)
     * Returns promise that resolves with { messageId, status }
     */
    function sendChatMessage(mac, text, prebuiltPayload, prebuiltId) {
        var cleanMac = _macWithColons(mac);
        var messageId = prebuiltId || _generateMessageId();
        var payload = prebuiltPayload || JSON.stringify({
            t: 'MSG',
            id: messageId,
            ts: Date.now(),
            body: text || ''
        });

        return new Promise(function(resolve, reject) {
            _safeNativeCall('sendMessage', { deviceId: cleanMac, message: payload })
                .then(function() {
                    resolve({ messageId: messageId, status: 'sent' });
                })
                .catch(function(err) {
                    // Enqueue for retry on reconnection
                    _enqueuePending(messageId, cleanMac, payload);
                    reject({ messageId: messageId, error: err, queued: true });
                });
        });
    }

    function openChat(mac) {
        var cleanMac = _macWithColons(mac);
        return connectToDevice(cleanMac).catch(function() {
            // Even if GATT connect fails, allow chat; messages will queue
            return cleanMac;
        });
    }

    function updateStatus() {
        return _safeNativeCall('getConnectedDevices', {}).then(function(result) {
            var devices = result && result.devices ? result.devices : [];
            var count = 0;
            devices.forEach(function(dev) {
                var mac = _macWithColons(dev.deviceId || dev.address);
                if (mac) {
                    connectedDevices[mac] = { mac: mac, connected: true, ts: Date.now() };
                    count++;
                }
            });
            return { connectedCount: count, devices: devices };
        }).catch(function() {
            return { connectedCount: 0, devices: [] };
        });
    }

    function getConnectedDevices() {
        return Object.keys(connectedDevices).map(function(k) { return connectedDevices[k]; });
    }

    function isDeviceConnected(mac) {
        var cleanMac = _macWithColons(mac);
        return !!(connectedDevices[cleanMac] && connectedDevices[cleanMac].connected);
    }

    function onMessageReceived(fn) {
        if (typeof fn === 'function') _messageListeners.push(fn);
    }

    function onMessageAcked(fn) {
        if (typeof fn === 'function') _ackListeners.push(fn);
    }

    function onMessageRead(fn) {
        if (typeof fn === 'function') _readListeners.push(fn);
    }

    function onConnectionChanged(fn) {
        if (typeof fn === 'function') _connListeners.push(fn);
    }

    function setCallbacks(cbs) {
        if (cbs) callbacks = cbs;
    }

    function sendReadReceipt(mac, messageIds) {
        _sendReadReceipt(_macWithColons(mac), messageIds);
    }

    return {
        init: init,
        requestPermissions: requestPermissions,
        startScan: startScan,
        stopScan: stopScan,
        connectToDevice: connectToDevice,
        disconnectDevice: disconnectDevice,
        sendChatMessage: sendChatMessage,
        openChat: openChat,
        updateStatus: updateStatus,
        getConnectedDevices: getConnectedDevices,
        isDeviceConnected: isDeviceConnected,
        onMessageReceived: onMessageReceived,
        onMessageAcked: onMessageAcked,
        onMessageRead: onMessageRead,
        onConnectionChanged: onConnectionChanged,
        setCallbacks: setCallbacks,
        sendReadReceipt: sendReadReceipt,
        SERVICE_UUID: SERVICE_UUID,
        RX_CHAR_UUID: RX_CHAR_UUID,
        TX_CHAR_UUID: TX_CHAR_UUID
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = bleInterface;
}
