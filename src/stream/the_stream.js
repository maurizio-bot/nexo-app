export class TheStream {
  constructor(videoId, containerId) {
    this.video = document.getElementById(videoId);
    this.container = document.getElementById(containerId);
    this.feed = [
      { url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4', title: 'Big Buck Bunny', duration: 596 },
      { url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4', title: 'Elephants Dream', duration: 653 }
    ];
    this.currentIndex = 0;
    
    this.init();
  }

  init() {
    this.loadVideo(0);
    
    // Cuando termina, siguiente
    this.video.addEventListener('ended', () => this.nextVideo());
    
    // Actualizar timestamp para Chispas cada segundo
    setInterval(() => this.updateContext(), 1000);
  }

  loadVideo(index) {
    if (index >= this.feed.length) index = 0;
    this.currentIndex = index;
    const item = this.feed[index];
    
    this.video.src = item.url;
    this.video.play().catch(e => console.log('Autoplay prevented:', e));
    
    // Actualizar contexto global
    window.NEXO.currentContext = {
      videoId: index,
      title: item.title,
      timestamp: 0,
      duration: item.duration
    };
  }

  nextVideo() {
    this.loadVideo(this.currentIndex + 1);
  }

  updateContext() {
    if (window.NEXO.currentContext && this.video.currentTime) {
      window.NEXO.currentContext.timestamp = Math.floor(this.video.currentTime);
      
      // Actualizar UI Vault si está abierto
      const timeDisplay = document.getElementById('ctx-time');
      if (timeDisplay) {
        const mins = Math.floor(this.video.currentTime / 60);
        const secs = Math.floor(this.video.currentTime % 60);
        timeDisplay.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
      }
    }
  }

  onVaultOpen() {
    // Duck audio: bajar volumen al 30% para escuchar conversación
    this.video.volume = 0.3;
    this.video.style.filter = 'blur(2px) brightness(0.7)';
  }

  onVaultClose() {
    // Restaurar
    this.video.volume = 1.0;
    this.video.style.filter = 'none';
  }
}
