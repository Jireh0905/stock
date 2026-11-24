/**
 * tradingview.js — 트레이딩뷰 시세 (해외 주식·선물·달러 인덱스·국채 금리)
 *
 * 트레이딩뷰 사이트가 종목 검색·스크리너에 쓰는 주소(scanner.tradingview.com)를 불러요.
 * ⚠ 공식 API가 아니에요. 바뀌거나 막히면 이 파일만 고치면 되게 모아뒀어요.
 *
 * 네이버(JSONP)와 달리 숫자(JSON)만 받는 보통 요청이라, 남의 코드를 우리 페이지에서 실행하지 않아요.
 * 트레이딩뷰가 브라우저 요청을 허락해줘서(CORS) fetch로 바로 받을 수 있어요.
 *
 * 요청 모양
 *   POST https://scanner.tradingview.com/{시장}/scan
 *   { symbols: { tickers: ['NASDAQ:AAPL', 'TVC:DXY'] }, columns: ['close', 'change'] }
 * 응답 모양
 *   { data: [ { s: 'NASDAQ:AAPL', d: [354.88, -0.21] }, ... ] }   ← d는 columns 순서대로
 *
 * 여러 종목을 한 번에 묶어 받아요 (요청을 적게 보내야 막힐 위험이 줄어요).
 * 'global' 시장은 주식·선물·지수·국채를 가리지 않고 받아줘요.
 */
import { netFetch } from './network.js';

const URL_BASE = 'https://scanner.tradingview.com';
const TIMEOUT = 10000;

/**
 * 종목들의 칸(columns)을 받아요.
 * @param {string[]} tickers - 'EXCHANGE:SYMBOL' 모양 (예: 'NASDAQ:AAPL', 'CME_MINI:NQ1!')
 * @param {string[]} columns - 트레이딩뷰 칸 이름
 * @param {string} [market='global']
 * @returns {Promise<Map<string, Record<string, any>>>} 티커 → { 칸이름: 값 }
 */
export async function scan(tickers, columns, market = 'global') {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT);
    try {
        // body를 문자열로 보내면 "단순 요청"이라 사전 확인(preflight) 없이 바로 가요
        const res = await netFetch(`${URL_BASE}/${market}/scan`, {
            method: 'POST',
            body: JSON.stringify({ symbols: { tickers }, columns }),
            signal: ctl.signal,
        });
        if (!res.ok) throw new Error(`트레이딩뷰 응답 ${res.status}`);
        const json = await res.json();
        if (!Array.isArray(json?.data)) throw new Error('트레이딩뷰 응답 모양이 달라요');
        return new Map(json.data.map(row => [row.s, Object.fromEntries(columns.map((c, i) => [c, row.d?.[i] ?? null]))]));
    } finally {
        clearTimeout(timer);
    }
}

/**
 * 지연 글자: 'delayed_streaming_600' → '10분 지연', 'streaming' → '실시간'
 * @param {string | null} mode - update_mode 칸
 */
export function delayText(mode) {
    const m = /delayed\D*(\d+)/.exec(mode ?? '');
    if (m) return `${Math.round(Number(m[1]) / 60)}분 지연`;
    return mode === 'streaming' ? '실시간' : '';
}

/* ---------- 미국 종목 ---------- */

/** 미국 종목 한 개에 받는 칸 */
const US_COLUMNS = [
    'close', 'change', 'change_abs', 'open', 'high', 'low', 'volume',
    'price_52_week_high', 'price_52_week_low',
    'price_earnings_ttm', 'price_book_fq', 'earnings_per_share_basic_ttm',
    'dps_common_stock_prim_issue_fy', 'dividends_yield_current', 'market_cap_basic',
    // ETF는 위 배당 칸이 비어 있어서 이 칸들을 써요 (최근 12개월 배당 수익률, 최근 1회 분배금, 지급 주기)
    'dividends_yield', 'dividend_amount_recent', 'dividends_frequency',
    'premarket_close', 'premarket_change', 'postmarket_close', 'postmarket_change',
    'nav', 'aum', 'expense_ratio', 'type', 'update_mode', 'description',
];

