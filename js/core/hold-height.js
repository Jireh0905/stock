/**
 * hold-height.js — 입력하는 동안 기능 화면 높이를 유지해요 (휴대폰에서 화면이 위아래로 튀지 않게)
 *
 * 왜 필요한가요?
 *   칸을 지워 잠깐 비면 결과 카드가 "입력하면 바로 계산돼요" 안내로 바뀌면서 수백 px 짧아져요.
 *   페이지가 짧아지면 화면 아래쪽을 보던 스크롤이 갈 곳이 없어 위로 튕기고,
 *   다시 숫자를 치면 길어지면서 제자리로 돌아와요. 키보드가 화면 절반을 가리는 휴대폰에서 특히 잘 보여요.
 *
 * 어떻게?
 *   입력칸에 커서가 있는 동안에는 기능 화면 전체(root)의 min-height를 "지금까지 가장 컸던 높이"로 잡아둬요.
 *   결과 카드뿐 아니라 칸 아래 안내 줄(예: 하락 대응의 단계별 안내)이 사라져도 페이지 길이는 그대로예요.
 *   내용이 짧아지면 맨 아래가 잠깐 빈 공간이 될 뿐이에요.
 *   입력칸에서 벗어나면(키보드를 닫으면) 원래대로 풀어요.
 *   MFC로 치면 다시 그리는 동안 창 크기를 고정해두는 것과 비슷해요. 계산기들은 이 파일을 몰라도 돼요.
 */

const isField = (el) => !!el?.matches?.('input:not([type="hidden"]), select, textarea');

/**
 * @param {HTMLElement} root - 기능 화면 (app.js가 mount한 곳)
 */
export function holdResultHeight(root) {
    const targets = () => [root];
    let holding = false;
    let releaseTimer = null;

    /** 지금 높이가 더 크면 그만큼으로 (작아지는 쪽으로는 안 움직여요) */
    const ratchet = () => {
        if (!holding) return;
        targets().forEach(r => {
            const h = r.offsetHeight;
            if (h > (parseFloat(r.style.minHeight) || 0)) r.style.minHeight = `${h}px`;
        });
    };

    root.addEventListener('focusin', (e) => {
        if (!isField(e.target)) return;
        clearTimeout(releaseTimer);
        holding = true;
        ratchet();
    });

    // 계산기가 결과를 다시 그린 뒤에 불려요 (같은 화면에 계산기 리스너가 먼저 붙어 있어서)
    root.addEventListener('input', () => requestAnimationFrame(ratchet));

    root.addEventListener('focusout', (e) => {
        // 다른 입력칸으로 옮겨 가는 중이면 계속 유지
        if (isField(e.relatedTarget) && root.contains(e.relatedTarget)) return;
        clearTimeout(releaseTimer);
        releaseTimer = setTimeout(() => {
            if (isField(document.activeElement) && root.contains(document.activeElement)) return;
            holding = false;
            targets().forEach(r => { r.style.minHeight = ''; });
        }, 400);
    });
}
