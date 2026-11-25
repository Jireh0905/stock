/**
 * fx/detail.js — 시장 지표 항목을 펼쳤을 때: 차트 + 일별 시세
 *
 * 항목마다 쓸 수 있는 것이 달라요 (키 없이 브라우저에서 받을 수 있는 것만):
 *   series ... 날짜별 값을 받아서 우리가 선 차트 + 일별 표를 그려요
 *              환율·달러 인덱스(유럽중앙은행) · 비트코인(업비트·바이낸스 일봉) · 미국 실효 금리(뉴욕 연은) · 미국 국채(재무부)
 *   image .... 네이버 증권 차트 그림 (국내 지수·한국 국채 3년). 날짜별 값은 브라우저에서 막혀 있어서 표는 없어요
 *   widget ... 트레이딩뷰 작은 차트 위젯 (해외 선물·금). 선물·지수 자체는 위젯에서 막혀 있어서
 *              같은 대상을 따라가는 CFD 차트를 보여줘요 (값이 선물과 조금 달라요)
 * 한국 기준 금리·한국 국채 10년은 볼 곳이 없어서 펼치기가 없어요.
 */
import { getJson, getText, num, daysAgo, DXY_CODES, dollarIndex, parseCsv, isoFromUs, treasuryUrl, TENORS } from './sources.js';
import { isOnline } from '../../core/network.js';

/** 받은 날짜별 값을 이만큼 기억해요 (펼 때마다 요청하지 않게) */
const KEEP_MS = 10 * 60 * 1000;

const fixed = (n, d = 2) => n.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });

/* ---------- 날짜별 값 받기 (묶음마다 1년 치를 한 번에) ---------- */

/**
 * 묶음별 받기: [{ date: 'YYYY-MM-DD', r }] 오래된 → 최근. r는 묶음마다 모양이 달라요 (항목의 pick이 꺼내 써요)
 */
const GROUPS = {
    // 유럽중앙은행 기준가: 1년 치 (원·엔·위안 + 달러 인덱스 6개 통화)
    async fx() {
        const codes = ['KRW', 'JPY', 'CNY', ...DXY_CODES.filter(c => c !== 'JPY')];
        const json = await getJson(`https://api.frankfurter.dev/v1/${daysAgo(370)}..?base=USD&symbols=${codes.join(',')}`);
        return Object.keys(json?.rates ?? {}).sort().map(date => ({ date, r: json.rates[date] }));
    },
    // 업비트 원화 비트코인 일봉: 한 번에 200개까지라 두 번 (약 400일)
    async upbit() {
        const url = (to) => `https://api.upbit.com/v1/candles/days?market=KRW-BTC&count=200${to ? `&to=${encodeURIComponent(to)}` : ''}`;
        const first = await getJson(url());
        const last = first.at(-1);
        const more = last ? await getJson(url(`${last.candle_date_time_utc}Z`)) : [];
        return [...first, ...more]
            .map(c => ({ date: c.candle_date_time_kst.slice(0, 10), r: num(c.trade_price, '종가') }))
            .filter((x, i, a) => a.findIndex(y => y.date === x.date) === i)
            .sort((a, b) => a.date.localeCompare(b.date));
    },
    // 바이낸스 USDT 비트코인 일봉 (UTC 0시 기준 하루)
    async binance() {
        const rows = await getJson('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=370');
        return rows.map(k => ({ date: new Date(k[0]).toISOString().slice(0, 10), r: num(k[4], '종가') }));
    },
    // 뉴욕 연은 실효 금리 (영업일, 약 1년)
    async effr() {
        const json = await getJson('https://markets.newyorkfed.org/api/rates/unsecured/effr/last/260.json');
        return (json?.refRates ?? []).map(x => ({ date: x.effectiveDate, r: num(x.percentRate, '실효 금리') }))
            .sort((a, b) => a.date.localeCompare(b.date));
    },
    // 미국 재무부 국채 금리: 올해 + 작년 CSV
    async treasury() {
        const year = new Date().getFullYear();
        const [now, before] = await Promise.all([getText(treasuryUrl(year)), getText(treasuryUrl(year - 1))]);
        return [...parseCsv(before), ...parseCsv(now)]
            .map(row => ({ date: isoFromUs(row.Date), r: row }))
            .sort((a, b) => a.date.localeCompare(b.date));
    },
};

