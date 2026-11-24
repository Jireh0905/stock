/**
 * stock/insight-view.js — 종목 정보의 덤 카드 (국내·해외 공통, 트레이딩뷰 core/tradingview.js loadInsight)
 *
 *   애널리스트 카드 ...... 의견(강력 매수~강력 매도) 막대 + 목표주가 평균·최고·최저, 지금 가격과의 차이
 *   성장·수익성 카드 ..... 매출·EPS 성장률(적자면 "적자 축소" 같은 말로), 이익률·ROE·부채비율, 다음 실적 발표
 *   기간별 수익률 카드 ... 1주 · 1달 · 3달 · 올해 · 1년 · 5년
 *   자세한 재무 .......... 매출·순이익 추이 막대 + 손익·재무상태·현금흐름·가치 (트레이딩뷰 숫자로 직접 그려요)
 *
 * 값이 없는 카드는 빈 글자('')를 돌려줘서 화면에서 빠져요 (ETF는 기간별 수익률만 나와요).
 */
import { isOnline } from '../../core/network.js';
import { escapeHtml } from '../../core/stock-search.js';
import { fixed, sign, row } from './parts.js';

/** 부호 붙인 % 글자: 12.3 → "+12.3%" (tone 클래스와 같이) */
const pct = (v, d = 1) => `${sign(v)}${fixed(Math.abs(v), d)}%`;
const toneCls = (v) => (v > 0 ? 'tone-up' : v < 0 ? 'tone-down' : '');

/* ---------- 불러오는 중 / 실패 ---------- */

/** 덤 정보를 아직 못 받았을 때 (애널리스트 자리에 한 장) */
export function insightWaitingCard(state) {
    let msg = '애널리스트·성장 정보를 불러오는 중…';
    if (!isOnline()) msg = '인터넷에 연결되면 애널리스트·성장 정보를 불러올게요';
    else if (state?.status === 'error') {
        msg = `애널리스트·성장 정보를 불러오지 못했어요 <button type="button" class="mini-btn" data-insight-retry data-needs-net>다시 시도</button>`;
    }
    return `<section class="card"><p class="mk-msg ${state?.status === 'error' ? 'is-error' : ''}">${msg}</p></section>`;
}

/* ---------- 애널리스트 ---------- */

/** 트레이딩뷰 의견 점수(1~5) → 말 (트레이딩뷰 화면과 같은 구간) */
function markLabel(mark) {
    if (mark == null) return null;
    if (mark <= 1.5) return { text: '강력 매수', cls: 'is-strong-buy' };
    if (mark <= 2.5) return { text: '매수', cls: 'is-buy' };
    if (mark <= 3.5) return { text: '중립', cls: 'is-hold' };
    if (mark <= 4.5) return { text: '매도', cls: 'is-sell' };
    return { text: '강력 매도', cls: 'is-strong-sell' };
}

/**
 * 목표주가 막대: 최저 ─ 평균(눈금) ─ 최고, 지금 가격(●)
 * 지금 가격이 범위 밖이면 끝에 붙이고 아래 글로 알려줘요.
 */
function targetRange(t, price, fmt) {
    if (t.high == null || t.low == null || t.high <= t.low) return '';
    const at = (v) => Math.min(Math.max((v - t.low) / (t.high - t.low), 0), 1) * 100;
    const out = price == null ? '' : price > t.high ? ' · 지금 가격이 최고 목표가보다 높아요' : price < t.low ? ' · 지금 가격이 최저 목표가보다 낮아요' : '';
    return `
        <div class="st-range st-target">
            <div class="st-range-head"><span>최저 <b>${fmt(t.low)}</b></span><span>최고 <b>${fmt(t.high)}</b></span></div>
            <div class="st-range-bar" role="img" aria-label="목표주가 범위와 지금 가격">
                <s style="left:${at(t.avg).toFixed(1)}%" title="평균 목표가"></s>
                ${price != null ? `<i style="left:${at(price).toFixed(1)}%"></i>` : ''}
            </div>
            <p class="st-range-note">● 지금 가격 · │ 평균 목표가${out}</p>
        </div>`;
}

/**
 * @param {object} ins - loadInsight 결과
 * @param {number | null} price - 지금 가격 (목표가와의 차이 계산)
 * @param {(n: number) => string} fmt - 가격 글자 ("462,676원" / "$348.52")
 */
