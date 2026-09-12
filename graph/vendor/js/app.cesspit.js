// State Management
let supabaseClient = null;
let chartInstance = null;
let realtimeSubscription = null;
let autoRefreshTimer = null;
let currentRange = '24h';
let isFetching = false;
let isDemoMode = false;

// Load credentials and cesspit settings from LocalStorage
let config = {
    url: localStorage.getItem('sb_url') || DEFAULT_SUPABASE_URL,
    key: localStorage.getItem('sb_key') || DEFAULT_SUPABASE_PUBLISHABLE_KEY,
    emptyCm: parseFloat(localStorage.getItem('cesspit_empty_cm')) || DEFAULT_EMPTY_CM,
    fullCm: parseFloat(localStorage.getItem('cesspit_full_cm')) || DEFAULT_FULL_CM
};

// DOM Elements
const configModal = document.getElementById('configModal');
const cfgUrlInput = document.getElementById('cfgUrl');
const cfgKeyInput = document.getElementById('cfgKey');
const cfgEmptyCmInput = document.getElementById('cfgEmptyCm');
const cfgFullCmInput = document.getElementById('cfgFullCm');
const refreshIcon = document.getElementById('refreshIcon');
const chartLoading = document.getElementById('chartLoading');
const apiErrorBanner = document.getElementById('apiErrorBanner');

// Initialize Lucide Icons
lucide.createIcons();

window.onload = function() {
    cfgUrlInput.value = config.url;
    cfgKeyInput.value = config.key;
    cfgEmptyCmInput.value = config.emptyCm;
    cfgFullCmInput.value = config.fullCm;

    updateTankLabels();
    initChart();
    setupEventListeners();

    // Check if credentials are present
    if (config.url && config.key && config.key.trim().length > 10) {
        initSupabase();
        fetchTelemetryData();
        setupAutoRefresh();
    } else {
        showApiErrorBanner('No valid Supabase API key configured.');
        toggleDemoMode(true);
    }
};

function updateTankLabels() {
    const lblEmpty = document.getElementById('lblEmptyDist');
    const lblFull = document.getElementById('lblFullDist');
    if (lblEmpty) lblEmpty.textContent = `${config.emptyCm} cm`;
    if (lblFull) lblFull.textContent = `${config.fullCm} cm`;
}

function initSupabase() {
    if (!config.url || !config.key) return;
    try {
        const { createClient } = window.supabase;
        supabaseClient = createClient(config.url, config.key);
    } catch (err) {
        console.error('Supabase init error:', err);
    }
}

function initChart() {
    const options = {
        chart: {
            type: 'area',
            height: 350,
            toolbar: { show: false },
            background: 'transparent',
            animations: { enabled: true, easing: 'easeinout', speed: 600 }
        },
        theme: { mode: 'dark' },
        colors: ['#0ea5e9'],
        stroke: { curve: 'smooth', width: 2 },
        fill: {
            type: 'gradient',
            gradient: {
                shadeIntensity: 1,
                opacityFrom: 0.45,
                opacityTo: 0.05,
                stops: [0, 90, 100]
            }
        },
        dataLabels: { enabled: false },
        grid: {
            borderColor: '#1F2937',
            strokeDashArray: 3,
            xaxis: { lines: { show: true } }
        },
        annotations: {
            yaxis: [
                {
                    y: config.fullCm,
                    borderColor: '#ef4444',
                    label: {
                        borderColor: '#ef4444',
                        style: { color: '#fff', background: '#ef4444', fontSize: '10px' },
                        text: `Full Threshold (${config.fullCm}cm)`
                    }
                },
                {
                    y: config.emptyCm,
                    borderColor: '#6b7280',
                    strokeDashArray: 4,
                    label: {
                        borderColor: '#6b7280',
                        style: { color: '#fff', background: '#374151', fontSize: '10px' },
                        text: `Empty Threshold (${config.emptyCm}cm)`
                    }
                }
            ]
        },
        xaxis: {
            type: 'datetime',
            labels: { style: { colors: '#9CA3AF', fontSize: '11px' } },
            axisBorder: { color: '#1F2937' },
            axisTicks: { color: '#1F2937' }
        },
        yaxis: {
            reversed: true,
            title: { text: 'Distance to Sensor (cm)', style: { color: '#9CA3AF', fontSize: '12px' } },
            labels: {
                style: { colors: '#9CA3AF', fontSize: '11px' },
                formatter: (val) => val != null ? val.toFixed(1) + ' cm' : ''
            }
        },
        tooltip: {
            theme: 'dark',
            x: { format: 'dd MMM yyyy - HH:mm:ss' },
            y: {
                formatter: (val) => {
                    const pct = calculateFillPercentage(val);
                    return `${val} cm gap (${pct.toFixed(1)}% Full)`;
                }
            }
        },
        series: [{ name: 'Distance', data: [] }],
        noData: { text: 'No telemetry records found', style: { color: '#9CA3AF' } }
    };

    chartInstance = new ApexCharts(document.querySelector("#chart"), options);
    chartInstance.render();
}