/** 묶음별 상태 { status, rows, at, error } (모듈 변수라 화면을 떠났다 와도 남아요) */
const groups = {};

/**
 * 묶음을 받아요 (받는 중이거나 10분 안에 받았으면 건너뛰어요).
 * @param {Function} onDone - 끝나면(성공·실패) 불러요 (화면 다시 그리기)
 */
export async function loadGroup(name, onDone, force = false) {
    const g = groups[name];
    if (!isOnline() || g?.status === 'loading') return;
    if (!force && g?.rows && Date.now() - g.at < KEEP_MS) return;
    groups[name] = { ...g, status: 'loading' };
    onDone();
    try {
        const rows = await GROUPS[name]();
        if (rows.length < 2) throw new Error('날짜별 값이 모자라요');
        groups[name] = { status: 'ok', rows, at: Date.now() };
    } catch (err) {
        groups[name] = { ...groups[name], status: 'error', error: err.message };
        console.warn(`[시장 지표] ${name} 날짜별 값:`, err);
    }
    onDone();
}

/* ---------- 항목 정의 ---------- */

const won = (d = 2) => (v) => `${fixed(v, d)}원`;
const pctFmt = (d = 2) => (v) => `${fixed(v, d)}%`;
const krwPer = (code, unit = 1) => (r) => r.KRW / r[code] * unit;

/** 네이버 국내 지수 그림 종류 (종목 정보와 같은 모바일 그림) */
const INDEX_KINDS = [
    ['day', '오늘'], ['candle/day', '일봉'], ['candle/week', '주봉'], ['candle/month', '월봉'],
    ['area/month3', '3개월'], ['area/year', '1년'], ['area/year3', '3년'],
];
const indexImage = (code) => ({
    type: 'image',
    kinds: INDEX_KINDS,
    size: [658, 408],
    url: (kind) => `https://ssl.pstatic.net/imgfinance/chart/mobile/${kind}/${code}_end.png?t=${Math.floor(Date.now() / 60000)}`,
    note: '네이버 증권 차트 그림이에요 (봉 차트의 선은 5·20·60 이동평균, 아래 막대는 거래량). 날짜별 값은 네이버가 다른 사이트에서 읽지 못하게 막아 둬서 표는 없어요.',
});

/** 트레이딩뷰 위젯 (해외 선물·금): 같은 대상을 따라가는 CFD */
const widget = (symbol, what) => ({
    type: 'widget',
    symbol,
    note: `트레이딩뷰는 선물 차트를 다른 사이트에서 막아 둬서, 같은 대상을 따라가는 ${what} 차트를 보여줘요. 값이 위 숫자와 조금 달라서 흐름을 보는 용도예요.`,
});

/**
 * 펼칠 수 있는 항목: 키 → 설정
 *   series: { group, pick(r) → 값, fmt(값) → 글자, rate(금리면 true: 변화를 bp로), digits(변화 글자 소수 자리) }
 */