export function analystCard(ins, price, fmt) {
    const a = ins.analyst;
    const t = ins.target;
    if (!a && !t) return '';
    const label = markLabel(a?.mark);
    const buy = a ? a.strongBuy + a.buy : 0;
    const sell = a ? a.sell + a.strongSell : 0;
    const w = (n) => (a ? (n / a.total * 100).toFixed(1) : 0);
    const upside = t && price ? (t.avg / price - 1) * 100 : null;
    return `
        <section class="card">
            <h2 class="card-title">애널리스트 의견</h2>
            ${a ? `
            <div class="st-opinion">
                ${label ? `<span class="st-opinion-label ${label.cls}">${label.text}</span>` : ''}
                <span class="st-opinion-count">애널리스트 ${a.total}명</span>
            </div>
            <div class="st-vote-bar" role="img" aria-label="매수 ${buy}명, 중립 ${a.hold}명, 매도 ${sell}명">
                ${buy ? `<i class="v-buy" style="width:${w(buy)}%"></i>` : ''}${a.hold ? `<i class="v-hold" style="width:${w(a.hold)}%"></i>` : ''}${sell ? `<i class="v-sell" style="width:${w(sell)}%"></i>` : ''}
            </div>
            <div class="st-vote-legend">
                <span><i class="v-buy"></i>매수 ${buy}</span><span><i class="v-hold"></i>중립 ${a.hold}</span><span><i class="v-sell"></i>매도 ${sell}</span>
            </div>
            <p class="st-vote-detail">강력 매수 ${a.strongBuy} · 매수 ${a.buy} · 중립 ${a.hold} · 매도 ${a.sell} · 강력 매도 ${a.strongSell}</p>` : ''}
            ${t ? `
            <ul class="rows rows-tight st-rows">
                <li class="${a ? 'divider' : ''}"><span>평균 목표주가</span><span>${fmt(t.avg)}${upside != null ? `<small class="st-sub ${toneCls(upside)}">지금 가격보다 ${pct(upside)}</small>` : ''}</span></li>
            </ul>
            ${targetRange(t, price, fmt)}` : ''}
            <p class="mk-note">트레이딩뷰가 모은 증권사 애널리스트 의견과 12개월 목표주가예요. 네이버·증권사 앱의 컨센서스와 숫자가 다를 수 있어요.</p>
        </section>`;
}

/* ---------- 성장 · 수익성 ---------- */

/**
 * 1년 전과 비교한 글자. 적자가 끼면 %가 오해를 부르기 쉬워서 말로 바꿔요.
 *   둘 다 흑자: +20.3%   적자→흑자: 흑자 전환   흑자→적자: 적자 전환   적자→적자: 적자 축소/확대
 * @returns {{ text: string, cls: string } | null}
 */
export function growthOf(now, prev) {
    if (now == null || prev == null) return null;
    if (prev > 0 && now > 0) {
        const g = (now / prev - 1) * 100;
        return { text: pct(g), cls: toneCls(g) };
    }
    if (prev <= 0 && now > 0) return { text: '흑자 전환', cls: 'tone-up' };
    if (prev > 0 && now <= 0) return { text: '적자 전환', cls: 'tone-down' };
    if (now === prev) return { text: '적자 그대로', cls: '' };
    return now > prev ? { text: '적자 축소', cls: 'tone-up' } : { text: '적자 확대', cls: 'tone-down' };
}

const pctRow = (label, v) => (v == null ? '' : row(label, pct(v), toneCls(v)));
const plainPct = (label, v, d = 1) => (v == null ? '' : row(label, `${v < 0 ? '−' : ''}${fixed(Math.abs(v), d)}%`, v < 0 ? 'tone-down' : ''));

/** 실적 발표일: "2027. 2. 3. (수)" */
const dateText = (d) => d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' });

/**
 * @param {object} ins - loadInsight 결과
 * @param {(n: number) => string} fmt - 주당 금액 글자 (EPS 예상치)
 */