function calculateFillPercentage(distanceCm) {
    if (distanceCm === null || distanceCm === undefined || isNaN(distanceCm)) return 0;
    
    // Sensor sits at top:
    // Empty distance = 140 cm (0%)
    // Full distance = 20 cm (100%)
    const emptyVal = config.emptyCm;
    const fullVal = config.fullCm;

    if (emptyVal === fullVal) return 0;

    const pct = ((emptyVal - distanceCm) / (emptyVal - fullVal)) * 100;
    return Math.max(0, Math.min(100, pct));
}

async function fetchTelemetryData() {
    if (isDemoMode) {
        renderDemoTelemetry();
        return;
    }
    if (!supabaseClient || isFetching) return;
    isFetching = true;
    if (refreshIcon) refreshIcon.classList.add('animate-spin');
    if (chartLoading) chartLoading.classList.remove('hidden');

    try {
        let timeBoundary = null;
        const now = new Date();
        if (currentRange === '1h') timeBoundary = new Date(now - 60 * 60 * 1000);
        else if (currentRange === '24h') timeBoundary = new Date(now - 24 * 60 * 60 * 1000);
        else if (currentRange === '7d') timeBoundary = new Date(now - 7 * 24 * 60 * 60 * 1000);

        let query = supabaseClient
            .from('sensor_readings')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(500);

        if (timeBoundary) {
            query = query.gte('created_at', timeBoundary.toISOString());
        }

        const { data, error } = await query;

        if (error) {
            console.error('Supabase query error:', error);
            if (error.message?.includes('Invalid API key') || error.status === 401 || error.code === 'PGRST301') {
                showApiErrorBanner(error.message || 'Invalid API key or unauthorized access.');
            } else {
                showToast('Database query error: ' + error.message, 'error');
            }
            processTelemetryData([]);
            return;
        }

        hideApiErrorBanner();
        processTelemetryData(data || []);
    } catch (err) {
        console.error('Fetch exception:', err);
        showToast('Error fetching telemetry: ' + err.message, 'error');
        processTelemetryData([]);
    } finally {
        isFetching = false;
        if (refreshIcon) refreshIcon.classList.remove('animate-spin');
        if (chartLoading) chartLoading.classList.add('hidden');
    }
}