export const DETAILS = {
    'kr:KOSPI': indexImage('KOSPI'),
    'kr:KOSDAQ': indexImage('KOSDAQ'),
    'kr:KPI200': indexImage('KPI200'),
    'kr:FUT': indexImage('FUT'),

    'fx:KRW': { type: 'series', group: 'fx', pick: (r) => r.KRW, fmt: won(), digits: 2 },
    'fx:JPY': { type: 'series', group: 'fx', pick: (r) => r.JPY, fmt: (v) => `${fixed(v)}엔`, digits: 2 },
    'fx:JPY100': { type: 'series', group: 'fx', pick: krwPer('JPY', 100), fmt: won(), digits: 2 },
    'fx:CNY': { type: 'series', group: 'fx', pick: krwPer('CNY'), fmt: won(), digits: 2 },
    'fx:EUR': { type: 'series', group: 'fx', pick: krwPer('EUR'), fmt: won(), digits: 2 },
    'fx:DXY': {
        type: 'series', group: 'fx', pick: (r) => dollarIndex(r), fmt: (v) => fixed(v), digits: 2,
        note: '유럽중앙은행 기준가의 6개 통화로 계산한 근사값이에요 (위 숫자는 트레이딩뷰 실제 지수라 조금 달라요).',
    },

    'gold': widget('OANDA:XAUUSD', '금 현물(XAU/USD)'),
    'btc:upbit': { type: 'series', group: 'upbit', pick: (r) => r, fmt: won(0), digits: 0, note: '업비트 일봉 종가 (한국 시간 0시~24시)예요. 오늘 줄은 지금 값이에요.' },
    'btc:binance': { type: 'series', group: 'binance', pick: (r) => r, fmt: (v) => `$${fixed(v)}`, digits: 2, note: '바이낸스 일봉 종가 (UTC 0시 = 한국 시간 오전 9시 기준)예요. 오늘 줄은 지금 값이에요.' },

    'fut:NQ': widget('OANDA:NAS100USD', '나스닥100 CFD(NAS100)'),
    'fut:ES': widget('OANDA:SPX500USD', 'S&P500 CFD(SPX500)'),
    'fut:CL': widget('TVC:USOIL', 'WTI 원유 CFD(USOIL)'),
    'fut:GC': widget('OANDA:XAUUSD', '금 현물(XAU/USD)'),

    'krb:3': {
        type: 'image',
        kinds: [['area/month', '1달'], ['area/month3', '3개월'], ['area/year', '1년'], ['area/year3', '3년']],
        size: [700, 243],
        url: (kind) => `https://ssl.pstatic.net/imgfinance/chart/marketindex/${kind}/IRR_GOVT03Y.png?t=${Math.floor(Date.now() / 600000)}`,
        note: '네이버 증권 국고채 3년 금리 그림이에요 (장 마감 기준이라 위 실시간 값과 조금 다를 수 있어요).',
    },
    'fed:effr': { type: 'series', group: 'effr', pick: (r) => r, fmt: pctFmt(), rate: true, note: '뉴욕 연은이 영업일마다 발표하는 실효 금리예요.' },
    ...Object.fromEntries(TENORS.map(([key, label]) => [`ust:${key}`, {
        type: 'series', group: 'treasury', pick: (r) => parseFloat(r[key]), fmt: pctFmt(), rate: true,
        note: `미국 재무부가 영업일마다 발표하는 ${label} 국채 금리예요.`,
    }])),
    'ust:spread': {
        type: 'series', group: 'treasury', pick: (r) => parseFloat(r['10 Yr']) - parseFloat(r['2 Yr']),
        fmt: (v) => `${v >= 0 ? '+' : '−'}${fixed(Math.abs(v))}%p`, rate: true, zero: true,
        note: '10년 금리 − 2년 금리예요. 0 아래(역전)면 짧게 빌리는 금리가 더 높다는 뜻이에요.',
    },
};

/** 펼치기 버튼 글자 */
export const toggleLabel = (key) => (DETAILS[key]?.type === 'series' ? '차트·일별 시세' : '차트');

/* ---------- 펼친 칸 그리기 ---------- */

/** 항목별 화면 상태 (기간 탭·그림 종류·표 줄 수) */
const view = {};
export const viewOf = (key) => (view[key] ??= { range: '3m', kind: null, rows: 10 });

const RANGES = [['1m', '1달', 31], ['3m', '3달', 92], ['1y', '1년', 366]];

/** 날짜별 값 → [{ date, value }] (값이 숫자가 아닌 날은 빼요) */
function seriesOf(cfg) {
    const rows = groups[cfg.group]?.rows ?? [];
    return rows.map(({ date, r }) => {
        try {
            const value = cfg.pick(r);
            return Number.isFinite(value) ? { date, value } : null;
        } catch {
            return null;
        }
    }).filter(Boolean);
}

const md = (iso) => `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}`;

