/**
 * JUMP Router v1.0-ARCH
 * Multi-hop message routing engine for NEXO Nearby mesh
 */

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

    this.jumpListener = nearbyPlugin.addListener('onJumpMessageReceived', (result) => {
      this._handleJumpDelivered(result);
    });

    this.connectedListener = nearbyPlugin.addListener('onConnected', (result) => {
      this._updateRoutingTable(result.endpointId, result.userId, result.userName, 1);
    });

    this.disconnectedListener = nearbyPlugin.addListener('onDisconnected', (result) => {
      this._removeFromRoutingTable(result.endpointId);
    });

    this._cleanupInterval = setInterval(() => this._cleanupOldIds(), 30000);
    this._isInitialized = true;
    console.log('[JUMP_ROUTER] Initialized');
    return true;
  }

  async sendJumpMessage(to, payload, maxHops = null) {
    if (!this.nearbyPlugin) {
      throw new Error('[JUMP_ROUTER] Nearby plugin not available');
    }
    const hops = maxHops || this.maxHops;
    const directRoute = this._findDirectRoute(to);
    if (directRoute) {
      console.log(`[JUMP_ROUTER] Direct route found to ${to}, sending direct`);
      await this.nearbyPlugin.sendMessage({
        endpointId: directRoute.endpointId,
        message: payload
      });
      return { success: true, direct: true, hops: 0 };
    }
    console.log(`[JUMP_ROUTER] No direct route to ${to}, using JUMP relay (${hops} hops max)`);
    const result = await this.nearbyPlugin.sendJumpMessage({
      to: to,
      payload: payload,
      maxHops: hops
    });
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
    console.log(`[JUMP_ROUTER] Message delivered! id=${messageId?.substring(0,8)} from=${from} hops=${hops}`);
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
      console.log(`[JUMP_ROUTER] Route updated: ${userId} via ${hopCount} hops`);
    }
  }

  _removeFromRoutingTable(endpointId) {
    for (const [userId, route] of this.routingTable.entries()) {
      if (route.endpointId === endpointId) {
        this.routingTable.delete(userId);
        console.log(`[JUMP_ROUTER] Route removed: ${userId} (disconnected)`);
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
      console.log(`[JUMP_ROUTER] Cleaned ${cleaned} old message IDs`);
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
    console.log('[JUMP_ROUTER] Destroyed');
  }
}

export { JumpRouter };
export default JumpRouter;