function processTelemetryData(records) {
    const chartSeries = [];
    const tableRows = [];

    if (records && records.length > 0) {
        const latest = records[0];
        const latestPayload = extractDataFields(latest);
        const prev = records[1] ? extractDataFields(records[1]) : null;

        const currentDist = latestPayload.distance;
        const fillPct = currentDist !== null ? calculateFillPercentage(currentDist) : 0;
        const waterHeight = currentDist !== null ? Math.max(0, config.emptyCm - currentDist) : 0;

        // Cesspit Gauge Card Updates
        const tankFillPctEl = document.getElementById('tankFillPct');
        if (tankFillPctEl) tankFillPctEl.textContent = `${fillPct.toFixed(1)}%`;

        const tankVisualTextEl = document.getElementById('tankVisualText');
        if (tankVisualTextEl) tankVisualTextEl.textContent = `${Math.round(fillPct)}%`;

        const tankVisualLiquidEl = document.getElementById('tankVisualLiquid');
        if (tankVisualLiquidEl) tankVisualLiquidEl.style.height = `${Math.min(100, Math.max(2, fillPct))}%`;

        const tankProgressBarEl = document.getElementById('tankProgressBar');
        if (tankProgressBarEl) tankProgressBarEl.style.width = `${Math.min(100, Math.max(2, fillPct))}%`;

        const tankLiquidVolEl = document.getElementById('tankLiquidVolume');
        if (tankLiquidVolEl) {
            tankLiquidVolEl.textContent = `${waterHeight.toFixed(1)} cm water height`;
        }

        // Tank Status Badge & Alert Banner
        const tankStatusBadgeEl = document.getElementById('tankStatusBadge');
        const highWaterAlertBanner = document.getElementById('highWaterAlertBanner');
        const highWaterAlertText = document.getElementById('highWaterAlertText');

        if (fillPct >= 85) {
            if (tankStatusBadgeEl) {
                tankStatusBadgeEl.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/40 animate-pulse';
                tankStatusBadgeEl.textContent = 'HIGH WATER ALERT';
            }
            if (highWaterAlertBanner) {
                highWaterAlertBanner.classList.remove('hidden');
                if (highWaterAlertText) {
                    highWaterAlertText.textContent = `Cesspit tank is at ${fillPct.toFixed(1)}% capacity! Air headroom is only ${currentDist ? currentDist.toFixed(1) : '--'} cm. Pump out suggested.`;
                }
            }
        } else if (fillPct >= 70) {
            if (tankStatusBadgeEl) {
                tankStatusBadgeEl.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30';
                tankStatusBadgeEl.textContent = 'FILLING HIGH';
            }
            if (highWaterAlertBanner) highWaterAlertBanner.classList.add('hidden');
        } else {
            if (tankStatusBadgeEl) {
                tankStatusBadgeEl.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
                tankStatusBadgeEl.textContent = 'NORMAL';
            }
            if (highWaterAlertBanner) highWaterAlertBanner.classList.add('hidden');
        }

        // Metric Cards
        const metricDistEl = document.getElementById('metricDistance');
        if (metricDistEl) {
            metricDistEl.innerHTML = `${currentDist != null ? currentDist.toFixed(1) : '--'} <span class="text-sm font-normal text-gray-400">cm</span>`;
        }

        const metricWaterHeightEl = document.getElementById('metricWaterHeight');
        if (metricWaterHeightEl) {
            metricWaterHeightEl.innerHTML = `${waterHeight.toFixed(1)} <span class="text-sm font-normal text-gray-400">cm</span>`;
        }

        const metricHeadroomEl = document.getElementById('metricHeadroom');
        if (metricHeadroomEl) {
            const headroom = currentDist != null ? Math.max(0, currentDist - config.fullCm) : 0;
            metricHeadroomEl.textContent = `${headroom.toFixed(1)} cm`;
        }

        const metricCountEl = document.getElementById('metricCount');
        if (metricCountEl) metricCountEl.textContent = records.length;

        const metricLastTimeEl = document.getElementById('metricLastTime');
        if (metricLastTimeEl) metricLastTimeEl.textContent = formatRelativeTime(latest.created_at);

        const metricUptimeEl = document.getElementById('metricUptime');
        if (metricUptimeEl) {
            metricUptimeEl.textContent = latestPayload.uptime != null ? `${(latestPayload.uptime / 1000).toFixed(0)}s` : 'N/A';
        }

        // Distance Trend Indicator
        const trendEl = document.getElementById('metricTrend');
        if (trendEl && prev && currentDist != null && prev.distance != null) {
            const diff = (currentDist - prev.distance).toFixed(1);
            if (diff < 0) {
                // Smaller air gap = water rising = filling up
                trendEl.className = 'inline-flex items-center text-amber-400 font-medium';
                trendEl.textContent = `${Math.abs(diff)} cm higher level ▲`;
            } else if (diff > 0) {
                // Larger air gap = water lowering = draining/pumping
                trendEl.className = 'inline-flex items-center text-emerald-400 font-medium';
                trendEl.textContent = `${diff} cm lowered ▼`;
            } else {
                trendEl.className = 'inline-flex items-center text-gray-400 font-medium';
                trendEl.textContent = `0.0 cm steady =`;
            }
        }

        // Chart Points
        const sortedRecords = [...records].reverse();
        sortedRecords.forEach(row => {
            const payload = extractDataFields(row);
            if (payload.distance !== null) {
                chartSeries.push({
                    x: new Date(row.created_at).getTime(),
                    y: payload.distance
                });
            }
        });

        // Table Construction
        records.slice(0, 50).forEach(row => {
            const payload = extractDataFields(row);
            const rowFillPct = payload.distance !== null ? calculateFillPercentage(payload.distance) : 0;
            const uptimeStr = payload.uptime != null ? (payload.uptime / 1000).toFixed(1) + 's' : '--';
            const reconnectsStr = payload.reconnects !== null ? payload.reconnects : '--';

            let pctBadgeClass = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
            if (rowFillPct >= 85) pctBadgeClass = 'bg-red-500/20 text-red-400 border-red-500/30';
            else if (rowFillPct >= 70) pctBadgeClass = 'bg-amber-500/20 text-amber-400 border-amber-500/30';

            tableRows.push(`
                <tr class="hover:bg-darkbg/50 transition-colors">
                    <td class="py-2.5 px-4 font-mono text-gray-300">${new Date(row.created_at).toLocaleString()}</td>
                    <td class="py-2.5 px-4 font-mono text-brand-400">${row.device_id || 'ESP32'}</td>
                    <td class="py-2.5 px-4 font-semibold text-white">${payload.distance != null ? payload.distance.toFixed(1) : '--'} cm</td>
                    <td class="py-2.5 px-4">
                        <span class="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full border ${pctBadgeClass}">
                            ${rowFillPct.toFixed(1)}%
                        </span>
                    </td>
                    <td class="py-2.5 px-4 font-mono text-gray-400">${payload.ip || '--'}</td>
                    <td class="py-2.5 px-4 text-gray-400">${uptimeStr}</td>
                    <td class="py-2.5 px-4 font-mono text-gray-300">${reconnectsStr}</td>
                </tr>
            `);
        });

        const tableBody = document.getElementById('telemetryTableBody');
        if (tableBody) tableBody.innerHTML = tableRows.join('');

        const tableCount = document.getElementById('tableRecordCount');
        if (tableCount) tableCount.textContent = `${records.length} Records`;
    } else {
        resetMetrics();
    }

    // Update Chart Data & Annotations
    if (chartInstance) {
        chartInstance.updateOptions({
            annotations: {
                yaxis: [
                    {
                        y: config.fullCm,
                        borderColor: '#ef4444',
                        label: {
                            borderColor: '#ef4444',
                            style: { color: '#fff', background: '#ef4444', fontSize: '10px' },
                            text: `Full Threshold (${config.fullCm}cm)`
                        }
                    },
                    {
                        y: config.emptyCm,
                        borderColor: '#6b7280',
                        strokeDashArray: 4,
                        label: {
                            borderColor: '#6b7280',
                            style: { color: '#fff', background: '#374151', fontSize: '10px' },
                            text: `Empty Threshold (${config.emptyCm}cm)`
                        }
                    }
                ]
            }
        });
        chartInstance.updateSeries([{ name: 'Distance', data: chartSeries }]);
    }
}

