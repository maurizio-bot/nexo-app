class TheStream {
  constructor(containerId) {
    if (!containerId || typeof containerId !== 'string') {
      containerId = 'message-container';
    }
    
    this.container = document.getElementById(containerId);
    
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = containerId;
      this.container.style.cssText = 'overflow-y: auto; height: calc(100vh - 200px); padding: 16px;';
      document.body.appendChild(this.container);
    }
    
    this.messageCache = new Map();
    this.avatarColors = new Map();
    this.initialized = true;
  }

  // MÉTODO QUE FALTABA - Restaurado
  setData(data) {
    if (Array.isArray(data)) {
      data.forEach(msg => this.renderMessage(msg));
    } else if (data) {
      this.renderMessage(data);
    }
  }

  generateAvatarSVG(sender, isMe) {
    const key = `${sender}-${isMe}`;
    if (this.avatarColors.has(key)) return this.avatarColors.get(key);
    
    const initial = (sender || 'U').charAt(0).toUpperCase();
    const color = isMe ? '#00FF88' : `hsl(${sender.split('').reduce((a,c) => a+c.charCodeAt(0),0)%360}, 70%, 50%)`;
    
    const svg = `<svg width="40" height="40" viewBox="0 0 40 40"><rect width="40" height="40" rx="12" fill="${color}" fill-opacity="0.2" stroke="${color}" stroke-width="2"/><text x="20" y="27" text-anchor="middle" font-family="system-ui" font-size="18" font-weight="600" fill="${color}">${initial}</text></svg>`;
    
    const uri = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
    this.avatarColors.set(key, uri);
    return uri;
  }

  renderMessage(message) {
    if (!this.container) return;
    if (message.id && this.messageCache.has(message.id)) return;
    if (message.id) this.messageCache.set(message.id, Date.now());
    if (!message.content || !String(message.content).trim()) return;

    const isMe = message.sender === 'Tú' || message.isMe;
    const bubble = document.createElement('div');
    bubble.style.cssText = `display:flex;gap:12px;margin-bottom:12px;padding:12px;border-radius:16px;background:${isMe?'rgba(0,255,136,0.1)':'rgba(255,255,255,0.05)'}`;
    bubble.innerHTML = `
      <img src="${this.generateAvatarSVG(message.sender, isMe)}" width="40" height="40" style="border-radius:12px;flex-shrink:0;">
      <div style="flex:1">
        <div style="font-weight:600;color:#fff;font-size:14px">${message.sender||'Unknown'}</div>
        <div style="color:#ddd;line-height:1.4">${this.escapeHtml(String(message.content))}</div>
        <div style="font-size:11px;color:#888;margin-top:4px">ahora</div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button style="background:rgba(255,255,255,0.1);border:none;border-radius:6px;padding:4px 8px">⚡</button>
          <button style="background:rgba(255,255,255,0.1);border:none;border-radius:6px;padding:4px 8px">↩️</button>
          <button style="background:rgba(255,255,255,0.1);border:none;border-radius:6px;padding:4px 8px">↗️</button>
        </div>
      </div>
    `;
    
    this.container.appendChild(bubble);
    this.container.scrollTop = this.container.scrollHeight;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

export { TheStream };
