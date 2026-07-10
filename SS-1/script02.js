// ============================================
// SUPABASE SETUP
// ============================================
const SUPABASE_URL = 'https://tzdajmzulwabvrvrjqxc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_R-TDdmRXXc-m167WxjYemg_R4gvEp7f';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================
// APP STATE
// ============================================
var currentUser = null;
var currentMonth = new Date().getMonth() + 1;
var currentYear = new Date().getFullYear();
var extraCreditEnabled = false;
var RAW_HABITS = [];
var logsLookup = {};
var scheduleLookup = {};
var DAYS_IN_MONTH = 30;
var firstDayMonBased = 0;

const DAYS_OF_WEEK = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

// ============================================
// AUTH
// ============================================
function showTab(tab) {
  document.getElementById('form-login').style.display = tab === 'login' ? 'block' : 'none';
  document.getElementById('form-signup').style.display = tab === 'signup' ? 'block' : 'none';
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-signup').classList.toggle('active', tab === 'signup');
}

function showMsg(id, text, type) {
  var el = document.getElementById(id);
  el.textContent = text;
  el.className = 'auth-msg ' + type;
}

async function handleLogin() {
  var email = document.getElementById('login-email').value.trim();
  var pass = document.getElementById('login-password').value;
  if (!email || !pass) return showMsg('login-msg', 'Please fill in all fields.', 'error');
  showMsg('login-msg', 'Logging in...', 'info');
  var { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
  if (error) return showMsg('login-msg', error.message, 'error');
  currentUser = data.user;
  onLoggedIn();
}

async function handleSignup() {
  var code = document.getElementById('signup-code').value.trim().toUpperCase();
  var email = document.getElementById('signup-email').value.trim();
  var pass = document.getElementById('signup-password').value;
  if (!code || !email || !pass) return showMsg('signup-msg', 'Please fill in all fields.', 'error');
  showMsg('signup-msg', 'Checking your code...', 'info');

  // Check code
  var { data: codeRows } = await sb.from('codes').select('*').eq('code', code);
  if (!codeRows || codeRows.length === 0) return showMsg('signup-msg', "That code doesn't exist.", 'error');
  if (codeRows[0].is_redeemed) return showMsg('signup-msg', 'That code has already been used.', 'error');

  // Create account
  var { data, error } = await sb.auth.signUp({ email, password: pass });
  if (error) return showMsg('signup-msg', error.message, 'error');

  // Mark code redeemed
  await sb.from('codes').update({ is_redeemed: true, redeemed_by: data.user.id, redeemed_at: new Date().toISOString() }).eq('code', code);

  showMsg('signup-msg', 'Account created! Check your email to confirm, then log in.', 'success');
}

async function handleLogout() {
  await sb.auth.signOut();
  currentUser = null;
  document.getElementById('tracker-screen').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
  toggleSettings(false);
}

// Check if already logged in on page load
async function checkSession() {
  var { data } = await sb.auth.getSession();
  if (data.session) {
    currentUser = data.session.user;
    onLoggedIn();
  }
}

function onLoggedIn() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('tracker-screen').style.display = 'block';
  document.getElementById('settings-email').textContent = currentUser.email;
  initMonthYearPickers();
  loadAndRender();
}

// ============================================
// SETTINGS PANEL
// ============================================
function toggleSettings(forceState) {
  var panel = document.getElementById('settings-panel');
  if (forceState === false) { panel.classList.remove('open'); return; }
  var isOpening = !panel.classList.contains('open');
  panel.classList.toggle('open');
  // Build schedule rows when panel opens so the DOM elements exist
  if (isOpening) buildScheduleRows();
}

function changeTheme(theme) {
  document.body.setAttribute('data-theme', theme);
  try { localStorage.setItem('habitTrackerTheme', theme); } catch(e) {}
  renderEverything();
}

function changeMonth() {
  currentMonth = parseInt(document.getElementById('month-select').value);
  currentYear = parseInt(document.getElementById('year-select').value);
  loadAndRender();
}

function jumpToCurrentMonth() {
  var now = new Date();
  currentMonth = now.getMonth() + 1;
  currentYear = now.getFullYear();
  document.getElementById('month-select').value = currentMonth;
  document.getElementById('year-select').value = currentYear;
  loadAndRender();
}

function toggleExtraCredit(val) {
  extraCreditEnabled = val;
  renderEverything();
}

function initMonthYearPickers() {
  document.getElementById('month-select').value = currentMonth;
  var yearSel = document.getElementById('year-select');
  yearSel.innerHTML = '';
  var thisYear = new Date().getFullYear();
  for (var y = thisYear - 5; y <= thisYear; y++) {
    var opt = document.createElement('option');
    opt.value = y; opt.textContent = y;
    yearSel.appendChild(opt);
  }
  yearSel.value = currentYear;
}

// Render the settings habit list
function renderHabitList() {
  var el = document.getElementById('habit-list');
  el.innerHTML = '';
  if (RAW_HABITS.length === 0) {
    el.innerHTML = '<p style="font-size:11px; color:rgba(244,232,250,0.5);">No habits yet. Add one above!</p>';
    return;
  }
  RAW_HABITS.forEach(function(h) {
    var row = document.createElement('div');
    row.className = 'habit-list-row';
    row.innerHTML = '<span>' + h.icon + ' ' + h.name + '</span>';
    var btn = document.createElement('button');
    btn.className = 'habit-del-btn';
    btn.textContent = '🗑';
    btn.onclick = function() { archiveHabit(h.id); };
    row.appendChild(btn);
    el.appendChild(row);
  });
}

