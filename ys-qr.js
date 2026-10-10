/* 📱 엽쌤 QR로 접속 도우미 (ys-qr.js)
 * - [data-qr] 버튼을 누르면 교실 TV·전자칠판에 띄우는 큰 QR 창을 연다.
 * - QR 그림은 이 앱 폴더의 qr.svg(미리 만들어 둔 파일)를 쓰므로 인터넷 없이도 뜬다.
 * - 주소·이름은 <html data-qr-url data-qr-name> 또는 앱 주소·홈 화면 이름에서 가져온다.
 */
(function () {
    if (window.YSQr) return;
    var css = '' +
        '.yq-back{position:fixed;inset:0;z-index:2147483000;background:rgba(15,23,42,.72);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}' +
        '.yq-card{box-sizing:border-box;background:#fff;color:#0f172a;border-radius:20px;padding:22px 20px 16px;width:min(100%,520px);max-height:100%;overflow:auto;text-align:center;font-family:inherit;line-height:1.5;box-shadow:0 20px 60px rgba(0,0,0,.35)}' +
        '.yq-card .yq-title{margin:0;font-size:22px;font-weight:800;color:#0f172a}' +
        '.yq-card .yq-name{margin:2px 0 0;color:#475569;font-size:15px;font-weight:600}' +
        '.yq-card .yq-qr{display:block;width:min(100%,62vh,420px);height:auto;margin:12px auto;image-rendering:pixelated}' +
        '.yq-card .yq-url{margin:0 0 4px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:16px;word-break:break-all;color:#0f172a}' +
        '.yq-card .yq-hint{margin:0 0 14px;color:#64748b;font-size:14px}' +
        '.yq-card .yq-close{font:inherit;font-weight:700;width:100%;padding:12px;border:0;border-radius:12px;background:#0f172a;color:#fff;cursor:pointer}';

    function injectCss() {
        if (document.getElementById('yq-style') || !document.head) return;
        var s = document.createElement('style');
        s.id = 'yq-style';
        s.textContent = css;
        document.head.appendChild(s);
    }
    var root = document.documentElement;
    function appUrl() {
        return root.getAttribute('data-qr-url') || new URL('./', location.href).href.split('#')[0];
    }
    function appName() {
        var m = document.querySelector('meta[name="apple-mobile-web-app-title"]');
        return root.getAttribute('data-qr-name') || (m && m.content) || document.title;
    }

    function open() {
        injectCss();
        var last = document.activeElement;
        var url = appUrl();
        var back = document.createElement('div');
        back.className = 'yq-back';
        back.style.setProperty('display', 'flex', 'important'); // 앱 CSS가 다른 창을 숨겨도 QR 창은 보이게
        back.innerHTML = '<div class="yq-card" role="dialog" aria-modal="true" aria-labelledby="yq-title">' +
            '<p class="yq-title" id="yq-title">📱 카메라로 찍어서 들어와요</p><p class="yq-name"></p>' +
            '<img class="yq-qr" alt="" width="420" height="420">' +
            '<p class="yq-url"></p><p class="yq-hint">휴대폰·태블릿 카메라를 QR 코드에 비추면 바로 열려요.</p>' +
            '<button type="button" class="yq-close">닫기</button></div>';
        back.querySelector('.yq-name').textContent = appName();
        back.querySelector('.yq-url').textContent = url.replace(/^https?:\/\//, '');
        var img = back.querySelector('.yq-qr');
        img.src = root.getAttribute('data-qr-src') || new URL('qr.svg', location.href).href; // 이 앱 폴더의 파일(오프라인에서도 뜸)
        img.alt = appName() + ' 주소 QR 코드';
        function close() {
            document.removeEventListener('keydown', onKey);
            back.remove();
            if (last && last.focus) last.focus();
        }
        function onKey(e) { if (e.key === 'Escape') close(); }
        back.addEventListener('click', function (e) { if (e.target === back || e.target.closest('.yq-close')) close(); });
        document.addEventListener('keydown', onKey);
        document.body.appendChild(back);
        back.querySelector('.yq-close').focus();
    }

    document.addEventListener('click', function (e) {
        var btn = e.target.closest && e.target.closest('[data-qr]');
        if (!btn) return;
        e.preventDefault();
        open();
    });
    window.YSQr = { open: open };
})();