function extractDataFields(row) {
    if (!row) return { distance: null, ip: null, uptime: null, reconnects: null };

    let data = row.data || {};
    if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch(e) { data = {}; }
    }

    const distCm = data.distance_cm ?? row.distance_cm;
    const distMm = data.distance_mm ?? row.distance_mm;
    const distGeneric = data.distance ?? row.distance ?? data.reading ?? row.reading ?? data.value ?? row.value;

    let finalDistance = null;
    if (distCm !== undefined && distCm !== null) {
        finalDistance = parseFloat(distCm);
    } else if (distMm !== undefined && distMm !== null) {
        finalDistance = parseFloat(distMm) / 10;
    } else if (distGeneric !== undefined && distGeneric !== null) {
        finalDistance = parseFloat(distGeneric);
    }

    const uptime = data.timestamp_ms ?? row.timestamp_ms ?? data.uptime ?? row.uptime ?? data.uptime_ms ?? row.uptime_ms ?? null;
    const ip = data.ip ?? row.ip ?? data.ip_address ?? row.ip_address ?? null;
    const reconnects = data.wifi_reconnects ?? row.wifi_reconnects ?? data.reconnects ?? row.reconnects ?? null;

    return {
        distance: finalDistance !== null && !isNaN(finalDistance) ? finalDistance : null,
        ip: ip,
        uptime: uptime !== null && !isNaN(uptime) ? parseFloat(uptime) : null,
        reconnects: reconnects
    };
}