// Build schedule rows in the Add Habit form
// ---- Update Charts button + auto-refresh after checkbox click ----
// Refreshes only the chart/donut elements without rebuilding the full grid
// (rebuilding the grid would reset visual checkbox state).
function refreshCharts() {
  if (lineChartInstance) lineChartInstance.destroy();
  if (barChartInstance) barChartInstance.destroy();
  if (plannedActualChartInstance) plannedActualChartInstance.destroy();
  buildWeekColors();
  buildHabits();
  renderTopHabits();
  renderDonuts();
  renderCharts();
  renderWeeklyDonut();
  var label = document.getElementById('last-updated');
  if (label) {
    var now = new Date();
    label.textContent = 'Updated ' + now.getHours() + ':' + String(now.getMinutes()).padStart(2,'0') + ':' + String(now.getSeconds()).padStart(2,'0');
  }
}

// ---- Day toggle button builder ----
// Creates clickable day pills (Mon Tue Wed etc) for fixed/flex day selection.
function buildDayToggles(containerId) {
  var el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '';
  var shortDays = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  shortDays.forEach(function(day, i) {
    var btn = document.createElement('button');
    btn.className = 'day-toggle';
    btn.textContent = day;
    btn.dataset.index = i;
    btn.addEventListener('click', function() {
      btn.classList.toggle('selected');
    });
    el.appendChild(btn);
  });
}

function buildScheduleRows() {
  buildDayToggles('fixed-days-row');
  buildDayToggles('flex-days-row');
}

async function submitAddHabit() {
  var name = document.getElementById('habit-name').value.trim();
  var icon = document.getElementById('habit-icon').value.trim() || '✅';
  var category = document.getElementById('habit-category').value.trim() || 'General';
  var timesPerDay = parseInt(document.getElementById('habit-times-per-day').value) || 1;
  var flexNeeded = parseInt(document.getElementById('habit-flex-needed').value) || 0;

  if (!name) return showMsg('add-habit-msg', 'Please enter a habit name.', 'error');

  // Collect selected fixed days
  var fixedDays = [];
  document.querySelectorAll('#fixed-days-row .day-toggle.selected').forEach(function(btn) {
    fixedDays.push(parseInt(btn.dataset.index));
  });

  // Collect selected flexible pool days
  var flexDays = [];
  document.querySelectorAll('#flex-days-row .day-toggle.selected').forEach(function(btn) {
    flexDays.push(parseInt(btn.dataset.index));
  });

  if (fixedDays.length === 0 && (flexDays.length === 0 || flexNeeded === 0)) {
    return showMsg('add-habit-msg', 'Select at least one fixed day, or set a flexible pool with days needed > 0.', 'error');
  }

  showMsg('add-habit-msg', 'Saving...', 'info');

  var { data, error } = await sb.from('habits').insert({
    user_id: currentUser.id, name, icon, category, color: 'auto'
  }).select();
  if (error) return showMsg('add-habit-msg', error.message, 'error');

  var habitId = data[0].id;

  // Build schedule rows:
  // Fixed days → is_flexible: false, times_required: timesPerDay
  // Flex pool days → is_flexible: true, times_required: timesPerDay
  // The flexNeeded count is stored in a special day_of_week: 7 row (sentinel)
  var schedRows = [];
  fixedDays.forEach(function(dow) {
    schedRows.push({ habit_id: habitId, day_of_week: dow, times_required: timesPerDay, is_flexible: false });
  });
  flexDays.forEach(function(dow) {
    schedRows.push({ habit_id: habitId, day_of_week: dow, times_required: timesPerDay, is_flexible: true });
  });
  // Sentinel row stores how many flex days are needed per week
  if (flexNeeded > 0 && flexDays.length > 0) {
    schedRows.push({ habit_id: habitId, day_of_week: 7, times_required: flexNeeded, is_flexible: true });
  }

  if (schedRows.length > 0) {
    await sb.from('habit_schedule').insert(schedRows);
  }

  // Reset form
  document.getElementById('habit-name').value = '';
  document.getElementById('habit-times-per-day').value = '1';
  document.getElementById('habit-flex-needed').value = '0';
  document.querySelectorAll('.day-toggle.selected').forEach(function(b){ b.classList.remove('selected'); });

  showMsg('add-habit-msg', '✅ Added: ' + icon + ' ' + name, 'success');
  await loadHabits();
  renderEverything();
}

async function archiveHabit(habitId) {
  await sb.from('habits').update({ archived: true }).eq('id', habitId);
  await loadHabits();
  renderEverything();
}

// ============================================
// SUPABASE DATA LOADING
// ============================================
async function loadHabits() {
  var { data } = await sb.from('habits').select('*, habit_schedule(*)').eq('user_id', currentUser.id).eq('archived', false);
  RAW_HABITS = data || [];
  buildScheduleLookup();
  renderHabitList();
}

