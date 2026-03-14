export class ChispasSystem {
  constructor(overlayId) {
    this.overlay = document.getElementById(overlayId);
    this.receivedChispas = [];
    this.init();
  }

  init() {
    // Escuchar actualizaciones de tiempo para mostrar chispas programadas
    setInterval(() => this.checkScheduledChispas(), 1000);
    
    // Simulación: recibir chispa de prueba en 10 segundos
    setTimeout(() => this.simulateIncoming(), 10000);
  }

  simulateIncoming() {
    const chispa = {
      from: 'María',
      content: '😂',
      timestamp: 15, // Segundo 15 del video
      type: 'reaction'
    };
    this.receiveChispa(chispa);
  }

  receiveChispa(chispa) {
    this.receivedChispas.push(chispa);
    
    // Si estamos cerca del timestamp, mostrar inmediatamente
    const currentTime = window.NEXO.currentContext?.timestamp || 0;
    if (Math.abs(currentTime - chispa.timestamp) < 3) {
      this.showFloatingReaction(chispa);
    }
  }

  checkScheduledChispas() {
    const currentTime = window.NEXO.currentContext?.timestamp || 0;
    
    this.receivedChispas.forEach(chispa => {
      if (!chispa.shown && Math.abs(currentTime - chispa.timestamp) < 2) {
        chispa.shown = true;
        this.showFloatingReaction(chispa);
      }
    });
  }

  showFloatingReaction(chispa) {
    const bubble = document.createElement('div');
    bubble.className = 'reaction-bubble';
    bubble.innerHTML = `
      <span class="reaction-from">${chispa.from}</span>
      <span class="reaction-content">${chispa.content}</span>
    `;
    bubble.style.cssText = `
      position: absolute;
      left: 50%;
      bottom: 20%;
      transform: translateX(-50%);
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 12px 24px;
      border-radius: 24px;
      font-size: 1.2rem;
      animation: popIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      pointer-events: none;
      z-index: 60;
    `;
    
    this.overlay.appendChild(bubble);
    
    setTimeout(() => {
      bubble.style.animation = 'fadeOut 0.5s forwards';
      setTimeout(() => bubble.remove(), 500);
    }, 3000);
  }
}
