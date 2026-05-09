/**
 * JUMP Router v1.1-ARCH
 * Multi-hop message routing engine for NEXO Nearby mesh
 * REM v2.1: Agregado dispatch de nexo:nap:audit para visibilidad en pantalla
 */

function jumpREM(code, message, level = 'info') {
    console.log(`[JUMP_ROUTER][${code}] ${message}`);
    window.dispatchEvent(new CustomEvent('nexo:nap:audit', {
        detail: { code, message, level: level.toUpperCase(), timestamp: Date.now() }
    }));
}

class JumpRouter {
    constructor(options = {}) {
        this.maxHops = options.maxHops || 4;
        this.ttlDefault = options.ttlDefault || 4;
        this.dedupTTL = options.dedupTTL || 60000;
        this.processedIds = new Map();
        this.routingTable = new Map();
        this.onMessageDelivered = options.onMessageDelivered || (() => {});
        this.onMessageRelayed = options.onMessageRelayed || (() => {});
        this.onRouteUpdated = options.onRouteUpdated || (() => {});
        this.localUserId = options.localUserId || '';
        this.nearbyPlugin = null;
        this.jumpListener = null;
        this.connectedListener = null;
        this.disconnectedListener = null;
        this._cleanupInterval = null;
        this._isInitialized = false;
    }

    async init(nearbyPlugin, localUserId) {
        if (this._isInitialized) return true;
        this.nearbyPlugin = nearbyPlugin;
        this.localUserId = localUserId;

        jumpREM('JUMP-INIT-001', `JUMP Router initializing. localUserId=${localUserId?.substring(0,8) || 'null'}`, 'info');

        this.jumpListener = nearbyPlugin.addListener('onJumpMessageReceived', (result) => {
            this._handleJumpDelivered(result);
        });

        this.connectedListener = nearbyPlugin.addListener('onConnected', (result) => {
            jumpREM('JUMP-CONN-001', `Peer connected: ${result.endpointId?.substring(0,8)}`, 'success');
            this._updateRoutingTable(result.endpointId, result.userId, result.userName, 1);
        });

        this.disconnectedListener = nearbyPlugin.addListener('onDisconnected', (result) => {
            jumpREM('JUMP-DISC-001', `Peer disconnected: ${result.endpointId?.substring(0,8)}`, 'warn');
            this._removeFromRoutingTable(result.endpointId);
        });

        this._cleanupInterval = setInterval(() => this._cleanupOldIds(), 30000);
        this._isInitialized = true;
        jumpREM('JUMP-INIT-002', 'JUMP Router initialized OK', 'success');
        return true;
    }

    async sendJumpMessage(to, payload, maxHops = null) {
        if (!this.nearbyPlugin) {
            jumpREM('JUMP-SEND-001', 'Nearby plugin not available', 'error');
            throw new Error('[JUMP_ROUTER] Nearby plugin not available');
        }
        const hops = maxHops || this.maxHops;
        const directRoute = this._findDirectRoute(to);
        if (directRoute) {
            jumpREM('JUMP-SEND-002', `Direct route found to ${to?.substring(0,8)}, sending direct`, 'info');
            await this.nearbyPlugin.sendMessage({
                endpointId: directRoute.endpointId,
                message: payload
            });
            return { success: true, direct: true, hops: 0 };
        }
        jumpREM('JUMP-SEND-003', `No direct route to ${to?.substring(0,8)}, using JUMP relay (${hops} hops max)`, 'info');
        const result = await this.nearbyPlugin.sendJumpMessage({
            to: to,
            payload: payload,
            maxHops: hops
        });
        jumpREM('JUMP-SEND-004', `JUMP sent to ${result.sentToPeers || 0} peers, msgId=${result.messageId?.substring(0,8)}`, 'success');
        return {
            success: result.success,
            messageId: result.messageId,
            sentToPeers: result.sentToPeers,
            maxHops: result.maxHops,
            direct: false
        };
    }

    _handleJumpDelivered(result) {
        const { messageId, from, payload, route, hops } = result;
        jumpREM('JUMP-RX-001', `Message delivered! id=${messageId?.substring(0,8)} from=${from?.substring(0,8)} hops=${hops}`, 'success');
        this._updateRoutingTable(null, from, null, hops);
        this.onMessageDelivered({
            messageId,
            from,
            payload,
            route: JSON.parse(route || '[]'),
            hops,
            timestamp: Date.now()
        });
    }

    _updateRoutingTable(endpointId, userId, userName, hopCount) {
        if (!userId) return;
        const existing = this.routingTable.get(userId);
        if (!existing || hopCount < existing.hops) {
            this.routingTable.set(userId, {
                endpointId: endpointId || existing?.endpointId,
                userId,
                userName: userName || existing?.userName || 'NEXO',
                hops: hopCount,
                lastSeen: Date.now()
            });
            this.onRouteUpdated({ userId, hops: hopCount, endpointId });
            jumpREM('JUMP-ROUTE-001', `Route updated: ${userId?.substring(0,8)} via ${hopCount} hops`, 'info');
        }
    }

    _removeFromRoutingTable(endpointId) {
        for (const [userId, route] of this.routingTable.entries()) {
            if (route.endpointId === endpointId) {
                this.routingTable.delete(userId);
                jumpREM('JUMP-ROUTE-002', `Route removed: ${userId?.substring(0,8)} (disconnected)`, 'warn');
            }
        }
    }

    _findDirectRoute(userId) {
        const route = this.routingTable.get(userId);
        if (route && route.hops === 1 && route.endpointId) {
            return route;
        }
        return null;
    }

    getRoutingTable() {
        return Array.from(this.routingTable.values());
    }

    getRouteTo(userId) {
        return this.routingTable.get(userId) || null;
    }

    _cleanupOldIds() {
        const now = Date.now();
        let cleaned = 0;
        for (const [id, ts] of this.processedIds.entries()) {
            if (now - ts > this.dedupTTL) {
                this.processedIds.delete(id);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            jumpREM('JUMP-CLEAN-001', `Cleaned ${cleaned} old message IDs`, 'info');
        }
    }

    destroy() {
        if (this.jumpListener?.remove) this.jumpListener.remove();
        if (this.connectedListener?.remove) this.connectedListener.remove();
        if (this.disconnectedListener?.remove) this.disconnectedListener.remove();
        if (this._cleanupInterval) clearInterval(this._cleanupInterval);
        this.processedIds.clear();
        this.routingTable.clear();
        this._isInitialized = false;
        jumpREM('JUMP-DESTROY-001', 'JUMP Router destroyed', 'info');
    }
}

export { JumpRouter };
export default JumpRouter;