/**
 * 미국 종목 시세·가치 (트레이딩뷰, 보통 15분 지연)
 * @param {{ code: string, exchange: string }} stock - 예: { code: 'AAPL', exchange: 'NASDAQ' }
 * @returns {Promise<object>} 종목 정보 화면이 쓰는 모양 (국내 naver.js loadItems와 비슷하게)
 */
export async function loadUsQuote(stock) {
    const ticker = `${stock.exchange}:${stock.code}`;
    const rows = await scan([ticker], US_COLUMNS);
    const r = rows.get(ticker);
    const price = num(r?.close);
    if (price == null) throw new Error('시세가 없어요');
    const change = num(r.change_abs) ?? 0;
    const extra = (close, pct) => (num(close) != null ? { price: close, rate: num(pct) ?? 0 } : null);
    // 배당: 주식은 1년 주당 배당금 칸이 있고, ETF는 없어서 "현재가 × 최근 12개월 배당 수익률"로 추정해요
    const divYield = num(r.dividends_yield_current) ?? num(r.dividends_yield);
    let dps = num(r.dps_common_stock_prim_issue_fy);
    const dpsEstimated = dps == null && divYield > 0;
    if (dpsEstimated) dps = price * divYield / 100;
    return {
        code: stock.code,
        name: r.description,
        price,
        prev: price - change,
        change,
        rate: num(r.change) ?? 0,
        dayOpen: num(r.open), high: num(r.high), low: num(r.low), volume: num(r.volume),
        high52: num(r.price_52_week_high), low52: num(r.price_52_week_low),
        per: num(r.price_earnings_ttm), pbr: num(r.price_book_fq), eps: num(r.earnings_per_share_basic_ttm),
        dps,                                                  // 1년 주당 배당금 (달러, 주식은 최근 회계연도 / ETF는 추정)
        dpsEstimated,                                         // true면 현재가 × 최근 12개월 수익률로 추정한 값
        divYield,                                             // 배당 수익률 (%, 최근 12개월)
        divRecent: num(r.dividend_amount_recent),             // 최근 1회 분배금 (달러)
        divFreq: FREQ_N[r.dividends_frequency] ?? null,       // 1년에 몇 번 (12·4·2·1, 모르면 null)
        cap: num(r.market_cap_basic),
        pre: extra(r.premarket_close, r.premarket_change),    // 프리마켓 (정규장 전)
        post: extra(r.postmarket_close, r.postmarket_change), // 애프터마켓 (정규장 뒤)
        isEtf: r.type === 'fund',
        nav: num(r.nav), aum: num(r.aum), expense: num(r.expense_ratio),
        delay: delayText(r.update_mode),
        time: Date.now(),
    };
}

/** 트레이딩뷰 지급 주기 → 1년에 몇 번 */
const FREQ_N = { Monthly: 12, Quarterly: 4, 'Semi-Annual': 2, 'Semi-annual': 2, Annual: 1, Annually: 1 };

/**
 * 국내 종목 배당 보충: 네이버에 주당 배당금이 없을 때(ETF 등) 트레이딩뷰 분배율로 1년 분배금을 추정해요.
 *   1년 분배금 ≈ 현재가 × 최근 12개월 분배율
 * 트레이딩뷰의 국내 1회 분배금·지급 주기는 단위가 이상하거나 "기타"로 와서 쓰지 않아요.
 * 실패해도 시세는 그대로 보여줘야 해서 오류를 던지지 않아요.
 * @param {{ code: string, price: number, dps: number | null }} data - naver.js loadItems의 종목 한 개 (바꿔서 돌려줘요)
 */
export async function addKrDividend(data) {
    if (data.dps > 0) {
        data.divYield ??= data.dps / data.price * 100;
        return data;
    }
    try {
        const rows = await scan([`KRX:${data.code}`], ['dividends_yield']);
        const y = num(rows.get(`KRX:${data.code}`)?.dividends_yield);
        if (y > 0) {
            data.divYield = y;
            data.dps = Math.round(data.price * y / 100);
            data.dpsEstimated = true;
        }
    } catch {
        // 배당은 덤이라 못 받아도 넘어가요
    }
    return data;
}

