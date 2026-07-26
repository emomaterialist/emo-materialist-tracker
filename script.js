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
var allTimeLogs = {};
var allTimeScatterInstance = null;
var radarChartInstance = null;
var DAYS_IN_MONTH = 30;
var firstDayMonBased = 0;
var lineChartInstance = null, barChartInstance = null, plannedActualChartInstance = null;
const DAYS_OF_WEEK = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

// ============================================
// AUTH
// ============================================
function showTab(tab) {
  document.getElementById('form-login').style.display = tab==='login'?'block':'none';
  document.getElementById('form-signup').style.display = tab==='signup'?'block':'none';
  document.getElementById('tab-login').classList.toggle('active', tab==='login');
  document.getElementById('tab-signup').classList.toggle('active', tab==='signup');
}
function showMsg(id, text, type) {
  var el = document.getElementById(id);
  el.textContent = text; el.className = 'auth-msg ' + type;
}
async function handleLogin() {
  var email = document.getElementById('login-email').value.trim();
  var pass = document.getElementById('login-password').value;
  if (!email || !pass) return showMsg('login-msg','Please fill in all fields.','error');
  showMsg('login-msg','Logging in...','info');
  var { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
  if (error) return showMsg('login-msg', error.message, 'error');
  currentUser = data.user; onLoggedIn();
}
async function handleSignup() {
  var code = document.getElementById('signup-code').value.trim().toUpperCase();
  var email = document.getElementById('signup-email').value.trim();
  var pass = document.getElementById('signup-password').value;
  if (!code||!email||!pass) return showMsg('signup-msg','Please fill in all fields.','error');
  showMsg('signup-msg','Checking your code...','info');
  var { data: codeRows } = await sb.from('codes').select('*').eq('code', code);
  if (!codeRows||codeRows.length===0) return showMsg('signup-msg',"That code doesn't exist.",'error');
  if (codeRows[0].is_redeemed) return showMsg('signup-msg','That code has already been used.','error');
  var { data, error } = await sb.auth.signUp({ email, password: pass });
  if (error) return showMsg('signup-msg', error.message, 'error');
  await sb.from('codes').update({ is_redeemed: true, redeemed_by: data.user.id, redeemed_at: new Date().toISOString() }).eq('code', code);
  showMsg('signup-msg','Account created! Check your email to confirm, then log in.','success');
}
async function handleLogout() {
  await sb.auth.signOut(); currentUser = null;
  document.getElementById('tracker-screen').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
  toggleSettings(false);
}
async function checkSession() {
  var { data } = await sb.auth.getSession();
  if (data.session) { currentUser = data.session.user; onLoggedIn(); }
}
function onLoggedIn() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('tracker-screen').style.display = 'block';
  document.getElementById('settings-email').textContent = currentUser.email;
  // Load saved theme from Supabase user metadata, fallback to localStorage
  var savedTheme = (currentUser.user_metadata && currentUser.user_metadata.preferred_theme) || null;
  try { savedTheme = savedTheme || localStorage.getItem('habitTrackerTheme') || 'vaporwave'; } catch(e) { savedTheme = savedTheme || 'vaporwave'; }
  document.body.setAttribute('data-theme', savedTheme);
  var sel = document.getElementById('theme-select');
  if (sel) sel.value = savedTheme;
  // Apply tron button colors if needed
  if(savedTheme==='tron'){
    document.querySelectorAll('.settings-toggle-btn').forEach(function(btn){
      btn.style.background='#0a1a3a';
      btn.style.color='#00FFFF';
      btn.style.textShadow='0 0 6px #00FFFF';
    });
  }
  buildCatPills();
  buildScheduleRows();
  initMonthYearPickers();
  updateMonthLabel();
  loadAndRender();
}

// ============================================
// SETTINGS
// ============================================
function toggleSettings(forceState) {
  var panel = document.getElementById('settings-panel');
  if (forceState===false) { panel.classList.remove('open'); return; }
  var isOpening = !panel.classList.contains('open');
  panel.classList.toggle('open');
  if (isOpening) buildScheduleRows();
}
async function changeTheme(theme) {
  document.body.setAttribute('data-theme', theme);
  try { localStorage.setItem('habitTrackerTheme', theme); } catch(e) {}
  if (currentUser) await sb.auth.updateUser({ data: { preferred_theme: theme } });
  // Force button colors for tron theme
  document.querySelectorAll('.settings-toggle-btn').forEach(function(btn) {
    if(theme==='tron'){
      btn.style.background='#0a1a3a';
      btn.style.color='#00FFFF';
      btn.style.textShadow='0 0 6px #00FFFF';
    } else {
      btn.style.background='';
      btn.style.color='';
      btn.style.textShadow='';
    }
  });
  renderEverything();
}
function updateMonthLabel() {
  var el=document.getElementById('current-month-label'); if(!el)return;
  var mNames=['January','February','March','April','May','June','July','August','September','October','November','December'];
  el.textContent=mNames[currentMonth-1]+' '+currentYear;
}
function changeMonth() {
  currentMonth = parseInt(document.getElementById('month-select').value);
  currentYear = parseInt(document.getElementById('year-select').value);
  updateMonthLabel(); loadAndRender();
}
function jumpToCurrentMonth() {
  var now=new Date(); currentMonth=now.getMonth()+1; currentYear=now.getFullYear();
  document.getElementById('month-select').value=currentMonth;
  document.getElementById('year-select').value=currentYear;
  updateMonthLabel(); loadAndRender();
}
function toggleExtraCredit(val) { extraCreditEnabled = val; renderEverything(); }
function initMonthYearPickers() {
  document.getElementById('month-select').value = currentMonth;
  var yearSel = document.getElementById('year-select'); yearSel.innerHTML = '';
  var thisYear = new Date().getFullYear();
  for (var y=thisYear-5; y<=thisYear; y++) {
    var opt = document.createElement('option'); opt.value=y; opt.textContent=y; yearSel.appendChild(opt);
  }
  yearSel.value = currentYear;
}
function renderHabitList() {
  var el = document.getElementById('habit-list'); el.innerHTML = '';
  if (RAW_HABITS.length===0) { el.innerHTML='<p style="font-size:11px;color:var(--c-text-muted);">No habits yet. Add one above!</p>'; return; }
  RAW_HABITS.forEach(function(h) {
    var row = document.createElement('div'); row.className='habit-list-row';
    row.innerHTML = '<span>'+h.icon+' '+h.name+'</span>';
    var btn = document.createElement('button'); btn.className='habit-del-btn'; btn.textContent='🗑';
    btn.onclick = function() { archiveHabit(h.id); };
    row.appendChild(btn); el.appendChild(row);
  });
}
function refreshCharts() {
  if (lineChartInstance) lineChartInstance.destroy();
  if (barChartInstance) barChartInstance.destroy();
  if (plannedActualChartInstance) plannedActualChartInstance.destroy();
  buildWeekColors(); buildHabits();
  renderTopHabits(); renderDonuts(); renderCharts(); renderWeeklyDonut();
  var label = document.getElementById('last-updated');
  if (label) { var now=new Date(); label.textContent='Updated '+now.getHours()+':'+String(now.getMinutes()).padStart(2,'0')+':'+String(now.getSeconds()).padStart(2,'0'); }
}

// ============================================
// CATEGORY DROPDOWN + PILLS
// ============================================
var customCategories = [];
function handleCategorySelect(val) {
  var row = document.getElementById('custom-cat-row');
  if (val==='__custom__') { row.style.display='flex'; document.getElementById('custom-cat-input').focus(); }
  else { row.style.display='none'; highlightPill(val); }
}
function confirmCustomCategory() {
  var val = document.getElementById('custom-cat-input').value.trim();
  if (!val) return;
  if (customCategories.indexOf(val)===-1) { customCategories.push(val); }
  var sel = document.getElementById('habit-category-select');
  // Add to dropdown if not there
  var exists = false;
  for (var i=0; i<sel.options.length; i++) { if (sel.options[i].value===val) { exists=true; break; } }
  if (!exists) { var opt=document.createElement('option'); opt.value=val; opt.textContent=val; sel.insertBefore(opt, sel.lastElementChild); }
  sel.value = val;
  document.getElementById('custom-cat-row').style.display='none';
  document.getElementById('custom-cat-input').value='';
  buildCatPills(); highlightPill(val);
}
function buildCatPills() {
  var el = document.getElementById('cat-pills-row'); if (!el) return; el.innerHTML='';
  var cats = ['General','Health','Fitness','Mindfulness','Learning','Productivity','Self-care','Finance','Social'].concat(customCategories);
  cats.forEach(function(c) {
    var pill = document.createElement('button');
    pill.textContent = c; pill.className='cat-pill';
    pill.style.cssText='font-size:10px;padding:3px 8px;border-radius:12px;border:1.5px solid var(--c-dark);background:transparent;color:var(--c-text-muted);cursor:pointer;transition:all 0.15s;';
    pill.onclick = function() {
      document.getElementById('habit-category-select').value = c;
      document.getElementById('custom-cat-row').style.display='none';
      highlightPill(c);
    };
    el.appendChild(pill);
  });
}
function highlightPill(val) {
  document.querySelectorAll('.cat-pill').forEach(function(p) {
    if (p.textContent===val) { p.style.background='var(--c-pink)'; p.style.color='var(--c-dark)'; p.style.borderColor='var(--c-pink)'; }
    else { p.style.background='transparent'; p.style.color='var(--c-text-muted)'; p.style.borderColor='var(--c-dark)'; }
  });
}