async function loadLogs() {
  var start = currentYear + '-' + String(currentMonth).padStart(2,'0') + '-01';
  var lastDay = new Date(currentYear, currentMonth, 0).getDate();
  var end = currentYear + '-' + String(currentMonth).padStart(2,'0') + '-' + String(lastDay).padStart(2,'0');
  var habitIds = RAW_HABITS.map(function(h) { return h.id; });
  if (habitIds.length === 0) { logsLookup = {}; return; }
  var { data } = await sb.from('habit_logs').select('habit_id, log_date, times_completed').in('habit_id', habitIds).gte('log_date', start).lte('log_date', end);
  logsLookup = {};
  (data || []).forEach(function(log) {
    var hid = String(log.habit_id);
    if (!logsLookup[hid]) logsLookup[hid] = {};
    logsLookup[hid][log.log_date] = log.times_completed;
  });
}

async function saveLog(habitId, logDate, timesCompleted) {
  await sb.from('habit_logs').upsert(
    { habit_id: habitId, log_date: logDate, times_completed: timesCompleted },
    { onConflict: 'habit_id,log_date' }
  );
  // Update local lookup immediately so re-renders are instant
  var hid = String(habitId);
  if (!logsLookup[hid]) logsLookup[hid] = {};
  logsLookup[hid][logDate] = timesCompleted;
  // Auto-refresh charts so they reflect the new entry without needing
  // the user to click "Update Charts" manually
  refreshCharts();
}

function buildScheduleLookup() {
  scheduleLookup = {};
  RAW_HABITS.forEach(function(h) {
    var hid = String(h.id);
    scheduleLookup[hid] = {};
    (h.habit_schedule || []).forEach(function(s) {
      scheduleLookup[hid][s.day_of_week] = { required: s.times_required, flexible: s.is_flexible };
    });
  });
}

async function loadAndRender() {
  await loadHabits();
  await loadLogs();
  DAYS_IN_MONTH = new Date(currentYear, currentMonth, 0).getDate();
  firstDayMonBased = (new Date(currentYear, currentMonth - 1, 1).getDay() + 6) % 7;
  renderEverything();
}

// ============================================
// THEME COLOR HELPERS
// ============================================
function getThemeColor(varName) {
  return getComputedStyle(document.body).getPropertyValue(varName).trim();
}

var HABIT_COLOR_CONFIG = {
  vaporwave:  { mode: 'hsl-band', baseHue: 0,   hueRange: 360, sat: 80, light: 62 },
  vaporwave2: { mode: 'hsl-band', baseHue: 180, hueRange: 160, sat: 85, light: 55 },
  basic:      { mode: 'hsl-band', baseHue: 200, hueRange: 80,  sat: 55, light: 50 },
  classic: { mode: 'curated', palette: ['#7A2E3A','#B08D8D','#C9A876','#5C3A3F','#E8D9C3','#946B6B','#D8C49A','#4A2B30','#BFA0A0','#F0E2C8','#8C5A5F','#A88B5F'] }
};
var GOLDEN_ANGLE = 137.508;

function colorForHabitIndex(i) {
  var theme = document.body.getAttribute('data-theme') || 'vaporwave';
  var cfg = HABIT_COLOR_CONFIG[theme] || HABIT_COLOR_CONFIG.vaporwave;
  if (cfg.mode === 'curated') return cfg.palette[i % cfg.palette.length];
  var hue = (cfg.baseHue + ((i * GOLDEN_ANGLE) % cfg.hueRange)) % 360;
  var light = Math.min(75, cfg.light + (i % 3) * 8);
  return 'hsl(' + hue.toFixed(0) + ', ' + cfg.sat + '%, ' + light + '%)';
}

function hexToRgb(hex) {
  var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  return m ? { r: parseInt(m[1],16), g: parseInt(m[2],16), b: parseInt(m[3],16) } : null;
}
function hexToRgba(hex, alpha) {
  var rgb = hexToRgb(hex);
  return rgb ? 'rgba('+rgb.r+','+rgb.g+','+rgb.b+','+alpha+')' : hex;
}
function lightenColor(hex, amount) {
  var rgb = hexToRgb(hex); if (!rgb) return hex;
  return 'rgb('+Math.round(rgb.r+(255-rgb.r)*amount)+','+Math.round(rgb.g+(255-rgb.g)*amount)+','+Math.round(rgb.b+(255-rgb.b)*amount)+')';
}
function darkenColor(hex, amount) {
  var rgb = hexToRgb(hex); if (!rgb) return hex;
  return 'rgb('+Math.round(rgb.r*(1-amount))+','+Math.round(rgb.g*(1-amount))+','+Math.round(rgb.b*(1-amount))+')';
}

// ============================================
// WEEK COLORS (from theme)
// ============================================
var weekColors = [], weekFillColors = [], weekTextColors = [];
function buildWeekColors() {
  var base = ['--c-pink','--c-orange','--c-purple','--c-text-muted','--c-dark'].map(getThemeColor);
  weekColors = base;
  weekFillColors = base.map(function(c) { return lightenColor(c, 0.75); });
  // FIX 2: Instead of blindly darkening (which fails on already-dark colors),
  // pick text color based on the perceived brightness of the base color.
  // If the base is dark, use a light text; if light, use a dark text.
  // This fixes the "Week 5" readability bug across all themes.
  weekTextColors = base.map(function(hex) {
    var rgb = hexToRgb(hex);
    if (!rgb) return '#fff';
    // Perceived brightness formula (WCAG relative luminance approximation)
    var brightness = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
    return brightness > 128 ? darkenColor(hex, 0.55) : lightenColor(hex, 0.85);
  });
}

