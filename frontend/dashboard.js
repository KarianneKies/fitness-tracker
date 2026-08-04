// dashboard.js — Standalone fullscreen "screensaver" dashboard
//
// A separate page from the main app (not a tab): reuses the same backend
// (GET /workouts, /meals, /goal, /checkins), computed and rendered here.
// Meant to sit on a screen and be glanced at from a distance - large
// numbers, minimal chrome, auto-rotating panels, periodic data refresh.

const ROTATE_INTERVAL_MS = 15000;
const REFRESH_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes
const ACCENT = '#e94560';
const NEUTRAL_ZONE = '#2a2a45';

const state = {
    panelIndex: 0,
    paused: false,
    rotateTimer: null,
    data: { workouts: [], meals: [], goal: {}, checkins: [] },
};

// ========== Data loading ==========

async function loadAllData() {
    try {
        const [workouts, meals, goal, checkins] = await Promise.all([
            fetchJson('/workouts'),
            fetchJson('/meals'),
            fetchJson('/goal'),
            fetchJson('/checkins'),
        ]);
        state.data = { workouts, meals, goal, checkins };
        renderAllPanels();
    } catch (error) {
        console.error('Dashboard data load failed:', error);
    }
}

async function fetchJson(path) {
    const response = await fetch(`${window.location.origin}${path}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${path} -> HTTP ${response.status}`);
    return response.json();
}

function renderAllPanels() {
    renderMusclePanel(state.data.workouts);
    renderStatsPanel(state.data.workouts);
    renderMacrosPanel(state.data.meals, state.data.goal);
    renderTrendPanel(state.data.checkins);
}

// ========== Date helpers (local time, same convention as the main app) ==========

function todayString() {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
}

function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    d.setHours(0, 0, 0, 0);
    return d;
}

function weekStart() {
    const now = new Date();
    const day = now.getDay(); // 0 = Sunday
    const diffToMonday = (day === 0) ? 6 : day - 1;
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday);
    return d;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ========== Panel 1: Muscle silhouette ==========

const MUSCLE_GROUPS = ['Chest', 'Back', 'Shoulders', 'Legs', 'Biceps', 'Triceps', 'Core'];

function computeMuscleSetCounts(workouts) {
    const cutoff = daysAgo(7);
    const counts = {};
    MUSCLE_GROUPS.forEach((g) => { counts[g] = 0; });

    (workouts || []).forEach((w) => {
        const started = new Date(w.started_at);
        if (started < cutoff) return;
        (w.exercises || []).forEach((ex) => {
            if (!ex.muscle_group || !(ex.muscle_group in counts)) return;
            counts[ex.muscle_group] += (ex.sets || []).length;
        });
    });

    return counts;
}

function intensityColor(count, maxCount) {
    if (!count || maxCount === 0) return NEUTRAL_ZONE;
    const opacity = 0.25 + 0.7 * (count / maxCount);
    return hexToRgba(ACCENT, opacity);
}

function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Shared body-outline zones; front and back differ only in torso + upper arms */
function figureSvg(view, colorFor) {
    const torso = view === 'front'
        ? `<rect x="62" y="94" width="76" height="42" rx="10" fill="${colorFor('Chest')}"/>
           <rect x="68" y="134" width="64" height="58" rx="10" fill="${colorFor('Core')}"/>`
        : `<rect x="60" y="94" width="80" height="98" rx="14" fill="${colorFor('Back')}"/>`;

    const upperArmGroup = view === 'front' ? 'Biceps' : 'Triceps';

    return `
    <svg viewBox="0 0 200 380" width="150" height="285" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="100" cy="35" rx="24" ry="28" fill="${NEUTRAL_ZONE}"/>
        <rect x="90" y="58" width="20" height="14" fill="${NEUTRAL_ZONE}"/>
        <rect x="45" y="70" width="110" height="26" rx="13" fill="${colorFor('Shoulders')}"/>
        ${torso}
        <rect x="25" y="75" width="24" height="70" rx="12" fill="${colorFor(upperArmGroup)}"/>
        <rect x="151" y="75" width="24" height="70" rx="12" fill="${colorFor(upperArmGroup)}"/>
        <rect x="20" y="143" width="20" height="58" rx="10" fill="${NEUTRAL_ZONE}"/>
        <rect x="160" y="143" width="20" height="58" rx="10" fill="${NEUTRAL_ZONE}"/>
        <rect x="68" y="194" width="28" height="105" rx="14" fill="${colorFor('Legs')}"/>
        <rect x="104" y="194" width="28" height="105" rx="14" fill="${colorFor('Legs')}"/>
        <rect x="68" y="297" width="28" height="65" rx="10" fill="${NEUTRAL_ZONE}"/>
        <rect x="104" y="297" width="28" height="65" rx="10" fill="${NEUTRAL_ZONE}"/>
    </svg>`;
}

