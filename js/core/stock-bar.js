/**
 * stock-bar.js — 계산기 맨 위 [국내 | 해외] 줄 아래의 "종목 검색 줄" (계산기 공통)
 *
 * 종목을 고르면 시세를 받아, 계산기가 정한 칸을 한 번에 채워요.
 *   국내: 네이버 실시간 (core/naver.js) → 원화      해외: 트레이딩뷰 15분 지연 (core/tradingview.js) → 달러
 *   - 무엇을 어디에 넣을지는 계산기가 정해요: stockFill({ view, data, market }) → { fields: [{ input, value, label }], focus?, note? }
 *   - 이 파일은 그 칸에 값을 넣고 input 이벤트를 보내요 → 계산기는 사람이 직접 친 것처럼 다시 계산·저장
 *     (core/money-input.js의 원화로 넣기와 같은 방식이라, 계산기는 이 파일을 몰라도 돼요)
 *
 * 칸은 "고를 때"와 "[다시 넣기]를 누를 때"만 채워요. 다른 화면에 갔다 와도 내가 고친 값을 덮어쓰지 않게,
 * 고른 종목과 마지막 시세는 기억해서 줄에만 다시 보여줘요 (session.stockOf, 국내·해외 따로).
 */
import { createStockSearch, escapeHtml } from './stock-search.js';
import { loadItems } from './naver.js';
import { loadUsQuote, addKrDividend } from './tradingview.js';
import { isOnline } from './network.js';
import { getStockOf, setStockOf } from './session.js';
import { won, clockTime } from './format.js';
import { showToast } from './toast.js';

/** 값이 들어간 칸을 잠깐 강조 (core/received.js와 같은 .flash) */
function flash(input) {
    input.classList.add('flash');
    input.addEventListener('animationend', () => input.classList.remove('flash'), { once: true });
}

/** 받침이 있으면 '을', 없으면 '를' ("2.75%"는 "퍼센트", "$97.44"는 "달러"로 읽어서 '를') */
function eulReul(text) {
    if (text.endsWith('%') || /\$[\d,.]+$/.test(text)) return '를';
    const code = text.charCodeAt(text.length - 1) - 0xAC00;
    return code >= 0 && code < 11172 && code % 28 === 0 ? '를' : '을';
}

const fixed = (n, d = 2) => n.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });

/** 고른 뒤 한 줄 요약: "삼성전자 005930 · 207,000원 ▼0.48% · 15:20  [↻ 다시 넣기] [✕]" */
function pickedHtml(s) {
    const us = s.kind === 'us';
    // 아직 가격을 못 받았으면(받는 중이거나 실패) 가격 자리에 안내만
    const priceHtml = s.price == null
        ? '<span class="sb-price is-empty">가격 없음</span>'
        : (() => {
            const priceText = us ? `$${s.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `${won(s.price)}원`;
            const tone = s.change > 0 ? 'tone-up' : s.change < 0 ? 'tone-down' : '';
            const arrow = s.change > 0 ? '▲' : s.change < 0 ? '▼' : '–';
            return `<span class="sb-price">${priceText} <span class="${tone}">${arrow}${fixed(Math.abs(s.rate))}%</span>
                <small>${clockTime(new Date(s.time))}${s.delay ? ` · ${s.delay}` : ''}</small></span>`;
        })();
    return `
        <div class="sb-picked">
            <div class="sb-info">
                <span class="sb-name"><b>${escapeHtml(s.name)}</b><small>${s.code}</small></span>
                ${priceHtml}
            </div>
            <button type="button" class="mini-btn sb-refresh" data-sb-refresh data-needs-net ${isOnline() ? '' : 'disabled'}
                    title="지금 가격을 다시 받아 칸을 채워요">↻ 다시 넣기</button>
            <button type="button" class="icon-mini" data-sb-clear aria-label="종목 지우고 다시 검색">✕</button>
        </div>
        <p class="sb-msg" data-sb-msg role="status"></p>`;
}

/**
 * 검색 줄을 그려요.
 * @param {HTMLElement} container - 국내/해외 줄 아래 자리
 * @param {{ featureId: string, market: 'domestic' | 'global', getView: () => HTMLElement, fill: Function }} options
 *   fill: 계산기의 stockFill({ view, data, market })
 */
export function renderStockBar(container, { featureId, market, getView, fill }) {
    container.className = 'stock-bar';
    const us = market === 'global';
    const memoKey = `${featureId}.${market}`;   // 고른 종목은 국내·해외 따로 기억

    // 시세를 기다리는 동안 사용자가 계산기 칸을 직접 고쳤는지 세요 (isTrusted = 사람이 친 입력, 우리가 보낸 이벤트는 제외)
    // → 늦게 도착한 시세가 방금 고친 값을 덮어쓰지 않게
    let edits = 0;
    getView().addEventListener('input', (e) => { if (e.isTrusted) edits += 1; });
    // 시세 요청 번호: ✕를 누르거나 새로 고르면 앞 요청의 결과는 버려요
    let requestNo = 0;

    function showSearch(autofocus = false) {
        container.innerHTML = '<div class="sb-search" data-sb-search></div><p class="sb-msg" data-sb-msg role="status"></p>';
        const { input } = createStockSearch(container.querySelector('[data-sb-search]'), {
            kind: us ? 'us' : 'kr',
            onPick: (stock) => load(stock),
            autofocus,
            placeholder: us ? '종목을 고르면 지금 가격을 칸에 넣어요 (예: 애플, AAPL)' : '종목을 고르면 지금 가격을 칸에 넣어요 (예: 삼성전자)',
        });
        container.querySelector('.ss-foot')?.remove();   // 목록 기준일은 종목 정보 화면에서만
        input.setAttribute('data-needs-net', '');        // 오프라인이면 app.js가 꺼요
        input.disabled = !isOnline();
    }

    function showPicked(s) {
        container.innerHTML = pickedHtml(s);
    }

    const message = (text, isError = false) => {
        const msg = container.querySelector('[data-sb-msg]');
        if (!msg) return;
        msg.textContent = text;
        msg.classList.toggle('is-error', isError);
    };

    /** 시세 받기 → 기억 → 칸 채우기 */
    async function load(stock) {
        const myNo = ++requestNo;
        const editsBefore = edits;
        // 고르자마자 검색칸을 "고른 종목" 줄로 바꿔요. 시세가 실패해도 검색칸으로 돌아가지 않아요.
        // (예전에는 실패하면 검색칸으로 돌아가서, 휴대폰에서 칸을 누를 때 검색칸 목록이 열려 아래 칸을 덮었고
        //  그 위를 누르면 같은 종목이 다시 골라져 "시세를 받지 못했어요"가 되풀이됐어요)
        if (!container.querySelector('.sb-picked')) {
            const pending = { ...stock, price: null };
            setStockOf(memoKey, pending);
            showPicked(pending);
        }
        if (!isOnline()) return message('인터넷 연결이 없어서 가격을 받을 수 없어요. 연결되면 ↻ 다시 넣기를 눌러 주세요', true);
        message(`${stock.name} 지금 가격을 받는 중…`);
        const refresh = container.querySelector('[data-sb-refresh]');
        refresh?.setAttribute('data-busy', '');
        if (refresh) refresh.disabled = true;
        try {
            let data;
            let time;
            if (us) {
                data = await loadUsQuote(stock);
                time = data.time;
            } else {
                const res = await loadItems([stock.code]);
                data = res.items.find(it => it.code === stock.code);
                if (data) await addKrDividend(data);   // ETF처럼 네이버에 배당이 없으면 트레이딩뷰 분배율로
                time = res.time;
            }
            if (!data) throw new Error('시세가 없어요');
            // 종목 정보(kind·code·name·market/exchange…) + 마지막 시세
            const saved = { ...stock, price: data.price, change: data.change, rate: data.rate, time, delay: data.delay ?? '' };
            if (myNo !== requestNo) return;        // 기다리는 동안 ✕를 눌렀거나 다른 종목을 골랐어요
            setStockOf(memoKey, saved);
            if (!container.isConnected) return;   // 기다리는 동안 다른 화면으로 갔으면 칸은 건드리지 않아요
            showPicked(saved);
            if (edits !== editsBefore) {
                // 기다리는 동안 칸을 직접 고쳤으면 그 값을 지켜요
                message('가격을 받았어요. 그사이 고친 값은 그대로 뒀어요 · ↻ 다시 넣기로 넣을 수 있어요');
                return;
            }
            apply(stock, data);
        } catch (err) {
            if (myNo !== requestNo) return;
            message(`${stock.name} 시세를 받지 못했어요. 연결이 좋아지면 ↻ 다시 넣기를 눌러 주세요. 계산기 칸은 그대로 쓸 수 있어요`, true);
            refresh?.removeAttribute('data-busy');
            if (refresh) refresh.disabled = !isOnline();
        }
    }

    /** 계산기가 정한 칸에 값 넣기 */
    function apply(stock, data) {
        const view = getView();
        const plan = fill({ view, data, market }) ?? {};
        const done = [];
        (plan.fields ?? []).forEach(({ input, value, label }) => {
            if (!input) return;
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));   // 계산기가 다시 계산·저장
            // 해외 칸을 원화로 넣는 중(₩)이면 보이는 칸은 원화 칸이라 그쪽을 강조
            flash(input.closest('.is-krw')?.querySelector('.krw-proxy') ?? input);
            done.push(label);
        });
        if (plan.focus) {
            plan.focus.focus({ preventScroll: true });
            plan.focus.select?.();
        }
        const list = done.join(', ');
        const text = done.length ? `${stock.name} · ${list}${eulReul(list)} 넣었어요` : `${stock.name} · 넣을 칸이 없어요`;
        showToast(plan.note ? `${text} (${plan.note})` : text);
    }

    container.addEventListener('click', (e) => {
        const current = getStockOf(memoKey);
        if (e.target.closest('[data-sb-refresh]') && current) load(current);
        if (e.target.closest('[data-sb-clear]')) {
            requestNo += 1;   // 받는 중이던 시세는 버려요
            setStockOf(memoKey, null);
            showSearch(true);
        }
    });

    const remembered = getStockOf(memoKey);
    if (remembered) showPicked(remembered);   // 기억한 종목은 줄에만 보여주고 칸은 그대로
    else showSearch();
}