// ============================================
// DAY TOGGLES + ADD HABIT
// ============================================
function buildDayToggles(containerId) {
  var el = document.getElementById(containerId); if (!el) return; el.innerHTML='';
  ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach(function(day, i) {
    var btn = document.createElement('button'); btn.className='day-toggle'; btn.textContent=day; btn.dataset.index=i;
    btn.addEventListener('click', function() { btn.classList.toggle('selected'); });
    el.appendChild(btn);
  });
}
function buildScheduleRows() { buildDayToggles('fixed-days-row'); buildDayToggles('flex-days-row'); }

async function submitAddHabit() {
  var name = document.getElementById('habit-name').value.trim();
  var icon = document.getElementById('habit-icon').value.trim() || '✅';
  var category = document.getElementById('habit-category-select').value || 'General';
  if (category==='__custom__') category='General';
  var timesPerDay = parseInt(document.getElementById('habit-times-per-day').value)||1;
  var flexNeeded = parseInt(document.getElementById('habit-flex-needed').value)||0;
  if (!name) return showMsg('add-habit-msg','Please enter a habit name.','error');

  var fixedDays=[], flexDays=[];
  document.querySelectorAll('#fixed-days-row .day-toggle.selected').forEach(function(btn){fixedDays.push(parseInt(btn.dataset.index));});
  document.querySelectorAll('#flex-days-row .day-toggle.selected').forEach(function(btn){flexDays.push(parseInt(btn.dataset.index));});

  // Debug: show what days were picked
  showMsg('add-habit-msg','Fixed days: ['+fixedDays+'] Flex days: ['+flexDays+'] flex needed: '+flexNeeded,'info');

  if (fixedDays.length===0 && flexDays.length===0) return showMsg('add-habit-msg','Select at least one day.','error');
  if (flexDays.length>0 && flexNeeded===0) return showMsg('add-habit-msg','If you picked flexible days, set how many per week are needed.','error');

  showMsg('add-habit-msg','Saving habit...','info');
  var { data, error } = await sb.from('habits').insert({ user_id:currentUser.id, name, icon, category, color:'auto' }).select();
  if (error) return showMsg('add-habit-msg','❌ habits insert error: '+error.message,'error');

  var habitId = data[0].id;
  var schedRows = [];
  fixedDays.forEach(function(dow){ schedRows.push({habit_id:habitId,day_of_week:dow,times_required:timesPerDay,is_flexible:false}); });
  flexDays.forEach(function(dow){ schedRows.push({habit_id:habitId,day_of_week:dow,times_required:timesPerDay,is_flexible:true}); });
  if (flexNeeded>0&&flexDays.length>0) schedRows.push({habit_id:habitId,day_of_week:7,times_required:flexNeeded,is_flexible:true});

  if (schedRows.length>0) {
    var { error: sErr } = await sb.from('habit_schedule').insert(schedRows);
    if (sErr) return showMsg('add-habit-msg','❌ schedule insert error: '+sErr.message,'error');
    showMsg('add-habit-msg','✅ Saved '+schedRows.length+' schedule rows for habit '+habitId,'success');
  } else {
    showMsg('add-habit-msg','⚠️ No schedule rows to save — habit created with no schedule','info');
  }

  document.getElementById('habit-name').value='';
  document.getElementById('habit-times-per-day').value='1';
  document.getElementById('habit-flex-needed').value='0';
  document.querySelectorAll('.day-toggle.selected').forEach(function(b){b.classList.remove('selected');});

  setTimeout(function(){ showMsg('add-habit-msg','✅ Added: '+icon+' '+name,'success'); }, 1500);
  await loadHabits(); renderEverything();
}
async function archiveHabit(habitId) {
  await sb.from('habits').update({archived:true}).eq('id',habitId);
  await loadHabits(); renderEverything();
}

// ============================================
// DATA LOADING
// ============================================
async function loadHabits() {
  var { data } = await sb.from('habits').select('*, habit_schedule(*)').eq('user_id',currentUser.id).eq('archived',false);
  RAW_HABITS = data||[]; buildScheduleLookup(); renderHabitList();
}
async function loadLogs() {
  var start = currentYear+'-'+String(currentMonth).padStart(2,'0')+'-01';
  var lastDay = new Date(currentYear,currentMonth,0).getDate();
  var end = currentYear+'-'+String(currentMonth).padStart(2,'0')+'-'+String(lastDay).padStart(2,'0');
  var habitIds = RAW_HABITS.map(function(h){return h.id;});
  if (habitIds.length===0) { logsLookup={}; return; }
  var { data } = await sb.from('habit_logs').select('habit_id,log_date,times_completed').in('habit_id',habitIds).gte('log_date',start).lte('log_date',end);
  logsLookup={};
  (data||[]).forEach(function(log){ var hid=String(log.habit_id); if(!logsLookup[hid])logsLookup[hid]={}; logsLookup[hid][log.log_date]=log.times_completed; });
}
async function loadAllTimeLogs() {
  var habitIds = RAW_HABITS.map(function(h){return h.id;});
  if (habitIds.length===0) { allTimeLogs={}; return; }
  var { data } = await sb.from('habit_logs').select('habit_id,log_date,times_completed').in('habit_id',habitIds).order('log_date',{ascending:true});
  allTimeLogs={};
  (data||[]).forEach(function(log){ var hid=String(log.habit_id); if(!allTimeLogs[hid])allTimeLogs[hid]={}; allTimeLogs[hid][log.log_date]=log.times_completed; });
}
async function saveLog(habitId, logDate, timesCompleted) {
  await sb.from('habit_logs').upsert({habit_id:habitId,log_date:logDate,times_completed:timesCompleted},{onConflict:'habit_id,log_date'});
  var hid=String(habitId); if(!logsLookup[hid])logsLookup[hid]={}; logsLookup[hid][logDate]=timesCompleted;
  // Also update allTimeLogs
  if(!allTimeLogs[hid])allTimeLogs[hid]={}; allTimeLogs[hid][logDate]=timesCompleted;
  refreshCharts();
}
function buildScheduleLookup() {
  scheduleLookup={};
  RAW_HABITS.forEach(function(h){
    var hid=String(h.id);
    scheduleLookup[hid]={};
    (h.habit_schedule||[]).forEach(function(s){
      // Explicitly coerce is_flexible to boolean in case Supabase returns a string
      var isFlexible = s.is_flexible === true || s.is_flexible === 'true';
      scheduleLookup[hid][s.day_of_week]={required:s.times_required, flexible:isFlexible};
    });
  });
}
async function loadAndRender() {
  await loadHabits(); await loadLogs(); await loadAllTimeLogs(); await loadWeeklyTasks();
  DAYS_IN_MONTH = new Date(currentYear,currentMonth,0).getDate();
  firstDayMonBased = (new Date(currentYear,currentMonth-1,1).getDay()+6)%7;
  renderEverything();
}

// ============================================
// COLOR HELPERS
// ============================================
function getThemeColor(varName) { return getComputedStyle(document.body).getPropertyValue(varName).trim(); }
var HABIT_COLOR_CONFIG = {
  vaporwave:  { mode:'hsl-band', baseHue:0, hueRange:360, sat:80, light:62 },
  vaporwave2: { mode:'hsl-band', baseHue:180, hueRange:160, sat:85, light:55 },
  basic:      { mode:'hsl-band', baseHue:200, hueRange:80, sat:55, light:50 },
  classic:    { mode:'curated', palette:['#7A2E3A','#B08D8D','#C9A876','#5C3A3F','#E8D9C3','#946B6B','#D8C49A','#4A2B30','#BFA0A0','#F0E2C8','#8C5A5F','#A88B5F'] },
  retro95:    { mode:'curated', palette:['#FFFFFF','#FF6600','#FF2E92','#9933FF','#39FF14','#00F0FF','#FFB347','#FF0055','#FFFF00','#AA00FF','#00FF88','#FF9900'] },
  gothic:     { mode:'curated', palette:['#8B0000','#1A4A1A','#1A1A5C','#4A0E5C','#5C3A00','#005C5C','#2A2A2A','#FF6B6B','#DC143C','#5C0000','#FF9999','#FFB3B3'] },
  tron:       { mode:'curated', palette:['#00FFFF','#FF00FF','#FFFF00','#00FF88','#FF6600','#AA00FF','#FF0055','#00CCFF','#FF99FF','#99FF00','#FF9900','#00FFCC'] },
  superpink:  { mode:'curated', palette:['#FFB3C6','#FF85A1','#FF5C8A','#E8407A','#C2446E','#FF9EBA','#FFD6E5','#FF6E96','#FFE0EB','#FF3399','#FFAAC8','#D96080'] }
};
var GOLDEN_ANGLE = 137.508;
function colorForHabitIndex(i) {
  var theme = document.body.getAttribute('data-theme')||'vaporwave';
  var cfg = HABIT_COLOR_CONFIG[theme]||HABIT_COLOR_CONFIG.vaporwave;
  if (cfg.mode==='curated') return cfg.palette[i%cfg.palette.length];
  var hue = (cfg.baseHue+((i*GOLDEN_ANGLE)%cfg.hueRange))%360;
  return 'hsl('+hue.toFixed(0)+','+cfg.sat+'%,'+Math.min(75,cfg.light+(i%3)*8)+'%)';
}
function hexToRgb(hex) { var m=/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec((hex||'').trim()); return m?{r:parseInt(m[1],16),g:parseInt(m[2],16),b:parseInt(m[3],16)}:null; }
function hexToRgba(hex,a) { var r=hexToRgb(hex); return r?'rgba('+r.r+','+r.g+','+r.b+','+a+')':hex; }
function lightenColor(hex,a) { var r=hexToRgb(hex); if(!r)return hex; return 'rgb('+Math.round(r.r+(255-r.r)*a)+','+Math.round(r.g+(255-r.g)*a)+','+Math.round(r.b+(255-r.b)*a)+')'; }
function darkenColor(hex,a) { var r=hexToRgb(hex); if(!r)return hex; return 'rgb('+Math.round(r.r*(1-a))+','+Math.round(r.g*(1-a))+','+Math.round(r.b*(1-a))+')'; }

