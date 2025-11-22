const { contextBridge, ipcRenderer } = require('electron');

// Предоставляем безопасный API для рендерера
contextBridge.exposeInMainWorld('electronAPI', {
  // Уведомления
  showNotification: (options) => ipcRenderer.invoke('show-notification', options),
  checkNotificationPermission: () => ipcRenderer.invoke('check-notification-permission'),
  requestNotificationPermission: () => ipcRenderer.invoke('request-notification-permission'),
});

// Переопределяем стандартный Notification API для работы через Electron
(function() {
  if (window.Notification) {
    const originalNotification = window.Notification;
    
    // Устанавливаем разрешение по умолчанию
    Object.defineProperty(window.Notification, 'permission', {
      get: function() {
        return 'granted'; // В Electron уведомления всегда разрешены
      },
      configurable: true
    });
    
    // Переопределяем requestPermission
    window.Notification.requestPermission = function() {
      return Promise.resolve('granted');
    };
    
    // Переопределяем конструктор Notification
    const NotificationConstructor = function(title, options = {}) {
      // Всегда показываем системное уведомление через Electron API
      // Заголовок берется из title, текст из body
      if (window.electronAPI) {
        window.electronAPI.showNotification({
          title: title || 'kTVCSS',
          body: options.body || '',
          icon: options.icon || '',
          silent: options.silent !== undefined ? options.silent : false
        }).catch(() => {});
      }
      
      // Возвращаем объект-заглушку для совместимости
      const stub = {
        title: title,
        body: options.body || '',
        icon: options.icon || '',
        onclick: null,
        onshow: null,
        onerror: null,
        onclose: null,
        close: function() {},
        addEventListener: function() {},
        removeEventListener: function() {}
      };
      return stub;
    };
    
    // Копируем статические свойства и методы
    Object.setPrototypeOf(NotificationConstructor, originalNotification);
    Object.setPrototypeOf(NotificationConstructor.prototype, originalNotification.prototype);
    
    // Заменяем глобальный Notification
    window.Notification = NotificationConstructor;
  }
})();

// Функция для преобразования относительного пути в абсолютный URL
const normalizeSoundPath = (path) => {
  if (typeof path === 'string') {
    // Если путь относительный и начинается с /sounds/, преобразуем в абсолютный URL
    if (path.startsWith('/sounds/')) {
      return `https://ktvcss.com${path}`;
    }
    // Если путь относительный без протокола, но не начинается с /, тоже может быть проблемой
    if (path.startsWith('/') && !path.startsWith('//') && !path.includes('://')) {
      return `https://ktvcss.com${path}`;
    }
  }
  return path;
};

// Перехватываем создание Audio объектов для правильной обработки относительных путей к звукам
(function() {
  const originalAudio = window.Audio;
  
  window.Audio = function(...args) {
    let normalizedPath = null;
    
    // Если первый аргумент - строка с относительным путем к звуку, преобразуем в абсолютный URL
    if (args.length > 0 && typeof args[0] === 'string') {
      normalizedPath = normalizeSoundPath(args[0]);
      if (normalizedPath !== args[0]) {
        args[0] = normalizedPath;
      }
    }
    
    const audio = new originalAudio(...args);
    
    // Перехватываем свойство src для обработки относительных путей, установленных после создания
    const originalSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    
    Object.defineProperty(audio, 'src', {
      get: function() {
        return originalSrcDescriptor.get ? originalSrcDescriptor.get.call(this) : '';
      },
      set: function(value) {
        // Преобразуем относительный путь в абсолютный URL
        const normalizedValue = normalizeSoundPath(value);
        
        // Устанавливаем через оригинальный setter
        if (originalSrcDescriptor.set) {
          originalSrcDescriptor.set.call(this, normalizedValue);
        } else {
          this.setAttribute('src', normalizedValue);
        }
      },
      configurable: true,
      enumerable: true
    });
    
    return audio;
  };
  
  // Копируем статические свойства
  Object.setPrototypeOf(window.Audio, originalAudio);
  Object.setPrototypeOf(window.Audio.prototype, originalAudio.prototype);
})();

// Глобальная переменная для отслеживания типа последнего уведомления
window.__lastNotificationType = null;

