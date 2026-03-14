export class GestureEngine {
  constructor(streamEl, vaultEl) {
    this.stream = streamEl;
    this.vault = vaultEl;
    this.isDragging = false;
    this.startX = 0;
    this.currentX = 0;
    this.offset = 0; // 0 a 1
    
    this.init();
  }

  init() {
    // Zona de activación: borde derecho 40px
    document.addEventListener('touchstart', this.handleStart.bind(this), {passive: false});
    document.addEventListener('touchmove', this.handleMove.bind(this), {passive: false});
    document.addEventListener('touchend', this.handleEnd.bind(this));
    
    // Mouse support
    document.addEventListener('mousedown', this.handleStart.bind(this));
    document.addEventListener('mousemove', this.handleMove.bind(this));
    document.addEventListener('mouseup', this.handleEnd.bind(this));
  }

  handleStart(e) {
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    const edgeZone = window.innerWidth - 60;
    
    // Solo activar si toca borde derecho O si vault ya está abierto (arrastrar para cerrar)
    if (x < edgeZone && this.offset < 0.1) return;
    
    this.isDragging = true;
    this.startX = x;
    this.currentX = x;
    
    // Preparar para animación fluida
    this.stream.style.transition = 'none';
    this.vault.style.transition = 'none';
  }

  handleMove(e) {
    if (!this.isDragging) return;
    e.preventDefault();
    
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    const delta = x - this.startX;
    const width = window.innerWidth;
    
    // Calcular offset (0 = cerrado, 1 = abierto)
    // Delta negativo (izquierda) abre el vault
    this.offset = Math.max(0, Math.min(1, -delta / (width * 0.7)));
    
    this.render();
  }

  handleEnd() {
    if (!this.isDragging) return;
    this.isDragging = false;
    
    // Snap con momentum
    if (this.offset > 0.3) {
      this.animateTo(1); // Abrir
      window.dispatchEvent(new Event('nexo:vault:opened'));
    } else {
      this.animateTo(0); // Cerrar
      window.dispatchEvent(new Event('nexo:vault:closed'));
    }
  }

  animateTo(target) {
    const start = this.offset;
    const diff = target - start;
    const duration = 300;
    const startTime = performance.now();
    
    const animate = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const ease = 1 - Math.pow(1 - progress, 3);
      
      this.offset = start + (diff * ease);
      this.render();
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };
    
    requestAnimationFrame(animate);
  }

  render() {
    // Stream se mueve -20%, Vault entra desde derecha
    const streamX = -(this.offset * 20);
    const vaultX = 100 - (this.offset * 100);
    
    this.stream.style.transform = `translateX(${streamX}%) scale(${1 - this.offset * 0.02})`;
    this.stream.style.filter = `brightness(${1 - this.offset * 0.2})`;
    
    this.vault.style.transform = `translateX(${vaultX}%)`;
  }
}