// ============================================
// WEEK COLORS
// ============================================
var weekColors=[], weekFillColors=[], weekTextColors=[];
function buildWeekColors() {
  var base=['--c-pink','--c-orange','--c-purple','--c-text-muted','--c-dark'].map(getThemeColor);
  weekColors=base;
  weekFillColors=base.map(function(c){return lightenColor(c,0.75);});
  weekTextColors=base.map(function(hex){ var rgb=hexToRgb(hex); if(!rgb)return'#fff'; var b=(rgb.r*299+rgb.g*587+rgb.b*114)/1000; return b>128?darkenColor(hex,0.55):lightenColor(hex,0.85); });
}
var habits=[];
function buildHabits() {
  if (RAW_HABITS.length>0) { habits=RAW_HABITS.map(function(h,i){return{id:h.id,name:h.name,icon:h.icon||'✅',category:h.category||'General',colorClass:colorForHabitIndex(i)};}); }
  else { habits=[{id:-1,name:'Add your first habit via ⚙ Settings',icon:'👆',category:'',colorClass:colorForHabitIndex(0)}]; }
}

// ============================================
// TOP HABITS
// ============================================
function renderTopHabits() {
  var el=document.getElementById('top-habits'); el.innerHTML='';
  var totals=habits.map(function(h){return{name:h.icon+' '+h.name,total:Object.values(logsLookup[String(h.id)]||{}).reduce(function(a,b){return a+b;},0)};});
  totals.sort(function(a,b){return b.total-a.total;});
  totals.slice(0,5).forEach(function(h,i){
    var row=document.createElement('div');
    row.className='top-habit-row';
    row.innerHTML='<span>'+(i+1)+'. '+h.name+'</span><span class="top-habit-count">'+h.total+'</span>';
    el.appendChild(row);
  });
  if (!totals.length||(habits.length===1&&habits[0].id===-1)) el.innerHTML='<p class="cell-subtitle">No habits yet</p>';
}

// ============================================
// DONUTS
// ============================================
function getWeekCount(){return Math.ceil(DAYS_IN_MONTH/7);}
function renderDonuts() {
  var el=document.getElementById('donut-row'); el.innerHTML='';
  var numWeeks=getWeekCount(), radius=26, circ=2*Math.PI*radius;
  for (var w=0;w<numWeeks;w++) {
    var ws=w*7+1, we=Math.min(ws+6,DAYS_IN_MONTH), tp=0, td=0;
    habits.forEach(function(h){
      if(h.id===-1)return; var hid=String(h.id);
      for(var d=ws;d<=we;d++){
        var dow=(firstDayMonBased+d-1)%7, sched=scheduleLookup[hid]&&scheduleLookup[hid][dow];
        if(sched&&sched.required>0){tp+=sched.required; var iso=currentYear+'-'+String(currentMonth).padStart(2,'0')+'-'+String(d).padStart(2,'0'); td+=(logsLookup[hid]&&logsLookup[hid][iso])||0;}
      }
    });
    var pct=tp>0?Math.round((td/tp)*100):0, offset=circ-(pct/100)*circ;
    var color=weekColors[w]||'#ccc', fill=weekFillColors[w]||'#eee', txt=weekTextColors[w]||'#333';
    var item=document.createElement('div'); item.style.cssText='flex:1;min-width:60px;text-align:center;';
    item.innerHTML='<svg width="44" height="44" viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" fill="none" stroke="'+fill+'" stroke-width="8"></circle><circle cx="32" cy="32" r="26" fill="none" stroke="'+color+'" stroke-width="8" stroke-dasharray="'+circ+' '+circ+'" stroke-dashoffset="'+offset+'" transform="rotate(-90 32 32)" stroke-linecap="round"></circle><text x="32" y="37" text-anchor="middle" font-size="12" font-weight="600" fill="'+txt+'">'+pct+'%</text></svg><p style="font-size:10px;color:var(--c-text-muted);margin:2px 0 0;">Wk '+(w+1)+'</p>';
    el.appendChild(item);
  }
}

// ============================================
// CHARTS
// ============================================
function renderCharts() {
  var dayLabels=[]; for(var i=1;i<=DAYS_IN_MONTH;i++) dayLabels.push(i);
  var barDatasets=habits.map(function(h,i){
    var hid=String(h.id);
    return { label:h.name, data:dayLabels.map(function(day){
      if(h.id===-1)return 0;
      var iso=currentYear+'-'+String(currentMonth).padStart(2,'0')+'-'+String(day).padStart(2,'0');
      var dow=(firstDayMonBased+day-1)%7, sched=scheduleLookup[hid]&&scheduleLookup[hid][dow];
      var req=sched?sched.required:1, done=(logsLookup[hid]&&logsLookup[hid][iso])||0;
      var ratio=req>0?done/req:0; return extraCreditEnabled?ratio:Math.min(ratio,1);
    }), _rawCounts:dayLabels.map(function(day){
      if(h.id===-1)return{done:0,required:1};
      var iso=currentYear+'-'+String(currentMonth).padStart(2,'0')+'-'+String(day).padStart(2,'0');
      var dow=(firstDayMonBased+day-1)%7, sched=scheduleLookup[hid]&&scheduleLookup[hid][dow];
      return{done:(logsLookup[hid]&&logsLookup[hid][iso])||0,required:sched?sched.required:1};
    }), backgroundColor:colorForHabitIndex(i), borderRadius:1, borderWidth:0 };
  });
  var totals=barDatasets.map(function(ds,i){return{index:i,total:ds.data.reduce(function(a,b){return a+b;},0)};});
  totals.sort(function(a,b){return b.total-a.total;}); var top5=totals.slice(0,5).map(function(t){return t.index;});
  var lineData=dayLabels.map(function(day){return barDatasets.reduce(function(sum,ds){return sum+(ds.data[day-1]||0);},0);});
  if(barChartInstance)barChartInstance.destroy(); if(lineChartInstance)lineChartInstance.destroy();
  barChartInstance=new Chart(document.getElementById('barChart'),{type:'bar',data:{labels:dayLabels,datasets:barDatasets},options:{responsive:true,maintainAspectRatio:false,scales:{y:{stacked:true,beginAtZero:true,ticks:{stepSize:1}},x:{stacked:true,ticks:{autoSkip:true,maxRotation:0,font:{size:9}}}},plugins:{legend:{position:'bottom',labels:{boxWidth:10,font:{size:10},filter:function(item){return top5.indexOf(item.datasetIndex)!==-1;}}},tooltip:{callbacks:{label:function(ctx){var r=ctx.dataset._rawCounts[ctx.dataIndex];return r&&r.done>0?ctx.dataset.label+': '+r.done+'/'+r.required:null;}}}}}});
  lineChartInstance=new Chart(document.getElementById('lineChart'),{type:'line',data:{labels:dayLabels,datasets:[{data:lineData,borderColor:getThemeColor('--c-pink'),backgroundColor:hexToRgba(getThemeColor('--c-pink'),0.2),fill:true,tension:0,pointRadius:2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true},x:{ticks:{autoSkip:true,maxRotation:0,font:{size:9}}}}}});
}

// ============================================
// CORRELATIONS
// ============================================
function renderCorrelations() {
  var el=document.getElementById('correlations'); el.innerHTML='';
  if(habits.length<2||habits[0].id===-1){el.innerHTML='<p class="cell-subtitle">Add habits to see correlations</p>';return;}
  var pairs=[];
  for(var i=0;i<habits.length;i++){for(var j=i+1;j<habits.length;j++){
    var hiid=String(habits[i].id),hjid=String(habits[j].id),xs=[],ys=[];
    for(var d=1;d<=DAYS_IN_MONTH;d++){var iso=currentYear+'-'+String(currentMonth).padStart(2,'0')+'-'+String(d).padStart(2,'0'); xs.push((logsLookup[hiid]&&logsLookup[hiid][iso])||0); ys.push((logsLookup[hjid]&&logsLookup[hjid][iso])||0);}
    var n=xs.length,sx=xs.reduce(function(a,b){return a+b;},0)/n,sy=ys.reduce(function(a,b){return a+b;},0)/n,num=0,dx=0,dy=0;
    xs.forEach(function(x,k){num+=(x-sx)*(ys[k]-sy);dx+=(x-sx)*(x-sx);dy+=(ys[k]-sy)*(ys[k]-sy);});
    pairs.push({a:habits[i].name,b:habits[j].name,corr:dx&&dy?num/Math.sqrt(dx*dy):0});
  }}
  pairs.sort(function(a,b){return Math.abs(b.corr)-Math.abs(a.corr);});
  pairs.slice(0,5).forEach(function(p){var card=document.createElement('div');card.className='correlation-card';card.innerHTML=p.a+' &harr; '+p.b+'<span class="correlation-value">correlation '+(p.corr>=0?'+':'')+p.corr.toFixed(2)+'</span>';el.appendChild(card);});
}