/* ---------- 애널리스트 · 성장 · 수익성 · 기간별 수익률 (국내·미국 공통) ---------- */

const INSIGHT_COLUMNS = [
    // 애널리스트 의견 (점수 1=강력 매수 … 5=강력 매도)과 사람 수, 목표주가
    'recommendation_mark', 'recommendation_buy', 'recommendation_over', 'recommendation_hold',
    'recommendation_under', 'recommendation_sell', 'recommendation_total',
    'price_target_average', 'price_target_high', 'price_target_low',
    // 성장: EPS는 분기·최근 12개월 기록(_h, [0]이 지금, [4]가 1년 전)을 받아 직접 비교해요 (적자일 때 "적자 축소" 등으로 쓰려고)
    'earnings_per_share_diluted_fq_h', 'earnings_per_share_diluted_ttm_h',
    'total_revenue_yoy_growth_ttm', 'total_revenue_yoy_growth_fq', 'net_income_yoy_growth_ttm', 'net_income_ttm',
    // 수익성
    'operating_margin_ttm', 'net_margin_ttm', 'return_on_equity', 'debt_to_equity',
    // 실적 일정
    'earnings_release_next_date', 'earnings_per_share_forecast_next_fq', 'eps_surprise_percent_fq', 'fiscal_period_current',
    // 기간별 수익률 (%)
    'Perf.W', 'Perf.1M', 'Perf.3M', 'Perf.YTD', 'Perf.Y', 'Perf.5Y',
    // 자세한 재무 (금액은 그 나라 돈): 손익(최근 12개월) · 재무상태(최근 분기) · 현금흐름(최근 12개월) · 가치
    'total_revenue_ttm', 'gross_profit_ttm', 'oper_income_ttm', 'ebitda_ttm',
    'total_assets_fq', 'total_liabilities_fq', 'total_equity_fq', 'total_debt_fq', 'cash_n_short_term_invest_fq', 'current_ratio_fq',
    'cash_f_operating_activities_ttm', 'cash_f_investing_activities_ttm', 'cash_f_financing_activities_ttm',
    'capital_expenditures_ttm', 'free_cash_flow_ttm',
    'enterprise_value_current', 'enterprise_value_ebitda_ttm', 'price_sales_current', 'price_free_cash_flow_ttm', 'number_of_employees',
    'fundamental_currency_code',
    // 추이: 연간(fiscal_period_fy_h = 회계연도) · 분기 기록. [0]이 가장 최근. (영업이익은 기록 칸이 없어서 매출·순이익만)
    'fiscal_period_fy_h', 'total_revenue_fy_h', 'net_income_fy_h', 'total_revenue_fq_h', 'net_income_fq_h',
];

/** 추이 막대에 쓰는 기간 수 */
const TREND_YEARS = 5;
const TREND_QUARTERS = 8;

/**
 * 기록 배열들을 오래된 것 → 최근 순서로, 기간 이름과 함께 묶어요.
 * @param {string[]} labels - 최근부터의 기간 이름
 * @returns {{ labels: string[], revenue: (number|null)[], net: (number|null)[] } | null}
 */
function trendOf(labels, revenue, net, count) {
    if (!Array.isArray(revenue) && !Array.isArray(net)) return null;
    const n = Math.min(count, labels.length, Math.max(revenue?.length ?? 0, net?.length ?? 0));
    if (n < 2) return null;
    const pick = (arr) => Array.from({ length: n }, (_, i) => num(arr?.[i])).reverse();
    const t = { labels: labels.slice(0, n).reverse(), revenue: pick(revenue), net: pick(net) };
    return [...t.revenue, ...t.net].some(v => v != null) ? t : null;
}