export function growthCard(ins, priceFmt) {
    // 적자 EPS 예상치: "$-0.57" 대신 "−$0.57", "-212원" 대신 "−212원"
    const fmt = (n) => (n < 0 ? `−${priceFmt(-n)}` : priceFmt(n));
    const g = ins.growth;
    const p = ins.profit;
    const e = ins.earnings;
    if (!g && !p && !e) return '';
    const epsT = g && growthOf(g.eps.now, g.eps.prev);
    const epsQ = g && growthOf(g.epsQ.now, g.epsQ.prev);
    // 순이익 성장률은 EPS가 1년 전·지금 모두 흑자일 때만 % 그대로 (적자가 끼면 EPS 줄의 말로 충분해요)
    const plainNet = g && g.netIncomeTtm != null && !g.netIncomeLoss && g.eps.prev > 0 && g.eps.now > 0;
    const growthRows = g ? [
        pctRow('매출 (최근 12개월)', g.revenueTtm),
        pctRow('매출 (최근 분기)', g.revenueQ),
        epsT ? row('EPS (최근 12개월)', epsT.text, epsT.cls) : '',
        epsQ ? row('EPS (최근 분기)', epsQ.text, epsQ.cls) : '',
        plainNet ? pctRow('순이익 (최근 12개월)', g.netIncomeTtm) : '',
    ].join('') : '';
    const profitRows = p ? [
        plainPct('영업이익률', p.operating),
        plainPct('순이익률', p.net),
        plainPct('ROE (자기자본이익률)', p.roe),
        p.debt == null ? '' : row('부채비율 (부채 ÷ 자본)', `${fixed(p.debt, 0)}%`),
    ].join('') : '';
    const surprise = e?.surprise;
    const earningsRows = e ? [
        e.next ? row('다음 실적 발표 (예정)', dateText(e.next)) : '',
        e.nextEps != null ? row('다음 분기 EPS 예상', fmt(e.nextEps)) : '',
        surprise != null ? row('지난 분기 EPS 예상 대비',
            `${pct(surprise)}<small class="st-sub">${surprise > 0 ? '예상보다 좋았어요' : surprise < 0 ? '예상보다 못했어요' : '예상과 같았어요'}</small>`,
            toneCls(surprise)) : '',
    ].join('') : '';
    const block = (title, rows) => (rows ? `<h3 class="sub-title">${title}</h3><ul class="rows rows-tight st-rows">${rows}</ul>` : '');
    return `
        <section class="card">
            <h2 class="card-title">성장 · 수익성</h2>
            ${block(`1년 전보다${g?.period ? ` <span class="sub-title-note">${escapeHtml(g.period.replace('-', ' '))}까지</span>` : ''}`, growthRows)}
            ${block('얼마나 남기나', profitRows)}
            ${block('실적 발표', earningsRows)}
            <p class="mk-note">트레이딩뷰 기준이에요. 성장률은 1년 전(분기는 작년 같은 분기)과 비교했어요.
                EPS가 적자인 때가 끼면 %가 크게 튀어서 "흑자 전환 · 적자 축소"처럼 말로 보여줘요.</p>
        </section>`;
}

/* ---------- 기간별 수익률 ---------- */

export function perfCard(ins) {
    if (!ins.perf) return '';
    return `
        <section class="card">
            <h2 class="card-title">기간별 수익률</h2>
            <div class="st-perf">
                ${ins.perf.map(p => `
                    <div class="st-perf-item ${p.value > 0 ? 'is-up' : p.value < 0 ? 'is-down' : ''}">
                        <span>${p.label}</span><b>${pct(p.value)}</b>
                    </div>`).join('')}
            </div>
            <p class="mk-note">그 기간 전 종가부터 지금 가격까지 오르내린 비율이에요 (배당은 빼고). 트레이딩뷰 기준.</p>
        </section>`;
}

/* ---------- 자세한 재무 (우리가 직접 그려요) ---------- */
/*
 * 예전에는 트레이딩뷰 재무 위젯을 넣었는데, 위젯이 폭과 상관없이 항상 두 칸으로 나눠서
 * 휴대폰에서 "영업 현금 흐름 (순…"처럼 이름이 잘렸어요. 그래서 같은 숫자(트레이딩뷰)를 받아 한 칸씩 그려요.
 * 금액은 우리말 단위로: 594,463,494,000,000원 → "594.5조 원", 145,097,000,000달러 → "1,451억 달러".
 */