// ============================================
// CHECKBOX GRID WITH THEME-AWARE STYLES
// ============================================
var completionState={};
var dayInitials=['M','T','W','T','F','S','S'];
function renderGrid() {
  var table=document.getElementById('grid-table'); table.innerHTML=''; completionState={};
  var headRow=document.createElement('tr'); headRow.appendChild(document.createElement('th'));
  var weekBoundaries=[];
  for(var d=1;d<=DAYS_IN_MONTH;d++){
    var w=weekBoundaries.length===0?0:weekBoundaries[weekBoundaries.length-1].week;
    if(weekBoundaries.filter(function(b){return b.week===w;}).length===7)w++;
    var th=document.createElement('th'); th.innerHTML=dayInitials[(firstDayMonBased+d-1)%7]+'<br>'+d;
    headRow.appendChild(th); weekBoundaries.push({day:d,week:w});
  }
  var progressTh=document.createElement('th'); progressTh.textContent='Progress'; progressTh.style.minWidth='110px';
  headRow.appendChild(progressTh); table.appendChild(headRow);

  habits.forEach(function(h,hi){
    var hid=String(h.id); completionState[hid]={};
    var row=document.createElement('tr');
    var labelCell=document.createElement('td'); labelCell.className='habit-label-cell';
    // Hover tooltip for category
    labelCell.title=h.category?'Category: '+h.category:'';
    labelCell.innerHTML='<span class="habit-icon" style="background:'+h.colorClass+';"></span>'+h.icon+' '+h.name;
    row.appendChild(labelCell);

    weekBoundaries.forEach(function(b){
      var cell=document.createElement('td'), box=document.createElement('div'); box.className='day-box';
      var isoDate=currentYear+'-'+String(currentMonth).padStart(2,'0')+'-'+String(b.day).padStart(2,'0');
      var dow=(firstDayMonBased+b.day-1)%7, sched=scheduleLookup[hid]&&scheduleLookup[hid][dow];
      var timesRequired=sched?sched.required:0;
      var timesLogged=(logsLookup[hid]&&logsLookup[hid][isoDate])||0;
      var isFlexible=sched?sched.flexible:true;
      // Stamp the box so CSS can target required vs flexible directly
      box.dataset.required = (!isFlexible && timesRequired > 0) ? 'true' : 'false';
      completionState[hid][b.day]=timesLogged;

      // Theme-aware checkbox style
      applyCheckboxThemeStyle(box, isFlexible);

      if(timesRequired===0){box.style.opacity='0.2';box.style.cursor='default';}
      else {
        applyBoxVisual(box,timesLogged,timesRequired,b.week,isFlexible);
        box.addEventListener('click',(function(habitId,date,reqTimes,weekNum,habitIdx,dayNum,flex){
          return function(){
            if(habitId===-1)return;
            var current=completionState[String(habitId)][dayNum]||0;
            var maxTimes=extraCreditEnabled?reqTimes*2:reqTimes;
            var next=current>=maxTimes?0:current+1;
            completionState[String(habitId)][dayNum]=next;
            logsLookup[String(habitId)]=logsLookup[String(habitId)]||{};
            logsLookup[String(habitId)][date]=next;
            applyBoxVisual(box,next,reqTimes,weekNum,flex);
            updateProgressCell(String(habitId),habitIdx);
            saveLog(habitId,date,next);
          };
        })(h.id,isoDate,timesRequired,b.week,hi,b.day,isFlexible));
        box.addEventListener('contextmenu',(function(habitId,date,reqTimes,weekNum,habitIdx,dayNum){
          return function(e){
            e.preventDefault();
            _ctxTarget={box,habitId,date,reqTimes,weekNum,habitIdx,dayNum};
            var menu=window._ctxMenu; menu.style.display='block'; menu.style.top=e.clientY+'px'; menu.style.left=e.clientX+'px';
          };
        })(h.id,isoDate,timesRequired,b.week,hi,b.day));
      }
      cell.appendChild(box); row.appendChild(cell);
    });

    var progressCell=document.createElement('td'); progressCell.className='progress-cell'; progressCell.id='progress-cell-'+hi;
    row.appendChild(progressCell); table.appendChild(row); updateProgressCell(hid,hi);
  });
}

function applyCheckboxThemeStyle(box, isFlexible) {
  var theme=document.body.getAttribute('data-theme')||'vaporwave';
  // Applied as data attr so applyBoxVisual can read it
  box.dataset.isFlexible = isFlexible ? '1' : '0';
  box.dataset.theme = theme;
}

function applyBoxVisual(box, timesLogged, timesRequired, week, isFlexible) {
  var theme=document.body.getAttribute('data-theme')||'vaporwave';
  var baseColor=weekColors[week]||'#8C5FD9';
  var isGlowTheme=(theme==='vaporwave2'||theme==='tron');

  box.style.display='flex';
  box.style.alignItems='center';
  box.style.justifyContent='center';

  if(timesRequired===0){
    box.style.background='transparent';
    box.style.color='transparent';
    box.textContent='';
    box.style.border='1px solid '+hexToRgba(baseColor,0.2);
    box.style.boxShadow='none';
    box.style.fontSize='';
  } else if(timesLogged<=0){
    box.style.background='transparent';
    box.style.boxShadow=isGlowTheme?'0 0 7px '+hexToRgba(baseColor,0.8):'none';
    if(isFlexible){
      box.style.border='1.5px dashed '+baseColor;
      box.style.color=baseColor;
      box.style.fontSize='10px';
      box.style.fontWeight='700';
      box.textContent='?';
    } else {
      box.style.border='3px solid '+baseColor;
      box.style.color=baseColor;
      box.style.fontSize='9px';
      box.style.fontWeight='700';
      box.textContent='\u2715';
    }
  } else if(timesLogged>=timesRequired){
    box.style.background=baseColor;
    box.style.color=weekTextColors[week]||'#fff';
    box.textContent='\u2713';
    box.style.fontSize='11px';
    box.style.fontWeight='700';
    if(isFlexible){
      box.style.border='1.5px dashed '+baseColor;
      box.style.boxShadow='none';
    } else {
      box.style.border='3px solid '+baseColor;
      box.style.boxShadow=isGlowTheme?'0 0 10px '+hexToRgba(baseColor,0.9)+', 0 0 20px '+hexToRgba(baseColor,0.5):'none';
    }
  } else {
    var frac=timesLogged/timesRequired, opacity=0.15+frac*0.6;
    var rgb=hexToRgb(baseColor); var bg=rgb?'rgba('+rgb.r+','+rgb.g+','+rgb.b+','+opacity.toFixed(2)+')':baseColor;
    box.style.background=bg; box.style.border='2px solid '+baseColor; box.style.color=weekTextColors[week]||'#333';
    box.textContent=timesLogged+'/'+timesRequired; box.style.fontSize='8px'; box.style.display='flex';
    box.style.alignItems='center'; box.style.justifyContent='center'; box.style.lineHeight='1';
    box.style.boxShadow=isGlowTheme?'0 0 5px '+hexToRgba(baseColor,0.6):'none';
  }
  box.setAttribute('data-tip',timesLogged+' / '+timesRequired+' done');
}

var _ctxTarget=null;
(function(){
  var menu=document.createElement('div'); menu.id='ctx-menu';
  menu.style.cssText='position:fixed;display:none;background:var(--c-body-bg);border:2px solid var(--c-dark);border-radius:var(--radius-sm);z-index:9999;padding:4px 0;min-width:130px;box-shadow:3px 3px 0 var(--c-dark);';
  var item=document.createElement('div'); item.textContent='Remove tick';
  item.style.cssText='padding:7px 14px;font-size:12px;color:var(--c-text);cursor:pointer;';
  item.addEventListener('mouseenter',function(){item.style.background='var(--c-body-bg-alt)';});
  item.addEventListener('mouseleave',function(){item.style.background='';});
  item.addEventListener('click',function(){
    if(_ctxTarget){
      var t=_ctxTarget, cur=completionState[String(t.habitId)][t.dayNum]||0;
      if(cur>0){var next=cur-1; completionState[String(t.habitId)][t.dayNum]=next; logsLookup[String(t.habitId)]=logsLookup[String(t.habitId)]||{}; logsLookup[String(t.habitId)][t.date]=next; applyBoxVisual(t.box,next,t.reqTimes,t.weekNum,false); updateProgressCell(String(t.habitId),t.habitIdx); saveLog(t.habitId,t.date,next);}
    }
    menu.style.display='none'; _ctxTarget=null;
  });
  var cancel=document.createElement('div'); cancel.textContent='Cancel';
  cancel.style.cssText='padding:7px 14px;font-size:12px;color:var(--c-text-muted);cursor:pointer;';
  cancel.addEventListener('click',function(){menu.style.display='none';_ctxTarget=null;});
  menu.appendChild(item); menu.appendChild(cancel);
  document.addEventListener('DOMContentLoaded',function(){document.body.appendChild(menu);});
  document.addEventListener('click',function(){menu.style.display='none';_ctxTarget=null;});
  window._ctxMenu=menu;
})();

function updateProgressCell(hid, hi) {
  var cell=document.getElementById('progress-cell-'+hi); if(!cell)return;
  var h=habits[hi], totalDone=0, totalRequired=0;
  for(var d=1;d<=DAYS_IN_MONTH;d++){
    var dow=(firstDayMonBased+d-1)%7, sched=scheduleLookup[hid]&&scheduleLookup[hid][dow];
    if(sched&&sched.required>0){ totalRequired+=sched.required; var iso=currentYear+'-'+String(currentMonth).padStart(2,'0')+'-'+String(d).padStart(2,'0'); totalDone+=(logsLookup[hid]&&logsLookup[hid][iso])||0; }
  }
  if(totalRequired===0){ totalDone=Object.values(logsLookup[hid]||{}).reduce(function(a,b){return a+b;},0); totalRequired=DAYS_IN_MONTH; }
  var pct=Math.round((totalDone/totalRequired)*100);
  if(!extraCreditEnabled)pct=Math.min(pct,100);
  cell.innerHTML='<div style="display:flex;justify-content:flex-end;font-size:11px;margin-bottom:3px;"><span style="color:var(--c-text-muted);font-weight:600;">'+pct+'%</span></div><div class="progress-track"><div style="background:'+h.colorClass+';width:'+Math.min(pct,100)+'%;height:100%;"></div></div>';
}