function showApiErrorBanner(msg) {
    if (isDemoMode) return;
    const msgEl = document.getElementById('apiErrorMessage');
    if (msgEl) msgEl.textContent = msg || 'Invalid API key or network error.';
    if (apiErrorBanner) apiErrorBanner.classList.remove('hidden');
}

function hideApiErrorBanner() {
    if (apiErrorBanner) apiErrorBanner.classList.add('hidden');
}

function toggleDemoMode(enable) {
    isDemoMode = enable !== undefined ? enable : !isDemoMode;
    const btn = document.getElementById('demoModeBtn');
    const label = document.getElementById('demoModeLabel');

    if (isDemoMode) {
        if (label) label.textContent = 'Demo Data: ON';
        if (btn) btn.className = 'flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-amber-500 text-slate-950 rounded-lg transition shadow-md shadow-amber-500/20 font-bold';
        hideApiErrorBanner();
        showToast('Switched to Cesspit Simulation Demo Mode', 'info');
        renderDemoTelemetry();
    } else {
        if (label) label.textContent = 'Demo Data: OFF';
        if (btn) btn.className = 'flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-lg transition';
        if (!config.key) {
            showApiErrorBanner('No API key configured.');
        } else {
            fetchTelemetryData();
        }
    }
}

function renderDemoTelemetry() {
    const records = [];
    const now = Date.now();
    const count = currentRange === '1h' ? 25 : currentRange === '24h' ? 70 : 130;
    const step = (currentRange === '1h' ? 3 * 60 : currentRange === '24h' ? 20 * 60 : 80 * 60) * 1000 / count;

    // Start near 110cm air gap (mostly empty) and simulate filling over time
    let currentAirGap = 120.0;
    for (let i = count; i >= 0; i--) {
        // Slowly fill tank (air gap decreases)
        currentAirGap -= (Math.random() * 1.8 - 0.2);
        
        // If it hits near full limit (20cm), simulate a pump-out back to 135cm
        if (currentAirGap < 22) {
            currentAirGap = 132.0;
        }

        currentAirGap = Math.max(15, Math.min(config.emptyCm, currentAirGap));

        records.push({
            created_at: new Date(now - i * step).toISOString(),
            device_id: 'ESP32_CESSPIT_01',
            data: {
                ip: '192.168.1.145',
                status: 'ok',
                distance_cm: parseFloat(currentAirGap.toFixed(1)),
                distance_mm: Math.round(currentAirGap * 10),
                timestamp_ms: (count - i) * 15000 + 120000,
                wifi_reconnects: 0
            }
        });
    }
    processTelemetryData(records);
}

