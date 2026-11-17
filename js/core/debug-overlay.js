/**
 * debug-overlay.js — 휴대폰 진단용 기록창 (임시). 주소에 ?debug를 붙이면 켜져요.
 *   예: https://jireh0905.github.io/stock/?debug#/saving
 *
 * 왜 필요한가요?
 *   "입력할 때 화면이 튄다" 같은 문제는 아이폰 Safari에서만 생겨서, 컴퓨터 브라우저로는 재현이 안 돼요.
 *   그래서 휴대폰 화면 위에 그 순간의 숫자를 바로 보여줘요. 화면을 녹화하면 무엇 때문에 튀었는지 알 수 있어요.
 *   MFC로 치면 TRACE 출력을 화면 구석에 띄워 두는 것과 같아요.
 *
 * 한 줄에 보이는 것:
 *   +120ms  마지막 입력부터 지난 시간
 *   입력 name=monthly / 스크롤 / 화면 / 결과   무슨 일이 있었는지
 *   y=812    페이지 스크롤 위치 (scrollY)
 *   vv=+270/430  키보드 때문에 화면을 밀어 올린 양(visualViewport.offsetTop) / 보이는 높이
 *   h=2310   페이지 전체 높이
 *   결과 줄: 결과 카드에서 새로 만든 덩어리 이름, 미룬 것이 있으면 "미룸"
 */

const MAX_LINES = 10;

export function startDebugOverlay() {
    const box = document.createElement('div');
    box.setAttribute('aria-hidden', 'true');
    box.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:9999', 'pointer-events:none',
        'font:11px/1.35 ui-monospace,Menlo,monospace', 'color:#0f0', 'background:rgba(0,0,0,.72)',
        'padding:4px 6px', 'white-space:pre', 'overflow:hidden', 'transform-origin:0 0',
    ].join(';');
    document.body.append(box);

    const vv = window.visualViewport;
    const lines = [];
    let lastInput = performance.now();
    let last = { y: -1, off: -1, h: -1, vh: -1 };

    const state = () => ({
        y: Math.round(scrollY),
        off: Math.round(vv?.offsetTop ?? 0),
        vh: Math.round(vv?.height ?? innerHeight),
        h: document.documentElement.scrollHeight,
    });
    const fmt = (s) => `y=${s.y} vv=+${s.off}/${s.vh} h=${s.h}`;

    function log(what) {
        const s = state();
        const ms = Math.round(performance.now() - lastInput);
        lines.push(`+${String(ms).padStart(5)}ms ${what.padEnd(14)} ${fmt(s)}`);
        while (lines.length > MAX_LINES) lines.shift();
        box.textContent = lines.join('\n');
        last = s;
    }

    // 키보드 때문에 화면을 밀어 올려도 기록창은 보이는 맨 위에 붙어 있게
    function stick() {
        if (vv) box.style.transform = `translate(${vv.offsetLeft}px, ${vv.offsetTop}px) scale(${1 / (vv.scale || 1)})`;
    }

    document.addEventListener('input', (e) => {
        lastInput = performance.now();
        log(`입력 ${e.target.name || (e.target.matches?.('[data-ref-loss]') ? 'ref' : '?')}`);
    }, true);
    document.addEventListener('result-parts', (e) => {
        const { fresh, deferred } = e.detail;
        log(`결과 ${[...fresh].join(',') || '-'}${deferred ? ' 미룸' : ''}`);
    });
    document.addEventListener('focusin', (e) => { if (e.target.matches?.('input, textarea')) log('칸 들어감'); });
    document.addEventListener('focusout', (e) => { if (e.target.matches?.('input, textarea')) log('칸 나감'); });

    // 스크롤·화면(키보드) 변화는 매우 자주 와서, 값이 바뀐 것만 한 프레임에 한 번 적어요
    let pending = false;
    const onMove = (kind) => () => {
        stick();
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => {
            pending = false;
            const s = state();
            if (s.y !== last.y || s.off !== last.off || s.vh !== last.vh || s.h !== last.h) log(kind);
        });
    };
    addEventListener('scroll', onMove('스크롤'), { passive: true });
    vv?.addEventListener('scroll', onMove('화면'));
    vv?.addEventListener('resize', onMove('화면 크기'));
    stick();
    log('진단 시작');
}