// ============================================
// WEEKLY TASKS + PLANNED VS ACTUAL (FIXED)
// ============================================
function renderWeeklyDonut() {
  var td=0,tp=0;
  habits.forEach(function(h){ if(h.id===-1)return; var hid=String(h.id); for(var d=1;d<=DAYS_IN_MONTH;d++){var dow=(firstDayMonBased+d-1)%7,sched=scheduleLookup[hid]&&scheduleLookup[hid][dow]; if(sched&&sched.required>0){tp+=sched.required;var iso=currentYear+'-'+String(currentMonth).padStart(2,'0')+'-'+String(d).padStart(2,'0');td+=(logsLookup[hid]&&logsLookup[hid][iso])||0;}} });
  var pct=tp>0?Math.round((td/tp)*100):0,radius=26,circ=2*Math.PI*radius,offset=circ-(pct/100)*circ;
  var pink=getThemeColor('--c-pink'),track=lightenColor(pink,0.75),text=darkenColor(pink,0.35);
  var svg=document.getElementById('weekly-donut');
  svg.innerHTML='<circle cx="32" cy="32" r="'+radius+'" fill="none" stroke="'+track+'" stroke-width="8"></circle><circle cx="32" cy="32" r="'+radius+'" fill="none" stroke="'+pink+'" stroke-width="8" stroke-dasharray="'+circ+' '+circ+'" stroke-dashoffset="'+offset+'" transform="rotate(-90 32 32)" stroke-linecap="round"></circle><text x="32" y="37" text-anchor="middle" font-size="13" font-weight="600" fill="'+text+'">'+pct+'%</text>';
}

var weeklyTaskData=[{week:'Week 1',tasks:[]},{week:'Week 2',tasks:[]},{week:'Week 3',tasks:[]},{week:'Week 4',tasks:[]},{week:'Week 5',tasks:[]}];

// ============================================
// WEEKLY TASKS — SUPABASE BACKED
// ============================================
async function loadWeeklyTasks() {
  if(!currentUser) return;
  var { data: thisMonth } = await sb.from('weekly_tasks').select('*').eq('user_id',currentUser.id).eq('month',currentMonth).eq('year',currentYear);
  var prevMonth=currentMonth===1?12:currentMonth-1, prevYear=currentMonth===1?currentYear-1:currentYear;
  var { data: lastMonth } = await sb.from('weekly_tasks').select('*').eq('user_id',currentUser.id).eq('month',prevMonth).eq('year',prevYear).eq('is_pinned',true);
  weeklyTaskData=[{week:'Week 1',tasks:[]},{week:'Week 2',tasks:[]},{week:'Week 3',tasks:[]},{week:'Week 4',tasks:[]},{week:'Week 5',tasks:[]}];
  (lastMonth||[]).forEach(function(row){
    var w=row.week_number,i=row.task_index;
    if(w<0||w>4||i<0||i>9)return;
    weeklyTaskData[w].tasks[i]={t:row.task_text,c:false,pinned:true,id:null};
  });
  (thisMonth||[]).forEach(function(row){
    var w=row.week_number,i=row.task_index;
    if(w<0||w>4||i<0||i>9)return;
    weeklyTaskData[w].tasks[i]={t:row.task_text,c:row.is_checked,pinned:row.is_pinned,id:row.id};
  });
}

async function saveWeeklyTask(weekIdx,taskIdx,text,checked,pinned) {
  if(!currentUser)return;
  var payload={user_id:currentUser.id,week_number:weekIdx,task_index:taskIdx,task_text:text,is_checked:checked,is_pinned:pinned,month:currentMonth,year:currentYear};
  var {data,error}=await sb.from('weekly_tasks').upsert(payload,{onConflict:'user_id,week_number,task_index,month,year'}).select();
  if(!error&&data&&data[0]){
    if(!weeklyTaskData[weekIdx].tasks[taskIdx])weeklyTaskData[weekIdx].tasks[taskIdx]={t:'',c:false,pinned:false,id:null};
    weeklyTaskData[weekIdx].tasks[taskIdx].id=data[0].id;
  }
}

async function togglePin(weekIdx,taskIdx,pinBtn) {
  if(!weeklyTaskData[weekIdx].tasks[taskIdx])weeklyTaskData[weekIdx].tasks[taskIdx]={t:'',c:false,pinned:false,id:null};
  var task=weeklyTaskData[weekIdx].tasks[taskIdx];
  task.pinned=!task.pinned;
  pinBtn.style.opacity=task.pinned?'1':'0.25';
  pinBtn.style.filter=task.pinned?'drop-shadow(0 0 3px gold)':'none';
  pinBtn.title=task.pinned?'Pinned — carries over every month (click to unpin)':'Click to pin this task every month';
  await saveWeeklyTask(weekIdx,taskIdx,task.t||'',task.c||false,task.pinned);
}

function renderWeeklyTasks() {
  var el=document.getElementById('weekly-tasks'); el.innerHTML='';
  var numWeeks=getWeekCount();
  var theme=document.body.getAttribute('data-theme')||'vaporwave';
  var isVW2=(theme==='vaporwave2');
  var isTron=(theme==='tron');

  // Hardcoded colors matching debug file exactly
  var vw2Colors      =['#00F0FF','#FFFF00','#FF2E92','#CC88FF','#FFC857'];
  var vw2HeaderBgs   =['rgba(0,240,255,0.35)','rgba(255,255,0,0.30)','rgba(255,46,146,0.35)','rgba(153,51,255,0.35)','rgba(255,200,87,0.30)'];
  var vw2RowBgs      =['rgba(0,240,255,0.08)','rgba(255,255,0,0.06)','rgba(255,46,146,0.08)','rgba(153,51,255,0.08)','rgba(255,200,87,0.06)'];
  var tronColors     =['#00FFFF','#FF00FF','#FFFF00','#00FF88','#FF6600'];
  var tronHeaderBgs  =['rgba(0,255,255,0.20)','rgba(255,0,255,0.20)','rgba(255,255,0,0.20)','rgba(0,255,136,0.20)','rgba(255,102,0,0.20)'];
  var tronRowBgs     =['rgba(0,255,255,0.06)','rgba(255,0,255,0.06)','rgba(255,255,0,0.06)','rgba(0,255,136,0.06)','rgba(255,102,0,0.06)'];

  weeklyTaskData.slice(0,numWeeks).forEach(function(wd,w){
    var col=document.createElement('div'); col.className='week-col';
    var header=document.createElement('div'); header.className='week-col-header';

    if(isVW2){
      header.style.cssText='background:'+vw2HeaderBgs[w]+';color:'+vw2Colors[w]+';border-bottom:2px solid '+vw2Colors[w]+';text-align:center;padding:4px;font-size:11px;font-weight:700;';
    } else if(isTron){
      header.style.cssText='background:'+tronHeaderBgs[w]+';color:'+tronColors[w]+';border-bottom:2px solid '+tronColors[w]+';text-shadow:0 0 6px '+tronColors[w]+';text-align:center;padding:4px;font-size:11px;font-weight:700;';
    } else {
      header.style.background=weekColors[w]||'#ccc';
      header.style.color=weekTextColors[w]||'#fff';
    }
    header.textContent=wd.week; col.appendChild(header);

    for(var i=0;i<10;i++){
      var task=wd.tasks[i]||{t:'',c:false,pinned:false,id:null};
      var row=document.createElement('div'); row.className='task-row';

      if(isVW2){
        row.style.background=i%2===1?vw2RowBgs[w]:'transparent';
      } else if(isTron){
        row.style.background=i%2===1?tronRowBgs[w]:'#050510';
      } else {
        row.style.background=i%2===1?(weekFillColors[w]||'transparent'):'transparent';
      }

      var accentColor=isVW2?vw2Colors[w]:isTron?tronColors[w]:(weekColors[w]||'#ccc');
      var textColor=isVW2?'#F0E8FF':isTron?'#E0E0E0':'';

      var cb=document.createElement('input'); cb.type='checkbox'; cb.checked=task.c||false; cb.style.accentColor=accentColor;
      var inp=document.createElement('input'); inp.type='text'; inp.value=task.t||''; inp.placeholder='';
      inp.style.cssText='border:none;background:transparent;font-size:11px;width:100%;outline:none;color:'+textColor+';';
      if(task.c)inp.classList.add('task-done');

      var pinBtn=document.createElement('span');
      pinBtn.textContent='📌';
      pinBtn.style.cssText='font-size:11px;cursor:pointer;flex-shrink:0;transition:opacity 0.15s;';
      pinBtn.style.opacity=task.pinned?'1':'0.25';
      pinBtn.style.filter=task.pinned?'drop-shadow(0 0 3px gold)':'none';
      pinBtn.title=task.pinned?'Pinned — carries over every month':'Click to pin';

      (function(weekIdx,taskIdx,textEl,pin){
        var saveTimer=null;
        function debouncedSave(){
          clearTimeout(saveTimer);
          saveTimer=setTimeout(function(){
            if(!weeklyTaskData[weekIdx].tasks[taskIdx])weeklyTaskData[weekIdx].tasks[taskIdx]={t:'',c:false,pinned:false,id:null};
            var t=weeklyTaskData[weekIdx].tasks[taskIdx];
            saveWeeklyTask(weekIdx,taskIdx,t.t||'',t.c||false,t.pinned||false);
          },600);
        }
        cb.addEventListener('change',function(){
          textEl.classList.toggle('task-done',this.checked);
          if(!weeklyTaskData[weekIdx].tasks[taskIdx])weeklyTaskData[weekIdx].tasks[taskIdx]={t:'',c:false,pinned:false,id:null};
          weeklyTaskData[weekIdx].tasks[taskIdx].c=this.checked;
          saveWeeklyTask(weekIdx,taskIdx,weeklyTaskData[weekIdx].tasks[taskIdx].t||'',this.checked,weeklyTaskData[weekIdx].tasks[taskIdx].pinned||false);
          renderPlannedActualChart();
        });
        textEl.addEventListener('input',function(){
          if(!weeklyTaskData[weekIdx].tasks[taskIdx])weeklyTaskData[weekIdx].tasks[taskIdx]={t:'',c:false,pinned:false,id:null};
          weeklyTaskData[weekIdx].tasks[taskIdx].t=this.value;
          debouncedSave(); renderPlannedActualChart();
        });
        pin.addEventListener('click',function(){togglePin(weekIdx,taskIdx,pin);});
      })(w,i,inp,pinBtn);

      row.appendChild(cb); row.appendChild(inp); row.appendChild(pinBtn); col.appendChild(row);
    }
    el.appendChild(col);
  });
}
function renderPlannedActualChart() {
  var numWeeks=getWeekCount();
  var weekLabels=weeklyTaskData.slice(0,numWeeks).map(function(w){return w.week;});
  var planned=weeklyTaskData.slice(0,numWeeks).map(function(wd){return wd.tasks.filter(function(t){return t&&t.t&&t.t.trim()!=='';}).length;});
  var actual=weeklyTaskData.slice(0,numWeeks).map(function(wd){return wd.tasks.filter(function(t){return t&&t.c;}).length;});
  if(plannedActualChartInstance)plannedActualChartInstance.destroy();
  plannedActualChartInstance=new Chart(document.getElementById('plannedActualChart'),{type:'bar',data:{labels:weekLabels,datasets:[{label:'Planned',data:planned,backgroundColor:lightenColor(getThemeColor('--c-purple'),0.6),borderRadius:2},{label:'Actual',data:actual,backgroundColor:getThemeColor('--c-purple'),borderRadius:2}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{beginAtZero:true,max:10,ticks:{stepSize:2}}},plugins:{legend:{display:true,position:'top',labels:{boxWidth:10,font:{size:10}}}}}});
}