// ============================================
// HABITS ARRAY (from Supabase data)
// ============================================
var habits = [];
function buildHabits() {
  if (RAW_HABITS.length > 0) {
    habits = RAW_HABITS.map(function(h, i) {
      return { id: h.id, name: h.name, icon: h.icon || '✅', category: h.category || 'General', colorClass: colorForHabitIndex(i) };
    });
  } else {
    habits = [{ id: -1, name: 'Add your first habit via ⚙ Settings', icon: '👆', category: '', colorClass: colorForHabitIndex(0) }];
  }
}

// ============================================
// TOP HABITS
// ============================================
function renderTopHabits() {
  var el = document.getElementById('top-habits');
  el.innerHTML = '';
  var totals = habits.map(function(h) {
    var hid = String(h.id);
    var total = Object.values(logsLookup[hid] || {}).reduce(function(a,b){return a+b;},0);
    return { name: h.name, total: total };
  });
  totals.sort(function(a,b){return b.total-a.total;});
  totals.slice(0,5).forEach(function(h,i) {
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;';
    row.innerHTML = '<span>'+(i+1)+'. '+h.name+'</span><span style="color:var(--c-text-muted);">'+h.total+'</span>';
    el.appendChild(row);
  });
  if (habits.length === 0 || (habits.length === 1 && habits[0].id === -1)) {
    el.innerHTML = '<p style="font-size:11px;color:var(--c-text-muted);">No habits yet</p>';
  }
}

// ============================================
// DONUTS
// ============================================
function getWeekCount() { return Math.ceil(DAYS_IN_MONTH / 7); }

function renderDonuts() {
  var el = document.getElementById('donut-row');
  el.innerHTML = '';
  var numWeeks = getWeekCount();
  var radius = 26;
  var circ = 2 * Math.PI * radius;
  for (var w = 0; w < numWeeks; w++) {
    var weekStart = w * 7 + 1;
    var weekEnd = Math.min(weekStart + 6, DAYS_IN_MONTH);
    var totalPossible = 0, totalDone = 0;
    habits.forEach(function(h) {
      if (h.id === -1) return;
      var hid = String(h.id);
      for (var d = weekStart; d <= weekEnd; d++) {
        var dow = (firstDayMonBased + d - 1) % 7;
        var sched = scheduleLookup[hid] && scheduleLookup[hid][dow];
        if (sched && sched.required > 0) {
          totalPossible += sched.required;
          var isoDate = currentYear+'-'+String(currentMonth).padStart(2,'0')+'-'+String(d).padStart(2,'0');
          totalDone += (logsLookup[hid] && logsLookup[hid][isoDate]) || 0;
        }
      }
    });
    var pct = totalPossible > 0 ? Math.round((totalDone/totalPossible)*100) : 0;
    var offset = circ - (pct/100)*circ;
    var color = weekColors[w] || '#ccc';
    var fillColor = weekFillColors[w] || '#eee';
    var textColor = weekTextColors[w] || '#333';
    var item = document.createElement('div');
    item.style.cssText='flex:1;min-width:60px;text-align:center;';
    item.innerHTML='<svg width="44" height="44" viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" fill="none" stroke="'+fillColor+'" stroke-width="8"></circle><circle cx="32" cy="32" r="26" fill="none" stroke="'+color+'" stroke-width="8" stroke-dasharray="'+circ+' '+circ+'" stroke-dashoffset="'+offset+'" transform="rotate(-90 32 32)" stroke-linecap="round"></circle><text x="32" y="37" text-anchor="middle" font-size="12" font-weight="600" fill="'+textColor+'">'+pct+'%</text></svg><p style="font-size:10px;color:var(--c-text-muted);margin:2px 0 0;">Wk '+(w+1)+'</p>';
    el.appendChild(item);
  }
}

// ============================================
// CHARTS (bar + line)
// ============================================
var lineChartInstance = null, barChartInstance = null, plannedActualChartInstance = null;