/** 큰 금액을 조·억·만 단위로 (unit: '원' | '달러') */
export function koMoney(n, unit) {
    if (n == null) return '—';
    const a = Math.abs(n);
    const s = n < 0 ? '−' : '';
    const k = (v) => Math.round(v).toLocaleString('ko-KR');
    let body;
    if (a >= 1e12) body = `${fixed(a / 1e12, 1)}조`;
    else if (a >= 1e8) body = `${k(a / 1e8)}억`;
    else if (a >= 1e4) body = `${k(a / 1e4)}만`;
    else body = k(a);
    return `${s}${body} ${unit}`;
}

/** 그래프 눈금·표용 짧은 금액: "594조", "4,786억", "−36억" (단위 글자 없이) */
function shortMoney(n) {
    if (n == null) return '—';
    const a = Math.abs(n);
    const s = n < 0 ? '−' : '';
    if (a >= 1e12) return `${s}${a >= 1e14 ? Math.round(a / 1e12).toLocaleString('ko-KR') : fixed(a / 1e12, 1)}조`;
    if (a >= 1e8) return `${s}${Math.round(a / 1e8).toLocaleString('ko-KR')}억`;
    if (a >= 1e4) return `${s}${Math.round(a / 1e4).toLocaleString('ko-KR')}만`;
    return `${s}${Math.round(a)}`;
}

const times = (v) => (v == null ? '—' : v <= 0 ? '—' : `${fixed(v)}배`);

/** 매출·순이익 추이 막대 (SVG, 크기를 처음부터 정해 둬요) */
function trendSvg(t) {
    const W = 320, H = 150, L = 44, R = 6, T = 8, B = 20;
    const vals = [...t.revenue, ...t.net].filter(v => v != null);
    const max = Math.max(...vals, 0);
    const min = Math.min(...vals, 0);
    const span = max - min || 1;
    const y = (v) => T + (max - v) / span * (H - T - B);
    const slot = (W - L - R) / t.labels.length;
    const bw = Math.min(slot * 0.32, 18);
    const bar = (v, x, cls) => (v == null ? '' :
        `<rect class="${cls}" x="${x.toFixed(1)}" y="${Math.min(y(v), y(0)).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(Math.abs(y(v) - y(0)), 0.8).toFixed(1)}"/>`);
    const bars = t.labels.map((label, i) => {
        const cx = L + slot * i + slot / 2;
        return `${bar(t.revenue[i], cx - bw - 1, 'fin-rev')}${bar(t.net[i], cx + 1, t.net[i] < 0 ? 'fin-net is-loss' : 'fin-net')}
            <text class="axis-label" x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle">${escapeHtml(label)}</text>`;
    }).join('');
    const ticks = [max, min < 0 ? min : null, 0].filter((v, i, a) => v != null && a.indexOf(v) === i);
    const grid = ticks.map(v => `
        <line class="grid-line${v === 0 ? ' is-zero' : ''}" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>
        <text class="axis-label" x="${L - 4}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${v === 0 ? '0' : shortMoney(v)}</text>`).join('');
    return `<svg class="chart fin-chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="aspect-ratio: ${W} / ${H}" role="img" aria-label="매출과 순이익 추이">${grid}${bars}</svg>`;
}