function formatRelativeTime(isoString) {
    if (!isoString) return '--';
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function resetMetrics() {
    const dist = document.getElementById('metricDistance');
    if (dist) dist.innerHTML = `-- <span class="text-sm font-normal text-gray-400">cm</span>`;
    
    const fillPct = document.getElementById('tankFillPct');
    if (fillPct) fillPct.textContent = '--%';

    const cnt = document.getElementById('metricCount');
    if (cnt) cnt.textContent = '0';

    const lastT = document.getElementById('metricLastTime');
    if (lastT) lastT.textContent = '--';

    const tbl = document.getElementById('telemetryTableBody');
    if (tbl) tbl.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-gray-500">No records found for selected time range.</td></tr>`;

    const tblCnt = document.getElementById('tableRecordCount');
    if (tblCnt) tblCnt.textContent = '0 Records';
}

function toggleRealtime() {
    const btn = document.getElementById('realtimeBtn');
    const status = document.getElementById('realtimeStatus');
    const liveBadge = document.getElementById('liveBadge');

    if (realtimeSubscription) {
        if (supabaseClient) supabaseClient.removeChannel(realtimeSubscription);
        realtimeSubscription = null;
        if (status) {
            status.textContent = 'OFF';
            status.className = 'text-gray-400';
        }
        if (btn) btn.classList.remove('border-amber-500/50', 'bg-amber-500/10');
        if (liveBadge) liveBadge.classList.add('hidden');
        showToast('Supabase Realtime disconnected', 'info');
    } else {
        if (!supabaseClient) {
            showToast('Please configure valid Supabase credentials first', 'warning');
            return;
        }
        if (status) {
            status.textContent = 'CONNECTING...';
            status.className = 'text-amber-400 animate-pulse';
        }

        realtimeSubscription = supabaseClient
            .channel('public:sensor_readings')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sensor_readings' }, payload => {
                const dist = extractDataFields(payload.new).distance;
                const pct = dist != null ? calculateFillPercentage(dist) : 0;
                showToast(`New level update: ${dist ?? '--'} cm (${pct.toFixed(0)}% full)`, 'success');
                fetchTelemetryData();
            })
            .subscribe((statusResult) => {
                if (statusResult === 'SUBSCRIBED') {
                    if (status) {
                        status.textContent = 'LIVE';
                        status.className = 'text-emerald-400 font-bold';
                    }
                    if (btn) btn.classList.add('border-amber-500/50', 'bg-amber-500/10');
                    if (liveBadge) liveBadge.classList.remove('hidden');
                    showToast('Subscribed to live database inserts!', 'success');
                }
            });
    }
}

function setupAutoRefresh() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    const selectEl = document.getElementById('autoRefreshSelect');
    if (!selectEl) return;
    const interval = parseInt(selectEl.value);
    if (interval > 0) {
        autoRefreshTimer = setInterval(() => {
            fetchTelemetryData();
        }, interval);
    }
}