function renderCharts() {
  var dayLabels = [];
  for (var i=1;i<=DAYS_IN_MONTH;i++) dayLabels.push(i);

  // Stacked bar datasets from real logs
  var barDatasets = habits.map(function(h, i) {
    var hid = String(h.id);
    return {
      label: h.name,
      data: dayLabels.map(function(day) {
        if (h.id === -1) return 0;
        var isoDate = currentYear+'-'+String(currentMonth).padStart(2,'0')+'-'+String(day).padStart(2,'0');
        var dow = (firstDayMonBased + day - 1) % 7;
        var sched = scheduleLookup[hid] && scheduleLookup[hid][dow];
        var required = sched ? sched.required : 1;
        var done = (logsLookup[hid] && logsLookup[hid][isoDate]) || 0;
        var ratio = required > 0 ? done / required : 0;
        return extraCreditEnabled ? ratio : Math.min(ratio, 1);
      }),
      _rawCounts: dayLabels.map(function(day) {
        if (h.id === -1) return {done:0,required:1};
        var isoDate = currentYear+'-'+String(currentMonth).padStart(2,'0')+'-'+String(day).padStart(2,'0');
        var dow = (firstDayMonBased + day - 1) % 7;
        var sched = scheduleLookup[hid] && scheduleLookup[hid][dow];
        return { done: (logsLookup[hid]&&logsLookup[hid][isoDate])||0, required: sched?sched.required:1 };
      }),
      backgroundColor: colorForHabitIndex(i),
      borderRadius: 1, borderWidth: 0
    };
  });

  var totals = barDatasets.map(function(ds,i){return{index:i,total:ds.data.reduce(function(a,b){return a+b;},0)};});
  totals.sort(function(a,b){return b.total-a.total;});
  var top5 = totals.slice(0,5).map(function(t){return t.index;});

  // Line: total score per day
  var lineData = dayLabels.map(function(day) {
    return barDatasets.reduce(function(sum, ds) { return sum + (ds.data[day-1]||0); }, 0);
  });

  if (barChartInstance) barChartInstance.destroy();
  if (lineChartInstance) lineChartInstance.destroy();

  barChartInstance = new Chart(document.getElementById('barChart'), {
    type:'bar', data:{labels:dayLabels, datasets:barDatasets},
    options:{responsive:true,maintainAspectRatio:false,
      scales:{y:{stacked:true,beginAtZero:true,ticks:{stepSize:1}},x:{stacked:true,ticks:{autoSkip:true,maxRotation:0,font:{size:9}}}},
      plugins:{legend:{position:'bottom',labels:{boxWidth:10,font:{size:10},filter:function(item){return top5.indexOf(item.datasetIndex)!==-1;}}},
        tooltip:{callbacks:{label:function(ctx){var r=ctx.dataset._rawCounts[ctx.dataIndex];return r&&r.done>0?ctx.dataset.label+': '+r.done+'/'+r.required:null;}}}}}
  });

  lineChartInstance = new Chart(document.getElementById('lineChart'), {
    type:'line', data:{labels:dayLabels,datasets:[{data:lineData,borderColor:getThemeColor('--c-pink'),backgroundColor:hexToRgba(getThemeColor('--c-pink'),0.2),fill:true,tension:0,pointRadius:2}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true},x:{ticks:{autoSkip:true,maxRotation:0,font:{size:9}}}}}
  });
}

// ============================================
// CORRELATIONS
// ============================================
function renderCorrelations() {
  var el = document.getElementById('correlations');
  el.innerHTML = '';
  if (habits.length < 2 || habits[0].id === -1) {
    el.innerHTML = '<p style="font-size:11px;color:var(--c-text-muted);">Add habits to see correlations</p>';
    return;
  }
  // Simple Pearson correlation between each pair's daily completion ratios
  var pairs = [];
  for (var i=0;i<habits.length;i++) {
    for (var j=i+1;j<habits.length;j++) {
      var hiid=String(habits[i].id), hjid=String(habits[j].id);
      var xs=[], ys=[];
      for (var d=1;d<=DAYS_IN_MONTH;d++) {
        var iso=currentYear+'-'+String(currentMonth).padStart(2,'0')+'-'+String(d).padStart(2,'0');
        xs.push((logsLookup[hiid]&&logsLookup[hiid][iso])||0);
        ys.push((logsLookup[hjid]&&logsLookup[hjid][iso])||0);
      }
      var n=xs.length, sx=xs.reduce(function(a,b){return a+b;},0)/n, sy=ys.reduce(function(a,b){return a+b;},0)/n;
      var num=0,dx=0,dy=0;
      xs.forEach(function(x,k){num+=(x-sx)*(ys[k]-sy);dx+=(x-sx)*(x-sx);dy+=(ys[k]-sy)*(ys[k]-sy);});
      var corr=dx&&dy?num/Math.sqrt(dx*dy):0;
      pairs.push({a:habits[i].name,b:habits[j].name,corr:corr});
    }
  }
  pairs.sort(function(a,b){return Math.abs(b.corr)-Math.abs(a.corr);});
  pairs.slice(0,5).forEach(function(p) {
    var card=document.createElement('div');
    card.className='correlation-card';
    card.innerHTML=p.a+' &harr; '+p.b+'<span class="correlation-value">correlation '+(p.corr>=0?'+':'')+p.corr.toFixed(2)+'</span>';
    el.appendChild(card);
  });
}

// ============================================
// CHECKBOX GRID
// ============================================
var completionState = {};
var dayInitials = ['M','T','W','T','F','S','S'];

