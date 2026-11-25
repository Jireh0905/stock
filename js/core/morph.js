/**
 * morph.js — 바뀐 글자·속성만 고쳐 쓰는 다시 그리기
 *
 * 왜 필요한가요?
 *   시장 지표는 1분마다 값을 새로 받아 카드를 다시 그려요. innerHTML로 통째로 바꾸면
 *   카드 안에 펼쳐 둔 차트(트레이딩뷰 위젯 iframe)도 새로 만들어져서 매번 다시 로딩되고 깜빡여요.
 *   그래서 새 HTML과 지금 화면을 나란히 비교해서, 다른 글자·속성만 고치고 요소는 그대로 둬요.
 *   MFC로 치면 컨트롤을 지웠다 다시 만드는 대신 SetWindowText로 글자만 바꾸는 것과 같아요.
 *
 * data-keep="이름"이 붙은 요소는 안쪽을 비교하지 않고 그대로 둬요 (펼친 차트 자리처럼 따로 관리하는 곳).
 * 같은 이름의 요소가 이미 있으면 그 요소를 그대로 써요 (자리만 다르면 옮겨요).
 */

/**
 * @param {HTMLElement} el - 고칠 요소
 * @param {string} html - 새 안쪽 HTML
 */
export function morph(el, html) {
    if (el.__html === html) return;
    el.__html = html;
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    patchChildren(el, tpl.content);
}

/** 이 둘이 같은 자리로 볼 수 있는 요소인지 (같은 태그, keep이면 같은 이름) */
function same(a, b) {
    if (a.nodeType !== b.nodeType) return false;
    if (a.nodeType !== Node.ELEMENT_NODE) return true;
    return a.tagName === b.tagName && a.dataset.keep === b.dataset.keep;
}

function patchChildren(parent, next) {
    const want = [...next.childNodes];
    // keep 요소는 이름으로 찾아서 그대로 써요 (안쪽을 건드리지 않게)
    const kept = new Map([...parent.children].filter(c => c.dataset.keep).map(c => [c.dataset.keep, c]));
    want.forEach((node, i) => {
        let cur = parent.childNodes[i];
        if (node.nodeType === Node.ELEMENT_NODE && node.dataset.keep) {
            const old = kept.get(node.dataset.keep);
            if (old) {
                kept.delete(node.dataset.keep);
                if (cur !== old) parent.insertBefore(old, cur ?? null);
                return;
            }
        }
        if (!cur) {
            parent.appendChild(node.cloneNode(true));
            return;
        }
        if (!same(cur, node) || cur.dataset?.keep) {
            parent.insertBefore(node.cloneNode(true), cur);
            return;
        }
        if (cur.nodeType === Node.TEXT_NODE || cur.nodeType === Node.COMMENT_NODE) {
            if (cur.nodeValue !== node.nodeValue) cur.nodeValue = node.nodeValue;
            return;
        }
        patchAttributes(cur, node);
        patchChildren(cur, node);
    });
    // 남는 것 지우기
    while (parent.childNodes.length > want.length) parent.lastChild.remove();
}

function patchAttributes(cur, next) {
    for (const { name } of [...cur.attributes]) {
        if (!next.hasAttribute(name)) cur.removeAttribute(name);
    }
    for (const { name, value } of [...next.attributes]) {
        if (cur.getAttribute(name) !== value) cur.setAttribute(name, value);
    }
}