function setupEventListeners() {
    const cfgForm = document.getElementById('configForm');
    if (cfgForm) {
        cfgForm.onsubmit = function(e) {
            e.preventDefault();
            config.url = cfgUrlInput.value.trim();
            config.key = cfgKeyInput.value.trim();
            config.emptyCm = parseFloat(cfgEmptyCmInput.value) || DEFAULT_EMPTY_CM;
            config.fullCm = parseFloat(cfgFullCmInput.value) || DEFAULT_FULL_CM;

            localStorage.setItem('sb_url', config.url);
            localStorage.setItem('sb_key', config.key);
            localStorage.setItem('cesspit_empty_cm', config.emptyCm);
            localStorage.setItem('cesspit_full_cm', config.fullCm);

            updateTankLabels();
            initSupabase();
            if (configModal) configModal.classList.add('hidden');
            showToast('Cesspit geometry and Supabase credentials saved!', 'success');
            
            if (isDemoMode) renderDemoTelemetry();
            else fetchTelemetryData();
            
            setupAutoRefresh();
        };
    }

    const testBtn = document.getElementById('testConnBtn');
    if (testBtn) {
        testBtn.onclick = async function() {
            const url = cfgUrlInput.value.trim();
            const key = cfgKeyInput.value.trim();

            if (!url || !key) {
                showToast('Please enter both Project URL and API Key', 'warning');
                return;
            }

            this.textContent = 'Testing...';
            try {
                const testClient = window.supabase.createClient(url, key);
                const { error } = await testClient.from('sensor_readings').select('created_at').limit(1);
                if (error && (error.message?.includes('Invalid API key') || error.status === 401)) {
                    showToast('Invalid API Key! Check Supabase settings.', 'error');
                } else {
                    showToast('Database Connection Successful!', 'success');
                }
            } catch (err) {
                showToast('Connection failed: ' + err.message, 'error');
            }
            finally {
                this.textContent = 'Test Key';
            }
        };
    }

    const demoBtn = document.getElementById('demoModeBtn');
    if (demoBtn) demoBtn.onclick = () => toggleDemoMode();

    const bannerDemoBtn = document.getElementById('bannerDemoBtn');
    if (bannerDemoBtn) bannerDemoBtn.onclick = () => toggleDemoMode(true);

    const bannerSettingsBtn = document.getElementById('bannerSettingsBtn');
    if (bannerSettingsBtn && configModal) bannerSettingsBtn.onclick = () => configModal.classList.remove('hidden');

    const clearBtn = document.getElementById('clearConfigBtn');
    if (clearBtn) {
        clearBtn.onclick = function() {
            localStorage.removeItem('sb_url');
            localStorage.removeItem('sb_key');
            localStorage.removeItem('cesspit_empty_cm');
            localStorage.removeItem('cesspit_full_cm');

            config.url = DEFAULT_SUPABASE_URL;
            config.key = '';
            config.emptyCm = DEFAULT_EMPTY_CM;
            config.fullCm = DEFAULT_FULL_CM;

            cfgUrlInput.value = config.url;
            cfgKeyInput.value = '';
            cfgEmptyCmInput.value = config.emptyCm;
            cfgFullCmInput.value = config.fullCm;

            updateTankLabels();
            showToast('Defaults restored.', 'info');
        };
    }

    const openCfgBtn = document.getElementById('openConfigBtn');
    if (openCfgBtn && configModal) openCfgBtn.onclick = () => configModal.classList.remove('hidden');

    const closeCfgBtn = document.getElementById('closeConfigBtn');
    if (closeCfgBtn && configModal) closeCfgBtn.onclick = () => configModal.classList.add('hidden');

    const manualBtn = document.getElementById('manualRefreshBtn');
    if (manualBtn) manualBtn.onclick = fetchTelemetryData;

    const realtimeBtn = document.getElementById('realtimeBtn');
    if (realtimeBtn) realtimeBtn.onclick = toggleRealtime;

    const refreshSel = document.getElementById('autoRefreshSelect');
    if (refreshSel) refreshSel.onchange = setupAutoRefresh;

    document.querySelectorAll('.range-btn').forEach(btn => {
        btn.onclick = function() {
            document.querySelectorAll('.range-btn').forEach(b => {
                b.className = 'range-btn px-3 py-1.5 rounded-lg font-medium transition text-gray-400 hover:text-white';
            });
            this.className = 'range-btn px-3 py-1.5 rounded-lg font-medium transition bg-brand-500 text-white shadow-sm';
            currentRange = this.getAttribute('data-range');
            fetchTelemetryData();
        };
    });

    // Impressum & Privacy Modal Handlers
    document.getElementById('openImpressumBtn').onclick = () => {
        document.getElementById('impressumModal').classList.remove('hidden');
    };
    document.getElementById('closeImpressumBtn').onclick = () => {
        document.getElementById('impressumModal').classList.add('hidden');
    };

    document.getElementById('openPrivacyBtn').onclick = () => {
        document.getElementById('privacyModal').classList.remove('hidden');
    };
    document.getElementById('closePrivacyBtn').onclick = () => {
        document.getElementById('privacyModal').classList.add('hidden');
    };

    // Close modals when clicking backdrop
    [
        { modal: 'impressumModal', btn: 'closeImpressumBtn' },
        { modal: 'privacyModal', btn: 'closePrivacyBtn' }
    ].forEach(item => {
        document.getElementById(item.modal).addEventListener('click', (e) => {
            if (e.target === document.getElementById(item.modal)) {
                document.getElementById(item.modal).classList.add('hidden');
            }
        });
    });
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    
    const bgColors = {
        success: 'bg-emerald-950/90 border-emerald-500/50 text-emerald-200',
        error: 'bg-red-950/90 border-red-500/50 text-red-200',
        warning: 'bg-amber-950/90 border-amber-500/50 text-amber-200',
        info: 'bg-gray-900/90 border-gray-700 text-gray-200'
    };

    toast.className = `px-4 py-3 rounded-xl border backdrop-blur-md text-xs font-medium shadow-xl transition-all duration-300 transform translate-y-2 opacity-0 flex items-center gap-2 ${bgColors[type] || bgColors.info}`;
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.remove('translate-y-2', 'opacity-0');
    }, 10);

    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}