// Перехватываем создание Audio для game-ready уведомлений и используем звук из localStorage
(function() {
  const originalAudio = window.Audio;
  
  // Перехватываем Audio конструктор
  window.Audio = function(...args) {
    let soundPath = args.length > 0 && typeof args[0] === 'string' ? args[0] : null;
    
    // Если это game-ready уведомление и звук стандартный, заменяем на звук из localStorage
    if (window.__lastNotificationType === 'game-ready' && soundPath) {
      // Проверяем, не является ли это уже кастомным звуком (не стандартным)
      const isStandardSound = soundPath.includes('/sounds/pornhub.mp3') || 
                              soundPath.includes('/sounds/new-msg-v1.mp3') ||
                              soundPath === '/sounds/pornhub.mp3' ||
                              soundPath === '/sounds/new-msg-v1.mp3';
      
      if (isStandardSound) {
        try {
          const storedSoundRaw = localStorage.getItem("GFSound");
          if (storedSoundRaw) {
            const storedSound = JSON.parse(storedSoundRaw);
            if (storedSound?.Value) {
              soundPath = storedSound.Value;
              args[0] = normalizeSoundPath(soundPath);
            }
          }
        } catch (e) {
          // Игнорируем ошибки
        }
      }
    }
    
    // Нормализуем путь
    if (args.length > 0 && typeof args[0] === 'string') {
      args[0] = normalizeSoundPath(args[0]);
    }
    
    const audio = new originalAudio(...args);
    
    // Если это game-ready уведомление, устанавливаем громкость из localStorage
    if (window.__lastNotificationType === 'game-ready') {
      try {
        const storedVolumeRaw = localStorage.getItem("GFSoundLevel");
        if (storedVolumeRaw) {
          const parsedVolume = Number(storedVolumeRaw);
          if (Number.isFinite(parsedVolume)) {
            const volume = Math.min(Math.max(parsedVolume, 0), 1);
            audio.volume = volume;
          }
        }
      } catch (e) {
        // Игнорируем ошибки
      }
    }
    
    // Перехватываем свойство src
    const originalSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    Object.defineProperty(audio, 'src', {
      get: function() {
        return originalSrcDescriptor.get ? originalSrcDescriptor.get.call(this) : '';
      },
      set: function(value) {
        const normalizedValue = normalizeSoundPath(value);
        if (originalSrcDescriptor.set) {
          originalSrcDescriptor.set.call(this, normalizedValue);
        } else {
          this.setAttribute('src', normalizedValue);
        }
      },
      configurable: true,
      enumerable: true
    });
    
    return audio;
  };
  
  Object.setPrototypeOf(window.Audio, originalAudio);
  Object.setPrototypeOf(window.Audio.prototype, originalAudio.prototype);
})();

// АГРЕССИВНЫЙ ПЕРЕХВАТ: Определяем showNotification ДО того, как страница его определит
(function() {
  let originalShowNotification = null;
  
  // Создаем функцию-обертку сразу
  const showNotificationWrapper = async function(title, message, icon, options) {
    // Сохраняем тип уведомления для использования в Audio
    // ВАЖНО: устанавливаем ДО вызова оригинальной функции, чтобы playNotificationFeedback мог использовать это значение
    const notificationType = options?.notificationType || options?.data?.notificationType;
    if (notificationType) {
      window.__lastNotificationType = notificationType;
    } else {
      // Также проверяем по заголовку - "ИГРА НАЙДЕНА!" означает game-ready
      if (title && (title.includes('ИГРА НАЙДЕНА') || title.includes('НАЙДЕНА') || title.includes('ИГРА'))) {
        window.__lastNotificationType = 'game-ready';
      }
    }
    
    // Сначала показываем системное уведомление через Electron API
    const finalTitle = title || 'kTVCSS';
    const finalBody = message || '';
    const finalIcon = icon || '';
    
    if (window.electronAPI) {
      window.electronAPI.showNotification({
        title: finalTitle,
        body: finalBody,
        icon: finalIcon,
        silent: false
      }).catch(() => {});
    }
    
    // Затем вызываем оригинальную функцию, если она есть
    // playNotificationFeedback будет вызван внутри оригинальной функции и сможет использовать __lastNotificationType
    let result;
    if (originalShowNotification && typeof originalShowNotification === 'function') {
      try {
        result = await originalShowNotification(title, message, icon, options);
      } catch (e) {
        // Игнорируем ошибки
      }
    }
    
    // Не сбрасываем __lastNotificationType сразу - даем время Audio использовать его
    // Сбрасываем только через 2 секунды, чтобы Audio успел его использовать
    setTimeout(() => {
      window.__lastNotificationType = null;
    }, 2000);
    
    return result;
  };
  
  // Определяем showNotification через Object.defineProperty, чтобы перехватить его до определения на странице
  Object.defineProperty(window, 'showNotification', {
    get: function() {
      return showNotificationWrapper;
    },
    set: function(value) {
      originalShowNotification = value;
      // Не устанавливаем значение, оставляем нашу обертку
    },
    configurable: true,
    enumerable: true
  });
})();