function renderMusclePanel(workouts) {
    const el = document.getElementById('muscle-panel-content');
    if (!el) return;

    const counts = computeMuscleSetCounts(workouts);
    const maxCount = Math.max(0, ...Object.values(counts));
    const colorFor = (group) => intensityColor(counts[group], maxCount);

    if (maxCount === 0) {
        el.innerHTML = '<div class="muscle-empty">No workouts logged in the last 7 days.</div>';
        return;
    }

    const legendRows = MUSCLE_GROUPS
        .slice()
        .sort((a, b) => counts[b] - counts[a])
        .map((group) => `
            <div class="muscle-legend-row">
                <span class="muscle-legend-swatch" style="background: ${colorFor(group)};"></span>
                <span class="muscle-legend-name">${group}</span>
                <span class="muscle-legend-count">${counts[group]} set${counts[group] === 1 ? '' : 's'}</span>
            </div>
        `).join('');

    el.innerHTML = `
        <div class="muscle-layout">
            <div class="muscle-figures">
                <div>
                    ${figureSvg('front', colorFor)}
                    <div class="muscle-figure-label">Front</div>
                </div>
                <div>
                    ${figureSvg('back', colorFor)}
                    <div class="muscle-figure-label">Back</div>
                </div>
            </div>
            <div class="muscle-legend">${legendRows}</div>
        </div>
    `;
}

// ========== Panel 2: This week's training stats ==========

function renderStatsPanel(workouts) {
    const el = document.getElementById('stats-panel-content');
    if (!el) return;

    const startDate = weekStart();
    const thisWeek = (workouts || []).filter((w) => new Date(w.started_at) >= startDate);

    if (thisWeek.length === 0) {
        el.innerHTML = '<div class="stats-empty">No workouts logged this week yet.</div>';
        return;
    }

    let totalSets = 0;
    let totalVolume = 0;
    let durationSum = 0;
    let durationCount = 0;

    thisWeek.forEach((w) => {
        (w.exercises || []).forEach((ex) => {
            (ex.sets || []).forEach((set) => {
                totalSets += 1;
                if (set.weight_kg != null && set.reps != null) {
                    totalVolume += set.weight_kg * set.reps;
                }
            });
        });
        if (w.duration_seconds != null) {
            durationSum += w.duration_seconds;
            durationCount += 1;
        }
    });

    const avgDurationMin = durationCount > 0 ? Math.round(durationSum / durationCount / 60) : null;

    el.innerHTML = `
        <div class="stat-grid">
            <div class="stat-tile">
                <div class="stat-tile-value">${thisWeek.length}</div>
                <div class="stat-tile-label">Workouts</div>
            </div>
            <div class="stat-tile">
                <div class="stat-tile-value">${totalSets}</div>
                <div class="stat-tile-label">Sets</div>
            </div>
            <div class="stat-tile">
                <div class="stat-tile-value">${Math.round(totalVolume).toLocaleString()}</div>
                <div class="stat-tile-label">kg lifted</div>
            </div>
            <div class="stat-tile">
                <div class="stat-tile-value">${avgDurationMin != null ? avgDurationMin : '—'}</div>
                <div class="stat-tile-label">Avg minutes</div>
            </div>
        </div>
    `;
}

