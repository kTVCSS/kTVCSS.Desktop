const { app, BrowserWindow, powerSaveBlocker, ipcMain, Notification } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

let mainWindow;
let powerSaveBlockerId = null;

function createWindow() {
  // Создаем окно браузера
  mainWindow = new BrowserWindow({
    width: 1720,
    height: 900,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      autoplayPolicy: 'no-user-gesture-required',
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: true
    },
    show: false,
    title: 'kTVCSS'
  });

  // Запрещаем создание новых окон (например, при клике на ссылки с target="_blank")
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Открываем ссылку в текущем окне вместо создания нового
    mainWindow.loadURL(url);
    return { action: 'deny' };
  });

  // Загружаем сайт
  mainWindow.loadURL('https://ktvcss.com');

  // Показываем окно после загрузки
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Предотвращаем засыпание системы
  if (powerSaveBlockerId === null) {
    powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep');
  }

  // Обработка закрытия окна
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Включаем автозагрузку медиа (для звуков) и перехватываем уведомления
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(`
      // Разрешаем автозагрузку медиа
      if (navigator.mediaSession) {
        navigator.mediaSession.setActionHandler('play', () => {});
      }
      
      // Предзагрузка аудио элементов для звуков
      document.addEventListener('DOMContentLoaded', () => {
        const audioElements = document.querySelectorAll('audio');
        audioElements.forEach(audio => {
          audio.preload = 'auto';
          audio.load();
        });
      });
      
      // Переопределяем Notification для работы системных уведомлений
      if (window.Notification && window.Notification.permission === 'default') {
        window.Notification.requestPermission();
      }
      
      // АГРЕССИВНЫЙ ПЕРЕХВАТ showNotification после загрузки страницы
      (function() {
        let checkCount = 0;
        const maxChecks = 50; // Проверяем 50 раз (10 секунд)
        
        const tryOverride = () => {
          checkCount++;
          
          if (window.showNotification && typeof window.showNotification === 'function') {
            // Проверяем, не перехватили ли мы уже
            if (window.showNotification.__electronInjected) {
              return true;
            }
            
            const original = window.showNotification;
            
            window.showNotification = async function(title, message, icon, options) {
              // Сохраняем тип уведомления для использования в Audio
              // ВАЖНО: устанавливаем ДО вызова оригинальной функции, чтобы playNotificationFeedback мог использовать это значение
              const notificationType = options?.notificationType || options?.data?.notificationType;
              if (notificationType) {
                window.__lastNotificationType = notificationType;
              } else {
                // Также проверяем по заголовку - "ИГРА НАЙДЕНА!" означает game-ready
                if (title && (title.includes('ИГРА НАЙДЕНА') || title.includes('НАЙДЕНА'))) {
                  window.__lastNotificationType = 'game-ready';
                }
              }
              
              // Показываем системное уведомление через Electron API
              const notificationBody = message || '';
              if (window.electronAPI) {
                window.electronAPI.showNotification({
                  title: title || 'kTVCSS',
                  body: notificationBody,
                  icon: icon || '',
                  silent: false
                }).catch(() => {});
              }
              
              // Вызываем оригинальную функцию - она вызовет playNotificationFeedback, которая создаст Audio
              // Тип уже сохранен в __lastNotificationType, поэтому Audio сможет его использовать
              const result = await original.call(this, title, message, icon, options);
              
              // Не сбрасываем __lastNotificationType сразу - даем время Audio использовать его
              // Сбрасываем только через 2 секунды, чтобы Audio успел его использовать
              setTimeout(() => {
                window.__lastNotificationType = null;
              }, 2000);
              
              return result;
            };
            
            // Помечаем как перехваченное
            window.showNotification.__electronInjected = true;
            return true;
          }
          
          return false;
        };
        
        // Пытаемся перехватить сразу
        if (!tryOverride()) {
          // Если не получилось, проверяем периодически
          const interval = setInterval(() => {
            if (tryOverride() || checkCount >= maxChecks) {
              clearInterval(interval);
            }
          }, 200);
        }
      })();
      
      // Перехватываем сообщения service worker
      (function() {
        const interceptServiceWorkerMessages = () => {
          if (navigator.serviceWorker && navigator.serviceWorker.controller) {
            const controller = navigator.serviceWorker.controller;
            
            // Проверяем, не перехватили ли мы уже
            if (controller.__electronPostMessageIntercepted) {
              return;
            }
            
            const originalPostMessage = controller.postMessage;
            
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
              
              // Вызываем оригинальный метод
              try {
                return originalPostMessage.call(this, message, transfer);
              } catch (e) {
                // Игнорируем ошибки
              }
            };
            
            controller.__electronPostMessageIntercepted = true;
          }
        };
        
        // Пытаемся перехватить сразу
        interceptServiceWorkerMessages();
        
        // Проверяем периодически
        setInterval(interceptServiceWorkerMessages, 500);
        
        // Проверяем при изменении контроллера
        if (navigator.serviceWorker) {
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            setTimeout(interceptServiceWorkerMessages, 100);
          });
        }
      })();
      
      // Перехватываем Audio для нормализации путей к звукам
      (function() {
        const normalizeSoundPath = (path) => {
          if (typeof path === 'string') {
            if (path.startsWith('/sounds/')) {
              return 'https://ktvcss.com' + path;
            }
            if (path.startsWith('/') && !path.startsWith('//') && !path.includes('://')) {
              return 'https://ktvcss.com' + path;
            }
          }
          return path;
        };
        
        const originalAudio = window.Audio;
        
        window.Audio = function(...args) {
          let soundPath = args.length > 0 && typeof args[0] === 'string' ? args[0] : null;
          
          // Если это game-ready уведомление и звук стандартный, заменяем на звук из localStorage
          if (window.__lastNotificationType === 'game-ready' && soundPath) {
            // Проверяем, не является ли это уже кастомным звуком
            const isStandardSound = soundPath.includes('/sounds/pornhub.mp3') || 
                                    soundPath.includes('/sounds/new-msg-v1.mp3') ||
                                    soundPath === '/sounds/pornhub.mp3' ||
                                    soundPath === '/sounds/new-msg-v1.mp3' ||
                                    soundPath.includes('new-msg-v1');
            
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
          
          // Нормализуем путь в конструкторе
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
              const normalized = normalizeSoundPath(value);
              if (originalSrcDescriptor.set) {
                originalSrcDescriptor.set.call(this, normalized);
              } else {
                this.setAttribute('src', normalized);
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
      
      // Перехватываем playNotificationFeedback для установки __lastNotificationType ДО создания Audio
      (function() {
        let checkCount = 0;
        const maxChecks = 50;
        
        const tryOverride = () => {
          checkCount++;
          
          // Ищем playNotificationFeedback в window или в глобальной области
          if (window.playNotificationFeedback && typeof window.playNotificationFeedback === 'function' && !window.playNotificationFeedback.__electronInjected) {
            const original = window.playNotificationFeedback;
            
            window.playNotificationFeedback = async function(feedback) {
              // Извлекаем notificationType из feedback и устанавливаем ДО вызова оригинальной функции
              if (feedback) {
                const data = feedback.data ?? {};
                const notificationType = data.notificationType ?? feedback.notificationType;
                
                if (notificationType) {
                  window.__lastNotificationType = notificationType;
                } else {
                  // Также проверяем по заголовку в payload, если он есть
                  if (feedback.title && (feedback.title.includes('ИГРА НАЙДЕНА') || feedback.title.includes('НАЙДЕНА') || feedback.title.includes('ИГРА'))) {
                    window.__lastNotificationType = 'game-ready';
                  }
                }
              }
              
              // Вызываем оригинальную функцию - она создаст Audio, который сможет использовать __lastNotificationType
              const result = await original.call(this, feedback);
              
              // Не сбрасываем __lastNotificationType сразу - даем время Audio использовать его
              setTimeout(() => {
                window.__lastNotificationType = null;
              }, 2000);
              
              return result;
            };
            
            window.playNotificationFeedback.__electronInjected = true;
            return true;
          }
          
          return false;
        };
        
        // Пытаемся перехватить сразу
        if (!tryOverride()) {
          // Если не получилось, проверяем периодически
          const interval = setInterval(() => {
            if (tryOverride() || checkCount >= maxChecks) {
              clearInterval(interval);
            }
          }, 200);
        }
      })();
    `);
  });

  // Обработка ошибок загрузки
  mainWindow.webContents.on('did-fail-load', () => {
    // Игнорируем ошибки загрузки
  });
}