/** '2026-Q3'부터 거꾸로 분기 이름: ['26.3Q', '26.2Q', '26.1Q', '25.4Q', …] */
function quarterLabels(current, count) {
    const m = /^(\d{4})-Q([1-4])$/.exec(current ?? '');
    if (!m) return [];
    let y = Number(m[1]);
    let q = Number(m[2]);
    const out = [];
    for (let i = 0; i < count; i++) {
        out.push(`${String(y).slice(2)}.${q}Q`);
        if (--q === 0) { q = 4; y -= 1; }
    }
    return out;
}

/** 자세한 재무 묶음 (값이 하나도 없으면 null — ETF 등) */
function finOf(r) {
    const v = (k) => num(r[k]);
    const fin = {
        currency: r.fundamental_currency_code === 'KRW' ? 'KRW' : r.fundamental_currency_code ?? null,
        income: { revenue: v('total_revenue_ttm'), gross: v('gross_profit_ttm'), operating: v('oper_income_ttm'), net: v('net_income_ttm'), ebitda: v('ebitda_ttm') },
        balance: {
            assets: v('total_assets_fq'), liabilities: v('total_liabilities_fq'), equity: v('total_equity_fq'),
            debt: v('total_debt_fq'), cash: v('cash_n_short_term_invest_fq'), currentRatio: v('current_ratio_fq'),
        },
        cash: {
            operating: v('cash_f_operating_activities_ttm'), investing: v('cash_f_investing_activities_ttm'),
            financing: v('cash_f_financing_activities_ttm'), capex: v('capital_expenditures_ttm'), fcf: v('free_cash_flow_ttm'),
        },
        value: {
            ev: v('enterprise_value_current'), evEbitda: v('enterprise_value_ebitda_ttm'),
            ps: v('price_sales_current'), pfcf: v('price_free_cash_flow_ttm'), employees: v('number_of_employees'),
        },
        annual: trendOf((r.fiscal_period_fy_h ?? []).map(y => `${y}`), r.total_revenue_fy_h, r.net_income_fy_h, TREND_YEARS),
        quarter: trendOf(quarterLabels(r.fiscal_period_current, TREND_QUARTERS), r.total_revenue_fq_h, r.net_income_fq_h, TREND_QUARTERS),
    };
    const any = [fin.income, fin.balance, fin.cash].some(g => Object.values(g).some(x => x != null));
    return any ? fin : null;
}

/** 기록 배열에서 [지금, 1년 전] (분기 기록이면 4칸 전이 작년 같은 분기) */
const yearPair = (h) => (Array.isArray(h) ? [num(h[0]), num(h[4])] : [null, null]);

/**
 * 종목 정보 화면의 덤 정보 (트레이딩뷰). 시세와 따로 받아서, 실패해도 가격 카드는 그대로예요.
 * 값이 없는 묶음은 null이에요 (ETF는 기간별 수익률만, 작은 종목은 애널리스트가 없을 수 있어요).
 *
 * 금액 단위: korea 주소로 물으면 국내 종목의 목표주가·EPS가 원화로 와요.
 * (순이익 칸은 금액으로는 쓰지 않고 적자인지 부호만 봐요)
 *
 * @param {string} ticker - 'KRX:005930', 'NASDAQ:AAPL'
 */
