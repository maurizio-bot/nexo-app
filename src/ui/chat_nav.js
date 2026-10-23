/**
 * NEXO — Navegación del chat (sacada de main.js en la ronda 2752, sin cambios): abrir y cerrar el chat, botón atrás,
 * deslizar desde el borde para volver y vaciar los mensajes en pantalla.
 */
import { _cancelReply, _renderedMessageIds } from './chat_actions.js';
import { _cleanupObjectURLs } from './media_limits.js';


export function _clearMessageContainer() {
  var container = document.getElementById('messages-container');
  if (container) container.innerHTML = '';
  _renderedMessageIds.clear();
}

export function _setupBackButton() {
  try {
    var backBtn = document.getElementById('chat-back-btn');
    if (!backBtn) return;
    window.addEventListener('nexo:ble:openChat', function(e) {
      _chatNavToken++;
      backBtn.classList.add('visible');
      document.body.classList.add('chat-view-active');
      _clearMessageContainer();
      var detail = e.detail || {};
      if (detail.contactId && window.NEXO.app && !window.NEXO.app.activeContact) {
        window.NEXO.app.activeContact = { nexoId: detail.contactId, name: detail.name || 'NEXO' };
      }
    });
    window.addEventListener('nexo:ble:closeChat', function() {
      backBtn.classList.remove('visible');
      document.body.classList.remove('chat-view-active');
    });
    backBtn.addEventListener('click', function() {
      _doChatBack();
    });
    _setupSwipeBack();
  } catch (e) {
    console.warn('[MAIN] _setupBackButton error:', e);
  }
}

export function _setupSwipeBack() {
  try {
    var SWIPE_EDGE_WIDTH = 40;
    var SWIPE_THRESHOLD = 0.30;
    var startX = 0;
    var startY = 0;
    var currentX = 0;
    var isDragging = false;
    var isHorizontal = false;
    var winWidth = window.innerWidth;
    var app = document.getElementById('app');
    if (!app) return;
    function onTouchStart(e) {
      if (!document.body.classList.contains('chat-view-active')) return;
      var touch = e.touches[0];
      if (touch.clientX > SWIPE_EDGE_WIDTH) return;
      startX = touch.clientX;
      startY = touch.clientY;
      currentX = startX;
      isDragging = true;
      isHorizontal = false;
      winWidth = window.innerWidth;
    }
    function onTouchMove(e) {
      if (!isDragging) return;
      var touch = e.touches[0];
      currentX = touch.clientX;
      var deltaX = currentX - startX;
      var deltaY = touch.clientY - startY;
      if (!isHorizontal) {
        if (Math.abs(deltaX) > Math.abs(deltaY) && deltaX > 10) {
          isHorizontal = true;
          document.body.classList.add('chat-swipe-dragging');
          e.preventDefault();
        } else if (Math.abs(deltaY) > 10) {
          isDragging = false;
          return;
        }
      }
      if (!isHorizontal) return;
      var translateX = Math.max(0, Math.min(deltaX, winWidth));
      var progress = translateX / winWidth;
      if (progress > 0.5) {
        translateX = winWidth * 0.5 + (translateX - winWidth * 0.5) * 0.4;
      }
      app.style.transform = 'translateX(' + translateX + 'px)';
      app.style.opacity = Math.max(0.4, 1 - (progress * 0.5));
      var contactsView = document.getElementById('contacts-view');
      if (contactsView) {
        contactsView.style.display = 'flex';
        contactsView.style.opacity = Math.min(1, progress * 2);
        contactsView.style.transform = 'translateX(' + (-20 + progress * 20) + '%)';
      }
      e.preventDefault();
    }
    function onTouchEnd(e) {
      if (!isDragging || !isHorizontal) {
        isDragging = false;
        isHorizontal = false;
        return;
      }
      var deltaX = currentX - startX;
      var progress = deltaX / winWidth;
      var threshold = winWidth * SWIPE_THRESHOLD;
      document.body.classList.remove('chat-swipe-dragging');
      if (deltaX > threshold) {
        document.body.classList.add('chat-swipe-complete');
        document.body.classList.add('chat-swipe-transition');
        setTimeout(function() {
          _doChatBack();
          app.style.transform = '';
          app.style.opacity = '';
          document.body.classList.remove('chat-swipe-complete');
          document.body.classList.remove('chat-swipe-transition');
          var contactsView = document.getElementById('contacts-view');
          if (contactsView) {
            contactsView.style.transform = '';
            contactsView.style.opacity = '';
          }
        }, 350);
      } else {
        document.body.classList.add('chat-swipe-rebound');
        document.body.classList.add('chat-swipe-transition');
        setTimeout(function() {
          document.body.classList.remove('chat-swipe-rebound');
          document.body.classList.remove('chat-swipe-transition');
          app.style.transform = '';
          app.style.opacity = '';
          var contactsView = document.getElementById('contacts-view');
          if (contactsView) {
            contactsView.style.transform = '';
            contactsView.style.opacity = '';
          }
        }, 250);
      }
      isDragging = false;
      isHorizontal = false;
    }
    function onTouchCancel(e) {
      if (!isDragging) return;
      isDragging = false;
      isHorizontal = false;
      document.body.classList.remove('chat-swipe-dragging');
      app.style.transform = '';
      app.style.opacity = '';
      var contactsView = document.getElementById('contacts-view');
      if (contactsView) {
        contactsView.style.transform = '';
        contactsView.style.opacity = '';
      }
    }
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    document.addEventListener('touchcancel', onTouchCancel, { passive: true });
  } catch (e) {
    console.warn('[MAIN] _setupSwipeBack error:', e);
  }
}