// ============================================
// ALL-TIME CHARTS
// ============================================
function renderAllTimeSection() {
  renderFullHeatmap(); renderActualVsIntended(); renderRadar(); renderStreaks(); renderBestMonth(); renderHabitAge();
}

var actualVsIntendedInstance=null;

function renderFullHeatmap() {
  var monthRow=document.getElementById('heatmap-month-row');
  var grid=document.getElementById('heatmap-grid');
  var tooltip=document.getElementById('heatmap-tooltip');
  if(!monthRow||!grid)return;
  monthRow.innerHTML=''; grid.innerHTML='';
  var dateMap={};
  RAW_HABITS.forEach(function(h){ var hid=String(h.id); Object.keys(allTimeLogs[hid]||{}).forEach(function(d){ dateMap[d]=(dateMap[d]||0)+(allTimeLogs[hid][d]||0); }); });
  var maxVal=Math.max(1,Math.max.apply(null,Object.values(dateMap).concat([0])));
  var year=currentYear;
  var jan1=new Date(year,0,1);
  var startDow=(jan1.getDay()+6)%7;
  var totalCols=53;
  var dayLabels=['M','','W','','F','',''];
  var mNames=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var pink=getThemeColor('--c-pink');
  var colTemplate='28px repeat('+totalCols+',1fr)';
  monthRow.style.cssText='display:grid;grid-template-columns:'+colTemplate+';gap:2px;margin-bottom:3px;';
  grid.style.cssText='display:grid;grid-template-columns:'+colTemplate+';gap:2px;';
  var spacer=document.createElement('div'); monthRow.appendChild(spacer);
  var lastMonth=-1;
  for(var w=0;w<totalCols;w++){
    var dn=(w*7)-startDow;
    var d=new Date(year,0,1+dn);
    var cell=document.createElement('div');
    cell.style.cssText='font-size:10px;color:var(--c-text-muted);white-space:nowrap;overflow:hidden;';
    if(d.getFullYear()===year){ var m=d.getMonth(); if(m!==lastMonth){cell.textContent=mNames[m];lastMonth=m;} }
    monthRow.appendChild(cell);
  }
  for(var dow=0;dow<7;dow++){
    var lbl=document.createElement('div');
    lbl.style.cssText='font-size:10px;color:var(--c-text-muted);text-align:right;padding-right:4px;line-height:1;display:flex;align-items:center;justify-content:flex-end;';
    lbl.textContent=dayLabels[dow]; grid.appendChild(lbl);
    for(var wk=0;wk<totalCols;wk++){
      var dn2=(wk*7+dow)-startDow;
      var dt=new Date(year,0,1+dn2);
      var cell2=document.createElement('div');
      cell2.style.cssText='width:100%;aspect-ratio:1;border-radius:2px;';
      if(dt.getFullYear()!==year){ cell2.style.background='transparent'; }
      else {
        var iso=dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0');
        var val=dateMap[iso]||0;
        var opacity=val===0?0.08:0.15+(val/maxVal)*0.85;
        cell2.style.background=pink; cell2.style.opacity=opacity.toFixed(2); cell2.style.cursor='default';
        var dateStr=dt.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'});
        (function(ds,v,tip){
          cell2.addEventListener('mouseenter',function(){ tip.innerHTML='<strong>'+ds+'</strong><br>'+(v>0?v+' habit'+(v!==1?'s':'')+' completed':'No activity logged'); tip.style.display='block'; });
          cell2.addEventListener('mousemove',function(e){ tip.style.left=(e.clientX+12)+'px'; tip.style.top=(e.clientY-40)+'px'; });
          cell2.addEventListener('mouseleave',function(){ tip.style.display='none'; });
        })(dateStr,val,tooltip);
      }
      grid.appendChild(cell2);
    }
  }
}

function renderActualVsIntended() {
  if(actualVsIntendedInstance)actualVsIntendedInstance.destroy();
  var el=document.getElementById('actualVsIntendedChart'); if(!el)return;
  var labels=[], actual=[], intended=[];
  var mShort=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  for(var d=1;d<=DAYS_IN_MONTH;d++){
    labels.push(d);
    var iso=currentYear+'-'+String(currentMonth).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    var dow=(firstDayMonBased+d-1)%7;
    var dayDone=0, dayRequired=0;
    RAW_HABITS.forEach(function(h){
      if(h.id===-1)return;
      var hid=String(h.id);
      var sched=scheduleLookup[hid]&&scheduleLookup[hid][dow];
      dayRequired+=(sched?sched.required:0);
      dayDone+=(logsLookup[hid]&&logsLookup[hid][iso])||0;
    });
    actual.push(dayDone); intended.push(dayRequired);
  }
  var pink=getThemeColor('--c-pink'), purple=getThemeColor('--c-purple');
  actualVsIntendedInstance=new Chart(el,{
    type:'line',
    data:{labels:labels,datasets:[
      {label:'Intended',data:intended,borderColor:hexToRgba(purple,0.4),backgroundColor:hexToRgba(purple,0.1),borderWidth:1.5,borderDash:[4,3],fill:true,tension:0,pointRadius:0,order:2},
      {label:'Actual',data:actual,borderColor:pink,backgroundColor:hexToRgba(pink,0.08),borderWidth:2,fill:false,tension:0.3,pointRadius:2,pointBackgroundColor:pink,order:1}
    ]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{
      title:function(ctx){return mShort[currentMonth-1]+' '+ctx[0].label+', '+currentYear;},
      label:function(ctx){return ctx.dataset.label+': '+ctx.raw+' habits';}
    }}},
    scales:{
      x:{ticks:{color:'#898781',font:{size:9},autoSkip:true,maxTicksLimit:16},grid:{color:'rgba(128,128,128,0.15)'},title:{display:true,text:'Day of month',color:'#898781',font:{size:10}}},
      y:{beginAtZero:true,ticks:{color:'#898781',font:{size:9},stepSize:1},grid:{color:'rgba(128,128,128,0.15)'},title:{display:true,text:'Habits',color:'#898781',font:{size:10}}}
    }}
  });
}