// Перехватываем сообщения service worker для показа уведомлений
(function() {
  if ('serviceWorker' in navigator) {
    // Перехватываем postMessage к service worker
    const checkController = () => {
      if (navigator.serviceWorker.controller) {
        const controller = navigator.serviceWorker.controller;
        
        // Сохраняем оригинальный метод
        if (!controller.__originalPostMessage) {
          controller.__originalPostMessage = controller.postMessage;
        }
        
        const originalPostMessage = controller.__originalPostMessage;
        
        controller.postMessage = function(message, transfer) {
          // Если это сообщение о показе уведомления, показываем его через Electron API
          if (message && message.type === 'SHOW_NOTIFICATION' && message.payload) {
            const payload = message.payload;
            
            // Сохраняем тип уведомления для использования в Audio
            // ВАЖНО: устанавливаем ДО вызова оригинального postMessage, чтобы playNotificationFeedback мог использовать это значение
            const notificationType = payload.data?.notificationType || payload.notificationType;
            if (notificationType) {
              window.__lastNotificationType = notificationType;
            } else {
              // Также проверяем по заголовку - "ИГРА НАЙДЕНА!" означает game-ready
              if (payload.title && (payload.title.includes('ИГРА НАЙДЕНА') || payload.title.includes('НАЙДЕНА') || payload.title.includes('ИГРА'))) {
                window.__lastNotificationType = 'game-ready';
              }
            }
            
            if (window.electronAPI) {
              window.electronAPI.showNotification({
                title: payload.title || 'kTVCSS',
                body: payload.body || '',
                icon: payload.icon || '',
                silent: payload.silent || false
              }).catch(() => {});
            }
            
            // Не сбрасываем __lastNotificationType сразу - даем время Audio использовать его
            setTimeout(() => {
              window.__lastNotificationType = null;
            }, 2000);
          }
          
          // Вызываем оригинальный метод (может не работать из-за ошибок service worker)
          try {
            return originalPostMessage.call(this, message, transfer);
          } catch (e) {
            return;
          }
        };
      }
    };
    
    // Проверяем сразу
    checkController();
    
    // Проверяем при изменении контроллера
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      setTimeout(checkController, 100); // Небольшая задержка для инициализации
    });
    
    // Также проверяем периодически
    setInterval(checkController, 1000);
    
    // Также перехватываем регистрацию service worker
    const originalRegister = navigator.serviceWorker.register;
    navigator.serviceWorker.register = function(...args) {
      return originalRegister.apply(this, args).then(registration => {
        // Перехватываем showNotification в регистрации
        const originalShowNotification = registration.showNotification;
        registration.showNotification = function(title, options) {
          // Показываем уведомление через Electron API
          // Заголовок берется из title, текст из body
          if (window.electronAPI) {
            window.electronAPI.showNotification({
              title: title || 'kTVCSS',
              body: options?.body || '',
              icon: options?.icon || '',
              silent: options?.silent || false
            }).catch(() => {});
          }
          
          // Вызываем оригинальный метод (может не работать из-за ошибок service worker)
          try {
            return originalShowNotification.call(this, title, options);
          } catch (e) {
            return Promise.resolve();
          }
        };
        
        return registration;
      }).catch(() => {
        // Возвращаем заглушку, чтобы не ломать код
        return {
          showNotification: function(title, options) {
            if (window.electronAPI) {
              window.electronAPI.showNotification({
                title: title || 'kTVCSS',
                body: options?.body || '',
                icon: options?.icon || '',
                silent: options?.silent || false
              });
            }
            return Promise.resolve();
          }
        };
      });
    };
  }
})();