// v9.9.34: cada apertura de chat incrementa este contador; el cierre diferido de "atrás" solo limpia
// el estado si no se abrió otro chat mientras tanto (antes, atrás + otro chat en <300 ms dejaba el
// chat nuevo sin contacto activo: los mensajes se pintaban pero no se enviaban)
export var _chatNavToken = 0;

export function _doChatBack() {
  try {
    var navToken = ++_chatNavToken;
    _cancelReply();
    _cleanupObjectURLs();
    var app = document.getElementById('app');
    var contactsView = document.getElementById('contacts-view');
    var backBtn = document.getElementById('chat-back-btn');
    if (app) {
      app.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
      app.style.transform = 'translateX(100%)';
      app.style.opacity = '0';
    }
    if (contactsView) {
      contactsView.style.display = 'flex';
      contactsView.style.opacity = '0';
      contactsView.style.transform = 'translateX(-20%)';
      contactsView.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      void contactsView.offsetWidth;
      contactsView.style.opacity = '1';
      contactsView.style.transform = 'translateX(0)';
    }
    setTimeout(function() {
      if (navToken !== _chatNavToken) {
        // Se abrió otro chat durante la animación: solo deshacer los estilos de la animación
        if (app) { app.style.transition = ''; app.style.transform = ''; app.style.opacity = ''; }
        if (contactsView) { contactsView.style.transition = ''; contactsView.style.transform = ''; contactsView.style.opacity = ''; contactsView.style.display = ''; }
        return;
      }
      if (backBtn) backBtn.classList.remove('visible');
      document.body.classList.remove('chat-view-active');
      var nameInput = document.getElementById('chat-contact-name');
      var subtitle = document.getElementById('chat-contact-subtitle');
      if (nameInput) nameInput.value = 'NEXO';
      if (subtitle) subtitle.textContent = '';
      var blePanel = document.getElementById('ble-panel');
      var bleOverlay = document.getElementById('ble-overlay');
      if (blePanel) blePanel.classList.remove('active');
      if (bleOverlay) bleOverlay.classList.remove('active');
      try {
        window.dispatchEvent(new CustomEvent('nexo:ble:closeChat', { detail: {} }));
      } catch (e) {}
      if (window.NEXO.app) {
        window.NEXO.app.activeContact = null;
      }
      if (window.NEXO.app && window.NEXO.app.bleInterface) {
        window.NEXO.app.bleInterface._activeChatDeviceId = null;
      }
      if (app) {
        app.style.transition = '';
        app.style.transform = '';
        app.style.opacity = '';
      }
      if (contactsView) {
        contactsView.style.transition = '';
        contactsView.style.transform = '';
        contactsView.style.opacity = '';
      }
    }, 300);
  } catch (e) {
    console.warn('[MAIN] _doChatBack error:', e);
  }
}