function renderGrid() {
  var table = document.getElementById('grid-table');
  table.innerHTML = '';
  completionState = {};
  var headRow = document.createElement('tr');
  headRow.appendChild(document.createElement('th'));
  var weekBoundaries = [];
  for (var d=1; d<=DAYS_IN_MONTH; d++) {
    var w = weekBoundaries.length === 0 ? 0 : weekBoundaries[weekBoundaries.length-1].week;
    var inWeek = weekBoundaries.filter(function(b){return b.week===w;}).length;
    if (inWeek === 7) w++;
    var th = document.createElement('th');
    th.innerHTML = dayInitials[(firstDayMonBased+d-1)%7]+'<br>'+d;
    headRow.appendChild(th);
    weekBoundaries.push({day:d,week:w});
  }
  var progressTh = document.createElement('th');
  progressTh.textContent = 'Progress';
  progressTh.style.minWidth = '110px';
  headRow.appendChild(progressTh);
  table.appendChild(headRow);

  habits.forEach(function(h, hi) {
    var hid = String(h.id);
    completionState[hid] = {};
    var row = document.createElement('tr');

    var labelCell = document.createElement('td');
    labelCell.className = 'habit-label-cell';
    labelCell.innerHTML = '<span class="habit-icon" style="background:'+h.colorClass+';"></span>'+h.icon+' '+h.name;
    row.appendChild(labelCell);

    weekBoundaries.forEach(function(b) {
      var cell = document.createElement('td');
      var box = document.createElement('div');
      box.className = 'day-box';

      var isoDate = currentYear+'-'+String(currentMonth).padStart(2,'0')+'-'+String(b.day).padStart(2,'0');
      var dow = (firstDayMonBased + b.day - 1) % 7;
      var sched = scheduleLookup[hid] && scheduleLookup[hid][dow];
      var timesRequired = sched ? sched.required : (h.id === -1 ? 0 : 1);
      var timesLogged = (logsLookup[hid] && logsLookup[hid][isoDate]) || 0;
      completionState[hid][b.day] = timesLogged;

      if (timesRequired === 0) {
        box.style.opacity = '0.2';
        box.style.cursor = 'default';
      } else {
        // Initial render from loaded log data
        applyBoxVisual(box, timesLogged, timesRequired, b.week);

        // Left-click: cycle 0 → 1 → ... → timesRequired → 0
        box.addEventListener('click', (function(habitId, date, reqTimes, weekNum, habitIdx, dayNum) {
          return function() {
            if (habitId === -1) return;
            var current = completionState[String(habitId)][dayNum] || 0;
            var maxTimes = extraCreditEnabled ? reqTimes * 2 : reqTimes;
            var next = current >= maxTimes ? 0 : current + 1;
            completionState[String(habitId)][dayNum] = next;
            logsLookup[String(habitId)] = logsLookup[String(habitId)] || {};
            logsLookup[String(habitId)][date] = next;
            applyBoxVisual(box, next, reqTimes, weekNum);
            updateProgressCell(String(habitId), habitIdx);
            saveLog(habitId, date, next);
          };
        })(h.id, isoDate, timesRequired, b.week, hi, b.day));

        // Right-click: open context menu to remove a tick
        box.addEventListener('contextmenu', (function(habitId, date, reqTimes, weekNum, habitIdx, dayNum) {
          return function(e) {
            e.preventDefault();
            _ctxTarget = { box: box, habitId: habitId, date: date, reqTimes: reqTimes, weekNum: weekNum, habitIdx: habitIdx, dayNum: dayNum };
            var menu = window._ctxMenu;
            menu.style.display = 'block';
            menu.style.top = e.clientY + 'px';
            menu.style.left = e.clientX + 'px';
          };
        })(h.id, isoDate, timesRequired, b.week, hi, b.day));
      }

      cell.appendChild(box);
      row.appendChild(cell);
    });

    var progressCell = document.createElement('td');
    progressCell.className = 'progress-cell';
    progressCell.id = 'progress-cell-' + hi;
    row.appendChild(progressCell);
    table.appendChild(row);
    updateProgressCell(hid, hi);
  });
}

// ---- FIX 1: Multi-click checkbox ----
// Each left-click increments timesLogged toward timesRequired.
// The box fills with progressively more opaque color as you click.
// When timesLogged >= timesRequired, it shows a ✓ checkmark.
// Right-clicking opens a context menu with "Remove tick".
// Hovering shows "N / M done" as a tooltip via data-tip + CSS.
//
// applyBoxVisual handles ONLY the visual state of a box given a count.
// The click handler in renderGrid calls this after updating state.
function applyBoxVisual(box, timesLogged, timesRequired, week) {
  var baseColor = weekColors[week] || '#8C5FD9';
  var doneColor = weekFillColors[week] || '#D7C5F0';

  if (timesLogged <= 0) {
    // Empty — transparent with just a border
    box.style.background = 'transparent';
    box.style.border = '1.5px solid ' + baseColor;
    box.style.color = 'transparent';
    box.textContent = '';
  } else if (timesLogged >= timesRequired) {
    // Fully done — solid fill + checkmark
    box.style.background = baseColor;
    box.style.border = '1.5px solid ' + baseColor;
    box.style.color = weekTextColors[week] || '#fff';
    box.textContent = '✓';
    box.style.fontSize = '11px';
    box.style.display = 'flex';
    box.style.alignItems = 'center';
    box.style.justifyContent = 'center';
  } else {
    // Partial — progressively more opaque fill, no checkmark yet
    var frac = timesLogged / timesRequired;
    // 0.15 opacity at 1/N, ramping up to 0.75 just before done
    var opacity = 0.15 + frac * 0.60;
    var rgb = hexToRgb(baseColor);
    var bg = rgb
      ? 'rgba('+rgb.r+','+rgb.g+','+rgb.b+','+opacity.toFixed(2)+')'
      : baseColor;
    box.style.background = bg;
    box.style.border = '1.5px solid ' + baseColor;
    box.style.color = weekTextColors[week] || '#333';
    // Show fraction as tiny text so user knows how far along they are
    box.textContent = timesLogged + '/' + timesRequired;
    box.style.fontSize = '8px';
    box.style.display = 'flex';
    box.style.alignItems = 'center';
    box.style.justifyContent = 'center';
    box.style.lineHeight = '1';
  }

  // Tooltip: shown via CSS :hover + data-tip attribute
  box.setAttribute('data-tip', timesLogged + ' / ' + timesRequired + ' done');
}