/** 추이 표: 기간 · 매출 · 순이익 · 순이익률 (최근이 위) */
function trendTable(t) {
    const rows = t.labels.map((label, i) => {
        const rev = t.revenue[i], net = t.net[i];
        // 매출이 아주 작으면(예: 출시 전 회사) 순이익률이 −8,000%처럼 의미 없이 커져서 빼요
        const raw = rev > 0 && net != null ? net / rev * 100 : null;
        const margin = raw != null && Math.abs(raw) <= 1000 ? raw : null;
        return `<tr><th>${escapeHtml(label)}</th><td>${shortMoney(rev)}</td>
            <td class="${net < 0 ? 'tone-down' : ''}">${shortMoney(net)}</td>
            <td class="${margin < 0 ? 'tone-down' : ''}">${margin == null ? '—' : `${margin < 0 ? '−' : ''}${fixed(Math.abs(margin), 1)}%`}</td></tr>`;
    }).reverse().join('');
    return `<table class="year-table fin-table"><thead><tr><th>기간</th><th>매출</th><th>순이익</th><th>순이익률</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/**
 * 자세한 재무 칸 (처음엔 접혀 있어요). 안쪽([data-fin-box])은 finBody로 채워요.
 * 접힘 상태가 시세 갱신 때 풀리지 않게, 이 틀은 종목이 바뀔 때만 새로 만들어요 (index.js drawFin).
 */
export function financialsCard() {
    return `
        <section class="card">
            <details class="st-fin" data-fin>
                <summary>자세한 재무 보기</summary>
                <div data-fin-box></div>
            </details>
        </section>`;
}

/**
 * @param {object} fin - loadInsight 결과의 fin
 * @param {'annual' | 'quarter'} view - 추이 막대 [연간 | 분기]
 */
export function finBody(fin, view) {
    const unit = fin.currency === 'KRW' ? '원' : fin.currency === 'USD' ? '달러' : (fin.currency ?? '');
    const m = (n) => koMoney(n, unit);
    const has = (g) => Object.values(g).some(v => v != null);
    const line = (label, v, cls = '') => (v == null ? '' : row(label, v, cls));
    const money = (label, v) => line(label, v == null ? null : m(v), v < 0 ? 'tone-down' : '');
    const block = (title, note, rows) => (rows.trim() ? `<h3 class="sub-title">${title}${note ? ` <span class="sub-title-note">${note}</span>` : ''}</h3><ul class="rows rows-tight st-rows">${rows}</ul>` : '');
    const views = [['annual', '연간', fin.annual], ['quarter', '분기', fin.quarter]].filter(v => v[2]);
    const shown = views.find(v => v[0] === view) ?? views[0];
    const { income: i, balance: b, cash: c, value: v } = fin;
    return `
        ${shown ? `
        <h3 class="sub-title">매출 · 순이익 추이 <span class="sub-title-note">단위: ${unit}</span></h3>
        ${views.length > 1 ? `
        <div class="segmented small fin-tabs" role="tablist" aria-label="추이 기간">
            ${views.map(([key, label]) => `<button type="button" role="tab" aria-selected="${key === shown[0]}" data-fin-view="${key}">${label}</button>`).join('')}
        </div>` : ''}
        <div class="chart-wrap">${trendSvg(shown[2])}</div>
        <div class="chart-legend"><span><i class="lg-fin-rev"></i>매출</span><span><i class="lg-fin-net"></i>순이익</span>${shown[2].net.some(n => n < 0) ? '<span><i class="lg-fin-loss"></i>순손실</span>' : ''}</div>
        ${trendTable(shown[2])}` : ''}
        ${has(i) ? block('손익', '최근 12개월', [
            money('매출', i.revenue), money('매출총이익', i.gross), money('영업이익', i.operating),
            money('순이익', i.net), money('EBITDA (영업이익 + 감가상각)', i.ebitda)].join('')) : ''}
        ${has(b) ? block('재무상태', '최근 분기 말', [
            money('자산', b.assets), money('부채', b.liabilities), money('자본', b.equity),
            money('차입금 (빌린 돈)', b.debt), money('현금성 자산', b.cash),
            line('유동비율 (1년 안 갚을 돈 대비 현금화할 자산)', b.currentRatio == null ? null : `${fixed(b.currentRatio * 100, 0)}%`)].join('')) : ''}
        ${has(c) ? block('현금흐름', '최근 12개월', [
            money('영업활동 (장사로 번 현금)', c.operating), money('투자활동', c.investing), money('재무활동', c.financing),
            money('설비투자', c.capex), money('잉여현금흐름 (영업 − 설비투자)', c.fcf)].join('')) : ''}
        ${has(v) ? block('가치', '', [
            money('기업가치 (시가총액 + 순부채)', v.ev),
            line('EV/EBITDA', v.evEbitda == null ? null : times(v.evEbitda)),
            line('PSR (시가총액 ÷ 매출)', v.ps == null ? null : times(v.ps)),
            line('P/FCF (시가총액 ÷ 잉여현금흐름)', v.pfcf == null ? null : times(v.pfcf)),
            line('직원 수', v.employees == null ? null : `${Math.round(v.employees).toLocaleString('ko-KR')}명`)].join('')) : ''}
        <p class="mk-note">트레이딩뷰 기준이에요. 분기 이름은 회사의 회계 분기라 달력 분기와 다를 수 있어요 (예: 애플은 9월 말 결산).</p>`;
}
