/**
 * nexo_app.js v5.1.1-ACK-ES5
 * ACK + Read Receipt + Estados de entrega + Cola + UI
 * FIX: Clase ES5 compatible con new NexoApp(config) + exports nombrados
 */
function NexoApp(config) {
    'use strict';
    if (!(this instanceof NexoApp)) {
        return new NexoApp(config);
    }

    var self = this;
    self._config = config || {};
    self._activeChatMAC = null;
    self._chatMessages = {};
    self._messageStatus = {};
    self._unreadCounts = {};
    self._lastReadMessageId = {};
    self.bleInterface = (typeof bleInterface !== 'undefined') ? bleInterface : 
                        (typeof window !== 'undefined' && window.bleInterface) ? window.bleInterface : null;

    var STATUS = {
        SENDING: 'sending',
        SENT: 'sent',
        DELIVERED: 'delivered',
        READ: 'read',
        FAILED: 'failed',
        QUEUED: 'queued'
    };

    function _generateId() {
        return 'msg_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
    }

    function _macWithColons(mac) {
        if (!mac) return '';
        var m = mac.toString().toLowerCase().replace(/[^a-f0-9]/g, '');
        if (m.length !== 12) return mac;
        return m.match(/.{1,2}/g).join(':');
    }

    function _sanitizeHTML(str) {
        if (!str) return '';
        return str.toString()
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function _getStatusIcon(status) {
        if (status === STATUS.SENDING) return '<span class="msg-status sending">⏳</span>';
        if (status === STATUS.SENT) return '<span class="msg-status sent">✓</span>';
        if (status === STATUS.DELIVERED) return '<span class="msg-status delivered">✓✓</span>';
        if (status === STATUS.READ) return '<span class="msg-status read">✓✓</span>';
        if (status === STATUS.QUEUED) return '<span class="msg-status queued">⏸</span>';
        return '<span class="msg-status failed">!</span>';
    }

    function _renderMessage(msg, append) {
        var container = document.getElementById('chat-messages');
        if (!container) return;

        var bubbleClass = msg.isOwn ? 'msg-bubble own' : 'msg-bubble peer';
        var statusHtml = msg.isOwn ? _getStatusIcon(msg.status) : '';
        var timeStr = msg.time || new Date(msg.ts || Date.now()).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});

        var html = '<div class="' + bubbleClass + '" data-msg-id="' + _sanitizeHTML(msg.id) + '">' +
            '<div class="msg-text">' + _sanitizeHTML(msg.body) + '</div>' +
            '<div class="msg-meta">' + timeStr + ' ' + statusHtml + '</div>' +
            '</div>';

        if (append) {
            container.insertAdjacentHTML('beforeend', html);
            container.scrollTop = container.scrollHeight;
        } else {
            container.insertAdjacentHTML('afterbegin', html);
        }
    }

    function _updateMessageStatus(messageId, status) {
        if (!self._messageStatus[messageId]) self._messageStatus[messageId] = {};
        self._messageStatus[messageId].status = status;

        var el = document.querySelector('[data-msg-id="' + messageId + '"] .msg-meta');
        if (el) {
            var timeMatch = el.innerHTML.match(/^[^<]+/);
            var timeStr = timeMatch ? timeMatch[0].trim() : '';
            el.innerHTML = timeStr + ' ' + _getStatusIcon(status);
        }

        try {
            localStorage.setItem('nexo_msg_status_' + messageId, JSON.stringify(self._messageStatus[messageId]));
        } catch (e) {}
    }

    function _storeMessage(mac, msg) {
        var key = 'nexo_chat_' + mac;
        if (!self._chatMessages[mac]) {
            try {
                var stored = localStorage.getItem(key);
                self._chatMessages[mac] = stored ? JSON.parse(stored) : [];
            } catch (e) {
                self._chatMessages[mac] = [];
            }
        }
        self._chatMessages[mac].push(msg);
        if (self._chatMessages[mac].length > 200) {
            self._chatMessages[mac] = self._chatMessages[mac].slice(-200);
        }
        try {
            localStorage.setItem(key, JSON.stringify(self._chatMessages[mac]));
        } catch (e) {}
    }

    function _loadChatHistory(mac) {
        var container = document.getElementById('chat-messages');
        if (!container) return;
        container.innerHTML = '';

        var key = 'nexo_chat_' + mac;
        try {
            var stored = localStorage.getItem(key);
            self._chatMessages[mac] = stored ? JSON.parse(stored) : [];
        } catch (e) {
            self._chatMessages[mac] = [];
        }

        self._chatMessages[mac].forEach(function(msg) {
            _renderMessage(msg, true);
        });
    }

    function _sendReadReceiptsForUnread(mac) {
        if (!mac) return;
        var key = 'nexo_chat_' + mac;
        var msgs = [];
        try {
            var stored = localStorage.getItem(key);
            msgs = stored ? JSON.parse(stored) : [];
        } catch (e) { return; }

        var unreadIds = [];
        msgs.forEach(function(msg) {
            if (!msg.isOwn && msg.id && msg.status !== STATUS.READ) {
                unreadIds.push(msg.id);
                msg.status = STATUS.READ;
            }
        });

        if (unreadIds.length > 0 && self.bleInterface && self.bleInterface.sendReadReceipt) {
            self.bleInterface.sendReadReceipt(mac, unreadIds);
            try {
                localStorage.setItem(key, JSON.stringify(msgs));
            } catch (e) {}
        }
    }

    function _handleIncomingMessage(data) {
        var mac = _macWithColons(data.mac);
        var body = data.body || '';
        var messageId = data.messageId || _generateId();
        var ts = data.ts || Date.now();

        var msg = {
            id: messageId,
            body: body,
            ts: ts,
            isOwn: false,
            status: STATUS.DELIVERED,
            time: new Date(ts).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})
        };

        _storeMessage(mac, msg);

        if (self._activeChatMAC === mac) {
            _renderMessage(msg, true);
            _sendReadReceiptsForUnread(mac);
        } else {
            self._unreadCounts[mac] = (self._unreadCounts[mac] || 0) + 1;
            self.showNotification(mac, 'Nuevo mensaje', body);
            self.updateContactBadge(mac, self._unreadCounts[mac]);
        }
    }

    function _handleAck(data) {
        var messageId = data.messageId;
        if (!messageId) return;
        _updateMessageStatus(messageId, STATUS.DELIVERED);
    }

    function _handleRead(data) {
        var ids = data.messageIds || [];
        ids.forEach(function(id) {
            _updateMessageStatus(id, STATUS.READ);
        });
    }

    function _handleConnectionChange(data) {
        var mac = _macWithColons(data.mac);
        var status = data.status;
        if (status === 'connected') {
            self.updateStatusBar('CONECTADO: ' + (mac || 'NEXO Peer'));
        } else {
            self.updateStatusBar('DESCONECTADO');
        }
    }

    self.init = function() {
        if (!self.bleInterface || !self.bleInterface.init()) {
            console.error('[NexoApp] BLE interface not available');
            return false;
        }

        self.bleInterface.onMessageReceived(_handleIncomingMessage);
        self.bleInterface.onMessageAcked(_handleAck);
        self.bleInterface.onMessageRead(_handleRead);
        self.bleInterface.onConnectionChanged(_handleConnectionChange);

        self.bleInterface.requestPermissions().catch(function() {});

        return true;
    };

    self.openChat = function(mac) {
        var cleanMac = _macWithColons(mac);
        self._activeChatMAC = cleanMac;
        _loadChatHistory(cleanMac);
        _sendReadReceiptsForUnread(cleanMac);

        if (self.bleInterface && self.bleInterface.openChat) {
            self.bleInterface.openChat(cleanMac).catch(function(err) {
                console.warn('[NexoApp] openChat failed, messages will queue:', err);
            });
        }

        self.updateStatusBar('CONECTADO: ' + cleanMac);
    };

    self.sendMessage = function(text) {
        if (!self._activeChatMAC) {
            self.showToast('No hay chat activo');
            return;
        }
        if (!text || !text.trim()) return;

        var messageId = _generateId();
        var cleanMac = self._activeChatMAC;
        var ts = Date.now();

        var msg = {
            id: messageId,
            body: text.trim(),
            ts: ts,
            isOwn: true,
            status: STATUS.SENDING,
            time: new Date(ts).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})
        };

        _storeMessage(cleanMac, msg);
        _renderMessage(msg, true);

        if (!self.bleInterface || !self.bleInterface.sendChatMessage) {
            _updateMessageStatus(messageId, STATUS.FAILED);
            self.showToast('BLE no disponible');
            return;
        }

        self.bleInterface.sendChatMessage(cleanMac, text.trim()).then(function(result) {
            _updateMessageStatus(messageId, STATUS.SENT);
        }).catch(function(err) {
            if (err && err.queued) {
                _updateMessageStatus(messageId, STATUS.QUEUED);
                self.showToast('Sin conexion. Mensaje encolado.');
            } else {
                _updateMessageStatus(messageId, STATUS.FAILED);
                self.showToast('Error al enviar');
            }
        });
    };

    self.onChatVisible = function() {
        if (self._activeChatMAC) {
            _sendReadReceiptsForUnread(self._activeChatMAC);
        }
    };

    self.updateStatusBar = function(text) {
        var el = document.getElementById('status-bar');
        if (el) el.textContent = text || 'NEXO READY';
    };

    self.showToast = function(msg) {
        console.log('[Toast]', msg);
    };

    self.showNotification = function(mac, title, body) {
        console.log('[Notification]', mac, title, body);
    };

    self.updateContactBadge = function(mac, count) {
        console.log('[Badge]', mac, count);
    };

    self.getStatus = function() {
        return {
            activeChatMAC: self._activeChatMAC,
            initialized: true,
            bleAvailable: !!self.bleInterface
        };
    };

    return self;
}

var DEBUG = false;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { NexoApp: NexoApp, DEBUG: DEBUG };
}

if (typeof exports !== 'undefined') {
    exports.NexoApp = NexoApp;
    exports.DEBUG = DEBUG;
}

if (typeof window !== 'undefined') {
    window.NexoApp = NexoApp;
    window.DEBUG = DEBUG;
}