// Keep old applyBoxState as a thin wrapper so any other callers don't break.
// (It's now only called for the initial "done/not-done" state in one place.)
function applyBoxState(box, done, week) {
  var logged = done ? 1 : 0;
  applyBoxVisual(box, logged, 1, week);
}

// Context menu for right-click "remove tick"
var _ctxTarget = null;
(function() {
  var menu = document.createElement('div');
  menu.id = 'ctx-menu';
  menu.style.cssText = 'position:fixed;display:none;background:var(--c-body-bg);border:2px solid var(--c-dark);border-radius:var(--radius-sm);z-index:9999;padding:4px 0;min-width:130px;box-shadow:3px 3px 0 var(--c-dark);';
  var item = document.createElement('div');
  item.textContent = 'Remove tick';
  item.style.cssText = 'padding:7px 14px;font-size:12px;color:var(--c-text);cursor:pointer;';
  item.addEventListener('mouseenter', function(){ item.style.background='var(--c-body-bg-alt)'; });
  item.addEventListener('mouseleave', function(){ item.style.background=''; });
  item.addEventListener('click', function() {
    if (_ctxTarget) {
      var t = _ctxTarget;
      var cur = completionState[String(t.habitId)][t.dayNum] || 0;
      if (cur > 0) {
        var next = cur - 1;
        completionState[String(t.habitId)][t.dayNum] = next;
        logsLookup[String(t.habitId)] = logsLookup[String(t.habitId)] || {};
        logsLookup[String(t.habitId)][t.date] = next;
        applyBoxVisual(t.box, next, t.reqTimes, t.weekNum);
        updateProgressCell(String(t.habitId), t.habitIdx);
        saveLog(t.habitId, t.date, next);
      }
    }
    menu.style.display = 'none';
    _ctxTarget = null;
  });
  var cancel = document.createElement('div');
  cancel.textContent = 'Cancel';
  cancel.style.cssText = 'padding:7px 14px;font-size:12px;color:var(--c-text-muted);cursor:pointer;';
  cancel.addEventListener('click', function(){ menu.style.display='none'; _ctxTarget=null; });
  menu.appendChild(item);
  menu.appendChild(cancel);
  document.addEventListener('DOMContentLoaded', function(){ document.body.appendChild(menu); });
  document.addEventListener('click', function(){ menu.style.display='none'; _ctxTarget=null; });
  window._ctxMenu = menu;
})();

function updateProgressCell(hid, hi) {
  var cell = document.getElementById('progress-cell-' + hi);
  if (!cell) return;
  var h = habits[hi];
  var totalDone = 0, totalRequired = 0;
  for (var d=1; d<=DAYS_IN_MONTH; d++) {
    var dow = (firstDayMonBased + d - 1) % 7;
    var sched = scheduleLookup[hid] && scheduleLookup[hid][dow];
    if (sched && sched.required > 0) {
      totalRequired += sched.required;
      var isoDate = currentYear+'-'+String(currentMonth).padStart(2,'0')+'-'+String(d).padStart(2,'0');
      totalDone += (logsLookup[hid] && logsLookup[hid][isoDate]) || 0;
    }
  }
  if (totalRequired === 0) {
    // No schedule found — count any logged days vs days in month as fallback
    totalDone = Object.values(logsLookup[hid] || {}).reduce(function(a, b) { return a + b; }, 0);
    totalRequired = DAYS_IN_MONTH;
  }
  var pct = Math.round((totalDone / totalRequired) * 100);
  if (!extraCreditEnabled) pct = Math.min(pct, 100);
  cell.innerHTML = '<div style="display:flex;justify-content:flex-end;font-size:11px;margin-bottom:3px;"><span style="color:var(--c-text-muted);font-weight:600;">'+pct+'%</span></div><div style="background:var(--c-body-bg-alt);border:2px solid var(--c-dark);border-radius:var(--radius-sm);height:9px;overflow:hidden;"><div style="background:'+h.colorClass+';width:'+Math.min(pct,100)+'%;height:100%;"></div></div>';
}