/** 선 차트 (SVG, 크기를 처음부터 정해 둬요). 최고·최저 점에 값 글자 */
function lineSvg(pts, cfg) {
    const W = 320, H = 150, L = 6, R = 6, T = 16, B = 20;
    const vals = pts.map(p => p.value);
    let max = Math.max(...vals), min = Math.min(...vals);
    if (cfg.zero) { max = Math.max(max, 0); min = Math.min(min, 0); }
    const span = max - min || Math.abs(max) || 1;
    const x = (i) => L + (W - L - R) * (pts.length === 1 ? 0.5 : i / (pts.length - 1));
    const y = (v) => T + (max - v) / span * (H - T - B);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
    const area = `${line}L${x(pts.length - 1).toFixed(1)},${H - B}L${x(0).toFixed(1)},${H - B}Z`;
    const up = pts.at(-1).value >= pts[0].value;
    const hi = vals.indexOf(Math.max(...vals));
    const lo = vals.indexOf(Math.min(...vals));
    const label = (i, above) => {
        const tx = Math.min(Math.max(x(i), 40), W - 40);
        return `<circle class="mk-pt" cx="${x(i).toFixed(1)}" cy="${y(pts[i].value).toFixed(1)}" r="2.5"/>
            <text class="axis-label mk-pt-label" x="${tx.toFixed(1)}" y="${(y(pts[i].value) + (above ? -6 : 12)).toFixed(1)}" text-anchor="middle">${above ? '최고' : '최저'} ${cfg.fmt(pts[i].value)}</text>`;
    };
    const ticks = [0, Math.floor((pts.length - 1) / 2), pts.length - 1];
    // 6달이 넘으면 날짜 대신 "25.11"처럼 연·월 (1년 차트에서 11/24 … 11/25가 헷갈리지 않게)
    const long = Date.parse(pts.at(-1).date) - Date.parse(pts[0].date) > 183 * 864e5;
    const tickText = (iso) => (long ? `${iso.slice(2, 4)}.${+iso.slice(5, 7)}` : md(iso));
    const zero = cfg.zero && min < 0 && max > 0
        ? `<line class="grid-line is-zero" x1="${L}" x2="${W - R}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"/>` : '';
    return `
        <svg class="chart mk-line ${up ? 'is-up' : 'is-down'}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="aspect-ratio: ${W} / ${H}" role="img" aria-label="날짜별 값 선 차트">
            ${zero}
            <path class="mk-area" d="${area}"/>
            <path class="mk-path" d="${line}"/>
            ${label(hi, true)}${hi !== lo ? label(lo, false) : ''}
            ${ticks.map(i => `<text class="axis-label" x="${x(i).toFixed(1)}" y="${H - 5}" text-anchor="${i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'}">${tickText(pts[i].date)}</text>`).join('')}
        </svg>`;
}

/** 일별 표: 날짜 · 값 · 전일 대비 · 등락률 (금리는 bp) */
function dailyTable(pts, cfg, count) {
    const rows = [];
    for (let i = pts.length - 1; i >= Math.max(pts.length - count, 0); i--) {
        const p = pts[i];
        const prev = pts[i - 1]?.value;
        let diff = '', rate = '';
        if (prev != null) {
            if (cfg.rate) {
                const bp = Math.round((p.value - prev) * 100);
                diff = `<td class="${bp > 0 ? 'tone-up' : bp < 0 ? 'tone-down' : ''}">${bp > 0 ? '▲' : bp < 0 ? '▼' : '–'} ${Math.abs(bp)}bp</td>`;
            } else {
                const d = +(p.value - prev).toFixed(cfg.digits ?? 2);
                const pct = prev ? (p.value - prev) / prev * 100 : 0;
                const cls = d > 0 ? 'tone-up' : d < 0 ? 'tone-down' : '';
                diff = `<td class="${cls}">${d > 0 ? '▲' : d < 0 ? '▼' : '–'} ${fixed(Math.abs(d), cfg.digits ?? 2)}</td>`;
                rate = `<td class="${cls}">${pct >= 0 ? '+' : '−'}${fixed(Math.abs(pct))}%</td>`;
            }
        } else {
            diff = '<td>—</td>';
            rate = cfg.rate ? '' : '<td>—</td>';
        }
        rows.push(`<tr><th>${p.date.slice(2).replace(/-/g, '.')}</th><td>${cfg.fmt(p.value)}</td>${diff}${rate}</tr>`);
    }
    return `
        <table class="year-table mk-daily">
            <thead><tr><th>날짜</th><th>값</th><th>전일 대비</th>${cfg.rate ? '' : '<th>등락률</th>'}</tr></thead>
            <tbody>${rows.join('')}</tbody>
        </table>`;
}

/**
 * 펼친 칸 안쪽 HTML (series·image). widget은 index.js가 위젯을 한 번만 넣어요.
 * @param {string} key - DETAILS의 키
 */