// ========== Panel 3: Today's macros vs goal ==========

function renderMacrosPanel(meals, goal) {
    const el = document.getElementById('macros-panel-content');
    if (!el) return;

    const todayStr = todayString();
    const todaysMeals = (meals || []).filter((m) => m.meal_date === todayStr);
    const calories = todaysMeals.reduce((sum, m) => sum + (m.total_calories || 0), 0);
    const protein = todaysMeals.reduce((sum, m) => sum + (m.total_protein_g || 0), 0);
    const carbs = todaysMeals.reduce((sum, m) => sum + (m.total_carbs_g || 0), 0);
    const fat = todaysMeals.reduce((sum, m) => sum + (m.total_fat_g || 0), 0);

    const barRow = (label, value, target) => {
        const pct = target ? Math.min(100, (value / target) * 100) : 0;
        const targetText = target != null ? `${Math.round(target)}g` : 'no target';
        return `
            <div class="macro-bar-row">
                <div class="macro-bar-label"><span>${label}</span><span class="muted">${value.toFixed(0)}g / ${targetText}</span></div>
                <div class="macro-bar-track"><div class="macro-bar-fill" style="width: ${pct}%;"></div></div>
            </div>
        `;
    };

    el.innerHTML = `
        <div class="hero-number">${Math.round(calories)}</div>
        <div class="hero-sub">${goal.calorie_target != null ? `of ${Math.round(goal.calorie_target)} kcal goal` : 'kcal consumed (no goal set)'}</div>
        <div class="macro-bars">
            ${barRow('Protein', protein, goal.protein_target_g)}
            ${barRow('Carbs', carbs, goal.carb_target_g)}
            ${barRow('Fat', fat, goal.fat_target_g)}
        </div>
    `;
}

// ========== Panel 4: Weight trend ==========

function renderTrendPanel(checkins) {
    const el = document.getElementById('trend-panel-content');
    if (!el) return;

    const withWeight = (checkins || [])
        .filter((c) => c.weight_kg != null)
        .slice()
        .reverse() // API returns most-recent-first; chart reads chronologically
        .slice(-10);

    if (withWeight.length === 0) {
        el.innerHTML = '<div class="trend-empty">No weight data logged yet.</div>';
        return;
    }

    const latest = withWeight[withWeight.length - 1];
    const first = withWeight[0];
    const delta = Math.round((latest.weight_kg - first.weight_kg) * 10) / 10;

    let deltaHtml = '';
    if (withWeight.length > 1) {
        const cls = delta < 0 ? 'down' : (delta > 0 ? 'up' : 'flat');
        const arrow = delta < 0 ? '▼' : (delta > 0 ? '▲' : '—');
        deltaHtml = `<span class="trend-delta ${cls}">${arrow} ${Math.abs(delta)} kg over period</span>`;
    }

    el.innerHTML = `
        <div class="trend-hero">
            <div class="hero-number" style="font-size: 5rem;">${latest.weight_kg}<span style="font-size: 2rem; color: #9a9ab5;"> kg</span></div>
            ${deltaHtml}
        </div>
        <div class="trend-chart">${lineChartSvg(withWeight)}</div>
    `;
}

function lineChartSvg(points) {
    const width = 900;
    const height = 220;
    const padX = 40;
    const padY = 30;

    const weights = points.map((p) => p.weight_kg);
    const min = Math.min(...weights);
    const max = Math.max(...weights);
    const range = (max - min) || 1;

    const x = (i) => padX + (i / (points.length - 1 || 1)) * (width - padX * 2);
    const y = (w) => height - padY - ((w - min) / range) * (height - padY * 2);

    const linePoints = points.map((p, i) => `${x(i)},${y(p.weight_kg)}`).join(' ');

    const dots = points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.weight_kg)}" r="5" fill="${ACCENT}"/>`).join('');

    // Selective direct labels: first and last points only
    const firstLabel = `<text x="${x(0)}" y="${y(points[0].weight_kg) - 16}" fill="#9a9ab5" font-size="15" text-anchor="middle">${points[0].weight_kg}</text>`;
    const lastLabel = `<text x="${x(points.length - 1)}" y="${y(points[points.length - 1].weight_kg) - 16}" fill="#fff" font-size="15" font-weight="600" text-anchor="middle">${points[points.length - 1].weight_kg}</text>`;

    return `
        <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" xmlns="http://www.w3.org/2000/svg">
            <polyline points="${linePoints}" fill="none" stroke="${ACCENT}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
            ${dots}
            ${firstLabel}
            ${lastLabel}
        </svg>
    `;
}