// ============================================
// WEEKLY TASKS + PLANNED VS ACTUAL
// ============================================
function renderWeeklyDonut() {
  var numWeeks = getWeekCount();
  var totalDone = 0, totalRequired = 0;
  habits.forEach(function(h) {
    if (h.id === -1) return;
    var hid = String(h.id);
    for (var d=1;d<=DAYS_IN_MONTH;d++) {
      var dow=(firstDayMonBased+d-1)%7;
      var sched=scheduleLookup[hid]&&scheduleLookup[hid][dow];
      if (sched&&sched.required>0) {
        totalRequired+=sched.required;
        var iso=currentYear+'-'+String(currentMonth).padStart(2,'0')+'-'+String(d).padStart(2,'0');
        totalDone+=(logsLookup[hid]&&logsLookup[hid][iso])||0;
      }
    }
  });
  var pct = totalRequired > 0 ? Math.round((totalDone/totalRequired)*100) : 0;
  var radius=26, circ=2*Math.PI*radius, offset=circ-(pct/100)*circ;
  var pink=getThemeColor('--c-pink'), track=lightenColor(pink,0.75), text=darkenColor(pink,0.35);
  var svg=document.getElementById('weekly-donut');
  svg.innerHTML='<circle cx="32" cy="32" r="'+radius+'" fill="none" stroke="'+track+'" stroke-width="8"></circle><circle cx="32" cy="32" r="'+radius+'" fill="none" stroke="'+pink+'" stroke-width="8" stroke-dasharray="'+circ+' '+circ+'" stroke-dashoffset="'+offset+'" transform="rotate(-90 32 32)" stroke-linecap="round"></circle><text x="32" y="37" text-anchor="middle" font-size="13" font-weight="600" fill="'+text+'">'+pct+'%</text>';
}

var weeklyTaskData = [
  {week:'Week 1',tasks:[]},{week:'Week 2',tasks:[]},
  {week:'Week 3',tasks:[]},{week:'Week 4',tasks:[]},{week:'Week 5',tasks:[]}
];

function renderWeeklyTasks() {
  var el = document.getElementById('weekly-tasks');
  el.innerHTML = '';
  var numWeeks = getWeekCount();
  weeklyTaskData.slice(0, numWeeks).forEach(function(wd, w) {
    var col = document.createElement('div');
    col.className = 'week-col';
    var header = document.createElement('div');
    header.className = 'week-col-header';
    header.style.background = weekColors[w] || '#ccc';
    // FIX 3: Apply the contrast-aware text color so "Week 5" (and all headers)
    // are always readable — this was unset before, inheriting whatever color
    // CSS happened to cascade in, which was too dark on dark theme colors.
    header.style.color = weekTextColors[w] || '#fff';
    header.textContent = wd.week;
    col.appendChild(header);
    for (var i=0; i<10; i++) {
      var task = wd.tasks[i] || {t:'',c:false};
      var row = document.createElement('div');
      row.className = 'task-row';
      row.style.background = (i%2===1) ? (weekFillColors[w]||'transparent') : 'transparent';
      var cb = document.createElement('input'); cb.type='checkbox'; cb.checked=task.c; cb.style.accentColor=weekColors[w]||'#ccc';
      var inp = document.createElement('input'); inp.type='text'; inp.value=task.t; inp.placeholder='';
      if (task.c) inp.classList.add('task-done');
      cb.addEventListener('change', function(textEl){ return function(){ textEl.classList.toggle('task-done', this.checked); }; }(inp));
      row.appendChild(cb); row.appendChild(inp);
      col.appendChild(row);
    }
    el.appendChild(col);
  });
}

function renderPlannedActualChart() {
  var numWeeks = getWeekCount();
  var weekLabels = weeklyTaskData.slice(0,numWeeks).map(function(w){return w.week;});
  var planned = weeklyTaskData.slice(0,numWeeks).map(function(){return 0;});
  var actual = weeklyTaskData.slice(0,numWeeks).map(function(wd){return wd.tasks.filter(function(t){return t.c;}).length;});
  if (plannedActualChartInstance) plannedActualChartInstance.destroy();
  plannedActualChartInstance = new Chart(document.getElementById('plannedActualChart'),{
    type:'bar',data:{labels:weekLabels,datasets:[
      {label:'Planned',data:planned,backgroundColor:lightenColor(getThemeColor('--c-purple'),0.6),borderRadius:2},
      {label:'Actual',data:actual,backgroundColor:getThemeColor('--c-purple'),borderRadius:2}
    ]},
    options:{responsive:true,maintainAspectRatio:false,scales:{y:{beginAtZero:true,max:10,ticks:{stepSize:2}}},plugins:{legend:{display:true,position:'top',labels:{boxWidth:10,font:{size:10}}}}}
  });
}

// ============================================
// MASTER RENDER
// ============================================
function renderEverything() {
  buildWeekColors();
  buildHabits();
  if (lineChartInstance) lineChartInstance.destroy();
  if (barChartInstance) barChartInstance.destroy();
  if (plannedActualChartInstance) plannedActualChartInstance.destroy();
  renderTopHabits();
  renderDonuts();
  renderCharts();
  renderCorrelations();
  renderGrid();
  renderWeeklyDonut();
  renderWeeklyTasks();
  renderPlannedActualChart();
}

// ============================================
// INIT
// ============================================
// Init theme from localStorage
(function() {
  var saved = 'vaporwave';
  try { saved = localStorage.getItem('habitTrackerTheme') || 'vaporwave'; } catch(e) {}
  document.body.setAttribute('data-theme', saved);
  var sel = document.getElementById('theme-select');
  if (sel) sel.value = saved;
})();

// Check if already logged in, otherwise show auth screen
checkSession();
