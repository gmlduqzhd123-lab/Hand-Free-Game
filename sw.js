// 4시 40분의 용사 서비스 워커: 앱 설치(홈 화면에 추가)와 오프라인 열기를 돕는다.
// 우리 사이트 파일은 새 버전을 먼저 받아 오므로 보통은 CACHE_VERSION을 올릴 필요가 없다.
// 게임 저장 기록(브라우저 저장소)은 건드리지 않는다.
const CACHE_VERSION = 'hand-free-game-v1';
// 같은 주소(gmlduqzhd123-lab.github.io)의 다른 앱들과 저장소를 함께 쓰므로, 이 앱의 이전 캐시만 지운다.
const CACHE_PREFIX = 'hand-free-game-v';
const APP_SHELL = [
    './',
    './index.html',
    './manifest.webmanifest',
    './ys-install.js',
    './ys-qr.js',
    './qr.svg',
    './icon.svg',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE_VERSION).then(cache => cache.addAll(APP_SHELL)).catch(() => {}));
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_VERSION).map(key => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

// 우리 사이트 파일만: 새 버전을 먼저 받아 오고, 인터넷이 없으면 저장해 둔 것을 보여준다
self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;
    if (new URL(request.url).origin !== self.location.origin) return;
    event.respondWith(
        fetch(request)
            .then(response => {
                if (response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE_VERSION).then(cache => cache.put(request, copy));
                }
                return response;
            })
            .catch(() => caches.match(request, { ignoreSearch: true })
                .then(cached => cached || (request.mode === 'navigate' ? caches.match('./index.html') : undefined))
                .then(res => res || Response.error()))
    );
});