// ========== Panel rotation ==========

function goToPanel(index) {
    state.panelIndex = ((index % 4) + 4) % 4;
    document.querySelectorAll('.panel').forEach((p) => {
        p.classList.toggle('active', Number(p.dataset.panel) === state.panelIndex);
    });
    document.querySelectorAll('.panel-dot').forEach((d) => {
        d.classList.toggle('active', Number(d.dataset.dot) === state.panelIndex);
    });
}

function startRotation() {
    stopRotation();
    state.rotateTimer = setInterval(() => {
        if (!state.paused) goToPanel(state.panelIndex + 1);
    }, ROTATE_INTERVAL_MS);
}

function stopRotation() {
    if (state.rotateTimer) {
        clearInterval(state.rotateTimer);
        state.rotateTimer = null;
    }
}

// ========== Fullscreen ==========

function isFullscreen() {
    return !!document.fullscreenElement;
}

async function toggleFullscreen() {
    if (!isFullscreen()) {
        await document.documentElement.requestFullscreen().catch((err) => {
            console.error('Fullscreen request failed:', err);
        });
    } else {
        await document.exitFullscreen().catch(() => {});
    }
}

function onFullscreenChange() {
    document.body.classList.toggle('is-fullscreen', isFullscreen());
    const fsBtn = document.getElementById('fullscreen-btn');
    if (fsBtn) fsBtn.textContent = isFullscreen() ? '⤢' : '⛶';

    if (isFullscreen()) {
        flashHint();
    }
}

let hintTimer = null;
function flashHint() {
    const hint = document.getElementById('exit-hint');
    if (!hint) return;
    hint.classList.add('visible');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => hint.classList.remove('visible'), 4000);
}

let chromeTimer = null;
function flashChrome() {
    document.body.classList.add('chrome-visible');
    clearTimeout(chromeTimer);
    chromeTimer = setTimeout(() => document.body.classList.remove('chrome-visible'), 3000);
}

// ========== Wiring ==========

function init() {
    const fsBtn = document.getElementById('fullscreen-btn');
    if (fsBtn) {
        fsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFullscreen();
        });
    }

    const pauseBtn = document.getElementById('pause-btn');
    if (pauseBtn) {
        pauseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            state.paused = !state.paused;
            pauseBtn.textContent = state.paused ? '▶' : '⏸';
            pauseBtn.title = state.paused ? 'Resume rotation' : 'Pause rotation';
        });
    }

    document.addEventListener('fullscreenchange', onFullscreenChange);

    // Tapping the background (not a control) exits fullscreen; outside
    // fullscreen it just reveals the chrome briefly (mouse move does too).
    document.getElementById('app').addEventListener('click', () => {
        if (isFullscreen()) {
            document.exitFullscreen().catch(() => {});
        } else {
            flashChrome();
        }
    });

    document.addEventListener('mousemove', () => {
        if (isFullscreen()) flashChrome();
    });

    document.querySelectorAll('.panel-dot').forEach((dot) => {
        dot.addEventListener('click', (e) => {
            e.stopPropagation();
            goToPanel(Number(dot.dataset.dot));
        });
    });

    goToPanel(0);
    startRotation();
    loadAllData();
    setInterval(loadAllData, REFRESH_INTERVAL_MS);
}

document.addEventListener('DOMContentLoaded', init);