export function detailHtml(key) {
    const cfg = DETAILS[key];
    const v = viewOf(key);
    if (cfg.type === 'image') {
        const kind = v.kind ?? cfg.kinds[Math.min(1, cfg.kinds.length - 1)][0];
        return `
            <div class="segmented small mk-tabs" role="tablist" aria-label="차트 종류">
                ${cfg.kinds.map(([k, label]) => `<button type="button" role="tab" aria-selected="${k === kind}" data-detail-kind="${k}">${label}</button>`).join('')}
            </div>
            <div class="st-chart">${isOnline()
                ? `<img src="${cfg.url(kind)}" alt="차트" width="${cfg.size[0]}" height="${cfg.size[1]}" loading="lazy" data-detail-img>`
                : '<p class="mk-msg">인터넷에 연결되면 보여요</p>'}</div>
            ${kind === 'day' ? '<p class="mk-note st-today-note">오늘 차트는 한국거래소(KRX) 정규장 09:00~15:30만 그려요.</p>' : ''}
            <p class="mk-note">${cfg.note}</p>`;
    }
    // series
    const g = groups[cfg.group];
    const all = seriesOf(cfg);
    if (!all.length) {
        let msg = '불러오는 중…';
        if (!isOnline()) msg = '인터넷에 연결되면 불러올게요';
        else if (g?.status === 'error') msg = `날짜별 값을 불러오지 못했어요 <button type="button" class="mini-btn" data-detail-retry data-needs-net>다시 시도</button>`;
        return `<p class="mk-msg ${g?.status === 'error' ? 'is-error' : ''}">${msg}</p>`;
    }
    const [, , days] = RANGES.find(r => r[0] === v.range) ?? RANGES[1];
    const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    const pts = all.filter(p => p.date >= since);
    const shown = pts.length >= 2 ? pts : all.slice(-2);
    const first = shown[0].value, last = shown.at(-1).value;
    const periodChg = cfg.rate
        ? `${Math.round((last - first) * 100) >= 0 ? '+' : '−'}${Math.abs(Math.round((last - first) * 100))}bp`
        : `${last >= first ? '+' : '−'}${fixed(Math.abs((last / first - 1) * 100))}%`;
    return `
        <div class="mk-detail-head">
            <div class="segmented small mk-tabs mk-range" role="tablist" aria-label="기간">
                ${RANGES.map(([k, label]) => `<button type="button" role="tab" aria-selected="${k === v.range}" data-detail-range="${k}">${label}</button>`).join('')}
            </div>
            <span class="mk-period ${last > first ? 'tone-up' : last < first ? 'tone-down' : ''}">기간 ${periodChg}</span>
        </div>
        <div class="chart-wrap">${lineSvg(shown, cfg)}</div>
        ${dailyTable(all, cfg, v.rows)}
        ${v.rows < 30 && all.length > v.rows ? '<button type="button" class="text-btn mk-more" data-detail-more>30일까지 더 보기 ▾</button>' : ''}
        <p class="mk-note">${cfg.note ?? '유럽중앙은행 기준가예요 (영업일마다 한 번).'}${g?.status === 'error' ? ' · 새 값을 못 받아서 지난 값이에요' : ''}</p>`;
}

/** series면 받아야 할 묶음 이름 (아니면 null) */
export const groupOf = (key) => (DETAILS[key]?.type === 'series' ? DETAILS[key].group : null);

/**
 * 트레이딩뷰 작은 차트 위젯 넣기 (한 번만. 다시 넣으면 새로 로딩돼요)
 * @param {HTMLElement} box - 펼친 칸 (data-detail-slot)
 */
export function mountWidget(box, key) {
    const cfg = DETAILS[key];
    if (box.dataset.mounted === String(isOnline())) return;
    box.dataset.mounted = String(isOnline());
    if (!isOnline()) {
        box.innerHTML = '<p class="mk-msg">인터넷에 연결되면 보여요</p>';
        return;
    }
    box.innerHTML = `<div class="mk-tv"><div class="tradingview-widget-container" style="height:100%"><div class="tradingview-widget-container__widget" style="height:100%"></div></div></div>
        <p class="mk-note">${cfg.note}</p>`;
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js';
    script.async = true;
    script.textContent = JSON.stringify({
        symbol: cfg.symbol,
        width: '100%',
        height: '100%',
        locale: 'kr',
        dateRange: '3M',
        colorTheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
        isTransparent: true,
        autosize: true,
        chartOnly: false,
    });
    box.querySelector('.tradingview-widget-container').append(script);
}
