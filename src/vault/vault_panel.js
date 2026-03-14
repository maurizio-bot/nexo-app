export class VaultPanel {
  constructor(panelId, listId) {
    this.panel = document.getElementById(panelId);
    this.list = document.getElementById(listId);
    this.contacts = [
      { id: 1, name: 'María', type: 'pareja', color: '#FF6B6B' },
      { id: 2, name: 'Carlos', type: 'amigo', color: '#4ECDC4' },
      { id: 3, name: 'Familia', type: 'grupo', color: '#45B7D1' }
    ];
    
    this.init();
  }

  init() {
    this.renderContacts();
    this.setupChispaButtons();
    
    // Escuchar cuando cambia contexto de video para reordenar (Glue effect)
    window.addEventListener('nexo:context:updated', () => this.reorderByContext());
  }

  renderContacts() {
    this.list.innerHTML = '';
    
    this.contacts.forEach((contact, index) => {
      const el = document.createElement('div');
      el.className = 'contact-item';
      el.dataset.id = contact.id;
      el.innerHTML = `
        <div class="contact-avatar" style="background:${contact.color}">
          ${contact.name[0]}
        </div>
        <div class="contact-name">${contact.name}</div>
        <div class="contact-priority">${index === 0 ? '⭐ Recomendado' : ''}</div>
      `;
      
      el.addEventListener('click', () => this.selectContact(contact));
      this.list.appendChild(el);
    });
  }

  reorderByContext() {
    // Glue simple: Si es video largo (>5min), prioriza "Familia", si no "Amigo"
    const ctx = window.NEXO.currentContext;
    if (!ctx) return;
    
    if (ctx.duration > 300) {
      // Mover Familia primero
      const famIndex = this.contacts.findIndex(c => c.type === 'grupo');
      if (famIndex > 0) {
        const [familia] = this.contacts.splice(famIndex, 1);
        this.contacts.unshift(familia);
      }
    }
    
    this.renderContacts();
  }

  selectContact(contact) {
    // Si hay chispa pendiente, enviarla
    if (window.pendingChispa) {
      this.sendChispa(window.pendingChispa, contact);
      window.pendingChispa = null;
    } else {
      // Abrir chat directo
      console.log(`[VAULT] Chat abierto con ${contact.name}`);
    }
  }

  setupChispaButtons() {
    const buttons = document.querySelectorAll('#chispa-creator button');
    buttons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const type = e.target.dataset.type;
        this.createChispa(type);
      });
    });
  }

  createChispa(type) {
    const chispa = {
      type,
      content: this.getChispaContent(type),
      timestamp: window.NEXO.currentContext?.timestamp || 0,
      videoId: window.NEXO.currentContext?.videoId || 0,
      id: Date.now()
    };
    
    // Mostrar flotante o enviar directo
    window.pendingChispa = chispa;
    this.showFloatingPreview(chispa);
  }

  getChispaContent(type) {
    const map = {
      'emoji': '🔥',
      'laugh': '😂',
      'sync': 'Solicitud ver juntos'
    };
    return map[type] || '👋';
  }

  showFloatingPreview(chispa) {
    const preview = document.createElement('div');
    preview.className = 'chispa-float';
    preview.innerHTML = `
      <div class="chispa-content">${chispa.content}</div>
      <div class="chispa-hint">Toca un contacto para enviar</div>
    `;
    preview.style.cssText = `
      position: fixed;
      right: 20px;
      top: 50%;
      background: white;
      padding: 15px;
      border-radius: 20px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.2);
      z-index: 1000;
      animation: float 2s ease-in-out infinite;
    `;
    
    document.body.appendChild(preview);
    
    // Auto eliminar si no se usa
    setTimeout(() => preview.remove(), 8000);
  }

  sendChispa(chispa, contact) {
    console.log(`[CHISPA] Enviado a ${contact.name}:`, chispa);
    // Aquí iría WebSocket real
    
    // Feedback visual
    alert(`Chispa enviada a ${contact.name} en ${chispa.timestamp}s del video`);
  }
}
