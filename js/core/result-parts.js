/**
 * result-parts.js — 결과 카드를 "부분" 단위로 갈아 끼우고, 휴대폰에서 입력하는 동안 그래프·표는 미뤄요
 *
 * 왜 필요한가요?
 *   적립식·손실 회복 계산기는 숫자를 하나 칠 때마다 결과 카드 전체(그래프 SVG·연도별 표 포함)를 지우고 새로 만들었어요.
 *   아이폰에서는 키보드가 아래쪽 칸을 가리지 않게 화면을 밀어 올려 두는데, 큰 그래프를 새로 만들 때마다
 *   이 위치가 풀렸다가 다시 맞춰져서 화면이 위아래로 튀었어요. (그래프가 없는 계산기는 튀지 않았어요)
 *
 * 어떻게?
 *   결과 HTML을 data-part="이름"이 붙은 덩어리로 나눠요 (예: head · chart · foot).
 *    - 글자가 그대로인 덩어리는 손대지 않아요 (요소를 새로 만들지 않음)
 *    - 바뀐 덩어리만 새 요소로 바꿔 끼워요
 *    - 휴대폰에서 입력칸에 커서가 있는 동안(defer)에는 무거운 덩어리(heavy: 그래프·표)를 바꾸지 않고
 *      흐리게 둔 뒤, 키보드를 닫을 때(whenTypingEnds) 계산기가 다시 그려요.
 *   MFC로 치면 Invalidate()로 창 전체를 다시 그리던 것을, 바뀐 컨트롤만 InvalidateRect 하는 것과 비슷해요.
 *   컴퓨터(마우스)에서는 키보드 문제가 없어서 지금처럼 바로바로 그려요.
 */

/** 덩어리 요소 → 그 요소를 만든 HTML 글자 (다음에 같은지 비교용) */
const madeFrom = new WeakMap();

/** 손가락으로 쓰는 화면인지 (화상 키보드가 뜨는 휴대폰·태블릿) */
const touchScreen = () => matchMedia('(pointer: coarse)').matches;
const isTextField = (el) => !!el?.matches?.('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea');

/**
 * 휴대폰에서 root 안의 입력칸에 커서가 있는지 (= 키보드가 떠 있는지)
 * @param {HTMLElement} root - 기능 화면
 * @param {HTMLElement} [except] - 이 안의 입력칸은 빼고 봐요 (예: 결과 카드 안의 작은 입력칸)
 */
export function isTypingIn(root, except = null) {
    const a = document.activeElement;
    return touchScreen() && isTextField(a) && root.contains(a) && !except?.contains(a);
}

/**
 * 입력칸에서 벗어나 키보드가 닫히면 callback을 불러요. 다른 입력칸으로 옮겨 가는 중이면 부르지 않아요.
 * @param {HTMLElement} root - 기능 화면
 * @param {Function} callback
 * @param {HTMLElement} [except] - isTypingIn과 같아요
 */
export function whenTypingEnds(root, callback, except = null) {
    root.addEventListener('focusout', () => {
        // focusout 순간에는 다음 칸이 아직 포커스를 받기 전이라, 한 박자 뒤에 확인해요
        setTimeout(() => { if (!isTypingIn(root, except)) callback(); }, 0);
    });
}

/** 무엇을 바꿨는지 알려요 (?debug 진단 기록창이 들어요. core/debug-overlay.js) */
function report(out) {
    document.dispatchEvent(new CustomEvent('result-parts', { detail: out }));
}

/** 아직 한 번도 못 그린 무거운 덩어리 자리 (입력을 마치면 그려요) */
function placeholder(key, withText) {
    const div = document.createElement('div');
    div.dataset.part = key;
    if (withText) {
        div.className = 'part-pending';
        div.textContent = '입력을 마치면 그래프와 표를 보여줘요';
    }
    return div;
}

/**
 * 결과 카드(el)를 markup으로 바꿔요. 바뀐 덩어리만 갈아 끼워요.
 *
 * @param {HTMLElement} el - 결과 카드
 * @param {string} markup - 새 결과 HTML. 맨 바깥 요소마다 data-part가 있어야 덩어리로 다뤄요 (없으면 통째로 바꿔요)
 * @param {{ defer?: boolean, heavy?: string[] }} options
 *   defer: 무거운 덩어리는 바꾸지 말고 미룰지 (보통 isTypingIn(view))
 *   heavy: 무거운 덩어리 이름들 (예: ['chart'])
 * @returns {{ fresh: Set<string>, deferred: boolean }}
 *   fresh: 새로 만든 덩어리 이름 ('*'면 통째로) / deferred: 미뤄 둔 덩어리가 있는지 (있으면 나중에 다시 그려야 해요)
 */
export function patchParts(el, markup, { defer = false, heavy = [] } = {}) {
    const tpl = document.createElement('template');
    tpl.innerHTML = markup.trim();
    const next = [...tpl.content.children];
    const out = { fresh: new Set(), deferred: false };

    // 덩어리로 나뉘지 않은 HTML은 예전처럼 통째로
    if (!next.length || !next.every(n => n.dataset.part)) {
        el.replaceChildren(tpl.content);
        out.fresh.add('*');
        report(out);
        return out;
    }

    const old = new Map([...el.children].filter(c => c.dataset.part).map(c => [c.dataset.part, c]));
    const want = [];
    let noted = false; // "입력을 마치면…" 안내는 첫 덩어리에만
    const keepStale = (o) => {
        o.dataset.stale = noted ? '' : 'note';
        noted = true;
        out.deferred = true;
        want.push(o);
    };

    for (const n of next) {
        const key = n.dataset.part;
        const o = old.get(key);
        old.delete(key);
        const text = n.outerHTML;
        if (o && madeFrom.get(o) === text) {          // 그대로 → 손대지 않아요
            delete o.dataset.stale;
            want.push(o);
        } else if (o?.contains(document.activeElement)) {
            // 커서가 있는 덩어리(예: 결과 카드 안의 입력칸)는 바꾸지 않아요. 바꾸면 커서와 키보드가 사라져서.
            // 만든 글자는 예전 것 그대로라, 다음에 다시 그릴 때 바뀌어요
            want.push(o);
        } else if (defer && heavy.includes(key)) {    // 입력 중 + 무거운 덩어리 → 미뤄요
            if (o && madeFrom.has(o)) keepStale(o);
            else {
                want.push(o ?? placeholder(key, !noted));
                noted = true;
                out.deferred = true;
            }
        } else {                                      // 바뀜 → 새 요소로
            madeFrom.set(n, text);
            out.fresh.add(key);
            want.push(n);
        }
    }
    // 새 결과에는 없지만(예: 칸을 지워 "입력하면…" 안내로) 입력 중이면 무거운 덩어리는 흐리게 남겨 둬요
    if (defer) old.forEach((o, key) => { if (heavy.includes(key) && madeFrom.has(o)) keepStale(o); });

    // 제자리 맞추기: 필요 없는 것을 먼저 빼고, 남은 요소는 옮기지 않은 채 새 요소만 끼워 넣어요
    // (이미 있는 그래프를 떼었다 붙이면 새로 만드는 것과 같아져서)
    [...el.childNodes].forEach(c => { if (!want.includes(c)) c.remove(); });
    let cur = el.firstChild;
    for (const node of want) {
        if (node === cur) cur = cur.nextSibling;
        else el.insertBefore(node, cur);
    }
    report(out);
    return out;
}