function renderRadar() {
  if(radarChartInstance)radarChartInstance.destroy();
  var catDone={}, catRequired={}, catAllDone={}, catAllRequired={};
  RAW_HABITS.forEach(function(h){
    var hid=String(h.id), cat=h.category||'General';
    if(!catDone[cat]){catDone[cat]=0;catRequired[cat]=0;catAllDone[cat]=0;catAllRequired[cat]=0;}
    // This month
    for(var d=1;d<=DAYS_IN_MONTH;d++){
      var iso=currentYear+'-'+String(currentMonth).padStart(2,'0')+'-'+String(d).padStart(2,'0');
      var dow=(firstDayMonBased+d-1)%7;
      var sched=scheduleLookup[hid]&&scheduleLookup[hid][dow];
      var req=sched?sched.required:0;
      catRequired[cat]+=req;
      catDone[cat]+=Math.min((logsLookup[hid]&&logsLookup[hid][iso])||0, req);
    }
    // All time
    Object.keys(allTimeLogs[hid]||{}).forEach(function(iso){
      var val=allTimeLogs[hid][iso]||0; if(val<=0)return;
      var dd=new Date(iso), dow2=(dd.getDay()+6)%7;
      var sched2=scheduleLookup[hid]&&scheduleLookup[hid][dow2];
      var req2=sched2?sched2.required:1;
      catAllRequired[cat]+=req2;
      catAllDone[cat]+=Math.min(val,req2);
    });
  });
  var cats=Object.keys(catDone); if(cats.length===0)return;
  var pink=getThemeColor('--c-pink'), purple=getThemeColor('--c-purple');
  radarChartInstance=new Chart(document.getElementById('radarChart'),{
    type:'radar',
    data:{labels:cats,datasets:[
      {label:'This month',data:cats.map(function(c){return catRequired[c]>0?Math.min(100,Math.round((catDone[c]/catRequired[c])*100)):0;}),backgroundColor:hexToRgba(pink,0.15),borderColor:pink,borderWidth:2,pointBackgroundColor:pink,pointRadius:3},
      {label:'All-time avg',data:cats.map(function(c){return catAllRequired[c]>0?Math.min(100,Math.round((catAllDone[c]/catAllRequired[c])*100)):0;}),backgroundColor:hexToRgba(purple,0.08),borderColor:purple,borderWidth:1.5,borderDash:[4,4],pointBackgroundColor:purple,pointRadius:2}
    ]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{r:{ticks:{display:false},pointLabels:{font:{size:10}},min:0,max:100}}}
  });
}

function getWeekDateRange(weekNum, year) {
  // Get the Monday of ISO week weekNum in given year
  var jan4 = new Date(year, 0, 4);
  var startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - (jan4.getDay() || 7) + 1);
  var weekStart = new Date(startOfWeek1);
  weekStart.setDate(startOfWeek1.getDate() + (weekNum - 1) * 7);
  var weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[weekStart.getMonth()] + ' ' + weekStart.getDate();
}

function getMonthFromISOWeek(weekNum) {
  var months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var approxMonth = Math.min(11, Math.floor((weekNum-1)/4.33));
  return months[approxMonth];
}

function getISOWeek(date) {
  var d = new Date(date);
  d.setHours(0,0,0,0);
  d.setDate(d.getDate()+4-(d.getDay()||7));
  var yearStart = new Date(d.getFullYear(),0,1);
  return Math.ceil((((d-yearStart)/86400000)+1)/7);
}