// Обработчик для системных уведомлений из рендерера
ipcMain.handle('show-notification', (event, options) => {
  if (!Notification.isSupported()) {
    return false;
  }
  
  try {
    // Обрабатываем иконку - если это URL, используем его, иначе локальный путь
    let iconPath = path.join(__dirname, 'icon.png');
    if (options.icon) {
      // Проверяем, что icon - это строка
      if (typeof options.icon === 'string') {
        if (options.icon.startsWith('http://') || options.icon.startsWith('https://')) {
          // Для URL используем иконку по умолчанию, так как Electron Notification не поддерживает удаленные иконки напрямую
          iconPath = path.join(__dirname, 'icon.png');
        } else if (options.icon.startsWith('/')) {
          // Относительный путь - используем иконку по умолчанию
          iconPath = path.join(__dirname, 'icon.png');
        } else if (options.icon.trim().length > 0) {
          // Локальный путь (если не пустая строка)
          iconPath = options.icon;
        }
      }
      // Если icon - это объект или другой тип, используем иконку по умолчанию
    }
    
      const notification = new Notification({
        title: options.title || 'kTVCSS',
        body: options.body || '',
        icon: iconPath,
        silent: options.silent || false
      });
    
    notification.on('click', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
    
    notification.show();
    return true;
  } catch (error) {
    return false;
  }
});

// Обработчик для воспроизведения звуков
ipcMain.handle('play-sound', async (event, soundPath, volume = 1) => {
  try {
    // Если звук относительный, делаем его абсолютным URL
    let soundUrl = soundPath;
    if (soundPath && soundPath.startsWith('/')) {
      soundUrl = `https://ktvcss.com${soundPath}`;
    }
    
    // Воспроизводим звук через webContents
    if (mainWindow && mainWindow.webContents) {
      // Экранируем URL для использования в JavaScript
      const escapedUrl = soundUrl.replace(/'/g, "\\'");
      await mainWindow.webContents.executeJavaScript(`
        (async () => {
          try {
            const audio = new Audio('${escapedUrl}');
            audio.volume = ${Math.min(Math.max(volume, 0), 1)};
            audio.preload = 'auto';
            await audio.play().catch(() => {});
          } catch (e) {
            // Игнорируем ошибки
          }
        })();
      `);
    }
    return true;
  } catch (error) {
    return false;
  }
});

// Проверка разрешения на уведомления
ipcMain.handle('check-notification-permission', () => {
  if (Notification.isSupported()) {
    return Notification.permission;
  }
  return 'denied';
});

// Запрос разрешения на уведомления
ipcMain.handle('request-notification-permission', async () => {
  if (Notification.isSupported()) {
    // В Electron уведомления всегда разрешены, если поддерживаются
    return 'granted';
  }
  return 'denied';
});

// Настройка автообновлятора
// Для работы автообновлятора нужно настроить сервер обновлений
// Можно использовать GitHub Releases, собственный сервер или generic provider
if (!app.isPackaged) {
  // В режиме разработки отключаем автообновлятор
  autoUpdater.autoDownload = false;
} else {
  // В продакшене включаем автообновлятор
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  
  // Настройка сервера обновлений (если нужен свой сервер, раскомментируйте и укажите URL)
  // autoUpdater.setFeedURL({
  //   provider: 'generic',
  //   url: 'https://your-update-server.com/updates'
  // });
  
  // Проверка обновлений при запуске (с задержкой 5 секунд)
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify();
  }, 5000);
  
  // Проверка обновлений каждые 4 часа
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify();
  }, 4 * 60 * 60 * 1000);
  
  // События автообновлятора
  autoUpdater.on('checking-for-update', () => {
    // Проверка обновлений началась
  });
  
  autoUpdater.on('update-available', (info) => {
    // Обновление доступно, начнется автоматическая загрузка
  });
  
  autoUpdater.on('update-not-available', (info) => {
    // Обновлений нет
  });
  
  autoUpdater.on('error', (err) => {
    // Ошибка при проверке обновлений (игнорируем в продакшене)
  });
  
  autoUpdater.on('download-progress', (progressObj) => {
    // Прогресс загрузки обновления
  });
  
  autoUpdater.on('update-downloaded', (info) => {
    // Обновление загружено, установится при следующем запуске
    // или можно установить сразу: autoUpdater.quitAndInstall(false, true);
  });
}

// Когда приложение готово
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Выход когда все окна закрыты
app.on('window-all-closed', () => {
  // Останавливаем блокировку засыпания
  if (powerSaveBlockerId !== null) {
    powerSaveBlocker.stop(powerSaveBlockerId);
    powerSaveBlockerId = null;
  }
  
  // На macOS приложения обычно остаются активными
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Перед выходом
app.on('before-quit', () => {
  if (powerSaveBlockerId !== null) {
    powerSaveBlocker.stop(powerSaveBlockerId);
    powerSaveBlockerId = null;
  }
});

// Обработка ошибок
process.on('uncaughtException', () => {
  // Игнорируем необработанные исключения
});

