// Настройки безопасности для Electron приложения
export const SECURITY_CONFIG = {
  // Разрешенные домены для API запросов
  allowedDomains: [
    'http://147.45.147.111',
    'ws://147.45.147.111',
    'http://localhost:3001',
    'ws://localhost:3001',
    'http://localhost:5173',
    'http://localhost:5174'
  ],
  
  // Content Security Policy для production
  csp: {
    production: [
      "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: http://147.45.147.111 ws://147.45.147.111",
      "connect-src 'self' http://147.45.147.111 ws://147.45.147.111",
      "img-src 'self' data: blob: http://147.45.147.111",
      "media-src 'self' blob: http://147.45.147.111",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'"
    ].join('; '),
    
    development: [
      "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: http://localhost:* ws://localhost:* http://147.45.147.111 ws://147.45.147.111",
      "connect-src 'self' http://localhost:* ws://localhost:* http://147.45.147.111 ws://147.45.147.111",
      "img-src 'self' data: blob: http://localhost:* http://147.45.147.111",
      "media-src 'self' blob: http://localhost:* http://147.45.147.111",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'"
    ].join('; ')
  }
};

export function setupSecurityHeaders(session: Electron.Session, isDev: boolean) {
  // Настройка CSP
  session.webRequest.onHeadersReceived((details, callback) => {
    const csp = isDev ? SECURITY_CONFIG.csp.development : SECURITY_CONFIG.csp.production;
    
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    });
  });

  // Разрешение CORS для API запросов
  session.webRequest.onBeforeSendHeaders((details, callback) => {
    const isAllowedDomain = SECURITY_CONFIG.allowedDomains.some(domain => 
      details.url.startsWith(domain)
    );

    if (isAllowedDomain) {
      details.requestHeaders['Access-Control-Allow-Origin'] = '*';
      details.requestHeaders['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
      details.requestHeaders['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    }

    callback({ requestHeaders: details.requestHeaders });
  });
}