function render52WeekScatter() {
  if(allTimeScatterInstance)allTimeScatterInstance.destroy();
  // Aggregate all logs by ISO week number
  var weekMap={}; // weekNum -> {done, possible, habitsTracked set}
  RAW_HABITS.forEach(function(h){
    var hid=String(h.id);
    Object.keys(allTimeLogs[hid]||{}).forEach(function(iso){
      var val=allTimeLogs[hid][iso]; if(!val||val<=0)return;
      var wn=getISOWeek(new Date(iso));
      var yr=new Date(iso).getFullYear();
      if(!weekMap[wn])weekMap[wn]={done:0,possible:0,habits:{},year:yr};
      weekMap[wn].done+=val;
      weekMap[wn].possible++;
      weekMap[wn].habits[hid]=true;
    });
  });
  var weekData=[], weekLabels={};
  Object.keys(weekMap).forEach(function(wn){
    wn=parseInt(wn); if(wn<1||wn>52)return;
    var info=weekMap[wn];
    var pct=info.possible>0?Math.round((info.done/info.possible)*100):0;
    var habitsTracked=Object.keys(info.habits).length;
    var dateLabel=getWeekDateRange(wn, info.year||new Date().getFullYear());
    weekLabels[wn]={pct,habitsTracked,dateLabel};
    weekData.push({x:wn,y:pct,r:Math.max(4,Math.min(14,habitsTracked*3))});
  });
  var pink=getThemeColor('--c-pink');
  allTimeScatterInstance=new Chart(document.getElementById('allTimeScatterChart'),{
    type:'bubble',
    data:{datasets:[{label:'Completion rate',data:weekData,backgroundColor:hexToRgba(pink,0.55),borderColor:pink,borderWidth:1}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{
      legend:{display:false},
      tooltip:{callbacks:{
        label:function(ctx){
          var wn=ctx.raw.x, info=weekLabels[wn]||{};
          return['Week '+wn+' ('+( info.dateLabel||'')+')', 'Completion: '+(info.pct||0)+'%','Habits tracked: '+(info.habitsTracked||0)];
        }
      }}
    },
    scales:{
      x:{min:1,max:52,
        ticks:{stepSize:4,font:{size:9},callback:function(v){
          var months=['','Jan','','','Feb','','','Mar','','','Apr','','','May','','','Jun','','','Jul','','','Aug','','','Sep','','','Oct','','','Nov','','','Dec','','','',''];
          return months[v]?'Wk '+v+' '+months[v]:'Wk '+v;
        }},
        title:{display:true,text:'Week of year',font:{size:10}}},
      y:{min:0,max:110,ticks:{callback:function(v){return v+'%';},font:{size:9}},title:{display:true,text:'Completion rate',font:{size:10}}}
    }}
  });
}

function renderHeatmap() {
  var el=document.getElementById('heatmap-container'); if(!el)return; el.innerHTML='';
  var dateMap={};
  RAW_HABITS.forEach(function(h){ var hid=String(h.id); Object.keys(allTimeLogs[hid]||{}).forEach(function(d){ dateMap[d]=(dateMap[d]||0)+(allTimeLogs[hid][d]||0); }); });
  var maxVal=Math.max(1,Math.max.apply(null,Object.values(dateMap).concat([0])));
  for(var i=364;i>=0;i--){
    var d=new Date(); d.setDate(d.getDate()-i);
    var iso=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    var val=dateMap[iso]||0, opacity=val===0?0.08:0.15+(val/maxVal)*0.85;
    var cell=document.createElement('div');
    var pink=getThemeColor('--c-pink');
    cell.style.cssText='width:12px;height:12px;background:'+pink+';opacity:'+opacity.toFixed(2)+';cursor:default;border-radius:1px;';
    cell.title=iso+': '+val+' completed'; el.appendChild(cell);
  }
}

function renderRadar() {
  if(radarChartInstance)radarChartInstance.destroy();
  var catMap={},catAllTime={};
  // This month
  RAW_HABITS.forEach(function(h){ var hid=String(h.id),cat=h.category||'General'; if(!catMap[cat])catMap[cat]=0; for(var d=1;d<=DAYS_IN_MONTH;d++){var iso=currentYear+'-'+String(currentMonth).padStart(2,'0')+'-'+String(d).padStart(2,'0');catMap[cat]+=(logsLookup[hid]&&logsLookup[hid][iso])||0;} });
  // All time
  RAW_HABITS.forEach(function(h){ var hid=String(h.id),cat=h.category||'General'; if(!catAllTime[cat])catAllTime[cat]=0; Object.values(allTimeLogs[hid]||{}).forEach(function(v){catAllTime[cat]+=v;}); });
  var cats=Object.keys(Object.assign({},catMap,catAllTime));
  if(cats.length===0)return;
  var maxM=Math.max(1,Math.max.apply(null,Object.values(catMap).concat([0])));
  var maxA=Math.max(1,Math.max.apply(null,Object.values(catAllTime).concat([0])));
  var pink=getThemeColor('--c-pink'), purple=getThemeColor('--c-purple');
  radarChartInstance=new Chart(document.getElementById('radarChart'),{
    type:'radar',
    data:{labels:cats,datasets:[
      {label:'This month',data:cats.map(function(c){return Math.round(((catMap[c]||0)/maxM)*100);}),backgroundColor:hexToRgba(pink,0.15),borderColor:pink,borderWidth:2,pointBackgroundColor:pink,pointRadius:3},
      {label:'All-time avg',data:cats.map(function(c){return Math.round(((catAllTime[c]||0)/maxA)*100);}),backgroundColor:hexToRgba(purple,0.08),borderColor:purple,borderWidth:1.5,borderDash:[4,4],pointBackgroundColor:purple,pointRadius:2}
    ]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{r:{ticks:{display:false},pointLabels:{font:{size:10}},min:0,max:100}}}
  });
}

function renderStreaks() {
  var el=document.getElementById('streaks-container'); if(!el)return; el.innerHTML='';
  if(RAW_HABITS.length===0){el.innerHTML='<p class="cell-subtitle">No habits yet</p>';return;}
  var maxStreak=0;
  var habitStreaks=RAW_HABITS.map(function(h,hi){
    var hid=String(h.id), dates=Object.keys(allTimeLogs[hid]||{}).filter(function(d){return allTimeLogs[hid][d]>0;}).sort();
    var best=0,cur=0,prev=null;
    dates.forEach(function(d){if(prev&&(new Date(d)-new Date(prev))/86400000===1){cur++;}else{cur=1;}if(cur>best)best=cur;prev=d;});
    if(best>maxStreak)maxStreak=best;
    return{h,hi,best};
  });
  habitStreaks.forEach(function(item){
    var color=habits[item.hi]?habits[item.hi].colorClass:getThemeColor('--c-pink');
    var pct=maxStreak>0?Math.round((item.best/maxStreak)*100):0;
    var row=document.createElement('div');
    row.innerHTML='<div style="display:flex;justify-content:space-between;margin-bottom:3px;"><span style="font-size:11px;color:var(--c-text);">'+item.h.icon+' '+item.h.name+'</span><span style="font-size:11px;color:var(--c-text-muted);font-weight:600;">'+item.best+' days</span></div><div class="progress-track"><div style="background:'+color+';width:'+pct+'%;height:100%;"></div></div>';
    el.appendChild(row);
  });
}

function renderBestMonth() {
  var el=document.getElementById('best-month-container'); if(!el)return;
  var monthMap={};
  RAW_HABITS.forEach(function(h){ var hid=String(h.id); Object.keys(allTimeLogs[hid]||{}).forEach(function(d){ var ym=d.substring(0,7); monthMap[ym]=(monthMap[ym]||0)+(allTimeLogs[hid][d]||0); }); });
  var months=Object.keys(monthMap).sort();
  if(months.length===0){el.innerHTML='<p class="cell-subtitle">Not enough data yet</p>';return;}
  var best=months.reduce(function(a,b){return monthMap[a]>=monthMap[b]?a:b;});
  var parts=best.split('-');
  var mNames=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var label=mNames[parseInt(parts[1])-1]+' '+parts[0];
  el.innerHTML='<div style="display:flex;align-items:center;gap:10px;"><span style="font-size:28px;font-weight:700;color:var(--c-orange);">'+label+'</span><div><div style="font-size:14px;font-weight:700;color:var(--c-text);">'+monthMap[best]+' done</div><div style="font-size:10px;color:var(--c-text-muted);">personal best month</div></div></div>';
}

function renderHabitAge() {
  var el=document.getElementById('habit-age-container'); if(!el)return; el.innerHTML='';
  RAW_HABITS.forEach(function(h){
    var createdAt=h.created_at?new Date(h.created_at):null;
    var days=createdAt?Math.floor((Date.now()-createdAt)/86400000):'?';
    var row=document.createElement('div'); row.className='top-habit-row';
    row.innerHTML='<span>'+h.icon+' '+h.name+'</span><span class="top-habit-count">'+days+'d</span>';
    el.appendChild(row);
  });
}

// ============================================
// HISTORY PAGE
// ============================================
function toggleHistoryPage() {
  var page=document.getElementById('history-page');
  var isShowing=page.style.display==='block';
  page.style.display=isShowing?'none':'block';
  if(!isShowing)renderHistoryPage();
}
function renderHistoryPage() {
  var el=document.getElementById('history-content'), summary=document.getElementById('history-summary');
  el.innerHTML='';
  if(RAW_HABITS.length===0){el.innerHTML='<p class="cell-subtitle">No habits added yet.</p>';return;}
  if(summary)summary.textContent=RAW_HABITS.length+' habit'+(RAW_HABITS.length>1?'s':'')+' tracked';
  var mNames=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  RAW_HABITS.forEach(function(h,hi){
    var hid=String(h.id), logs=allTimeLogs[hid]||{};
    var createdAt=h.created_at?new Date(h.created_at):null;
    var createdStr=createdAt?createdAt.toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'}):'Unknown';
    var ageDays=createdAt?Math.floor((Date.now()-createdAt)/86400000):'?';
    var totalLogs=Object.values(logs).reduce(function(a,b){return a+b;},0);
    var dates=Object.keys(logs).filter(function(d){return logs[d]>0;}).sort();
    var best=0,cur=0,prev=null;
    dates.forEach(function(d){if(prev&&(new Date(d)-new Date(prev))/86400000===1){cur++;}else{cur=1;}if(cur>best)best=cur;prev=d;});
    var monthMap={};
    dates.forEach(function(d){var ym=d.substring(0,7);monthMap[ym]=(monthMap[ym]||0)+(logs[d]||0);});
    var monthKeys=Object.keys(monthMap).sort();
    var color=habits[hi]?habits[hi].colorClass:getThemeColor('--c-pink');
    var card=document.createElement('div'); card.className='cell-border'; card.style.marginBottom='12px';
    var titleBar=document.createElement('div'); titleBar.className='title-bar';
    titleBar.innerHTML='<span class="title-glyph" style="background:'+color+';"></span><span class="title-text">'+h.icon+' '+h.name+'</span><span style="font-size:10px;color:var(--c-text-muted);opacity:0.8;margin-left:auto;">'+h.category+'</span>';
    card.appendChild(titleBar);
    var body=document.createElement('div'); body.className='cell-body';
    var stats=document.createElement('div'); stats.style.cssText='display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px;';
    [[ageDays,'days old','--c-pink'],[totalLogs,'total done','--c-orange'],[best,'best streak','--c-purple'],[monthKeys.length,'active months','--c-text-muted']].forEach(function(item){
      var s=document.createElement('div');
      s.style.cssText='background:var(--c-body-bg-alt);padding:8px;border-radius:var(--radius-sm);text-align:center;border:1px solid var(--c-dark);';
      s.innerHTML='<div style="font-size:18px;font-weight:700;color:var('+item[2]+');">'+item[0]+'</div><div style="font-size:10px;color:var(--c-text-muted);">'+item[1]+'</div>';
      stats.appendChild(s);
    });
    body.appendChild(stats);
    if(monthKeys.length>0){
      var maxVal=Math.max.apply(null,Object.values(monthMap));
      var bl=document.createElement('p');bl.className='cell-subtitle';bl.textContent='Monthly completions';body.appendChild(bl);
      var bars=document.createElement('div');bars.style.cssText='display:flex;flex-direction:column;gap:4px;';
      monthKeys.forEach(function(ym){
        var parts=ym.split('-'),label=mNames[parseInt(parts[1])-1]+' '+parts[0],val=monthMap[ym],pct=Math.round((val/maxVal)*100);
        var r=document.createElement('div');r.style.cssText='display:grid;grid-template-columns:60px 1fr 30px;gap:6px;align-items:center;';
        r.innerHTML='<span style="font-size:11px;color:var(--c-text-muted);">'+label+'</span><div class="progress-track"><div style="background:'+color+';width:'+pct+'%;height:100%;"></div></div><span style="font-size:11px;color:var(--c-text-muted);text-align:right;">'+val+'</span>';
        bars.appendChild(r);
      });
      body.appendChild(bars);
    } else {
      var nd=document.createElement('p');nd.className='cell-subtitle';nd.textContent='No completions logged yet — created '+createdStr;body.appendChild(nd);
    }
    var cd=document.createElement('div');cd.style.cssText='margin-top:10px;font-size:11px;color:var(--c-text-muted);border-top:1px solid var(--c-body-bg-alt);padding-top:8px;';cd.textContent='Created '+createdStr;body.appendChild(cd);
    card.appendChild(body);el.appendChild(card);
  });
}

// ============================================
// EXPORT
// ============================================
function exportToCSV() {
  if(RAW_HABITS.length===0){alert('No habits to export.');return;}
  var rows=[['Habit','Icon','Category','Created','Total Completions','Best Streak','Days Old']];
  RAW_HABITS.forEach(function(h,hi){
    var hid=String(h.id), createdAt=h.created_at?new Date(h.created_at):null;
    var createdStr=createdAt?createdAt.toISOString().split('T')[0]:'';
    var ageDays=createdAt?Math.floor((Date.now()-createdAt)/86400000):'';
    var totalLogs=Object.values(allTimeLogs[hid]||{}).reduce(function(a,b){return a+b;},0);
    var dates=Object.keys(allTimeLogs[hid]||{}).filter(function(d){return allTimeLogs[hid][d]>0;}).sort();
    var best=0,cur=0,prev=null;
    dates.forEach(function(d){if(prev&&(new Date(d)-new Date(prev))/86400000===1){cur++;}else{cur=1;}if(cur>best)best=cur;prev=d;});
    rows.push([h.name,h.icon,h.category||'General',createdStr,totalLogs,best,ageDays]);
  });
  rows.push([]); rows.push(['--- Daily Log Data ---']); rows.push(['Habit','Date','Times Completed']);
  RAW_HABITS.forEach(function(h){ var hid=String(h.id); Object.keys(allTimeLogs[hid]||{}).sort().forEach(function(date){ var val=allTimeLogs[hid][date]; if(val>0)rows.push([h.name,date,val]); }); });
  var csv=rows.map(function(r){return r.map(function(c){return'"'+(String(c||'').replace(/"/g,'""'))+'"';}).join(',');}).join('\n');
  var blob=new Blob([csv],{type:'text/csv'}), a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download='emo-materialist-habits-'+new Date().toISOString().split('T')[0]+'.csv'; a.click();
}

// ============================================
// MASTER RENDER
// ============================================
function renderEverything() {
  buildWeekColors(); buildHabits();
  if(lineChartInstance)lineChartInstance.destroy();
  if(barChartInstance)barChartInstance.destroy();
  if(plannedActualChartInstance)plannedActualChartInstance.destroy();
  if(allTimeScatterInstance)allTimeScatterInstance.destroy();
  if(radarChartInstance)radarChartInstance.destroy();
  if(actualVsIntendedInstance)actualVsIntendedInstance.destroy();
  renderTopHabits(); renderDonuts(); renderCharts(); renderCorrelations(); renderGrid();
  renderWeeklyDonut(); renderWeeklyTasks(); renderPlannedActualChart(); renderAllTimeSection();
}

// ============================================
// INIT
// ============================================
(function(){
  var saved='vaporwave';
  try{saved=localStorage.getItem('habitTrackerTheme')||'vaporwave';}catch(e){}
  document.body.setAttribute('data-theme',saved);
  var sel=document.getElementById('theme-select'); if(sel)sel.value=saved;
})();
checkSession();