export async function loadInsight(ticker) {
    // 시장별 주소로 물어야 금액이 그 나라 돈으로 와요 (global로 물으면 국내 목표주가·EPS 예상이 달러로 바뀌어 와요)
    const market = ticker.startsWith('KRX:') ? 'korea' : 'america';
    const rows = await scan([ticker], INSIGHT_COLUMNS, market);
    const r = rows.get(ticker);
    if (!r) throw new Error('정보가 없어요');

    const total = num(r.recommendation_total);
    const analyst = total > 0 ? {
        mark: num(r.recommendation_mark),
        strongBuy: num(r.recommendation_buy) ?? 0,
        buy: num(r.recommendation_over) ?? 0,
        hold: num(r.recommendation_hold) ?? 0,
        sell: num(r.recommendation_under) ?? 0,
        strongSell: num(r.recommendation_sell) ?? 0,
        total,
    } : null;
    const avg = num(r.price_target_average);
    const target = avg > 0 ? { avg, high: num(r.price_target_high), low: num(r.price_target_low) } : null;

    const [epsQ, epsQPrev] = yearPair(r.earnings_per_share_diluted_fq_h);
    const [epsT, epsTPrev] = yearPair(r.earnings_per_share_diluted_ttm_h);
    const growth = {
        revenueTtm: num(r.total_revenue_yoy_growth_ttm),
        revenueQ: num(r.total_revenue_yoy_growth_fq),
        eps: { now: epsT, prev: epsTPrev },        // 최근 12개월 EPS와 1년 전
        epsQ: { now: epsQ, prev: epsQPrev },       // 최근 분기 EPS와 작년 같은 분기
        netIncomeTtm: num(r.net_income_yoy_growth_ttm),
        netIncomeLoss: num(r.net_income_ttm) != null && r.net_income_ttm < 0,
        period: typeof r.fiscal_period_current === 'string' ? r.fiscal_period_current : null, // 예: '2026-Q3'
    };
    const hasGrowth = growth.revenueTtm != null || epsT != null || epsQ != null;
    const de = num(r.debt_to_equity);
    const profit = {
        operating: num(r.operating_margin_ttm),
        net: num(r.net_margin_ttm),
        roe: num(r.return_on_equity),
        debt: de == null ? null : de * 100,        // 배수(0.77)로 와서 %(77%)로
    };
    const hasProfit = Object.values(profit).some(v => v != null);
    const next = num(r.earnings_release_next_date);
    const earnings = {
        next: next ? new Date(next * 1000) : null,
        nextEps: num(r.earnings_per_share_forecast_next_fq),
        surprise: num(r.eps_surprise_percent_fq),
    };
    const perf = [['1주', 'Perf.W'], ['1달', 'Perf.1M'], ['3달', 'Perf.3M'], ['올해', 'Perf.YTD'], ['1년', 'Perf.Y'], ['5년', 'Perf.5Y']]
        .map(([label, key]) => ({ label, value: num(r[key]) }))
        .filter(p => p.value != null);

    return {
        analyst,
        target,
        growth: hasGrowth ? growth : null,
        profit: hasProfit ? profit : null,
        earnings: earnings.next || earnings.nextEps != null || earnings.surprise != null ? earnings : null,
        perf: perf.length ? perf : null,
        fin: finOf(r),
        time: Date.now(),
    };
}

/**
 * 목록 파일에 없는 미국 종목 찾기 (코드나 영문 이름으로, 시가총액 순)
 * @returns {Promise<Array<{ code, name, en, exchange, type }>>}
 */
export async function searchUs(query) {
    const q = query.trim();
    if (!/^[A-Za-z0-9 .&-]+$/.test(q)) return [];   // 영문·숫자만 (한글은 목록 파일에서 찾아요)
    const body = (left) => ({
        filter: [
            { left, operation: 'match', right: q },
            { left: 'exchange', operation: 'in_range', right: ['NASDAQ', 'NYSE', 'AMEX'] },
        ],
        sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' },
        columns: ['name', 'description', 'exchange', 'type'],
        range: [0, 10],
    });
    const run = async (left) => {
        const res = await netFetch(`${URL_BASE}/america/scan`, { method: 'POST', body: JSON.stringify(body(left)) });
        if (!res.ok) return [];
        const json = await res.json();
        return (json.data ?? []).map(({ d }) => ({ code: d[0], name: d[1], en: d[1], exchange: d[2], type: d[3] === 'fund' ? 'E' : 'S' }));
    };
    const byCode = await run('name');
    return byCode.length ? byCode : run('description');
}

/** 숫자면 그대로, 아니면 null (응답이 바뀌었을 때 엉뚱한 값을 보여주지 않게) */
export const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * 시세 한 줄을 우리 모양으로: { value, prev, change, rate, delay }
 * prev(전일 종가) = 지금 값 − 전일 대비(change_abs)
 */
export function quoteOf(row) {
    const value = num(row?.close);
    if (value == null) return null;
    const change = num(row.change_abs) ?? 0;
    return { value, prev: value - change, change, rate: num(row.change) ?? 0, delay: delayText(row.update_mode) };
}
