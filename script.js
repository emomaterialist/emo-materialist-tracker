// ============================================
// SUPABASE SETUP
// ============================================
const SUPABASE_URL = 'https://tzdajmzulwabvrvrjqxc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_R-TDdmRXXc-m167WxjYemg_R4gvEp7f';
// Every request to Supabase gives up after 30 seconds and shows an error, instead of freezing forever.
// Loading requests (not saves) get one automatic second try, in case a phone connection was just slow.
function fetchWithTimeout(url, opts, isRetry) {
  var o = Object.assign({}, opts || {}), outer = o.signal;
  var ctrl = new AbortController(), timedOut = false;
  var timer = setTimeout(function () { timedOut = true; ctrl.abort(); }, 30000);
  if (outer) outer.addEventListener('abort', function () { ctrl.abort(); });
  o.signal = ctrl.signal;
  var method = String(o.method || 'GET').toUpperCase();
  return fetch(url, o).then(function (r) { clearTimeout(timer); return r; }, function (err) {
    clearTimeout(timer);
    if (timedOut && !isRetry && (method === 'GET' || method === 'HEAD')) return fetchWithTimeout(url, opts, true);
    if (timedOut) { var e = new Error('Supabase took too long to answer (no reply in 30 seconds). Check your internet connection and reload.'); e.name = 'TimeoutError'; throw e; }
    throw err;
  });
}
function isReachError(msg) { return /too long to answer|Abort|Failed to fetch|Load failed|NetworkError|network connection/i.test(String(msg || '')); }
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { global: { fetch: fetchWithTimeout } });

// ============================================
// ON-SCREEN ERROR BOX (phones don't show the browser console, so problems appear here instead)
// ============================================
function showAppError(msg) {
  msg = String(msg || 'Something went wrong');
  if (/kofiwidget|^Script error\.?$/i.test(msg)) return;   // the Ko-fi button's own harmless error
  var box = document.getElementById('app-error');
  if (!box) { box = document.createElement('div'); box.id = 'app-error'; box.className = 'app-error'; document.body.appendChild(box); }
  var row = document.createElement('div'); row.className = 'app-error-row';
  var t = document.createElement('span'); t.textContent = '⚠ ' + msg;
  var x = document.createElement('button'); x.type = 'button'; x.textContent = '✕'; x.title = 'Dismiss'; x.onclick = function () { row.remove(); };
  row.appendChild(t); row.appendChild(x); box.appendChild(row);
  while (box.children.length > 4) box.firstChild.remove();
}
window.addEventListener('error', function (e) { showAppError((e && e.message) + (e && e.lineno ? ' (script line ' + e.lineno + ')' : '')); });
window.addEventListener('unhandledrejection', function (e) { var r = e && e.reason; showAppError('Request failed: ' + ((r && r.message) || r)); });

// ============================================
// APP STATE
// ============================================
var currentUser = null;
var currentMonth = new Date().getMonth() + 1;
var currentYear = new Date().getFullYear();
var extraCreditEnabled = false;
var RAW_HABITS = [];      // active habits (dashboard, checklist, Today box)
var ARCHIVED_HABITS = [];  // archived habits (Archives tab); history kept
function allHabits() { return RAW_HABITS.concat(ARCHIVED_HABITS); }
var logsLookup = {};
var scheduleLookup = {};
var allTimeLogs = {};
var allTimeScatterInstance = null;
var DAYS_IN_MONTH = 30;
var firstDayMonBased = 0;
var lineChartInstance = null, barChartInstance = null, plannedActualChartInstance = null, catChartInstance = null;
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
async function handleForgotPassword() {
  var email = document.getElementById('login-email').value.trim();
  if (!email) {
    email = prompt('Enter your email address:');
    if (!email) return;
  }
  showMsg('login-msg','Sending reset email...','info');
  var { error } = await sb.auth.resetPasswordForEmail(email);
  if (error) return showMsg('login-msg','Error: ' + error.message,'error');
  showMsg('login-msg','✅ Check your email for the reset link!','success');
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
  await sb.auth.signOut({ scope: 'local' }); currentUser = null;   // 'local' = only this device; your other devices stay logged in
  document.getElementById('tracker-screen').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
  toggleSettings(false);
}
async function checkSession() {
  var { data } = await sb.auth.getSession();
  if (data.session) { currentUser = data.session.user; onLoggedIn(); }
}

var emojiArray = ['✅','💪','🏃','🧘','📖','💰','🛏️','🧴','🚴','🤸','⛹️','🏋️','🧗','🚶','🤾','⚽','🏀','🎾','🏐','🏈','🏸','🥋','🤺','🏹','🎣','🎯','📓','📔','📕','📗','📘','📙','📚','📒','📝','📋','❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💖','🌟','❤️‍🔥','❤️‍🩹','💔','❣️','💕','💞','💓','💗','💘','💝','🏄','🚣','🏊','🤽','🛹','🛼','🥌','⛷️','🏂','🪂','🏌️','🏎️','🏍️','🏉','🏏','🏑','🏒','🥍','🏓','🎳','🥊','🥅','⛳','⛸️','🎽','🏅','🥇','🥈','🥉','🏋️‍♂️','🏋️‍♀️','🏃‍♂️','🏃‍♀️','🚶‍♂️','🚶‍♀️','🧘‍♂️','🧘‍♀️','🚴‍♂️','🚴‍♀️','🚵‍♂️','🚵‍♀️','🤸‍♂️','🤸‍♀️','⛹️‍♂️','⛹️‍♀️','🤾‍♂️','🤾‍♀️','🧗‍♂️','🧗‍♀️','🏌️‍♂️','🏌️‍♀️','❌','🗓️','📅','📆','📊','📈','📉','📁','📂','📌','📍','📎','⏰','⏱️','⏲️','⏳','💵','💴','💶','💷','💳','💎','📥','📤','✉️','📩','📨','🛀','🧼','🪥','🧽','🪮','💤','🧉','🍵','☕','🥛','🥤','🧃','🍎','🥦','🥗','🥑','🥩','🥚','💧'];

function initEmojiPicker() {
  var grid = document.getElementById('emoji-grid');
  grid.innerHTML = '';
  
  emojiArray.forEach(function(emoji) {
    var btn = document.createElement('button');
    btn.textContent = emoji;
    btn.style.fontSize = '28px';
    btn.onclick = function() {
      if (window._editingHabitId) {
        // Edit mode
        var hiddenInput = document.getElementById('ei-'+window._editingHabitId);
        var btnDisplay = document.getElementById('ei-'+window._editingHabitId+'-btn');
        if (hiddenInput && btnDisplay) {
          hiddenInput.value = emoji;
          btnDisplay.textContent = emoji;
        }
        window._editingHabitId = null;
      } else {
        // Add mode
        var habitIconInput = document.getElementById('habit-icon');
        var addBtn = document.getElementById('emoji-picker-btn');
        if (habitIconInput && addBtn) {
          habitIconInput.value = emoji;
          addBtn.textContent = emoji + ' Choose Emoji';
        }
      }
      document.getElementById('emoji-picker-modal').style.display = 'none';
    };
    grid.appendChild(btn);
  });
}

function onLoggedIn() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('tracker-screen').style.display = 'block';
  document.getElementById('settings-email').textContent = currentUser.email;
  
  // Add-mode emoji button
  document.getElementById('emoji-picker-btn').onclick = function() {
    window._editingHabitId = null;
    emojiPickerHome();   // back under "Add a habit"
    initEmojiPicker();
    document.getElementById('emoji-picker-modal').style.display = 'block';
  };
  
  // Modal backdrop click
  document.getElementById('emoji-picker-modal').onclick = function(e) {
    if(e.target.id === 'emoji-picker-modal') 
      this.style.display = 'none';
  };
  
  // Load saved theme from Supabase user metadata, fallback to localStorage
  var savedTheme = (currentUser.user_metadata && currentUser.user_metadata.preferred_theme) || null;
  try { savedTheme = savedTheme || localStorage.getItem('habitTrackerTheme') || 'vaporwave'; } catch(e) { savedTheme = savedTheme || 'vaporwave'; }
  document.body.setAttribute('data-theme', savedTheme);
  var sel = document.getElementById('theme-select');
  if (sel) sel.value = savedTheme;
  
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
  loadAndRender().then(applySyncedPrefs);   // after the first draw, pull your toggles from your account
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
  var now = new Date(); currentMonth = now.getMonth()+1; currentYear = now.getFullYear();
  document.getElementById('month-select').value = currentMonth;
  document.getElementById('year-select').value = currentYear;
  updateMonthLabel(); loadAndRender();
}
function toggleExtraCredit(val) { extraCreditEnabled = val; try { localStorage.setItem('habitTrackerExtraCredit', val ? '1' : '0'); } catch (e) {} savePref({ extra_credit: val }); renderEverything(); }
try { extraCreditEnabled = localStorage.getItem('habitTrackerExtraCredit') === '1'; } catch (e) {}
(function () { var cb = document.getElementById('extra-credit-toggle'); if (cb) cb.checked = extraCreditEnabled; })();
function initMonthYearPickers() {
  document.getElementById('month-select').value = currentMonth;
  var yearSel = document.getElementById('year-select'); yearSel.innerHTML = '';
  var thisYear = new Date().getFullYear();
  for (var y=thisYear-5; y<=thisYear; y++) {
    var opt = document.createElement('option'); opt.value=y; opt.textContent=y; yearSel.appendChild(opt);
  }
  yearSel.value = currentYear;
}
// The emoji picker is one shared box. Editing a habit moves it under that habit; this puts it back under "Add a habit".
var EMOJI_HOME = null;
function emojiPickerHome() {
  var picker = document.getElementById('emoji-picker-modal'); if (!picker) return;
  if (!EMOJI_HOME) return;
  if (picker.parentNode !== EMOJI_HOME.parent) EMOJI_HOME.parent.insertBefore(picker, EMOJI_HOME.next);
}
(function () { var p = document.getElementById('emoji-picker-modal'); if (p) EMOJI_HOME = { parent: p.parentNode, next: p.nextSibling }; })();
function renderHabitList() {
  emojiPickerHome(); var _pk = document.getElementById('emoji-picker-modal'); if (_pk) _pk.style.display = 'none';   // keep the picker safe before the list is rebuilt
  var el=document.getElementById('habit-list'); el.innerHTML='';
  if(RAW_HABITS.length===0){el.innerHTML='<p style="font-size:11px;color:var(--c-text-muted);">No habits yet. Add one above!</p>';return;}
  var defaultCats=['General','Health','Fitness','Mindfulness','Learning','Productivity','Self-care','Finance','Social','Skincare'];
  var catMap={};
  defaultCats.forEach(function(c){catMap[c.toLowerCase()]=c;});
  RAW_HABITS.forEach(function(h){if(h.category)catMap[h.category.toLowerCase()]=h.category;});
  (customCategories||[]).forEach(function(c){catMap[c.toLowerCase()]=c;});
  var cats=Object.values(catMap).sort();

  RAW_HABITS.forEach(function(h){
    var wrapper=document.createElement('div');
    wrapper.style.cssText='border-bottom:1px solid var(--c-body-bg-alt);margin-bottom:2px;';
    var row=document.createElement('div'); row.className='habit-list-row';
    var nameSpan=document.createElement('span');
    nameSpan.style.cssText='flex:1;font-size:12px;color:var(--c-text);';
    nameSpan.textContent=h.icon+' '+h.name;
    if(h.category){var catTag=document.createElement('span');catTag.textContent=' '+h.category;catTag.style.cssText='font-size:9px;color:var(--c-text-muted);opacity:0.7;';nameSpan.appendChild(catTag);}
    var editBtn=document.createElement('button'); editBtn.className='habit-del-btn'; editBtn.textContent='✏️'; editBtn.title='Edit';
    var delBtn=document.createElement('button'); delBtn.className='habit-del-btn'; delBtn.textContent='📦'; delBtn.title='Archive (hide from the dashboard, keep its history)';
    delBtn.onclick=function(){archiveHabit(h.id);};
    row.appendChild(nameSpan); row.appendChild(editBtn); row.appendChild(delBtn);
    wrapper.appendChild(row);
    var form=document.createElement('div');
    form.style.cssText='display:none;padding:8px 4px 10px;background:var(--c-body-bg-alt);border-radius:var(--radius-sm);margin-top:2px;';
    var currentCatLower=(h.category||'').toLowerCase();
    var catOptions=cats.map(function(c){return '<option value="'+c+'"'+(c.toLowerCase()===currentCatLower?' selected':'')+'>'+c+'</option>';}).join('');
    catOptions+='<option value="__custom__">+ Add new category…</option>';
    form.innerHTML=[
      '<div style="display:grid;grid-template-columns:40px 1fr;gap:6px;margin-bottom:6px;">',
        '<button id="ei-'+h.id+'-btn" type="button" style="font-size:14px;text-align:center;background:var(--c-body-bg);border:1px solid var(--c-dark);color:var(--c-text);padding:4px;width:100%;box-sizing:border-box;cursor:pointer;">'+h.icon+'</button>',
        '<input id="ei-'+h.id+'" type="hidden" value="'+h.icon+'">',
        '<input id="en-'+h.id+'" type="text" value="'+h.name+'" style="font-size:12px;background:var(--c-body-bg);border:1px solid var(--c-dark);color:var(--c-text);padding:4px;width:100%;box-sizing:border-box;">',
      '</div>',
      '<select id="ec-'+h.id+'" style="width:100%;font-size:11px;background:var(--c-body-bg);border:1px solid var(--c-dark);color:var(--c-text);padding:4px;margin-bottom:6px;">'+catOptions+'</select>',
      '<input id="ecc-'+h.id+'" type="text" placeholder="New category name..." style="display:none;width:100%;font-size:11px;background:var(--c-body-bg);border:1px solid var(--c-dark);color:var(--c-text);padding:4px;margin-bottom:6px;box-sizing:border-box;">',
      '<div class="se-mini"><span>📅 '+moneyEsc(schedDescribe(schedCurrent(h)))+'</span><button type="button" class="sleep-q-btn se-mini-btn" onclick="openScheduleEditor('+h.id+')">Edit schedule</button></div>',
      '<div style="display:flex;gap:6px;">',
        '<button id="es-'+h.id+'" style="flex:1;padding:5px;font-size:11px;background:var(--c-pink);color:var(--c-dark);border:none;cursor:pointer;font-weight:700;">Save</button>',
        '<button id="esc-'+h.id+'" style="padding:5px 10px;font-size:11px;background:transparent;color:var(--c-text-muted);border:1px solid var(--c-dark);cursor:pointer;">Cancel</button>',
      '</div>',
      '<div id="em-'+h.id+'" style="font-size:10px;margin-top:4px;"></div>'
    ].join('');
    wrapper.appendChild(form); el.appendChild(wrapper);
    
    // Wire up emoji button for edit mode
    var emojiBtn = form.querySelector('#ei-'+h.id+'-btn');
    emojiBtn.onclick = function() {
      window._editingHabitId = h.id;
      var picker = document.getElementById('emoji-picker-modal');
      emojiBtn.parentNode.insertAdjacentElement('afterend', picker);   // open right under this habit's emoji button
      initEmojiPicker();
      picker.style.display = 'block';
    };
    
    editBtn.onclick=function(){var o=form.style.display==='block';form.style.display=o?'none':'block';editBtn.textContent=o?'✏️':'✕';};
    form.querySelector('#ec-'+h.id).addEventListener('change',function(){
      form.querySelector('#ecc-'+h.id).style.display=this.value==='__custom__'?'block':'none';
    });
    
    form.querySelector('#es-'+h.id).onclick=async function(){
      var newIcon=form.querySelector('#ei-'+h.id).value.trim()||h.icon;
      var newName=form.querySelector('#en-'+h.id).value.trim();
      var selCat=form.querySelector('#ec-'+h.id).value;
      var customVal=form.querySelector('#ecc-'+h.id).value.trim();
      var rawCat=selCat==='__custom__'?customVal:selCat;
      if(!rawCat)rawCat=h.category||'General';
      var newCat=rawCat.charAt(0).toUpperCase()+rawCat.slice(1);
      var msgEl=form.querySelector('#em-'+h.id);
      if(!newName){msgEl.style.color='red';msgEl.textContent='Name required';return;}
      msgEl.style.color='var(--c-text-muted)';msgEl.textContent='Saving...';
      var {error}=await sb.from('habits').update({name:newName,icon:newIcon,category:newCat}).eq('id',h.id);
      if(error){msgEl.style.color='red';msgEl.textContent='Error: '+error.message;return;}
      if(!customCategories)customCategories=[];
      if(!customCategories.map(function(c){return c.toLowerCase();}).includes(newCat.toLowerCase())){customCategories.push(newCat);buildCatPills();}
      msgEl.style.color='green';msgEl.textContent='✅ Saved!';
      setTimeout(function(){form.style.display='none';editBtn.textContent='✏️';loadHabits().then(renderEverything);},600);
    };
    form.querySelector('#esc-'+h.id).onclick=function(){form.style.display='none';editBtn.textContent='✏️';};
  });
}

function refreshCharts() {
  if (lineChartInstance) lineChartInstance.destroy();
  if (barChartInstance) barChartInstance.destroy();
  if (plannedActualChartInstance) plannedActualChartInstance.destroy();
  buildWeekColors(); buildHabits();
  renderTopHabits(); renderDonuts(); renderCharts(); renderMonthProgress();
  renderToday();
  renderXpStats();
  renderActualVsIntended();   // keep "Actual vs intended" in step with every tick (it wasn't redrawn before)
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

function handleFreqType(val) {
  document.getElementById('freq-days-section').style.display=val==='days'?'block':'none';
  document.getElementById('freq-monthly-section').style.display=val==='monthly'?'block':'none';
  document.getElementById('freq-interval-section').style.display=val==='interval'?'block':'none';
  if(val==='interval') populateStartDateDropdowns();
}

function populateStartDateDropdowns() {
  var dayEl=document.getElementById('habit-start-day'); if(!dayEl)return;
  if(dayEl.options.length===0){
    for(var d=1;d<=31;d++){ var o=document.createElement('option'); o.value=d; o.textContent=d; dayEl.appendChild(o); }
  }
  var yearEl=document.getElementById('habit-start-year'); if(!yearEl)return;
  if(yearEl.options.length===0){
    var y=new Date().getFullYear();
    for(var yr=y-2;yr<=y+1;yr++){ var o=document.createElement('option'); o.value=yr; o.textContent=yr; yearEl.appendChild(o); }
  }
  var now=new Date();
  document.getElementById('habit-start-month').value=now.getMonth()+1;
  document.getElementById('habit-start-day').value=now.getDate();
  document.getElementById('habit-start-year').value=now.getFullYear();
}

async function submitAddHabit() {
  var name = document.getElementById('habit-name').value.trim();
  var icon = document.getElementById('habit-icon').value.trim() || '✅';
  var category = document.getElementById('habit-category-select').value || 'General';
  if (category==='__custom__') category='General';
  var timesPerDay = parseInt(document.getElementById('habit-times-per-day').value)||1;
  var freqType = document.getElementById('habit-freq-type').value;
  if (!name) return showMsg('add-habit-msg','Please enter a habit name.','error');

  showMsg('add-habit-msg','Saving habit...','info');
  var { data, error } = await sb.from('habits').insert({ user_id:currentUser.id, name, icon, category, color:'auto' }).select();
  if (error) return showMsg('add-habit-msg','❌ habits insert error: '+error.message,'error');
  var habitId = data[0].id;
  var schedRows = [];

  if(freqType==='days'){
    var fixedDays=[], flexDays=[];
    var flexNeeded = parseInt(document.getElementById('habit-flex-needed').value)||0;
    document.querySelectorAll('#fixed-days-row .day-toggle.selected').forEach(function(btn){fixedDays.push(parseInt(btn.dataset.index));});
    document.querySelectorAll('#flex-days-row .day-toggle.selected').forEach(function(btn){flexDays.push(parseInt(btn.dataset.index));});
    if(fixedDays.length===0&&flexDays.length===0) return showMsg('add-habit-msg','Select at least one day.','error');
    if(flexDays.length>0&&flexNeeded===0) return showMsg('add-habit-msg','Set how many flexible days are needed per week.','error');
    fixedDays.forEach(function(dow){ schedRows.push({habit_id:habitId,day_of_week:dow,times_required:timesPerDay,is_flexible:false}); });
    flexDays.forEach(function(dow){ schedRows.push({habit_id:habitId,day_of_week:dow,times_required:timesPerDay,is_flexible:true}); });

  } else if(freqType==='monthly'){
    var timesMonth = parseInt(document.getElementById('habit-times-month').value)||4;
    var { error: uErr } = await sb.from('habits').update({freq_type:'monthly',freq_value:timesMonth}).eq('id',habitId);
    if(uErr) return showMsg('add-habit-msg','❌ freq update error: '+uErr.message,'error');

  } else if(freqType==='interval'){
    var intervalDays = parseInt(document.getElementById('habit-interval-days').value)||2;
    var sm=document.getElementById('habit-start-month').value;
    var sd=document.getElementById('habit-start-day').value;
    var sy=document.getElementById('habit-start-year').value;
    var startDate=sy+'-'+String(sm).padStart(2,'0')+'-'+String(sd).padStart(2,'0');
    var { error: uErr } = await sb.from('habits').update({freq_type:'interval',freq_value:intervalDays,start_date:startDate}).eq('id',habitId);
    if(uErr) return showMsg('add-habit-msg','❌ freq update error: '+uErr.message,'error');
  }

  if (schedRows.length>0) {
    var { error: sErr } = await sb.from('habit_schedule').insert(schedRows);
    if (sErr) return showMsg('add-habit-msg','❌ schedule insert error: '+sErr.message,'error');
  }

  document.getElementById('habit-name').value='';
  document.getElementById('habit-times-per-day').value='1';
  document.getElementById('habit-flex-needed').value='0';
  document.getElementById('habit-times-month').value='4';
  document.getElementById('habit-interval-days').value='2';
  document.getElementById('habit-freq-type').value='days';
  handleFreqType('days');
  document.querySelectorAll('.day-toggle.selected').forEach(function(b){b.classList.remove('selected');});
  setTimeout(function(){ showMsg('add-habit-msg','✅ Added: '+icon+' '+name,'success'); }, 600);
  await loadHabits(); renderEverything();
}
async function archiveHabit(habitId) {
  var h=RAW_HABITS.filter(function(x){return x.id===habitId;})[0];
  if(h && !confirm('Archive "'+h.name+'"?\n\nIt leaves your checklist and Today box, but its history stays. You can still log it from the Archives tab and restore it any time.')) return;
  var r=await sb.from('habits').update({archived:true}).eq('id',habitId);
  if(r&&r.error){alert('Could not archive: '+r.error.message);return;}
  await loadHabits(); renderEverything(); if(typeof ehRender==='function')ehRender();
}
async function restoreHabit(habitId) {
  var r=await sb.from('habits').update({archived:false}).eq('id',habitId);
  if(r&&r.error){alert('Could not restore: '+r.error.message);return;}
  await loadHabits(); renderEverything(); if(typeof ehRender==='function')ehRender();
}
// Permanently removes an archived habit: its logs, its schedule, then the habit itself.
// skipConfirm is used by "Delete all never-logged" (which asks once for the whole batch).
async function deleteHabitForever(habitId, skipConfirm) {
  var h=ARCHIVED_HABITS.filter(function(x){return x.id===habitId;})[0]; if(!h)return false;
  if(!skipConfirm && !confirm('Delete "'+h.name+'" forever?\n\nThis erases the habit AND every day you ever logged it. This cannot be undone.'))return false;
  var steps=[['habit_logs','habit_id'],['habit_schedule','habit_id'],['habits','id']];
  for(var i=0;i<steps.length;i++){
    var r=await sb.from(steps[i][0]).delete().eq(steps[i][1],habitId);
    if(r&&r.error){alert('Could not delete "'+h.name+'" ('+steps[i][0]+'): '+r.error.message);return false;}
  }
  delete allTimeLogs[String(habitId)]; delete logsLookup[String(habitId)];
  if(!skipConfirm){ if(ehSel===habitId)ehSel=null; await loadHabits(); renderEverything(); if(typeof ehRender==='function')ehRender(); }
  return true;
}
// Archives tab: one button to clear out every archived habit that was never logged (old test habits).
async function deleteNeverLoggedArchived() {
  var list=ARCHIVED_HABITS.filter(function(h){var l=allTimeLogs[String(h.id)]||{};return !Object.keys(l).some(function(k){return l[k]>0;});});
  if(!list.length){alert('Every archived habit has at least one log, so nothing to clear.');return;}
  if(!confirm('Delete these '+list.length+' archived habits forever? None of them were ever logged.\n\n'+list.map(function(h){return '• '+h.name;}).join('\n')+'\n\nThis cannot be undone.'))return;
  var gone=0;
  for(var i=0;i<list.length;i++){ if(await deleteHabitForever(list[i].id,true))gone++; else break; }
  ehSel=null; await loadHabits(); renderEverything(); ehRender();
  victory('pop','Cleared '+gone+' 🧹');
}
// Settings > Archives: every archived habit with Restore and Delete forever.
function renderArchiveList() {
  var el=document.getElementById('archive-list'); if(!el)return;
  if(!ARCHIVED_HABITS.length){el.innerHTML='<p class="settings-value" style="opacity:0.7;">Nothing archived. Use 📦 next to a habit above to archive it.</p>';return;}
  el.innerHTML=ARCHIVED_HABITS.map(function(h){
    return '<div class="habit-list-row archive-row"><span style="flex:1;font-size:12px;">'+(h.icon||'✅')+' '+moneyEsc(h.name)+(h.category?' <span style="font-size:9px;opacity:0.7;">'+moneyEsc(h.category)+'</span>':'')+'</span>'+
      '<button class="habit-del-btn" title="Restore to your dashboard" onclick="restoreHabit('+h.id+')">↩ Restore</button>'+
      '<button class="habit-del-btn" title="Delete forever (erases its history)" onclick="deleteHabitForever('+h.id+')">🗑</button></div>';
  }).join('');
}

// ============================================
// DATA LOADING
// ============================================
async function loadHabits() {
  var { data, error } = await sb.from('habits').select('*, habit_schedule(*)').eq('user_id',currentUser.id);
  if (error) { showAppError('Could not load your habits: ' + error.message); return; }
  await fixIntervalStartDates(data||[]);
  await loadScheduleVersions();
  RAW_HABITS = (data||[]).filter(function(h){return !h.archived;});
  ARCHIVED_HABITS = (data||[]).filter(function(h){return !!h.archived;});
  buildScheduleLookup(); renderHabitList(); renderArchiveList();
}
async function loadLogs() {
  var start = currentYear+'-'+String(currentMonth).padStart(2,'0')+'-01';
  var lastDay = new Date(currentYear,currentMonth,0).getDate();
  var end = currentYear+'-'+String(currentMonth).padStart(2,'0')+'-'+String(lastDay).padStart(2,'0');
  var habitIds = allHabits().map(function(h){return h.id;});   // archived habits too, so their logs show as bonus
  if (habitIds.length===0) { logsLookup={}; return; }
  var { data } = await sb.from('habit_logs').select('habit_id,log_date,times_completed').in('habit_id',habitIds).gte('log_date',start).lte('log_date',end);
  logsLookup={};
  (data||[]).forEach(function(log){ var hid=String(log.habit_id); if(!logsLookup[hid])logsLookup[hid]={}; logsLookup[hid][log.log_date]=log.times_completed; });
}
async function loadAllTimeLogs() {
  var habitIds = allHabits().map(function(h){return h.id;});
  if (habitIds.length===0) { allTimeLogs={}; return; }
  var { data } = await sb.from('habit_logs').select('habit_id,log_date,times_completed').in('habit_id',habitIds).order('log_date',{ascending:true});
  allTimeLogs={};
  (data||[]).forEach(function(log){ var hid=String(log.habit_id); if(!allTimeLogs[hid])allTimeLogs[hid]={}; allTimeLogs[hid][log.log_date]=log.times_completed; });
}
async function saveLog(habitId, logDate, timesCompleted) {
  var hid=String(habitId); if(!allTimeLogs[hid])allTimeLogs[hid]={};
  var before=allTimeLogs[hid][logDate]||0;   // what it was before this click (for the victory animation)
  if(!logsLookup[hid])logsLookup[hid]={}; logsLookup[hid][logDate]=timesCompleted;
  allTimeLogs[hid][logDate]=timesCompleted;
  vicHabit(habitId, logDate, before, timesCompleted);
  await sb.from('habit_logs').upsert({habit_id:habitId,log_date:logDate,times_completed:timesCompleted},{onConflict:'habit_id,log_date'});
  refreshCharts();
}
function buildScheduleLookup() {
  scheduleLookup={};
  allHabits().forEach(function(h){
    var hid=String(h.id);
    scheduleLookup[hid]={};
    (h.habit_schedule||[]).forEach(function(s){
      var isFlexible = s.is_flexible === true || s.is_flexible === 'true';
      scheduleLookup[hid][s.day_of_week]={required:s.times_required, flexible:isFlexible};
    });
  });
}
async function loadAndRender() {
  // Each step is protected: if one fails, the error shows on screen and the rest still loads.
  var steps = [['your settings', loadUserSettings], ['your habits', loadHabits], ['this month\'s check-ins', loadLogs], ['your history', loadAllTimeLogs], ['weekly tasks', loadWeeklyTasks], ['task XP', loadTaskXpOtherMonths]];
  for (var i = 0; i < steps.length; i++) {
    try { await steps[i][1](); } catch (e) { showAppError('Could not load ' + steps[i][0] + ': ' + ((e && e.message) || e)); }
  }
  DAYS_IN_MONTH = new Date(currentYear,currentMonth,0).getDate();
  firstDayMonBased = (new Date(currentYear,currentMonth-1,1).getDay()+6)%7;
  renderEverything();
}

// ============================================
// COLOR HELPERS
// ============================================
function getThemeColor(varName) { return getComputedStyle(document.body).getPropertyValue(varName).trim(); }
function getCheckboxSymbol(symbolType) { var varName='--checkbox-'+symbolType; var value=getComputedStyle(document.body).getPropertyValue(varName).trim(); return value.replace(/['"]/g,''); }
var HABIT_COLOR_CONFIG = {
  vaporwave:  { mode:'hsl-band', baseHue:0, hueRange:360, sat:80, light:62 },
  vaporwave2: { mode:'hsl-band', baseHue:180, hueRange:160, sat:85, light:55 },
  basic:      { mode:'hsl-band', baseHue:200, hueRange:80, sat:55, light:50 },
  classic:    { mode:'curated', palette:['#7A2E3A','#B08D8D','#C9A876','#5C3A3F','#E8D9C3','#946B6B','#D8C49A','#4A2B30','#BFA0A0','#F0E2C8','#8C5A5F','#A88B5F'] },
  retro95:    { mode:'curated', palette:['#FFFFFF','#FF6600','#FF2E92','#9933FF','#39FF14','#00F0FF','#FFB347','#FF0055','#FFFF00','#AA00FF','#00FF88','#FF9900'] },
  gothic:     { mode:'curated', palette:['#8B0000','#1A4A1A','#1A1A5C','#4A0E5C','#5C3A00','#005C5C','#2A2A2A','#FF6B6B','#DC143C','#5C0000','#FF9999','#FFB3B3'] },
  tron:       { mode:'curated', palette:['#00FFFF','#FF00FF','#FFFF00','#00FF88','#FF6600','#AA00FF','#FF0055','#00CCFF','#FF99FF','#99FF00','#FF9900','#00FFCC'] },
  superpink:  { mode:'curated', palette:['#FFB3C6','#FF85A1','#FF5C8A','#E8407A','#C2446E','#FF9EBA','#FFD6E5','#FF6E96','#FFE0EB','#FF3399','#FFAAC8','#D96080'] },
  'light-pastel': { mode:'curated', palette:['#ffd0ef','#f0d0ff','#ede5eb','#a08ba0','#6b4c6b','#ffc8e8','#e8d0f5','#f5c8f0','#e8b8e8','#d4a8d8','#f0c8f0','#ede8f0'] },
  'light-melon':  { mode:'curated', palette:['#f6e48e','#f8c391','#f67481','#f5ebd5','#b39977','#ffeb99','#f0d77d','#e6c999','#ffc896','#f0b88f','#f8d4a8','#ffb38f'] },
  'experimental': { mode:'curated', palette:['#f6e48e','#f8c391','#f67481','#f5ebd5','#b39977','#ffeb99','#f0d77d','#e6c999','#ffc896','#f0b88f','#f8d4a8','#ffb38f'] },
  'v4p3':     { mode:'curated', palette:['#FF00FF','#00FFFF','#FFFF00','#FF6600','#9933FF','#00FF88','#FF0055','#00CCFF','#FF99FF','#99FF00','#FF9900','#FF1493'] },
  'debug':    { mode:'curated', palette:['#A86B87','#A89860','#7A95A8','#8A9B60','#7FA8A8','#6BA876','#8B6BA8','#A87A5A','#99A876','#6BA895','#7AA0B8','#7589B8'] },
  'dark-romantic': { mode:'curated', palette:['#D1436B','#1B5E5E','#2D5A2D','#1A4A6F','#5B2E5F','#8B5A3C','#D1946B','#A8A8B8','#E8D9D9','#C9A876','#B08D8D','#946B6B'] },
  'coquette':     { mode:'curated', palette:['#E8A0B4','#C26A85','#D9B48F','#B79CC8','#9FC2A8','#F2B5C4','#A85A72','#E6C9A8','#CFA59B','#D98BA3','#8FA9C7','#F4C9A8'] },
  'pixel-pink':   { mode:'curated', palette:['#FF3D8B','#9B2FAE','#00B8A9','#FFC93C','#FF7A5C','#3D0A24','#F15BB5','#6A4CFF','#FF9EC7','#00897B','#C77DFF','#E8A400'] },
  'pixel-arcade': { mode:'curated', palette:['#FFD93D','#3EC1D3','#FF6B6B','#6BCB77','#B388FF','#FF9F45','#4D96FF','#F15BB5','#00F5D4','#FEE440','#FF5D8F','#9BF6FF'] },
  'pastel-goth':  { mode:'curated', palette:['#FF8CCF','#C3A6FF','#8FE3CF','#FFB3E0','#9AC8FF','#E05FA8','#A07CE8','#F6D6E8','#FF6FB5','#7FD6C2','#D9B8FF','#FFC4E6'] },
  'sage-linen':   { mode:'curated', palette:['#7D8F6E','#B9A36B','#A3B18A','#8FA39A','#C7B08A','#5E7254','#D4C39A','#6E8B84','#B5BFA0','#9C8455','#C9D3B8','#7A6A4F'] },
  'goth-noir':    { mode:'curated', palette:['#F2F2F2','#A6A6A6','#D0D0D0','#7A7A7A','#E3E3E3','#8E8E8E','#BBBBBB','#666666','#FFFFFF','#959595','#C8C8C8','#727272'] },
  'office':       { mode:'curated', palette:['#2B6CB0','#0F9D9A','#2E9E5B','#5BA4E6','#6CC3A6','#1E4E8C','#3BB8C4','#7BB662','#8FB8E8','#0B7A75','#A8D5BA','#4A7FB5'] },
  'sage-lilac':   { mode:'curated', palette:['#9C86C4','#6E9160','#B9A2DC','#A7BE9A','#7656A6','#CBDCBF','#D4C6EC','#94AE88','#5A4182','#B8CDAA','#C7B3E3','#7F9A74'] }
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
  var computedStyle = getComputedStyle(document.body);
  weekColors = [
    computedStyle.getPropertyValue('--week-1-bg').trim(),
    computedStyle.getPropertyValue('--week-2-bg').trim(),
    computedStyle.getPropertyValue('--week-3-bg').trim(),
    computedStyle.getPropertyValue('--week-4-bg').trim(),
    computedStyle.getPropertyValue('--week-5-bg').trim()
  ];
  weekTextColors = [
    computedStyle.getPropertyValue('--week-1-text').trim(),
    computedStyle.getPropertyValue('--week-2-text').trim(),
    computedStyle.getPropertyValue('--week-3-text').trim(),
    computedStyle.getPropertyValue('--week-4-text').trim(),
    computedStyle.getPropertyValue('--week-5-text').trim()
  ];
  weekFillColors = weekColors.map(function(c){ return lightenColor(c, 0.6); });
}

function debugWeekColors() {
  var theme = document.body.getAttribute('data-theme') || 'vaporwave';
  var computedStyle = getComputedStyle(document.body);
  console.log('=== DEBUG WEEK COLORS ===');
  console.log('Current Theme:', theme);
  console.log('');
  console.log('CSS Variables:');
  for(var i=1; i<=5; i++){
    var varName = '--week-'+i+'-color';
    var value = computedStyle.getPropertyValue(varName).trim();
    console.log(varName + ':', value || 'NOT FOUND');
  }
  console.log('');
  console.log('Donut Text Colors (SVG):');
  document.querySelectorAll('.donut-row svg text').forEach(function(el, i){
    var fill = el.getAttribute('fill');
    console.log('Week ' + (i+1) + ' fill:', fill);
  });
  console.log('');
  console.log('Donut Labels (Wk X):');
  document.querySelectorAll('.donut-row p').forEach(function(el, i){
    var color = window.getComputedStyle(el).color;
    console.log('Week ' + (i+1) + ' color:', color);
  });
  console.log('');
  console.log('Weekly Table Headers:');
  document.querySelectorAll('.weekly-tasks th').forEach(function(el, i){
    var color = window.getComputedStyle(el).color;
    console.log('Week ' + (i+1) + ' color:', color);
  });
}

setTimeout(function(){
  debugWeekColors();
  console.log('Type debugWeekColors() in console to re-run anytime');
}, 1000);

var habits=[];
function buildHabits() {
  if (RAW_HABITS.length>0) { habits=RAW_HABITS.map(function(h,i){return{id:h.id,name:h.name,icon:h.icon||'✅',category:h.category||'General',colorClass:colorForHabitIndex(i),freq_type:h.freq_type||'days',freq_value:h.freq_value||null,start_date:h.start_date||null,difficulty:h.difficulty||null};}); }
  else { habits=[{id:-1,name:'Add your first habit via ⚙ Settings',icon:'👆',category:'',colorClass:colorForHabitIndex(0),freq_type:'days',freq_value:null,start_date:null}]; }
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
  var numWeeks0=getWeekCount(); document.getElementById('donut-row').style.gridTemplateColumns='repeat('+numWeeks0+', minmax(0,1fr))';
  var numWeeks=getWeekCount(), radius=26, circ=2*Math.PI*radius, monthGoal=0, monthDone=0, weekPcts=[];
  var currentTheme=document.body.getAttribute('data-theme')||'vaporwave';
  var donutLabelColor = getComputedStyle(document.body).getPropertyValue('--donut-label-color').trim();
  for (var w=0;w<numWeeks;w++) {
    var ws=w*7+1, we=Math.min(ws+6,DAYS_IN_MONTH), tp=0, td=0;
    habits.forEach(function(h){
      if(h.id===-1)return; var hid=String(h.id);
      for(var d=ws;d<=we;d++){
        var req=dayRequirement(h,d);
        if(req>0){
          var iso=currentYear+'-'+String(currentMonth).padStart(2,'0')+'-'+String(d).padStart(2,'0');
          var n=(logsLookup[hid]&&logsLookup[hid][iso])||0;
          if(isHardOptional(h)){ var got=Math.min(n,req); tp+=got; td+=got; }
          else { tp+=req; td+=n; }
        }
      }
    });
    if(extraCreditEnabled){ for(var bd=ws;bd<=we;bd++) td+=bonusForDay(bd).count; }   // Extra credit: bonus check-ins push the week past 100%
    monthGoal+=tp; monthDone+=td;
    var pct=tp>0?Math.round((td/tp)*100):0, offset=circ-(Math.min(pct,100)/100)*circ;
    weekPcts.push(pct);
    var color=weekColors[w]||'#ccc', fill=getThemeColor('--week-donut-track')||weekFillColors[w]||'#eee', txt=getThemeColor('--week-donut-text')||weekTextColors[w]||'#333';   // dark themes can set their own donut track/text colors
    var item=document.createElement('div'); item.style.cssText='flex:0 0 auto;text-align:center;';
    item.innerHTML='<svg width="74" height="74" viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" fill="none" stroke="'+fill+'" stroke-width="8"></circle><circle cx="32" cy="32" r="26" fill="none" stroke="'+color+'" stroke-width="8" stroke-dasharray="'+circ+' '+circ+'" stroke-dashoffset="'+offset+'" transform="rotate(-90 32 32)" stroke-linecap="round"></circle><text x="32" y="29" text-anchor="middle" font-size="9" font-weight="600" fill="'+txt+'">Wk '+(w+1)+'</text><text x="32" y="43" text-anchor="middle" font-size="13" font-weight="700" fill="'+txt+'">'+pct+'%</text></svg>';
    el.appendChild(item);
  }
  renderWeekBars(weekPcts);
  renderSummaryDonut(monthDone, monthGoal, 'summary-donut', 'This month');
  var yr=getYearProgress(); renderSummaryDonut(yr.done, yr.goal, 'summary-donut-year', 'This year');
}

// Big donut for the whole month: habits completed out of the month's goal.
function renderSummaryDonut(done, goal, elId, label) {
  var el=document.getElementById(elId||'summary-donut'); if(!el) return;
  var r=44, circ=2*Math.PI*r, pct=goal>0?Math.round((done/goal)*100):0;
  var shown=Math.min(pct,100), offset=circ-(shown/100)*circ;
  var color=getThemeColor('--c-pink'), track=hexToRgba(color,0.2), txt=getThemeColor('--c-text');
  var over='';   // Extra credit above 100%: a thin inner ring in the bonus color
  if(pct>100){ var r2=34, c2=2*Math.PI*r2, f2=Math.min((pct-100)/100,1); over='<circle cx="50" cy="50" r="'+r2+'" fill="none" stroke="'+bonusColor()+'" stroke-width="5" stroke-dasharray="'+(f2*c2)+' '+c2+'" transform="rotate(-90 50 50)" stroke-linecap="round"></circle>'; }
  el.innerHTML='<svg width="120" height="120" viewBox="0 0 100 100"><circle cx="50" cy="50" r="'+r+'" fill="none" stroke="'+track+'" stroke-width="10"></circle><circle cx="50" cy="50" r="'+r+'" fill="none" stroke="'+color+'" stroke-width="10" stroke-dasharray="'+circ+' '+circ+'" stroke-dashoffset="'+offset+'" transform="rotate(-90 50 50)" stroke-linecap="round"></circle>'+over+'<text x="50" y="57" text-anchor="middle" font-size="22" font-weight="700" fill="'+txt+'">'+pct+'%</text></svg><p>'+done+' of '+goal+' habits done</p>';
  el.insertAdjacentHTML('afterbegin','<p class="sum-label">'+(label||'This month')+'</p>');
}


// ============================================
// CATEGORY STAR MAP
// ============================================
var STAR_MAX=5, STAR_KEY='habitTrackerStarSel';
function getCategoryTotals(){
  var cats={};
  habits.forEach(function(h){
    if(h.id===-1)return; var hid=String(h.id), cat=h.category||'General';
    if(!cats[cat])cats[cat]={done:0,goal:0};
    for(var d=1;d<=DAYS_IN_MONTH;d++){
      var req=dayRequirement(h,d);   // same rule as the checklist, so "every X days" habits count too
      if(!(req>0))continue;
      var iso=currentYear+'-'+String(currentMonth).padStart(2,'0')+'-'+String(d).padStart(2,'0');
      var n=(logsLookup[hid]&&logsLookup[hid][iso])||0;
      cats[cat].goal+=req; cats[cat].done+=Math.min(n,req);
    }
  });
  if(extraCreditEnabled){ for(var d=1;d<=DAYS_IN_MONTH;d++) bonusForDay(d).items.forEach(function(it){ var c=it.h.category||'General'; if(cats[c]&&cats[c].goal>0) cats[c].done+=it.n; }); }   // Extra credit: bonus counts toward the star map
  return cats;
}
function loadStarSelection(names){
  var saved=null;
  try{ saved=JSON.parse(localStorage.getItem(STAR_KEY)||'null'); }catch(e){}
  if(!Array.isArray(saved)) saved=names.slice(0,STAR_MAX);
  return saved.filter(function(n){return names.indexOf(n)>-1;}).slice(0,STAR_MAX);
}
function saveStarSelection(sel){
  try{ localStorage.setItem(STAR_KEY, JSON.stringify(sel)); }catch(e){}
}
function renderStarMap(){
  var svg=document.getElementById('star-map'); if(!svg) return;
  var cats=getCategoryTotals();
  var names=Object.keys(cats).sort(function(a,b){return cats[b].goal-cats[a].goal || a.localeCompare(b);});
  var sel=loadStarSelection(names);
  var CX=170, CY=160, R=98;
  var ink=getThemeColor('--c-text'), muted=getThemeColor('--c-text-muted'), accent=getThemeColor('--c-pink');
  var grid=hexToRgba(muted,0.7);   // pentagon grid lines (was 0.35, too faint)
  function pt(k,f){var a=-Math.PI/2+k*2*Math.PI/STAR_MAX; return [CX+Math.cos(a)*R*f, CY+Math.sin(a)*R*f];}
  function ring(f){var p=[];for(var k=0;k<STAR_MAX;k++){var q=pt(k,f);p.push(q[0].toFixed(1)+','+q[1].toFixed(1));}return p.join(' ');}
  var g='';
  [0.25,0.5,0.75,1].forEach(function(f){g+='<polygon points="'+ring(f)+'" fill="none" stroke="'+grid+'" stroke-width="'+(f===1?1.6:1.1)+'"/>';});   // outer pentagon a little thicker
  for(var k=0;k<STAR_MAX;k++){var e=pt(k,1);g+='<line x1="'+CX+'" y1="'+CY+'" x2="'+e[0].toFixed(1)+'" y2="'+e[1].toFixed(1)+'" stroke="'+grid+'" stroke-width="1"/>';}
  var pts=[];
  sel.forEach(function(name,k){
    var c=cats[name], ratio=c.goal>0?Math.min(c.done/c.goal,1):0, q=pt(k,ratio);
    pts.push(q[0].toFixed(1)+','+q[1].toFixed(1));
    var l=pt(k,1.22);
    g+='<text x="'+l[0].toFixed(1)+'" y="'+(l[1]+4).toFixed(1)+'" text-anchor="middle" font-size="12" fill="'+ink+'">'+name.replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</text>';
    var v=pt(k,ratio+0.1);
    g+='<text x="'+v[0].toFixed(1)+'" y="'+(v[1]+4).toFixed(1)+'" text-anchor="middle" font-size="11" font-weight="700" fill="'+accent+'">'+Math.round(ratio*100)+'%</text>';
  });
  if(sel.length>=3){g+='<polygon points="'+pts.join(' ')+'" fill="'+hexToRgba(accent,0.25)+'" stroke="'+accent+'" stroke-width="2"/>';}
  pts.forEach(function(p){var xy=p.split(',');g+='<circle cx="'+xy[0]+'" cy="'+xy[1]+'" r="3.5" fill="'+accent+'"/>';});
  // Invisible, bigger circles on top of each point: hover (or tap) shows how far you are in that category
  pts.forEach(function(p,k){var xy=p.split(',');g+='<circle class="star-hit" data-star="'+k+'" cx="'+xy[0]+'" cy="'+xy[1]+'" r="14" fill="transparent"/>';});
  svg.innerHTML=g;
  var wrap=svg.parentNode, tip=document.getElementById('star-tip');
  if(!tip){ tip=document.createElement('div'); tip.id='star-tip'; tip.className='star-tip'; wrap.appendChild(tip); }
  wrap.classList.add('star-wrap'); tip.style.display='none';
  function showTip(k,ev){
    var name=sel[k], c=cats[name], pct=c.goal>0?Math.round(c.done/c.goal*100):0, left=Math.max(0,c.goal-c.done);
    var esc=function(x){return String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;');};
    tip.innerHTML='<b>'+esc(name)+': '+pct+'%</b>'+c.done+' of '+c.goal+' habits done this month<br>'+(left?left+' to go to reach the edge':'You reached the edge! 🎉');
    var r=wrap.getBoundingClientRect(); tip.style.display='block';
    var x=ev.clientX-r.left+12, y=ev.clientY-r.top+12;
    if(x+tip.offsetWidth>r.width) x=Math.max(4,ev.clientX-r.left-tip.offsetWidth-12);
    tip.style.left=x+'px'; tip.style.top=y+'px';
  }
  svg.querySelectorAll('.star-hit').forEach(function(h){
    var k=+h.getAttribute('data-star');
    h.addEventListener('mousemove',function(e){showTip(k,e);});
    h.addEventListener('mouseleave',function(){tip.style.display='none';});
    h.addEventListener('click',function(e){e.stopPropagation(); showTip(k,e);});
  });
  if(!wrap._starTipClose){ wrap._starTipClose=true; document.addEventListener('click',function(){var t=document.getElementById('star-tip'); if(t) t.style.display='none';}); }

  var tog=document.getElementById('star-toggles'); tog.innerHTML='';
  var note=document.getElementById('star-note'); note.textContent=sel.length<STAR_MAX?'Pick five categories for a full star.':'';
  names.forEach(function(name){
    var on=sel.indexOf(name)>-1;
    var lab=document.createElement('label'); lab.className='star-chip'+(on?' on':'');
    var cb=document.createElement('input'); cb.type='checkbox'; cb.checked=on;
    cb.addEventListener('change',function(){
      var cur=loadStarSelection(names);
      if(cb.checked){
        if(cur.length>=STAR_MAX){ cb.checked=false; note.textContent='Five is the maximum. Untick one first.'; return; }
        cur.push(name);
      } else { cur=cur.filter(function(x){return x!==name;}); }
      saveStarSelection(cur);
      renderStarMap();
    });
    var t=document.createElement('span'); t.textContent=name;
    lab.appendChild(cb); lab.appendChild(t); tog.appendChild(lab);
  });
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
      var dow=(firstDayMonBased+day-1)%7, sched=schedDays(habitAt(h,iso))[dow];
      var req=sched?sched.required:1, done=(logsLookup[hid]&&logsLookup[hid][iso])||0;
      if(done>0&&isBonusDay(h,day))return 0;   // done on a day it wasn't due: drawn in the striped Bonus piece instead
      var ratio=req>0?done/req:0; return extraCreditEnabled?ratio:Math.min(ratio,1);
    }), _rawCounts:dayLabels.map(function(day){
      if(h.id===-1)return{done:0,required:1};
      var iso=currentYear+'-'+String(currentMonth).padStart(2,'0')+'-'+String(day).padStart(2,'0');
      var dow=(firstDayMonBased+day-1)%7, sched=schedDays(habitAt(h,iso))[dow];
      return{done:(logsLookup[hid]&&logsLookup[hid][iso])||0,required:sched?sched.required:1};
    }), backgroundColor:colorForHabitIndex(i), borderRadius:1, borderWidth:0 };
  });
  var totals=barDatasets.map(function(ds,i){return{index:i,total:ds.data.reduce(function(a,b){return a+b;},0)};});
  totals.sort(function(a,b){return b.total-a.total;}); var top5=totals.slice(0,5).map(function(t){return t.index;});
  var lineData=dayLabels.map(function(day){return barDatasets.reduce(function(sum,ds){return sum+(ds.data[day-1]||0);},0);});
  // Bonus = archived habits logged that day + habits done on a day they weren't due.
  var bonusDays=dayLabels.map(function(day){return bonusForDay(day);});
  var bColor=bonusColor(), hasBonus=bonusDays.some(function(b){return b.count>0;});
  if(hasBonus) barDatasets.push({ label:'Bonus', data:bonusDays.map(function(b){return b.count;}), _bonus:bonusDays, backgroundColor:bonusPattern(bColor), borderColor:bColor, borderWidth:1, borderRadius:1 });
  if(barChartInstance)barChartInstance.destroy(); if(lineChartInstance)lineChartInstance.destroy(); if(catChartInstance)catChartInstance.destroy();

  // Size the bar chart so one fully-done habit segment is about 6px tall.
  var yMax=Math.max(1,Math.ceil(Math.max.apply(null,lineData.map(function(v,i){return v+bonusDays[i].count;}))));
  var barWrap=document.getElementById('barChart').parentElement;
  var BAR_PX_PER_HABIT=14, BAR_MIN_HEIGHT=260;  // change these two numbers to make the graph taller or shorter
  barWrap.style.height=Math.max(BAR_MIN_HEIGHT,yMax*BAR_PX_PER_HABIT+80)+'px';
  var catEl=document.getElementById('catChart');
  if(catEl) catEl.parentElement.style.height=barWrap.style.height;  // category chart matches the bar chart
  
  var axisTextColor=getThemeColor('--c-text-muted');
  
  barChartInstance=new Chart(document.getElementById('barChart'),{type:'bar',data:{labels:dayLabels,datasets:barDatasets},options:{responsive:true,maintainAspectRatio:false,scales:{y:{stacked:true,beginAtZero:true,max:yMax,ticks:{color:axisTextColor,stepSize:yMax>12?Math.ceil(yMax/8):1}},x:{stacked:true,ticks:{color:axisTextColor,autoSkip:true,maxRotation:0,font:{size:9}}}},plugins:{legend:{position:'bottom',labels:{color:getThemeColor('--c-text'),boxWidth:10,font:{size:10},filter:function(item){return top5.indexOf(item.datasetIndex)!==-1||item.text==='Bonus';}}},tooltip:{callbacks:{label:function(ctx){if(ctx.dataset._bonus)return bonusTooltipLines(ctx.dataset._bonus[ctx.dataIndex]);var r=ctx.dataset._rawCounts[ctx.dataIndex];return r&&r.done>0?ctx.dataset.label+': '+r.done+'/'+r.required:null;}}}}}});
  // Daily trend: the line is your routine; a bonus-colored dot above it marks bonus check-ins.
  // The more archived habits you logged that day, the bigger the dot. Hover it to see which ones.
  var lineSets=[{label:'Habits done',data:lineData,borderColor:getThemeColor('--c-pink'),backgroundColor:hexToRgba(getThemeColor('--c-pink'),0.2),fill:true,tension:0,pointRadius:2}];
  if(hasBonus) lineSets.push({label:'Bonus',data:bonusDays.map(function(b,i){return b.count?lineData[i]+b.count:null;}),_bonus:bonusDays,showLine:false,fill:false,
    pointRadius:bonusDays.map(function(b){return b.count?Math.min(14,4+b.archived.length*2.5+b.offday.length):0;}),
    pointHoverRadius:bonusDays.map(function(b){return b.count?Math.min(16,6+b.archived.length*2.5+b.offday.length):0;}),
    pointBackgroundColor:bColor,pointBorderColor:getThemeColor('--c-body-bg')||'#fff',pointBorderWidth:1.5});
  var stemPlugin={id:'bonusStem',beforeDatasetDraw:function(chart,args){
    if(args.index!==1)return; var m0=chart.getDatasetMeta(0), m1=chart.getDatasetMeta(1), c=chart.ctx;
    c.save(); c.strokeStyle=bColor; c.lineWidth=2; c.setLineDash([3,2]);
    bonusDays.forEach(function(b,i){ if(!b.count||!m0.data[i]||!m1.data[i])return; c.beginPath(); c.moveTo(m0.data[i].x,m0.data[i].y); c.lineTo(m1.data[i].x,m1.data[i].y); c.stroke(); });
    c.restore(); }};
  lineChartInstance=new Chart(document.getElementById('lineChart'),{type:'line',data:{labels:dayLabels,datasets:lineSets},plugins:[stemPlugin],options:{responsive:true,maintainAspectRatio:false,layout:{padding:{top:14}},plugins:{legend:{display:false},tooltip:{callbacks:{title:function(items){return items.length?monthDayLabel(+items[0].label):'';},label:function(ctx){if(ctx.dataset._bonus)return bonusTooltipLines(ctx.dataset._bonus[ctx.dataIndex]);return 'Habits done: '+Math.round(ctx.parsed.y*10)/10;}}}},scales:{y:{beginAtZero:true,ticks:{color:axisTextColor}},x:{ticks:{color:axisTextColor,autoSkip:true,maxRotation:0,font:{size:9}}}}}});
  renderCategoryChart(axisTextColor);
  renderStarMap();
  renderXpGrowth();
  renderXpDerivatives();
}

// Horizontal bars: for each category, habits done (solid) out of the month's goal (light).
function renderCategoryChart(axisTextColor) {
  var el=document.getElementById('catChart'); if(!el) return;
  if(catChartInstance){catChartInstance.destroy();catChartInstance=null;}
  var cats={};
  habits.forEach(function(h){
    if(h.id===-1)return; var hid=String(h.id), cat=h.category||'General';
    if(!cats[cat])cats[cat]={done:0,goal:0};
    for(var d=1;d<=DAYS_IN_MONTH;d++){
      var req=dayRequirement(h,d);   // same rule as the checklist, so "every X days" habits count too
      if(!(req>0))continue;
      var iso=currentYear+'-'+String(currentMonth).padStart(2,'0')+'-'+String(d).padStart(2,'0');
      var n=(logsLookup[hid]&&logsLookup[hid][iso])||0;
      cats[cat].goal+=req; cats[cat].done+=Math.min(n,req);
    }
  });
  var bonusCat={};   // bonus check-ins per category (archived habits and not-due days)
  for(var bd=1;bd<=DAYS_IN_MONTH;bd++) bonusForDay(bd).items.forEach(function(it){ var c=it.h.category||'General'; bonusCat[c]=(bonusCat[c]||0)+it.n; if(!cats[c])cats[c]={done:0,goal:0}; });
  var names=Object.keys(cats).sort(function(a,b){return cats[b].goal-cats[a].goal;});
  var color=getThemeColor('--c-pink'), bc=bonusColor();
  var catSets=[
    {label:'Done',data:names.map(function(n){return cats[n].done;}),backgroundColor:color,borderRadius:2,borderWidth:0},
    {label:'Left to do',data:names.map(function(n){return cats[n].goal-cats[n].done;}),backgroundColor:hexToRgba(color,0.2),borderRadius:2,borderWidth:0}
  ];
  if(Object.keys(bonusCat).length) catSets.push({label:'Bonus',data:names.map(function(n){return bonusCat[n]||0;}),backgroundColor:bonusPattern(bc),borderColor:bc,borderWidth:1,borderRadius:2});
  catChartInstance=new Chart(el,{type:'bar',data:{labels:names,datasets:catSets},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,scales:{x:{stacked:true,beginAtZero:true,ticks:{color:axisTextColor}},y:{stacked:true,ticks:{color:axisTextColor,font:{size:10}}}},plugins:{legend:{position:'bottom',labels:{color:getThemeColor('--c-text'),boxWidth:10,font:{size:10}}}}}});
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
// TBD Title; Builds the hover text shown on a habit's name in the monthly grid.
// ==========================================
// Builds the hover text shown on a habit's name in the monthly grid.
function buildHabitTooltip(h) {
  if (h.id === -1) return '';
  var dayNames = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  var monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var hid = String(h.id);
  var lines = ['Schedule:'];

  if (h.freq_type === 'monthly' && h.freq_value) {
    lines.push('Required: ' + h.freq_value + ' times per month (any day)');
  } else if (h.freq_type === 'interval' && h.freq_value && h.start_date) {
    var p = h.start_date.split('-');
    lines.push('Required: every ' + h.freq_value + ' days');
    lines.push('Starting: ' + monthNames[parseInt(p[1], 10) - 1] + ' ' + parseInt(p[2], 10) + ', ' + p[0]);
  } else {
    var req = [], flex = [], perDay = 1;
    for (var i = 0; i < 7; i++) {
      var s = scheduleLookup[hid] && scheduleLookup[hid][i];
      if (!s) continue;
      if (s.required > perDay) perDay = s.required;
      if (s.flexible) flex.push(dayNames[i]);
      else if (s.required > 0) req.push(dayNames[i]);
    }
    var perDayText = perDay > 1 ? ' (' + perDay + 'x per day)' : '';
    if (req.length) lines.push('Required: ' + req.join(' ') + perDayText);
    if (flex.length) lines.push('Flexible: ' + flex.join(' ') + (req.length ? '' : perDayText));
    if (!req.length && !flex.length) lines.push('Required: none');
  }

  lines.push('Category: ' + (h.category || 'General'));
  var vs = SCHED_VERSIONS[hid];
  if (vs && vs.length > 1) { lines.push('Schedule history:'); vs.forEach(function (v) { lines.push('  ' + (v.effective_from <= '1901-01-01' ? 'Start' : moneyDay(v.effective_from)) + ': ' + schedDescribe(v)); }); }
  return lines.join('\n');
}

// ============================================
// CHECKBOX GRID
// ============================================
var completionState={};
var dayInitials=['M','T','W','T','F','S','S'];
function renderGrid() {
  var table=document.getElementById('grid-table'); table.innerHTML=''; completionState={};
  renderGridTabs();
  var headRow=document.createElement('tr'); headRow.appendChild(document.createElement('th'));
  var weekBoundaries=[];
  for(var d=1;d<=DAYS_IN_MONTH;d++){
    var w=weekBoundaries.length===0?0:weekBoundaries[weekBoundaries.length-1].week;
    if(weekBoundaries.filter(function(b){return b.week===w;}).length===7)w++;
    var th=document.createElement('th'); th.innerHTML=dayInitials[(firstDayMonBased+d-1)%7]+'<br>'+d; th.className=hlDayClass(d);
    headRow.appendChild(th); weekBoundaries.push({day:d,week:w});
  }
  var progressTh=document.createElement('th'); progressTh.textContent='Progress'; progressTh.style.minWidth='110px';
  headRow.appendChild(progressTh); table.appendChild(headRow);

  habits.forEach(function(h,hi){
    if(!gridFilterMatch(h))return;
    var hid=String(h.id); completionState[hid]={};
    var row=document.createElement('tr');
    var labelCell=document.createElement('td'); labelCell.className='habit-label-cell';
    labelCell.title=buildHabitTooltip(h);
    labelCell.innerHTML='<span class="habit-icon" style="background:'+h.colorClass+';"></span>'+h.icon+' '+h.name;
    if(xpMode&&h.id!==-1)labelCell.appendChild(makeXpTag(h.difficulty,function(nd){setHabitDifficulty(h.id,nd);}));
    row.appendChild(labelCell);

    weekBoundaries.forEach(function(b){
      var cell=document.createElement('td'), box=document.createElement('div'); box.className='day-box'; cell.className=hlDayClass(b.day);
      var isoDate=currentYear+'-'+String(currentMonth).padStart(2,'0')+'-'+String(b.day).padStart(2,'0');
      var timesRequired, isFlexible;
      var rq=schedReq(habitAt(h,isoDate),currentYear,currentMonth,b.day);   // uses the schedule that was active on this date
      if(rq.kind==='monthly'){ timesRequired=1; isFlexible=true; }
      else { timesRequired=rq.req; isFlexible=rq.flexible; }
      var chg=schedChangeOn(hid,isoDate);   // a schedule change starts on this day: draw the marker line
      if(chg){ box.classList.add('sched-change'); }

      var timesLogged=(logsLookup[hid]&&logsLookup[hid][isoDate])||0;
      box.dataset.required = (!isFlexible && timesRequired > 0) ? 'true' : 'false';
      completionState[hid][b.day]=timesLogged;
      applyCheckboxThemeStyle(box, isFlexible);

      if(timesRequired===0){
        applyBoxVisual(box,timesLogged,1,b.week,true);
        box.style.opacity=timesLogged>0?'1':'0.3';
        box.style.cursor='pointer';
        box.addEventListener('click',(function(habitId,date,weekNum,habitIdx,dayNum){
          return function(){
            if(habitId===-1)return;
            var current=completionState[String(habitId)][dayNum]||0;
            var next=current>=1?0:1;
            completionState[String(habitId)][dayNum]=next;
            logsLookup[String(habitId)]=logsLookup[String(habitId)]||{};
            logsLookup[String(habitId)][date]=next;
            if(next>0){
              box.style.background=weekColors[weekNum]||'#8C5FD9';
              box.style.color=weekTextColors[weekNum]||'#fff';
              box.textContent='\u2713';
              box.style.fontSize='11px';
              box.style.fontWeight='700';
              box.style.border='1.5px dashed '+(weekColors[weekNum]||'#8C5FD9');
              box.style.opacity='1';
            } else {
              applyBoxVisual(box,0,1,weekNum,true);
              box.style.opacity='0.3';
            }
            updateProgressCell(String(habitId),habitIdx);
            saveLog(habitId,date,next);
          };
        })(h.id,isoDate,b.week,hi,b.day));
      } else {
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
      if(chg) box.dataset.tip=(box.dataset.tip?box.dataset.tip+' · ':'')+'Schedule changed: '+chg;
      cell.appendChild(box); row.appendChild(cell);
    });

    var progressCell=document.createElement('td'); progressCell.className='progress-cell'; progressCell.id='progress-cell-'+hi;
        row.appendChild(progressCell); table.appendChild(row); updateProgressCell(hid,hi);
  });
  if(table.rows.length===1){
    var er=document.createElement('tr'), ec=document.createElement('td');
    ec.colSpan=DAYS_IN_MONTH+2; ec.className='grid-empty'; ec.textContent='No habits with this rank yet.';
    er.appendChild(ec); table.appendChild(er);
  }
  renderGridLegend();
}

// Key next to the checklist: real sample boxes drawn the same way as the grid, so they always match the theme.
var legendMin=false;   // key folded down to a small chip (remembered on this device only)
try { legendMin = localStorage.getItem('habitTrackerLegendMin') === '1'; } catch (e) {}
function toggleLegend() {
  legendMin = !legendMin;
  try { localStorage.setItem('habitTrackerLegendMin', legendMin ? '1' : '0'); } catch (e) {}
  renderGridLegend();
}
function renderGridLegend() {
  var el=document.getElementById('grid-legend'); if(!el)return;
  var todayWeek=0; (function(){ var now=new Date(); if(now.getFullYear()===currentYear&&now.getMonth()+1===currentMonth) todayWeek=Math.min(4,Math.floor((now.getDate()-1)/7)); })();
  var w=todayWeek, base=weekColors[w]||'#8C5FD9';
  var items=[
    {label:'To do: scheduled, not done yet', make:function(b){ b.dataset.required='true'; applyBoxVisual(b,0,1,w,false); }},
    {label:'Done', make:function(b){ b.dataset.required='true'; applyBoxVisual(b,1,1,w,false); }},
    {label:'Partly done (e.g. 1 of 2 times)', make:function(b){ b.dataset.required='true'; applyBoxVisual(b,1,2,w,false); }},
    {label:'Extra credit: done more times than required', make:function(b){ b.dataset.required='true'; applyBoxVisual(b,3,2,w,false); }},
    {label:'Flexible or "X times a month": do it any day you can', make:function(b){ b.dataset.required='false'; applyBoxVisual(b,0,1,w,true); }},
    {label:'Flexible, done', make:function(b){ b.dataset.required='false'; applyBoxVisual(b,1,1,w,true); }},
    {label:'Rest day: not scheduled (tap for a bonus)', make:function(b){ b.dataset.required='false'; applyBoxVisual(b,0,1,w,true); b.style.opacity='0.3'; }},
    {label:'Bonus: done on a rest day', make:function(b){ b.dataset.required='false'; b.style.display='flex'; b.style.alignItems='center'; b.style.justifyContent='center';
      b.style.background=base; b.style.color=weekTextColors[w]||'#fff'; b.textContent='✓'; b.style.fontSize='11px'; b.style.fontWeight='700'; b.style.border='1.5px dashed '+base; }},
    {label:'Schedule changed starting this day', make:function(b){ b.dataset.required='true'; applyBoxVisual(b,0,1,w,false); b.classList.add('sched-change'); }},
    {label:'Today\'s column (Highlight setting)', cls:'grid-legend-hl-today', make:function(b){ b.style.border='2px solid var(--c-pink)'; b.style.background='color-mix(in srgb, var(--c-pink) 30%, transparent)'; }},
    {label:'Weekend columns (Highlight setting)', make:function(b){ b.style.border='none'; b.style.background='color-mix(in srgb, var(--c-text-muted) 14%, transparent)'; }}
  ];
  el.classList.toggle('min', legendMin);
  el.innerHTML='';
  var head=document.createElement('div'); head.className='grid-legend-head';
  head.innerHTML='<p class="grid-legend-title">🔑 Key</p>';
  var btn=document.createElement('button'); btn.type='button'; btn.className='grid-legend-btn';
  btn.textContent=legendMin?'Show ▸':'Hide ▾'; btn.title=legendMin?'Open the key':'Fold the key away';
  btn.addEventListener('click', toggleLegend);
  head.appendChild(btn); el.appendChild(head);
  if(legendMin) return;
  items.forEach(function(it){
    var row=document.createElement('div'); row.className='grid-legend-row';
    var box=document.createElement('div'); box.className='day-box grid-legend-box';
    applyCheckboxThemeStyle(box, false); it.make(box); box.removeAttribute('data-tip');
    var lab=document.createElement('span'); lab.textContent=it.label;
    row.appendChild(box); row.appendChild(lab); el.appendChild(row);
  });
  var tip=document.createElement('p'); tip.className='grid-legend-tip'; tip.textContent='Tap a box to add a tick. Click again to take one tick away.';
  el.appendChild(tip);
}

function applyCheckboxThemeStyle(box, isFlexible) {
  var theme=document.body.getAttribute('data-theme')||'vaporwave';
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
      box.textContent=getCheckboxSymbol('flexible-empty');
    } else {
      box.style.border='3px solid '+baseColor;
      box.style.color=baseColor;
      box.style.fontSize='9px';
      box.style.fontWeight='700';
      box.textContent=getCheckboxSymbol('required-empty');
    }
  } else if(timesLogged>=timesRequired){
    box.style.background=baseColor;
    box.style.color=weekTextColors[week]||'#fff';
    box.textContent=getCheckboxSymbol('required-done');
    box.style.fontSize='11px';
    box.style.fontWeight='700';
    if(isFlexible){
      box.style.border='1.5px dashed '+baseColor;
      box.style.boxShadow='none';
    } else {
      box.style.border='3px solid '+baseColor;
      box.style.boxShadow=isGlowTheme?'0 0 10px '+hexToRgba(baseColor,0.9)+', 0 0 20px '+hexToRgba(baseColor,0.5):'none';
    }
    if(timesLogged>timesRequired){ box.style.border='3px solid '+bonusColor(); }   // extra credit: did it more times than required
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
  var h=habits[hi], totalDone=0, totalRequired=0, monthlyGoal=0, hasMonthly=false;
  // Day by day, using whichever schedule was active that day ("X times per month" parts are prorated by days).
  for(var d=1;d<=DAYS_IN_MONTH;d++){
    var iso=currentYear+'-'+String(currentMonth).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    var hh=habitAt(h,iso), r=schedReq(hh,currentYear,currentMonth,d), n=(logsLookup[hid]&&logsLookup[hid][iso])||0;
    if(r.kind==='monthly'){ hasMonthly=true; monthlyGoal+=(hh.freq_value||0)/DAYS_IN_MONTH; totalDone+=n; }
    else if(r.req>0){ totalRequired+=r.req; totalDone+=n; }
  }
  totalRequired+=Math.round(monthlyGoal);
  if(totalRequired===0 && !hasMonthly){ totalDone=Object.values(logsLookup[hid]||{}).reduce(function(a,b){return a+b;},0); totalRequired=DAYS_IN_MONTH; }

  var pct=Math.round((totalDone/Math.max(1,totalRequired))*100);
  if(!extraCreditEnabled)pct=Math.min(pct,100);
  cell.innerHTML='<div style="display:flex;justify-content:flex-end;font-size:11px;margin-bottom:3px;"><span style="color:var(--c-text-muted);font-weight:600;">'+pct+'%</span></div><div class="progress-track"><div style="background:'+h.colorClass+';width:'+Math.min(pct,100)+'%;height:100%;"></div></div>';
}

// ============================================
// MONTH PROGRESS + PACE KEEPER
// ============================================
function renderMonthProgress() {
  var el=document.getElementById('month-progress-panel'); if(!el)return;
  var today=new Date();
  var isCurrentMonth=(today.getMonth()+1===currentMonth&&today.getFullYear()===currentYear);
  var dayOfMonth=isCurrentMonth?today.getDate():DAYS_IN_MONTH;
  var timePct=Math.round((dayOfMonth/DAYS_IN_MONTH)*100);
  var totalDone=0, totalRequired=0;
  RAW_HABITS.forEach(function(h){
    if(h.id===-1)return;
    var hid=String(h.id);
    for(var d=1;d<=DAYS_IN_MONTH;d++){
      var req=dayRequirement(h,d);
      if(req>0){
        var iso=currentYear+'-'+String(currentMonth).padStart(2,'0')+'-'+String(d).padStart(2,'0');
        var got=Math.min((logsLookup[hid]&&logsLookup[hid][iso])||0,req);
        totalRequired+=isHardOptional(h)?got:req;
        totalDone+=got;
      }
    }
  });
  if(extraCreditEnabled){ for(var bd=1;bd<=DAYS_IN_MONTH;bd++) totalDone+=bonusForDay(bd).count; }   // Extra credit: bonus can push you past 100%
  var habitPct=totalRequired>0?Math.round((totalDone/totalRequired)*100):0;
  if(!extraCreditEnabled) habitPct=Math.min(100,habitPct);
  var pink=getThemeColor('--c-pink'), purple=getThemeColor('--c-purple');
  el.innerHTML=[
    '<div><div style="display:flex;justify-content:space-between;font-size:10px;color:var(--c-text-muted);margin-bottom:4px;"><span>Time elapsed</span><span>'+dayOfMonth+' / '+DAYS_IN_MONTH+' days</span></div>',
    '<div style="background:var(--c-body-bg-alt);border:1px solid var(--c-dark);height:10px;border-radius:3px;overflow:hidden;"><div style="background:'+purple+';width:'+timePct+'%;height:100%;border-radius:3px;"></div></div></div>',
    '<div><div style="display:flex;justify-content:space-between;font-size:10px;color:var(--c-text-muted);margin-bottom:4px;"><span>Habits done</span><span>'+habitPct+'%</span></div>',
    '<div style="background:var(--c-body-bg-alt);border:1px solid var(--c-dark);height:10px;border-radius:3px;overflow:hidden;"><div style="background:'+pink+';width:'+Math.min(100,habitPct)+'%;height:100%;border-radius:3px;"></div></div></div>',
    '<div style="font-size:10px;text-align:center;margin-top:4px;">',
    habitPct>=timePct?'<span style="color:'+pink+';">✓ Ahead of pace</span>':'<span style="color:var(--c-text-muted);">'+( timePct-habitPct)+'% behind pace</span>',
    '</div>'
  ].join('');
}

// ============================================
// WEEKLY TASKS
// ============================================
var weeklyTaskData=[{week:'Week 1',tasks:[]},{week:'Week 2',tasks:[]},{week:'Week 3',tasks:[]},{week:'Week 4',tasks:[]},{week:'Week 5',tasks:[]}];

async function loadWeeklyTasks() {
  if(!currentUser) return;
  var { data: thisMonth } = await sb.from('weekly_tasks').select('*').eq('user_id',currentUser.id).eq('month',currentMonth).eq('year',currentYear);
  var prevMonth=currentMonth===1?12:currentMonth-1, prevYear=currentMonth===1?currentYear-1:currentYear;
  var { data: lastMonth } = await sb.from('weekly_tasks').select('*').eq('user_id',currentUser.id).eq('month',prevMonth).eq('year',prevYear).eq('is_pinned',true);
  weeklyTaskData=[{week:'Week 1',tasks:[]},{week:'Week 2',tasks:[]},{week:'Week 3',tasks:[]},{week:'Week 4',tasks:[]},{week:'Week 5',tasks:[]}];
  (lastMonth||[]).forEach(function(row){
    var w=row.week_number,i=row.task_index;
    if(w<0||w>4||i<0||i>9)return;
    weeklyTaskData[w].tasks[i]={t:row.task_text,c:false,pinned:true,id:null,d:row.difficulty||null};
  });
  (thisMonth||[]).forEach(function(row){
    var w=row.week_number,i=row.task_index;
    if(w<0||w>4||i<0||i>9)return;
    weeklyTaskData[w].tasks[i]={t:row.task_text,c:row.is_checked,pinned:row.is_pinned,id:row.id,d:row.difficulty||null};
  });
}

async function saveWeeklyTask(weekIdx,taskIdx,text,checked,pinned) {
  if(!currentUser)return;
  var payload={user_id:currentUser.id,week_number:weekIdx,task_index:taskIdx,task_text:text,is_checked:checked,is_pinned:pinned,month:currentMonth,year:currentYear};
  var ranked=weeklyTaskData[weekIdx]&&weeklyTaskData[weekIdx].tasks[taskIdx];
  if(ranked&&ranked.d)payload.difficulty=ranked.d;
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

  function hexToRgbaLocal(hex,a){ var r=hexToRgb(hex); return r?'rgba('+r.r+','+r.g+','+r.b+','+a+')':hex; }
  var headerBgs = weekColors.map(function(c){ return hexToRgbaLocal(c, isVW2?0.35:isTron?0.20:0.25); });
  var rowBgs    = weekColors.map(function(c){ return hexToRgbaLocal(c, isVW2?0.08:isTron?0.06:0.10); });
  // Soft stripes: rows alternate between the week's light color and a stronger shade of it (no dark rows),
  // with dark text on both. Add a theme's name here to give it the same look.
  var SOFT_STRIPES = { 'v4p3': 1, 'dark-romantic': 1, 'pixel-arcade': 1, 'pastel-goth': 1, 'goth-noir': 1 };
  var isSoft = !!SOFT_STRIPES[theme];

  weeklyTaskData.slice(0,numWeeks).forEach(function(wd,w){
    var col=document.createElement('div'); col.className='week-col';
    var header=document.createElement('div'); header.className='week-col-header';

    if(isVW2){
      header.style.cssText='background:'+headerBgs[w]+';color:'+weekColors[w]+';border-bottom:2px solid '+weekColors[w]+';text-align:center;padding:4px;font-size:11px;font-weight:700;';
    } else if(isTron){
      header.style.cssText='background:'+headerBgs[w]+';color:'+weekColors[w]+';border-bottom:2px solid '+weekColors[w]+';text-shadow:0 0 6px '+weekColors[w]+';text-align:center;padding:4px;font-size:11px;font-weight:700;';
    } else {
      header.style.background=weekColors[w]||'#ccc';
      header.style.color=weekTextColors[w]||'#fff';
    }
    header.textContent=wd.week; col.appendChild(header);

    for(var i=0;i<10;i++){
      var task=wd.tasks[i]||{t:'',c:false,pinned:false,id:null};
      var row=document.createElement('div'); row.className='task-row';

      if(isVW2){
        row.style.background=i%2===1?rowBgs[w]:'transparent';
      } else if(isTron){
        row.style.background=i%2===1?rowBgs[w]:'#050510';
      } else if(isSoft){
        row.classList.add('soft-stripe');
        var light=weekFillColors[w]||'#eee';
        row.style.background=i%2===0?light:'color-mix(in srgb, '+(weekColors[w]||'#ccc')+' 45%, '+light+')';   // row 1 light, row 2 a stronger shade
      } else {
        row.style.background=i%2===1?(weekFillColors[w]||'transparent'):'transparent';
      }

      var accentColor=weekColors[w]||'#ccc';
      var textColor=isVW2?'#F0E8FF':isTron?'#E0E0E0':isSoft?'#1E1A24':'';

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

      var tagEl=null;
      (function(weekIdx,taskIdx,textEl,pin){
        var saveTimer=null;
        var tag=null;
        if(xpMode){
          tag=makeXpTag(task.d||null,function(nd){setTaskDifficulty(weekIdx,taskIdx,nd);});
          tag.style.display=(task.t||'').trim()?'':'none';
          tagEl=tag;
        }
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
          if(this.checked)victory('pop','Task done!');
          renderPlannedActualChart();
          renderXpStats();
        });
        textEl.addEventListener('input',function(){
          if(!weeklyTaskData[weekIdx].tasks[taskIdx])weeklyTaskData[weekIdx].tasks[taskIdx]={t:'',c:false,pinned:false,id:null};
          weeklyTaskData[weekIdx].tasks[taskIdx].t=this.value;
          if(tag)tag.style.display=this.value.trim()?'':'none';
          debouncedSave(); renderPlannedActualChart(); renderXpStats();
        });
        pin.addEventListener('click',function(){togglePin(weekIdx,taskIdx,pin);});
      })(w,i,inp,pinBtn);

      row.appendChild(cb); row.appendChild(inp); if(tagEl)row.appendChild(tagEl); row.appendChild(pinBtn); col.appendChild(row);
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
  renderFullHeatmap(); renderActualVsIntended(); renderStreaks(); renderBestMonth(); renderHabitAge();
}

function getWeekDateRange(weekNum, year) {
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
  var months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var pink=getThemeColor('--c-pink');

  var colTemplate='28px repeat('+totalCols+',1fr)';
  monthRow.style.cssText='display:grid;grid-template-columns:'+colTemplate+';gap:2px;margin-bottom:3px;';
  grid.style.cssText='display:grid;grid-template-columns:'+colTemplate+';gap:2px;';

  var spacer=document.createElement('div'); monthRow.appendChild(spacer);
  var lastMonth=-1;
  for(var w=0;w<totalCols;w++){
    var dayIdx=w*7;
    var dayNum=dayIdx-startDow;
    var d=new Date(year,0,1+dayNum);
    var cell=document.createElement('div');
    cell.style.cssText='font-size:10px;color:var(--c-text-muted);white-space:nowrap;overflow:hidden;';
    if(d.getFullYear()===year){
      var m=d.getMonth();
      if(m!==lastMonth){cell.textContent=months[m];lastMonth=m;}
    }
    monthRow.appendChild(cell);
  }

  for(var dow=0;dow<7;dow++){
    var lbl=document.createElement('div');
    lbl.style.cssText='font-size:10px;color:var(--c-text-muted);text-align:right;padding-right:4px;line-height:1;display:flex;align-items:center;justify-content:flex-end;';
    lbl.textContent=dayLabels[dow];
    grid.appendChild(lbl);
    for(var wk=0;wk<totalCols;wk++){
      var dn=(wk*7+dow)-startDow;
      var dt=new Date(year,0,1+dn);
      var cell=document.createElement('div');
      cell.style.cssText='width:100%;aspect-ratio:1;border-radius:2px;';
      if(dt.getFullYear()!==year){
        cell.style.background='transparent';
      } else {
        var iso=dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0');
        var val=dateMap[iso]||0;
        var opacity=val===0?0.08:0.15+(val/maxVal)*0.85;
        cell.style.background=pink;
        cell.style.opacity=opacity.toFixed(2);
        cell.style.cursor='default';
        var dateStr=dt.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'});
        (function(ds,v,tip){
          cell.addEventListener('mouseenter',function(){
            tip.innerHTML='<strong>'+ds+'</strong><br>'+(v>0?v+' habit'+(v!==1?'s':'')+' completed':'No activity logged');
            tip.style.display='block';
          });
          cell.addEventListener('mousemove',function(e){ tip.style.left=(e.clientX+12)+'px'; tip.style.top=(e.clientY-40)+'px'; });
          cell.addEventListener('mouseleave',function(){ tip.style.display='none'; });
        })(dateStr,val,tooltip);
      }
      grid.appendChild(cell);
    }
  }
}

function renderActualVsIntended() {
  if(actualVsIntendedInstance)actualVsIntendedInstance.destroy();
  var el=document.getElementById('actualVsIntendedChart'); if(!el)return;

  var labels=[], actual=[], intended=[];
  var dayDetails = {};
  
  for(var d=1;d<=DAYS_IN_MONTH;d++){
    labels.push(d);
    var iso=currentYear+'-'+String(currentMonth).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    var dow=(firstDayMonBased+d-1)%7;
    var dayActual=0, dayIntended=0;
    var intendedHabits=[], completedHabits=[], missedHabits=[];
    
    RAW_HABITS.forEach(function(h,i){
      if(h.id===-1)return;
      var hid=String(h.id);
      var rq=schedReq(habitAt(h,iso),currentYear,currentMonth,d);
      var req=rq.kind==='monthly'?0:rq.req;
      
      var done=(logsLookup[hid]&&logsLookup[hid][iso])||0;
      if(req>0) {
        intendedHabits.push({name: h.name, required: req});
      }
      if(done>0) {
        completedHabits.push({name: h.name, completed: done});
      }
      if(req>0 && done<req) {
        missedHabits.push({name: h.name, missed: req-done});
      }
      // Both lines count HABITS (a habit done 2 of 2 times = 1 habit), same as the Daily trend chart.
      // Before, "Intended" added up times (2x habit = 2) while "Actual" added up habits, so the lines didn't match.
      // A habit done on a day it isn't required still counts as done (like Daily trend), it just isn't "intended".
      var ratio=done/(req>0?req:1);
      dayActual+=extraCreditEnabled?ratio:Math.min(ratio,1);
      if(req>0) dayIntended+=1;
    });
    
    dayDetails[d] = {intended: intendedHabits, completed: completedHabits, missed: missedHabits};
    actual.push(dayActual);
    intended.push(dayIntended);
  }

  var pink=getThemeColor('--c-pink');
  var purple=getThemeColor('--c-purple');
  var months_short=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  // Glow color: the theme's second accent, lightened 35% so it shows up bright on dark themes too
  var glowBase=hexToRgb(purple)||{r:180,g:140,b:255};
  function glowRgba(a){ return 'rgba('+Math.round(glowBase.r+(255-glowBase.r)*0.35)+','+Math.round(glowBase.g+(255-glowBase.g)*0.35)+','+Math.round(glowBase.b+(255-glowBase.b)*0.35)+','+a+')'; }

  actualVsIntendedInstance=new Chart(el,{
    type:'line',
    data:{labels:labels,datasets:[
      {label:'Intended',data:intended,borderColor:glowRgba(1),borderWidth:1.5,borderDash:[4,3],fill:true,tension:0,pointRadius:0,order:2,
        // Glowing gradient fill: bright at the top edge of the band, fading to clear at the bottom
        backgroundColor:function(c){
          var area=c.chart.chartArea; if(!area) return glowRgba(0.5);
          var g=c.chart.ctx.createLinearGradient(0,area.top,0,area.bottom);
          g.addColorStop(0,glowRgba(0.85)); g.addColorStop(0.45,glowRgba(0.4)); g.addColorStop(1,glowRgba(0.05));
          return g;
        }},
      {label:'Actual',data:actual,borderColor:pink,backgroundColor:hexToRgba(pink,0.08),borderWidth:2,fill:false,tension:0,pointRadius:2,pointBackgroundColor:pink,order:1}
    ]},
    // Soft glow around the Intended band (draws a blurred halo in the theme's second accent color)
    plugins:[{id:'intendedGlow',
      beforeDatasetDraw:function(chart,args){ if(args.index!==0)return; var ctx=chart.ctx; ctx.save(); ctx.shadowColor=glowRgba(1); ctx.shadowBlur=16; },
      afterDatasetDraw:function(chart,args){ if(args.index!==0)return; chart.ctx.restore(); }}],
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{filter:function(item){return item.dataset.label==='Actual';},callbacks:{
      title:function(ctx){return months_short[currentMonth-1]+' '+ctx[0].label+', '+currentYear;},
      afterTitle:function(ctx){
        var dayNum = parseInt(ctx[0].label);
        var details = dayDetails[dayNum];
        if(!details) return '';
        var html = '';
        if(details.completed.length > 0) {
          html += '\n✅ COMPLETED:\n';
          details.completed.forEach(function(h){
            html += '  ✓ ' + h.name + ' (x' + h.completed + ')\n';
          });
        }
        if(details.missed.length > 0) {
          html += '\n❌ MISSED:\n';
          details.missed.forEach(function(h){
            html += '  ✗ ' + h.name + ' (x' + h.missed + ')\n';
          });
        }
        if(details.intended.length === 0) {
          html += '\nNo habits scheduled for this day';
        }
        return html;
      },
      label:function(ctx){
        return ctx.dataset.label + ': ' + Math.round(ctx.raw*10)/10 + ' habits';
      }
    }}},
    scales:{
      x:{ticks:{color:'#898781',font:{size:9},autoSkip:true,maxTicksLimit:16},grid:{color:'rgba(128,128,128,0.15)'},title:{display:true,text:'Day of month',color:'#898781',font:{size:10}}},
      y:{beginAtZero:true,ticks:{color:'#898781',font:{size:9},stepSize:1},grid:{color:'rgba(128,128,128,0.15)'},title:{display:true,text:'Habits',color:'#898781',font:{size:10}}}
    }}
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

// Personal bests: best day, best week, best two weeks and best month (all habits, archived ones too).
// Week and two weeks are any 7 / 14 days in a row, so a great stretch counts even if it crosses a month.
function renderBestMonth() {
  var el=document.getElementById('best-month-container'); if(!el)return;
  var perDay={};
  allHabits().forEach(function(h){ var logs=allTimeLogs[String(h.id)]||{}; Object.keys(logs).forEach(function(d){ if(logs[d]>0) perDay[d]=(perDay[d]||0)+logs[d]; }); });
  var days=Object.keys(perDay).sort();
  if(days.length===0){el.innerHTML='<p class="cell-subtitle">Not enough data yet</p>';return;}
  var fmt=function(iso,yr){ return isoToDate(iso).toLocaleDateString('en-US',yr?{month:'short',day:'numeric',year:'numeric'}:{month:'short',day:'numeric'}); };
  // every calendar day from the first log to today, so empty days count as 0 inside a stretch
  var all=[], end=new Date(); end.setHours(0,0,0,0);
  for(var d=isoToDate(days[0]); d<=end; d.setDate(d.getDate()+1)) all.push(localISO(d));
  function bestRun(len){
    var sum=0, best={total:-1,start:all[0],end:all[0]};
    for(var i=0;i<all.length;i++){
      sum+=perDay[all[i]]||0; if(i>=len) sum-=perDay[all[i-len]]||0;
      if(i>=Math.min(len,all.length)-1 && sum>best.total) best={total:sum,start:all[Math.max(0,i-len+1)],end:all[i]};
    }
    return best;
  }
  var bd=days.reduce(function(a,b){return perDay[a]>=perDay[b]?a:b;});
  var wk=bestRun(7), tw=bestRun(14);
  var monthMap={}; days.forEach(function(d){ var ym=d.substring(0,7); monthMap[ym]=(monthMap[ym]||0)+perDay[d]; });
  var bm=Object.keys(monthMap).reduce(function(a,b){return monthMap[a]>=monthMap[b]?a:b;});
  var mp=bm.split('-'), mNames=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var rows=[
    ['Best day', fmt(bd,true), perDay[bd]],
    ['Best week', fmt(wk.start)+' – '+fmt(wk.end,true), wk.total],
    ['Best two weeks', fmt(tw.start)+' – '+fmt(tw.end,true), tw.total],
    ['Best month', mNames[+mp[1]-1]+' '+mp[0], monthMap[bm]]
  ];
  el.innerHTML='<div class="best-list">'+rows.map(function(r){
    return '<div class="best-row"><span class="best-kind">'+r[0]+'</span><span class="best-when">'+r[1]+'</span><span class="best-num">'+r[2]+' done</span></div>';
  }).join('')+'</div>';
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
  ['sleep-page','mood-page','money-page','shop-page','memory-page','every-page'].forEach(function(id){var el=document.getElementById(id); if(el)el.style.display='none';});
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
// TODAY'S REQUIRED HABITS
// ============================================
var DAY_ABBR = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

function localISO(d) {
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

// Returns {required, tag} if the habit is required today, otherwise null.
// Same rules as the monthly grid: flexible and "X per month" habits are optional, so they are not listed.
function getTodayRequirement(h, now) {
  h = habitAt(h, localISO(now));   // the schedule active today
  var hid = String(h.id), SD = schedDays(h);
  var dow = (now.getDay()+6)%7;
  if (h.freq_type === 'monthly') return null;
  if (h.freq_type === 'interval' && h.start_date && h.freq_value) {
    var cellDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var startDate = parseLocalDate(h.start_date);
    startDate.setHours(0,0,0,0);
    var daysSince = Math.round((cellDate - startDate)/86400000);
    if (daysSince >= 0 && daysSince % h.freq_value === 0) return { required: 1, tag: 'every '+h.freq_value+' days' };
    return null;
  }
  var sched = SD[dow];
  if (!sched || sched.flexible || !(sched.required > 0)) return null;
  var fixedDays = [];
  for (var i = 0; i < 7; i++) {
    var s = SD[i];
    if (s && !s.flexible && s.required > 0) fixedDays.push(DAY_ABBR[i]);
  }
  return { required: sched.required, tag: fixedDays.length === 7 ? 'daily' : fixedDays.join(' ') };
}

// Optional habits = every habit that is NOT required today (flexible days, "X per month" habits, and off days).
// Returns {required, tag} or null if the habit is already in the required list.
function getTodayOptional(h, now) {
  if (getTodayRequirement(h, now)) return null;
  var base = h; h = habitAt(h, localISO(now));
  var hid = String(h.id);
  var dow = (now.getDay()+6)%7;
  if (h.freq_type === 'monthly') {
    var ym = localISO(now).slice(0, 7), total = 0, goal = monthlyGoalFor(base, now.getFullYear(), now.getMonth() + 1);
    Object.keys(allTimeLogs[hid] || {}).forEach(function(d) { if (d.indexOf(ym) === 0) total += allTimeLogs[hid][d] || 0; });
    return { required: 1, tag: goal ? total + '/' + goal + ' this month' : 'any day' };
  }
  var sched = schedDays(h)[dow];
  if (sched && sched.flexible && sched.required > 0) return { required: sched.required, tag: 'flexible' };
  return { required: 1, tag: 'extra' };
}

var showOptionalToday = false;
try { showOptionalToday = localStorage.getItem('habitTrackerShowOptional') === '1'; } catch (e) {}
(function () {
  var cb = document.getElementById('show-optional-toggle');
  if (cb) cb.checked = showOptionalToday;
})();

function toggleShowOptional(on) {
  showOptionalToday = on;
  try { localStorage.setItem('habitTrackerShowOptional', on ? '1' : '0'); } catch (e) {}
  savePref({ show_optional: on });
  if (currentUser) { renderToday(); renderXpStats(); }
}

function makeTodayItem(it, iso, optional) {
  var label = document.createElement('label');
  label.className = 'today-item' + (optional ? ' optional' : '');
  var cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = it.done >= it.req.required;
  var box = document.createElement('span');
  box.className = 'today-box';
  var name = document.createElement('span');
  name.className = 'today-name';
  name.textContent = it.h.icon + ' ' + it.h.name;
  var tag = document.createElement('span');
  tag.className = 'today-tag';
  tag.textContent = (it.req.required > 1 ? it.done + '/' + it.req.required + ' · ' : '') + it.req.tag;
  label.appendChild(cb); label.appendChild(box); label.appendChild(name); label.appendChild(tag);
  label.addEventListener('click', function(e) {
    e.preventDefault();
    onTodayClick(it.h, it.req.required, iso);
  });
  return label;
}

function renderToday() {
  var listEl = document.getElementById('today-list');
  if (!listEl) return;
  var now = new Date();
  var iso = localISO(now);
  document.getElementById('today-dow').textContent = DAYS_OF_WEEK[(now.getDay()+6)%7];
  document.getElementById('today-date').textContent = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  listEl.innerHTML = '';

  var items = [], optItems = [];
  RAW_HABITS.forEach(function(h) {
    var hid = String(h.id);
    var done = (allTimeLogs[hid] && allTimeLogs[hid][iso]) || 0;
    var req = getTodayRequirement(h, now);
    if (req) { items.push({ h: h, req: req, done: done }); return; }
    if (!showOptionalToday) return;
    var opt = getTodayOptional(h, now);
    if (opt) optItems.push({ h: h, req: opt, done: done });
  });

  // Bonus: archived habits logged today, and active habits done today that weren't due (and aren't already listed).
  var listed = {}; items.concat(optItems).forEach(function(it) { listed[String(it.h.id)] = 1; });
  var bonusItems = [];
  allHabits().forEach(function(h) {
    var hid = String(h.id), n = (allTimeLogs[hid] && allTimeLogs[hid][iso]) || 0;
    if (n > 0 && !listed[hid] && (h.archived || habitAt(h, iso).freq_type !== 'monthly')) bonusItems.push({ h: h, req: { required: 1, tag: h.archived ? 'archived' : 'bonus' }, done: n });
  });

  // The counter and bar only count the required habits (plus bonus ones when Extra credit is on).
  var doneCount = items.filter(function(it) { return it.done >= it.req.required; }).length;
  if (extraCreditEnabled) doneCount += bonusItems.length;
  document.getElementById('today-done').textContent = doneCount;
  document.getElementById('today-total').textContent = items.length;
  var pct = items.length ? Math.round((doneCount / items.length) * 100) : 0;
  document.getElementById('today-bar-fill').style.width = Math.min(pct, 100) + '%';

  if (items.length === 0) {
    var empty = document.createElement('p');
    empty.className = 'today-empty';
    empty.style.gridColumn = '1 / -1';
    empty.textContent = 'Nothing is required today. Enjoy the day off.';
    listEl.appendChild(empty);
  }

  items.forEach(function(it) { listEl.appendChild(makeTodayItem(it, iso, false)); });

  if (optItems.length) {
    var sub = document.createElement('p');
    sub.className = 'today-sub';
    sub.textContent = 'Optional';
    listEl.appendChild(sub);
    optItems.forEach(function(it) { listEl.appendChild(makeTodayItem(it, iso, true)); });
  }
  if (bonusItems.length) {
    var bsub = document.createElement('p');
    bsub.className = 'today-sub';
    bsub.textContent = 'Bonus' + (extraCreditEnabled ? ' (counts as extra credit)' : '');
    listEl.appendChild(bsub);
    bonusItems.forEach(function(it) { var el = makeTodayItem(it, iso, true); el.classList.add('bonus'); el.title = 'Click to un-log'; listEl.appendChild(el); });
  }
  renderChests();   // treasure chests on the right of this box and the checklist
}

function setLocalLog(hid, iso, n) {
  if (!allTimeLogs[hid]) allTimeLogs[hid] = {};
  allTimeLogs[hid][iso] = n;
  var inShownMonth = iso.indexOf(currentYear+'-'+String(currentMonth).padStart(2,'0')) === 0;
  if (inShownMonth) {
    if (!logsLookup[hid]) logsLookup[hid] = {};
    logsLookup[hid][iso] = n;
    renderGrid();      // keep the monthly checkboxes in sync
    refreshCharts();   // also redraws the Today box
  } else {
    renderToday();
    renderXpStats();
  }
}

async function onTodayClick(h, required, iso) {
  var hid = String(h.id);
  var cur = (allTimeLogs[hid] && allTimeLogs[hid][iso]) || 0;
  var next = required === 1 ? (cur >= 1 ? 0 : 1) : (cur >= required ? 0 : cur + 1);
  setLocalLog(hid, iso, next);
  vicHabit(h.id, iso, cur, next);
  var res = await sb.from('habit_logs').upsert(
    { habit_id: h.id, log_date: iso, times_completed: next },
    { onConflict: 'habit_id,log_date' }
  );
  if (res.error) {
    setLocalLog(hid, iso, cur);
    alert('Could not save that check: ' + res.error.message);
  }
}

// If the page stays open past midnight, switch the box to the new day.
setInterval(function() { if (currentUser) renderToday(); }, 60000);


// ============================================
// XP MODE (piece 1: toggle + easy / medium / hard ranks)
// ============================================
var XP_VALUES = { easy: 5, medium: 10, hard: 15 };
var XP_ORDER  = ['easy', 'medium', 'hard'];
var XP_LETTER = { easy: 'E', medium: 'M', hard: 'H' };
var xpMode = false;
try { xpMode = localStorage.getItem('habitTrackerXpMode') === '1'; } catch (e) {}
(function () {
  var cb = document.getElementById('xp-mode-toggle');
  if (cb) cb.checked = xpMode;
})();

function toggleXpMode(on) {
  xpMode = on;
  try { localStorage.setItem('habitTrackerXpMode', on ? '1' : '0'); } catch (e) {}
  savePref({ xp_mode: on });   // also saved to your account, so every device and browser gets it
  if (!currentUser) return;
  renderGrid();
  renderWeeklyTasks();
  renderXpRankPanel();
  renderChests();   // chests show their XP only in XP Mode
}

// Easy -> Medium -> Hard -> Easy ... (an unranked item starts at Easy)
function nextDifficulty(d) {
  return XP_ORDER[(XP_ORDER.indexOf(d) + 1) % 3];
}

function paintXpTag(el, d) {
  el.dataset.d = d || '';
  el.className = 'xp-tag ' + (d ? 'xp-' + d : 'xp-unranked');
  el.textContent = XP_LETTER[d] || '?';
  el.title = d
    ? d.charAt(0).toUpperCase() + d.slice(1) + ' · ' + XP_VALUES[d] + ' XP (click to change)'
    : 'Not ranked yet (click to rank)';
}

// The small E / M / H / ? square. Clicking it moves to the next rank and calls onPick(newRank).
function makeXpTag(d, onPick) {
  var el = document.createElement('span');
  paintXpTag(el, d);
  el.addEventListener('click', function (e) {
    e.stopPropagation();
    var nd = nextDifficulty(el.dataset.d || null);
    paintXpTag(el, nd);
    onPick(nd);
  });
  return el;
}

async function setHabitDifficulty(habitId, d) {
  RAW_HABITS.forEach(function (h) { if (h.id === habitId) h.difficulty = d; });
  habits.forEach(function (h) { if (h.id === habitId) h.difficulty = d; });
  renderXpRankPanel();
  var res = await sb.from('habits').update({ difficulty: d }).eq('id', habitId);
  if (res.error) alert('Could not save that rank: ' + res.error.message);
}

function setTaskDifficulty(weekIdx, taskIdx, d) {
  if (!weeklyTaskData[weekIdx].tasks[taskIdx]) weeklyTaskData[weekIdx].tasks[taskIdx] = { t: '', c: false, pinned: false, id: null };
  var t = weeklyTaskData[weekIdx].tasks[taskIdx];
  t.d = d;
  renderXpRankPanel();
  saveWeeklyTask(weekIdx, taskIdx, t.t || '', t.c || false, t.pinned || false);
}

// The "Rank your tasks" box: lists everything that has no rank yet, hides itself when nothing is left.
function renderXpRankPanel() {
  renderXpStats();   // ranks change XP, so refresh the stats boxes too
  var row = document.getElementById('xp-rank-row');
  var body = document.getElementById('xp-rank-body');
  if (!row || !body) return;

  var pendingHabits = [], pendingTasks = [];
  if (xpMode) {
    RAW_HABITS.forEach(function (h) {
      if (!h.difficulty) pendingHabits.push({ habitId: h.id, label: (h.icon || '✅') + ' ' + h.name });
    });
    weeklyTaskData.slice(0, getWeekCount()).forEach(function (wd, w) {
      for (var i = 0; i < 10; i++) {
        var t = wd.tasks[i];
        if (t && t.t && t.t.trim() && !t.d) pendingTasks.push({ w: w, i: i, label: t.t.trim(), sub: wd.week });
      }
    });
  }

  body.innerHTML = '';
  if (pendingHabits.length + pendingTasks.length === 0) { row.style.display = 'none'; return; }
  row.style.display = '';

  var note = document.createElement('p');
  note.className = 'xp-rank-note';
  note.textContent = 'Pick how hard each one is: Easy = 5 XP, Medium = 10 XP, Hard = 15 XP.';
  body.appendChild(note);

  function addGroup(title, items, onPick) {
    if (!items.length) return;
    var h = document.createElement('p');
    h.className = 'xp-rank-group';
    h.textContent = title;
    body.appendChild(h);
    var list = document.createElement('div');
    list.className = 'xp-rank-list';
    items.forEach(function (it) {
      var r = document.createElement('div');
      r.className = 'xp-rank-item';
      var name = document.createElement('span');
      name.className = 'xp-rank-name';
      name.textContent = it.label + (it.sub ? ' · ' + it.sub : '');
      r.appendChild(name);
      XP_ORDER.forEach(function (d) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'xp-rank-btn';
        b.textContent = (d === 'medium' ? 'Med' : d.charAt(0).toUpperCase() + d.slice(1)) + ' ' + XP_VALUES[d];
        b.addEventListener('click', function () {
          onPick(it, d);
          renderGrid();          // refresh the little tags next to the names
          renderWeeklyTasks();
        });
        r.appendChild(b);
      });
      list.appendChild(r);
    });
    body.appendChild(list);
  }
  addGroup('Daily habits', pendingHabits, function (it, d) { setHabitDifficulty(it.habitId, d); });
  addGroup('Weekly tasks', pendingTasks, function (it, d) { setTaskDifficulty(it.w, it.i, d); });
}


// ============================================
// XP MODE (piece 2: XP, levels, stats, quests, streak)
// XP is never stored as a running total. It is worked out from what is checked,
// so unchecking something automatically takes its XP back.
// ============================================
var XP_PER_LEVEL = 100;
var taskXpOtherMonths = 0;
var lastXpLevel = null;
var xpNoteTimer = null;

// XP from weekly tasks that were checked in months other than the one on screen.
// (The month on screen is counted live from weeklyTaskData.)
async function loadTaskXpOtherMonths() {
  taskXpOtherMonths = 0;
  if (!currentUser) return;
  var res = await sb.from('weekly_tasks')
    .select('task_text,is_checked,difficulty,month,year')
    .eq('user_id', currentUser.id).eq('is_checked', true).not('difficulty', 'is', null);
  if (res.error || !res.data) return;
  res.data.forEach(function (row) {
    if (row.month === currentMonth && row.year === currentYear) return;
    if (!row.task_text || !row.task_text.trim()) return;
    taskXpOtherMonths += XP_VALUES[row.difficulty] || 0;
  });
}

// Total XP, XP per habit category, and XP from weekly tasks.
function computeXp() {
  var total = 0, byCat = {};
  allHabits().forEach(function (h) {   // archived habits keep earning XP when you log them
    var cat = h.category || 'General';
    if (byCat[cat] === undefined) byCat[cat] = 0;
    var cb = comebackDates(String(h.id)).length * COMEBACK_XP;   // +20 XP each time you revive a habit after 30+ days
    total += cb; byCat[cat] += cb;
    var per = XP_VALUES[h.difficulty] || 0;
    if (!per) return;
    var hid = String(h.id), logs = allTimeLogs[hid] || {}, times = 0;
    Object.keys(logs).forEach(function (iso) {
      var n = logs[iso] || 0;
      if (n <= 0) return;
      var p = iso.split('-');
      var dow = (new Date(+p[0], +p[1] - 1, +p[2]).getDay() + 6) % 7;
      var s = schedDays(habitAt(h, iso))[dow];
      var cap = (s && s.required > 0) ? s.required : 1;   // extra ticks beyond the goal earn no XP
      times += Math.min(n, cap);
    });
    var xp = times * per;
    total += xp;
    byCat[cat] += xp;
  });
  var shown = 0;
  weeklyTaskData.forEach(function (wd) {
    wd.tasks.forEach(function (t) {
      if (t && t.c && t.d && t.t && t.t.trim()) shown += XP_VALUES[t.d] || 0;
    });
  });
  var tasksXp = taskXpOtherMonths + shown;
  var chestXp = chestEarned().reduce(function (a, c) { return a + CHESTS[c.type].xp; }, 0);   // treasure chests
  if (chestXp) byCat['Treasure chests'] = chestXp;
  return { total: total + tasksXp + chestXp, byCat: byCat, tasksXp: tasksXp };
}

// How many times a habit is required on a given date (0 = not required that day).
// Same rules as the monthly grid and Today's box.
function habitRequiredOn(h, y, m, d) {
  var iso = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  var r = schedReq(habitAt(h, iso), y, m, d);
  if (r.kind === 'monthly' || (r.kind === 'days' && r.flexible)) return 0;
  return r.req;
}

// Days in a row where every required habit was done. Days with nothing required are skipped.
// Today does not break the streak while it is still unfinished.
function computeStreak() {
  var day = new Date();
  day.setHours(0, 0, 0, 0);
  var streak = 0;
  for (var i = 0; i < 400; i++) {
    var y = day.getFullYear(), m = day.getMonth() + 1, d = day.getDate(), iso = localISO(day);
    var need = 0, allMet = true;
    for (var k = 0; k < RAW_HABITS.length; k++) {
      var h = RAW_HABITS[k];
      var created = h.created_at ? localISO(new Date(h.created_at)) : '';
      if (created && iso < created) continue;
      var r = habitRequiredOn(h, y, m, d);
      if (!r) continue;
      if (isHardOptional(h)) continue;
      need++;
      var n = (allTimeLogs[String(h.id)] && allTimeLogs[String(h.id)][iso]) || 0;
      if (n < r) allMet = false;
    }
    if (need > 0) {
      if (allMet) streak++;
      else if (i > 0) break;
    }
    day.setDate(day.getDate() - 1);
  }
  return streak;
}

function renderXpStats() {
  renderPaceChart();   // pace chart shows only when XP Mode is off
  var sides = document.querySelectorAll('.xp-side');
  if (!sides.length) return;
  for (var si = 0; si < sides.length; si++) sides[si].style.display = xpMode ? '' : 'none';
  if (!xpMode) return;

  var xp = computeXp();
  var level = Math.floor(xp.total / XP_PER_LEVEL) + 1;
  var into = xp.total % XP_PER_LEVEL;
  document.getElementById('xp-level').textContent = level;
  document.getElementById('xp-total').textContent = xp.total;
  document.getElementById('xp-next').textContent = XP_PER_LEVEL - into;
  document.getElementById('xp-progress-num').textContent = into + ' / ' + XP_PER_LEVEL;
  document.getElementById('xp-bar-fill').style.width = into + '%';

  var note = document.getElementById('xp-note');
  if (lastXpLevel !== null && level > lastXpLevel) {
    note.textContent = 'Level up! You reached level ' + level + '.';
    clearTimeout(xpNoteTimer);
    xpNoteTimer = setTimeout(function () { note.textContent = ''; }, 4000);
  } else if (lastXpLevel !== null && level < lastXpLevel) {
    note.textContent = '';
  }
  lastXpLevel = level;

  // Stats: XP per habit category, plus weekly tasks. Shows the five biggest.
  var entries = Object.keys(xp.byCat).map(function (c) { return { name: c, xp: xp.byCat[c] }; });
  entries.push({ name: 'Weekly tasks', xp: xp.tasksXp });
  entries.sort(function (a, b) { return b.xp - a.xp || a.name.localeCompare(b.name); });
  entries = entries.slice(0, 5);
  var maxXp = Math.max(20, entries.reduce(function (m, e) { return Math.max(m, e.xp); }, 0));
  var list = document.getElementById('xp-stats-list');
  list.innerHTML = '';
  entries.forEach(function (e) {
    var r = document.createElement('div');
    r.className = 'xp-stat-row';
    var nm = document.createElement('span');
    nm.className = 'xp-stat-name';
    nm.textContent = e.name;
    var val = document.createElement('span');
    val.className = 'xp-stat-val';
    val.textContent = e.xp + ' XP';
    var bar = document.createElement('div');
    bar.className = 'xp-stat-bar';
    var fill = document.createElement('div');
    fill.className = 'today-bar-fill';
    fill.style.width = Math.round((e.xp / maxXp) * 100) + '%';
    bar.appendChild(fill);
    r.appendChild(nm); r.appendChild(val); r.appendChild(bar);
    list.appendChild(r);
  });

  // Quests done = habits finished today (optional ones count only while they are shown).
  var now = new Date(), iso = localISO(now), done = 0, total = 0;
  RAW_HABITS.forEach(function (h) {
    var req = getTodayRequirement(h, now);
    var r = req || (showOptionalToday ? getTodayOptional(h, now) : null);
    if (!r) return;
    var n = (allTimeLogs[String(h.id)] && allTimeLogs[String(h.id)][iso]) || 0;
    if (isHardOptional(h) && n < r.required) return;
    total++;
    if (n >= r.required) done++;
  });
  document.getElementById('xp-quests').textContent = done;
  document.getElementById('xp-quests-of').textContent = 'of ' + total + ' today';
  document.getElementById('xp-streak').textContent = computeStreak();
}


// ============================================
// MASTER RENDER
// ============================================
function renderEverything() {
  buildWeekColors(); buildHabits();
  if(lineChartInstance)lineChartInstance.destroy();
  if(barChartInstance)barChartInstance.destroy();
  if(catChartInstance)catChartInstance.destroy();
  if(plannedActualChartInstance)plannedActualChartInstance.destroy();
  if(allTimeScatterInstance)allTimeScatterInstance.destroy();
  if(actualVsIntendedInstance)actualVsIntendedInstance.destroy();
  renderTopHabits(); renderDonuts(); renderCharts(); renderCorrelations(); renderGrid();
  renderMonthProgress(); renderToday(); renderWeeklyTasks(); renderPlannedActualChart(); renderAllTimeSection();
  renderXpRankPanel();
}

// ============ UPDATE SYSTEM ============
var appVersion='2.0';
function checkForUpdate() {
  showMsg('update-msg','Checking for updates...','info');
  setTimeout(function(){
    var currentStored=localStorage.getItem('appVersion')||'1.0';
    if(appVersion>currentStored){
      var confirmed=confirm('Update available!\n\nCurrent: v'+currentStored+'\nNew: v'+appVersion+'\n\nUpdate now?');
      if(confirmed){
        localStorage.setItem('appVersion',appVersion);
        showMsg('update-msg','✅ Updating to v'+appVersion+'...','success');
        setTimeout(function(){location.reload();},800);
      } else {
        showMsg('update-msg','Update cancelled.','info');
      }
    } else {
      showMsg('update-msg','✅ Already on latest version (v'+appVersion+')','success');
    }
  },800);
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

// ============================================
// TERMS AND CONDITIONS MODAL
// ============================================
document.getElementById('terms-link').addEventListener('click', function(e){
  e.preventDefault();
  document.getElementById('terms-modal').style.display = 'block';
});

document.getElementById('terms-close').addEventListener('click', function(){
  document.getElementById('terms-modal').style.display = 'none';
});

document.getElementById('terms-modal').addEventListener('click', function(e){
  if(e.target.id === 'terms-modal') 
    this.style.display = 'none';
});

// Bars under the week donuts: actual completed / possible, per week.
function renderWeekBars(pcts) {
  var el = document.getElementById('week-bars'); if (!el) return;
  el.innerHTML = '';
  el.style.gridTemplateColumns = 'repeat(' + pcts.length + ', minmax(0,1fr))';
  pcts.forEach(function (pct, w) {
    var color = weekColors[w] || '#ccc';
    var h = Math.max(2, Math.round(Math.min(pct, 100) / 100 * 90));
    var item = document.createElement('div'); item.className = 'week-bar-item';
    item.innerHTML = '<div class="week-bar-track"><div class="week-bar-pct">' + pct + '%</div>' +
      '<div class="week-bar-fill" style="height:' + h + 'px;background:' + color + ';"></div></div>' +
      '<div class="week-bar-label">Wk ' + (w + 1) + '</div>';
    el.appendChild(item);
  });
}

// ============================================
// DEBUG THEME CYCLER
// ============================================
// const debugOverrides = [
//   { selector: '.habit-del-btn', name: 'habit-del-btn' },
//   { selector: '.habit-list-row', name: 'habit-list-row' },
//   { selector: '.settings-panel', name: 'settings-panel' },
//   { selector: '.settings-section', name: 'settings-section' },
//   { selector: '.cell-body', name: 'cell-body' },
//   { selector: '.cell-border', name: 'cell-border' },
//   { selector: '.correlation-card', name: 'correlation-card' },
//   { selector: '.day-box', name: 'day-box' },
//   { selector: '.grid-cell', name: 'grid-cell' },
//   { selector: '.checkbox-grid', name: 'checkbox-grid' },
//   { selector: '#grid-table td', name: 'grid-table td' },
//   { selector: '.progress-cell', name: 'progress-cell' },
//   { selector: '.progress-track', name: 'progress-track' },
//   { selector: '.chart-container', name: 'chart-container' },
//   { selector: 'canvas', name: 'canvas' },
//   { selector: '.settings-label', name: 'settings-label' },
//   { selector: '.field-group label', name: 'field-group label' },
//   { selector: '.title-bar', name: 'title-bar' },
//   { selector: '.settings-section .cell-subtitle', name: 'cell-subtitle' },
//   { selector: '.checkbox-grid th', name: 'checkbox-grid th' }
// ];

// let debugCyclerState = {
//   currentIndex: 0,
//   isRunning: false,
//   intervalId: null,
//   styleEl: null
// };

// const MAGENTA_HIGHLIGHT = '#FF00FF';

// function initDebugCycler() {
//   debugCyclerState.styleEl = document.createElement('style');
//   debugCyclerState.styleEl.id = 'debug-cycler-style';
//   document.head.appendChild(debugCyclerState.styleEl);
  
//   const panel = document.createElement('div');
//   panel.id = 'debug-cycler-panel';
//   panel.style.cssText = `position:fixed;bottom:20px;right:20px;background:#1a1a1a;border:3px solid #FF00FF;border-radius:8px;padding:15px;z-index:99999;font-family:monospace;color:#ddd;max-width:320px;`;
  
//   panel.innerHTML = `<div style="margin-bottom:10px;font-weight:bold;font-size:12px;color:#FF00FF;">🐛 DEBUG CYCLER (Magenta Mode)</div><div id="debug-cycler-display" style="background:#222;padding:10px;border-radius:4px;margin-bottom:10px;font-size:11px;white-space:pre-wrap;word-break:break-all;border:2px solid #FF00FF;color:#FF00FF;">Ready</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:10px;"><button id="debug-back-btn" style="padding:8px;background:#333;color:#FF00FF;border:2px solid #FF00FF;cursor:pointer;font-weight:bold;font-size:11px;">← Back 1</button><button id="debug-forward-btn" style="padding:8px;background:#333;color:#FF00FF;border:2px solid #FF00FF;cursor:pointer;font-weight:bold;font-size:11px;">Forward 1 →</button></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;"><button id="debug-start-btn" style="padding:8px;background:#FF00FF;color:#000;border:none;cursor:pointer;font-weight:bold;font-size:11px;">▶ Start</button><button id="debug-stop-btn" style="padding:8px;background:#FF00FF;color:#000;border:none;cursor:pointer;font-weight:bold;font-size:11px;">⏹ Stop</button></div>`;
  
//   document.body.appendChild(panel);
  
//   document.getElementById('debug-start-btn').onclick = debugCyclerStart;
//   document.getElementById('debug-stop-btn').onclick = debugCyclerStop;
//   document.getElementById('debug-forward-btn').onclick = debugCyclerForward;
//   document.getElementById('debug-back-btn').onclick = debugCyclerBack;
  
//   if(document.body.getAttribute('data-theme') !== 'dark-romantic') {
//     document.body.setAttribute('data-theme', 'dark-romantic');
//   }
// }

// function debugCyclerUpdate() {
//   const item = debugOverrides[debugCyclerState.currentIndex];
//   const display = document.getElementById('debug-cycler-display');
//   display.textContent = `[${debugCyclerState.currentIndex + 1}/${debugOverrides.length}]\n\n${item.selector}`;
//   display.style.background = MAGENTA_HIGHLIGHT;
//   display.style.color = '#000';
//   display.style.borderColor = MAGENTA_HIGHLIGHT;
  
//   let css = 'body[data-theme="dark-romantic"] ';
//   debugOverrides.forEach((override, i) => {
//     if(i === debugCyclerState.currentIndex) {
//       css += override.selector + ' { background: ' + MAGENTA_HIGHLIGHT + ' !important; color: #000 !important; border-color: ' + MAGENTA_HIGHLIGHT + ' !important; box-shadow: 0 0 20px ' + MAGENTA_HIGHLIGHT + ' !important; }\n';
//       css += 'body[data-theme="dark-romantic"] ' + override.selector + ' * { background: inherit !important; color: inherit !important; }\n';
//     }
//   });
  
//   debugCyclerState.styleEl.textContent = css;
// }

// function debugCyclerStart() {
//   if(debugCyclerState.isRunning) return;
//   debugCyclerState.isRunning = true;
//   debugCyclerState.intervalId = setInterval(() => {
//     debugCyclerState.currentIndex = (debugCyclerState.currentIndex + 1) % debugOverrides.length;
//     debugCyclerUpdate();
//   }, 1500);
//   debugCyclerUpdate();
// }

// function debugCyclerStop() {
//   if(debugCyclerState.intervalId) {
//     clearInterval(debugCyclerState.intervalId);
//     debugCyclerState.intervalId = null;
//   }
//   debugCyclerState.isRunning = false;
//   debugCyclerUpdate();
// }

// function debugCyclerForward() {
//   debugCyclerStop();
//   debugCyclerState.currentIndex = (debugCyclerState.currentIndex + 1) % debugOverrides.length;
//   debugCyclerUpdate();
// }

// function debugCyclerBack() {
//   debugCyclerStop();
//   debugCyclerState.currentIndex = (debugCyclerState.currentIndex - 1 + debugOverrides.length) % debugOverrides.length;
//   debugCyclerUpdate();
// }

// if(document.readyState === 'loading') {
//   document.addEventListener('DOMContentLoaded', initDebugCycler);
// } else {
//   initDebugCycler();
// }


// ============================================
// XP GROWTH LINE CHART
// ============================================
var xpGrowthInstance = null;
function getXpGrowth() {
  var perDay = {};
  allHabits().forEach(function (h) {
    comebackDates(String(h.id)).forEach(function (iso) { perDay[iso] = (perDay[iso] || 0) + COMEBACK_XP; });
    var per = XP_VALUES[h.difficulty] || 0;
    if (!per) return;
    var hid = String(h.id), logs = allTimeLogs[hid] || {};
    Object.keys(logs).forEach(function (iso) {
      var n = logs[iso] || 0;
      if (n <= 0) return;
      var p = iso.split('-');
      var dow = (new Date(+p[0], +p[1] - 1, +p[2]).getDay() + 6) % 7;
      var s = schedDays(habitAt(h, iso))[dow];
      var cap = (s && s.required > 0) ? s.required : 1;
      perDay[iso] = (perDay[iso] || 0) + Math.min(n, cap) * per;
    });
  });
  var todayIso = localISO(new Date());
  chestEarned().forEach(function (c) { var d = c.iso > todayIso ? todayIso : c.iso; perDay[d] = (perDay[d] || 0) + CHESTS[c.type].xp; });   // treasure chests
  var days = Object.keys(perDay).sort();
  var labels = ['Start'], xp = [0];
  if (days.length) {
    var p0 = days[0].split('-');
    var now = new Date();
    var end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var run = 0;
    for (var d = new Date(+p0[0], +p0[1] - 1, +p0[2]); d <= end; d.setDate(d.getDate() + 1)) {
      var iso = localISO(d);
      run += perDay[iso] || 0;
      labels.push(iso); xp.push(run);
    }
  }
  var total = xp[xp.length - 1];
  var pct = xp.map(function (v) { return total > 0 ? Math.round(v / total * 100) : 0; });
  return { labels: labels, xp: xp, pct: pct, total: total };
}
function renderXpGrowth() {
  var el = document.getElementById('xpGrowthChart');
  if (!el) return;
  if (xpGrowthInstance) { xpGrowthInstance.destroy(); xpGrowthInstance = null; }
  var g = getXpGrowth();
  var axis = getThemeColor('--c-text-muted');
  var pink = getThemeColor('--c-pink');
  xpGrowthInstance = new Chart(el, {
    type: 'line',
    data: { labels: g.labels, datasets: [{
      label: 'XP growth', data: g.pct,
      borderColor: pink, backgroundColor: hexToRgba(pink, 0.2),
      fill: true, tension: 0.25, pointRadius: 0
    }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: function (c) { return g.xp[c.dataIndex] + ' XP (' + g.pct[c.dataIndex] + '%)'; } } }
      },
      scales: {
        y: { min: 0, max: 100, ticks: { color: axis, callback: function (v) { return v + '%'; } } },
        x: { ticks: { color: axis, autoSkip: true, maxRotation: 0, font: { size: 9 } } }
      }
    }
  });
}

// ============================================
// XP' (speed) AND XP" (acceleration) CHART
// ============================================
var xpDerivInstance = null;
function renderXpDerivatives() {
  var el = document.getElementById('xpDerivChart');
  if (!el) return;
  if (xpDerivInstance) { xpDerivInstance.destroy(); xpDerivInstance = null; }
  var g = getXpGrowth();
  // XP' : XP gained that day (change in running total)
  var d1 = g.xp.map(function (v, i) { return i === 0 ? null : v - g.xp[i - 1]; });
  // XP" : change in XP' from the previous day
  var d2 = d1.map(function (v, i) { return (i < 2 || v === null || d1[i - 1] === null) ? null : v - d1[i - 1]; });
  var axis = getThemeColor('--c-text-muted');
  var pink = getThemeColor('--c-pink');
  var purple = getThemeColor('--xp-accel-color') || getThemeColor('--c-purple');   // a theme can set its own XP" line color
  xpDerivInstance = new Chart(el, {
    type: 'line',
    data: { labels: g.labels, datasets: [
      { label: "XP'", data: d1, borderColor: pink, backgroundColor: hexToRgba(pink, 0.15),
        fill: false, tension: 0.25, pointRadius: 0, spanGaps: false },
      { label: 'XP"', data: d2, borderColor: purple, backgroundColor: hexToRgba(purple, 0.15),
        fill: false, tension: 0.25, pointRadius: 0, spanGaps: false, borderDash: [5, 4] }
    ] },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, labels: { color: axis, boxWidth: 14 } },
        tooltip: { callbacks: { label: function (c) {
          var v = c.parsed.y;
          return c.dataset.label + ': ' + (v === null ? '-' : (Math.round(v * 10) / 10)) + (c.dataset.label === "XP'" ? ' XP/day' : ' XP/day²');
        } } }
      },
      scales: {
        y: { ticks: { color: axis }, grid: { color: function (c) { return c.tick && c.tick.value === 0 ? axis : 'rgba(128,128,128,0.15)'; } } },
        x: { ticks: { color: axis, autoSkip: true, maxRotation: 0, font: { size: 9 } } }
      }
    }
  });
}


// Year-to-date totals for the Summary ring: every day from Jan 1 to today.
function getYearProgress() {
  var now = new Date(), done = 0, goal = 0;
  var end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (var d = new Date(now.getFullYear(), 0, 1); d <= end; d.setDate(d.getDate() + 1)) {
    var iso = localISO(d), dow = (d.getDay() + 6) % 7;
    RAW_HABITS.forEach(function (h) {
      if (h.id === -1) return;
      var hid = String(h.id);
      var rq = schedReq(habitAt(h, iso), d.getFullYear(), d.getMonth() + 1, d.getDate());
      var req = rq.kind === 'monthly' ? 0 : rq.req;
      if (req > 0) {
        var n = (allTimeLogs[hid] && allTimeLogs[hid][iso]) || 0;
        if (isHardOptional(h)) { var got = Math.min(n, req); goal += got; done += got; }
        else { goal += req; done += n; }
      } else if (extraCreditEnabled && rq.kind !== 'monthly') {
        done += (allTimeLogs[hid] && allTimeLogs[hid][iso]) || 0;   // Extra credit: done on a day it wasn't due
      }
    });
    if (extraCreditEnabled) ARCHIVED_HABITS.forEach(function (h) { done += (allTimeLogs[String(h.id)] && allTimeLogs[String(h.id)][iso]) || 0; });   // Extra credit: archived habits
  }
  return { done: done, goal: goal };
}

// ============================================
// HARD HABITS OPTIONAL (Month progress box)
// When on, a missed hard habit doesn't count against you.
// Done hard habits still count as done.
// ============================================
var hardOptional = false;
try { hardOptional = localStorage.getItem('habitTrackerHardOptional') === '1'; } catch (e) {}
(function () {
  var cb = document.getElementById('hard-optional-toggle');
  if (cb) cb.checked = hardOptional;
})();
function isHardOptional(h) { return hardOptional && h.difficulty === 'hard'; }
function toggleHardOptional(on) {
  hardOptional = on;
  try { localStorage.setItem('habitTrackerHardOptional', on ? '1' : '0'); } catch (e) {}
  savePref({ hard_optional: on });
  if (currentUser) { renderDonuts(); renderMonthProgress(); renderXpStats(); }
}


// How many times a habit is due on day d of the month on screen.
// "Every X days" habits count on the days they come due; "specific days" habits use their schedule.
// "X times per month" habits have no set day, so they return 0.
function dayRequirement(h, d) {
  var iso = currentYear + '-' + String(currentMonth).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  return schedReq(habitAt(h, iso), currentYear, currentMonth, d).req;
}

// ============================================
// CHECKLIST TABS (All / Easy / Medium / Hard / Unranked)
// ============================================
var gridFilter = 'all';
try { gridFilter = localStorage.getItem('habitTrackerGridFilter') || 'all'; } catch (e) {}
function gridFilterMatch(h) {
  if (gridFilter === 'all') return true;
  if (gridFilter === 'none') return !h.difficulty;
  return h.difficulty === gridFilter;
}
function renderGridTabs() {
  var el = document.getElementById('grid-tabs'); if (!el) return;
  var real = habits.filter(function (h) { return h.id !== -1; });
  var count = { all: real.length, easy: 0, medium: 0, hard: 0, none: 0 };
  real.forEach(function (h) { count[h.difficulty || 'none'] = (count[h.difficulty || 'none'] || 0) + 1; });
  var tabs = [['all', 'All'], ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['none', 'Unranked']];
  el.innerHTML = '';
  tabs.forEach(function (t) {
    if (t[0] === 'none' && !count.none && gridFilter !== 'none') return;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'grid-tab' + (gridFilter === t[0] ? ' on' : '');
    b.innerHTML = t[1] + '<span class="grid-tab-n">' + (count[t[0]] || 0) + '</span>';
    b.addEventListener('click', function () {
      gridFilter = t[0];
      try { localStorage.setItem('habitTrackerGridFilter', gridFilter); } catch (e) {}
      renderGrid();
    });
    el.appendChild(b);
  });
}

// ============================================
// SLEEP TRACKER (saved in the Supabase "sleep_logs" table)
// ============================================
var SLEEP_QUALITY = ['Awful', 'Poor', 'Okay', 'Good', 'Great'];
var sleepLogs = [];
var sleepQuality = -1;
var sleepGoal = 8;
var sleepGoalTimer = null;

function toggleSleepPage() {
  var page = document.getElementById('sleep-page');
  var opening = page.style.display !== 'block';
  page.style.display = opening ? 'block' : 'none';
  if (!opening) return;
  ['history-page', 'mood-page', 'money-page', 'shop-page', 'memory-page', 'every-page'].forEach(function (id) { var el = document.getElementById(id); if (el) el.style.display = 'none'; });
  var meta = currentUser && currentUser.user_metadata;
  sleepGoal = (meta && meta.sleep_goal) ? Number(meta.sleep_goal) : 8;
  document.getElementById('sleep-goal').value = sleepGoal;
  var y = new Date(); y.setDate(y.getDate() - 1);
  document.getElementById('sleep-date').value = localISO(y);
  renderSleepQuality();
  loadSleepLogs().then(renderSleep);
}

async function loadSleepLogs() {
  if (!currentUser) return;
  var res = await sb.from('sleep_logs').select('*').eq('user_id', currentUser.id).order('log_date', { ascending: false });
  if (res.error) { sleepLogs = []; setSleepMsg('Could not load sleep logs: ' + res.error.message, 'error'); return; }
  sleepLogs = res.data || [];
}

function setSleepMsg(text, type) {
  var el = document.getElementById('sleep-msg');
  el.textContent = text;
  el.className = 'sleep-msg ' + (type || '');
}

function renderSleepQuality() {
  var el = document.getElementById('sleep-quality');
  el.innerHTML = '';
  SLEEP_QUALITY.forEach(function (label, i) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'sleep-q-btn' + (sleepQuality === i ? ' on' : '');
    b.textContent = label;
    b.addEventListener('click', function () { sleepQuality = i; setSleepMsg('', ''); renderSleepQuality(); });
    el.appendChild(b);
  });
}

// Hours between bed and wake time, rounded to the nearest quarter hour. Handles going to bed after midnight.
function sleepHours(bed, wake) {
  var b = bed.split(':').map(Number), w = wake.split(':').map(Number);
  var mins = (w[0] * 60 + w[1]) - (b[0] * 60 + b[1]);
  if (mins <= 0) mins += 1440;
  return Math.round(mins / 15) / 4;
}

function sleepDateLabel(iso) {
  var p = iso.split('-');
  return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function renderSleep() {
  renderSleepTags();
  renderSleepTrend();
  var last = sleepLogs.slice(0, 7);
  var avg = last.length ? last.reduce(function (a, n) { return a + Number(n.hours); }, 0) / last.length : 0;
  var hit = last.length ? Math.round(last.filter(function (n) { return Number(n.hours) >= sleepGoal; }).length / last.length * 100) : 0;
  document.getElementById('sleep-avg').textContent = avg.toFixed(1) + 'h';
  document.getElementById('sleep-hit').textContent = hit + '%';

  var el = document.getElementById('sleep-history');
  el.innerHTML = '';
  if (!sleepLogs.length) {
    var empty = document.createElement('p');
    empty.className = 'sleep-empty';
    empty.textContent = 'No nights logged yet.';
    el.appendChild(empty);
    return;
  }
  sleepLogs.slice(0, 14).forEach(function (n) {
    var h = Number(n.hours);
    var row = document.createElement('div');
    row.className = 'sleep-night';
    var date = document.createElement('span');
    date.textContent = sleepDateLabel(n.log_date);
    var bar = document.createElement('div');
    bar.className = 'sleep-bar';
    var fill = document.createElement('i');
    fill.className = h >= sleepGoal ? 'met' : 'under';
    fill.style.width = Math.min(100, h / 12 * 100) + '%';
    bar.appendChild(fill);
    var hrs = document.createElement('span');
    hrs.className = 'sleep-hours';
    hrs.textContent = h + 'h';
    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'sleep-del';
    del.textContent = 'x';
    del.title = 'Delete this night';
    del.addEventListener('click', function () { deleteSleepLog(n.id); });
    var meta = document.createElement('span');
    meta.className = 'sleep-meta';
    var tags = [n.took_meds ? 'meds' : '', n.screen_before_bed ? 'screen' : '', n.caffeine_late ? 'caffeine' : ''].concat(Array.isArray(n.tags) ? n.tags : []).filter(Boolean).join(', ');
    meta.textContent = (SLEEP_QUALITY[n.quality] || '') + ' · ' + String(n.bed_time).slice(0, 5) + '–' + String(n.wake_time).slice(0, 5) + (tags ? ' · ' + tags : '') + (n.notes ? ' · ' + n.notes : '');
    row.appendChild(date); row.appendChild(bar); row.appendChild(hrs); row.appendChild(del); row.appendChild(meta);
    el.appendChild(row);
  });
  var legend = document.createElement('div');
  legend.className = 'sleep-legend';
  legend.innerHTML = '<span><i style="background:var(--c-purple)"></i>met goal</span><span><i style="background:var(--c-pink)"></i>under goal</span>';
  el.appendChild(legend);
}

async function submitSleepLog() {
  var date = document.getElementById('sleep-date').value;
  var bed = document.getElementById('sleep-bed').value;
  var wake = document.getElementById('sleep-wake').value;
  if (!date) return setSleepMsg('Pick which night this is for.', 'error');
  if (!bed || !wake) return setSleepMsg('Enter both bed time and wake time.', 'error');
  if (sleepQuality < 0) return setSleepMsg('Pick how you slept first.', 'error');
  var row = {
    user_id: currentUser.id,
    log_date: date,
    bed_time: bed,
    wake_time: wake,
    hours: sleepHours(bed, wake),
    quality: sleepQuality,
    notes: document.getElementById('sleep-notes').value.trim() || null,
    took_meds: document.getElementById('sleep-meds').checked,
    screen_before_bed: document.getElementById('sleep-screen').checked,
    caffeine_late: document.getElementById('sleep-caffeine').checked
  };
  row.tags = sleepPickedTags();   // your own tags that are ticked (needs the "tags" column, see SQL)
  setSleepMsg('Saving...', 'ok');
  var res = await sb.from('sleep_logs').upsert(row, { onConflict: 'user_id,log_date' });
  if (res.error && /tags/i.test(res.error.message)) {
    // The "tags" column hasn't been added in Supabase yet: save everything else so nothing is lost.
    delete row.tags;
    res = await sb.from('sleep_logs').upsert(row, { onConflict: 'user_id,log_date' });
    if (!res.error) setTimeout(function () { setSleepMsg('Saved, but your own tags need the new "tags" column in Supabase (run the SQL).', 'error'); }, 0);
  }
  if (res.error) return setSleepMsg('Could not save: ' + res.error.message, 'error');
  sleepQuality = -1;
  document.getElementById('sleep-notes').value = '';
  ['sleep-meds', 'sleep-screen', 'sleep-caffeine'].forEach(function (id) { document.getElementById(id).checked = false; });
  document.querySelectorAll('#sleep-custom-tags input').forEach(function (c) { c.checked = false; });
  renderSleepQuality();
  await loadSleepLogs();
  renderSleep();
  setSleepMsg('Saved ' + row.hours + 'h for ' + sleepDateLabel(date) + '.', 'ok');
  victory('pop', 'Sleep logged 🌙');
}

async function deleteSleepLog(id) {
  if (!confirm('Delete this night?')) return;
  var res = await sb.from('sleep_logs').delete().eq('id', id);
  if (res.error) return setSleepMsg('Could not delete: ' + res.error.message, 'error');
  await loadSleepLogs();
  renderSleep();
}

// The goal is saved to your account, like your theme, so it follows you to other devices.
function onSleepGoalChange(val) {
  var g = parseFloat(val);
  if (!(g > 0)) return;
  sleepGoal = g;
  renderSleep();
  clearTimeout(sleepGoalTimer);
  sleepGoalTimer = setTimeout(function () {
    sb.auth.updateUser({ data: { sleep_goal: g } }).then(function (r) {
      if (r && r.data && r.data.user) currentUser = r.data.user;
    });
  }, 800);
}


// ---- Your own sleep tags (the list is saved to your account as "sleep_tags"; each night saves the ticked ones) ----
function sleepTagList() { var m = currentUser && currentUser.user_metadata; return (m && Array.isArray(m.sleep_tags)) ? m.sleep_tags : []; }
function sleepPickedTags() { return Array.prototype.map.call(document.querySelectorAll('#sleep-custom-tags input:checked'), function (c) { return c.value; }); }

function renderSleepTags() {
  var box = document.getElementById('sleep-custom-tags'); if (!box) return;
  var picked = sleepPickedTags(), h = '';
  sleepTagList().forEach(function (t) {
    h += '<label class="sleep-tag"><input type="checkbox" value="' + moneyEsc(t) + '"' + (picked.indexOf(t) > -1 ? ' checked' : '') + '> ' + moneyEsc(t) +
      '<button type="button" class="sleep-tag-x" data-sleep-untag="' + moneyEsc(t) + '" title="Remove this tag from your list">×</button></label>';
  });
  box.innerHTML = h;
  box.querySelectorAll('[data-sleep-untag]').forEach(function (b) { b.onclick = function (e) { e.preventDefault(); removeSleepTag(b.getAttribute('data-sleep-untag')); }; });
}

async function saveSleepTags(list) {
  currentUser.user_metadata = currentUser.user_metadata || {}; currentUser.user_metadata.sleep_tags = list;
  var r = await sb.auth.updateUser({ data: { sleep_tags: list } });
  if (r && r.data && r.data.user) currentUser = r.data.user;
}

async function addSleepTag() {
  var inp = document.getElementById('sleep-newtag'), t = inp.value.trim();
  if (!t) return;
  var builtIn = ['took sleep meds/melatonin', 'screen before bed', 'caffeine after 3pm'];
  if (builtIn.indexOf(t.toLowerCase()) > -1 || sleepTagList().some(function (x) { return x.toLowerCase() === t.toLowerCase(); })) return setSleepMsg('You already have that one.', 'error');
  var picked = sleepPickedTags();
  await saveSleepTags(sleepTagList().concat([t]));
  inp.value = '';
  renderSleepTags();
  picked.concat([t]).forEach(function (x) { var c = document.querySelector('#sleep-custom-tags input[value="' + x.replace(/"/g, '\\"') + '"]'); if (c) c.checked = true; });
  setSleepMsg('Added "' + t + '".', 'ok');
}

async function removeSleepTag(t) {
  await saveSleepTags(sleepTagList().filter(function (x) { return x !== t; }));
  renderSleepTags();
  setSleepMsg('Removed "' + t + '" from your list (old nights keep it).', 'ok');
}

// ---- Sleep trend chart: a bar for each night's hours, a line connecting them, and a dashed goal line ----
var sleepTrendDays = 14, sleepTrendChart = null;

function renderSleepTrend() {
  var canvas = document.getElementById('sleepTrendChart'); if (!canvas || typeof Chart === 'undefined') return;
  var rangeBox = document.getElementById('sleep-range');
  rangeBox.innerHTML = '';
  [[7, 'Last 7 nights'], [14, '2 weeks'], [30, '30 nights']].forEach(function (r) {
    var b = document.createElement('button'); b.type = 'button';
    b.className = 'sleep-q-btn' + (sleepTrendDays === r[0] ? ' on' : ''); b.textContent = r[1];
    b.onclick = function () { sleepTrendDays = r[0]; renderSleepTrend(); };
    rangeBox.appendChild(b);
  });
  // Calendar nights ending at your latest logged night (or last night), so skipped nights show as gaps.
  var byDate = {}; sleepLogs.forEach(function (n) { byDate[n.log_date] = Number(n.hours); });
  var end = new Date(); end.setDate(end.getDate() - 1);
  if (sleepLogs.length) { var p = sleepLogs[0].log_date.split('-'), last = new Date(+p[0], +p[1] - 1, +p[2]); if (last > end) end = last; }
  var labels = [], hours = [];
  for (var i = sleepTrendDays - 1; i >= 0; i--) {
    var d = new Date(end); d.setDate(d.getDate() - i);
    var iso = localISO(d);
    labels.push(sleepDateLabel(iso));
    hours.push(byDate[iso] !== undefined ? byDate[iso] : null);
  }
  // Use the exact same colors as the Recent nights bars (some themes override those).
  function barColor(cls, fallback) {
    var bar = document.createElement('div'); bar.className = 'sleep-bar'; bar.style.cssText = 'position:absolute;visibility:hidden;';
    var i = document.createElement('i'); i.className = cls; bar.appendChild(i); document.getElementById('sleep-page').appendChild(bar);
    var c = getComputedStyle(i).backgroundColor; bar.remove();
    return (c && c !== 'rgba(0, 0, 0, 0)') ? c : fallback;
  }
  var met = barColor('met', getThemeColor('--c-purple') || '#8C5FD9'), under = barColor('under', getThemeColor('--c-pink') || '#FF5FA2');
  var ink = getThemeColor('--c-text') || '#333', muted = getThemeColor('--c-text-muted') || '#888';
  if (sleepTrendChart) sleepTrendChart.destroy();
  sleepTrendChart = new Chart(canvas, {
    data: { labels: labels, datasets: [
      { type: 'line', label: 'Trend', data: hours, borderColor: ink, backgroundColor: ink, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, tension: 0.3, spanGaps: true, order: 1 },
      { type: 'line', label: 'Goal', data: labels.map(function () { return sleepGoal; }), borderColor: muted, borderWidth: 1.5, borderDash: [6, 4], pointRadius: 0, fill: false, order: 2 },
      { type: 'bar', label: 'Hours slept', data: hours, backgroundColor: hours.map(function (h) { return h !== null && h >= sleepGoal ? met : under; }), borderRadius: 3, maxBarThickness: 34, order: 3 }
    ] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: true, position: 'top', labels: { color: ink, boxWidth: 12, font: { size: 11 } } },
        tooltip: { callbacks: { label: function (c) { return c.raw === null ? 'Not logged' : c.dataset.label + ': ' + c.raw + 'h'; } } } },
      scales: {
        x: { ticks: { color: muted, font: { size: 10 }, autoSkip: true, maxRotation: 0 }, grid: { display: false } },
        y: { beginAtZero: true, suggestedMax: Math.max(10, sleepGoal + 2), ticks: { color: muted, font: { size: 10 }, stepSize: 2 }, title: { display: true, text: 'hours', color: muted, font: { size: 10 } } }
      } }
  });
  var logged = hours.filter(function (h) { return h !== null; });
  var note = document.getElementById('sleep-trend-note');
  if (!logged.length) { note.textContent = 'Log a few nights to see your trend.'; return; }
  var avg = logged.reduce(function (a, b) { return a + b; }, 0) / logged.length, half = Math.floor(logged.length / 2), dir = '';
  if (logged.length >= 4) {
    var a1 = logged.slice(0, half).reduce(function (a, b) { return a + b; }, 0) / half, a2 = logged.slice(half).reduce(function (a, b) { return a + b; }, 0) / (logged.length - half);
    dir = a2 - a1 > 0.25 ? ' Trending up ↑' : (a1 - a2 > 0.25 ? ' Trending down ↓' : ' Holding steady →');
  }
  note.textContent = logged.length + ' of ' + sleepTrendDays + ' nights logged · average ' + avg.toFixed(1) + 'h · bar colors match Recent nights (met your ' + sleepGoal + 'h goal vs under).' + dir;
}

// ============================================
// MOOD TRACKER (saved in the Supabase "mood_logs" table)
// Colors: each mood uses the theme's bar-graph colors (the "Daily habit count" chart),
// skipping any color too close to the empty-day color. A theme can set its own with
// --mood-1 ... --mood-5 in its theme block (1 = Rad ... 5 = Awful).
// ============================================
var MOOD_NAMES = ['Rad', 'Good', 'Meh', 'Low', 'Awful'];
var MOOD_STYLES = [['pixels', 'Pixels'], ['wheel', 'Wheel'], ['bars', 'Bars'], ['mush', 'Mushrooms'], ['books', 'Bookshelf'], ['garden', 'Garden']];
var moodData = {};          // { 'YYYY-MM-DD': 0..4 } for the month on screen
var moodBrush = 0;          // mood picked in the top box
var moodStyle = 'pixels';
var moodYear = 0, moodMonth = 0;
var moodColors = [], moodPaper = '#FFFFFF', moodInk = '#000000';

function toggleMoodPage() {
  var page = document.getElementById('mood-page');
  var opening = page.style.display !== 'block';
  page.style.display = opening ? 'block' : 'none';
  if (!opening) return;
  ['sleep-page', 'history-page', 'money-page', 'shop-page', 'memory-page', 'every-page'].forEach(function (id) { var el = document.getElementById(id); if (el) el.style.display = 'none'; });
  var meta = currentUser && currentUser.user_metadata;
  if (meta && meta.mood_style) moodStyle = meta.mood_style;
  moodYear = currentYear; moodMonth = currentMonth;
  loadMoods().then(renderMood);
}

function moodShiftMonth(step) {
  moodMonth += step;
  if (moodMonth < 1) { moodMonth = 12; moodYear--; }
  if (moodMonth > 12) { moodMonth = 1; moodYear++; }
  loadMoods().then(renderMood);
}

function moodDays() { return new Date(moodYear, moodMonth, 0).getDate(); }
function moodIso(d) { return moodYear + '-' + String(moodMonth).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }

async function loadMoods() {
  moodData = {};
  if (!currentUser) return;
  var res = await sb.from('mood_logs').select('log_date,mood').eq('user_id', currentUser.id)
    .gte('log_date', moodIso(1)).lte('log_date', moodIso(moodDays()));
  if (res.error) { setMoodMsg('Could not load moods: ' + res.error.message); return; }
  (res.data || []).forEach(function (r) { moodData[r.log_date] = r.mood; });
  setMoodMsg('');
}

function setMoodMsg(t) { var el = document.getElementById('mood-msg'); if (el) el.textContent = t; }

// Turns any CSS color (hex, hsl, rgb) into [r, g, b] so colors can be compared.
function moodRgb(c) {
  var probe = document.createElement('span');
  probe.style.color = c; document.body.appendChild(probe);
  var m = getComputedStyle(probe).color.match(/\d+/g); probe.remove();
  return m ? m.slice(0, 3).map(Number) : [0, 0, 0];
}

function buildMoodColors() {
  moodPaper = getThemeColor('--mood-paper') || '#FFFFFF';
  moodInk = getThemeColor('--mood-ink') || '#000000';
  var paper = moodRgb(moodPaper);
  // Candidates in order: bar-graph colors first, then the theme's week and accent colors as backups.
  var cands = [];
  for (var i = 0; i < 12; i++) cands.push(colorForHabitIndex(i));
  [1, 2, 3, 4, 5].forEach(function (w) { cands.push(getThemeColor('--week-' + w + '-bg')); });
  ['--c-pink', '--c-purple', '--c-orange', '--c-dark', '--c-text'].forEach(function (v) { cands.push(getThemeColor(v)); });
  function dist(a, b) { return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]); }
  function pick(farMin, apartMin, picked) {
    cands.forEach(function (c) {
      if (!c || picked.length >= 5) return;
      var rgb = moodRgb(c);
      if (dist(rgb, paper) <= farMin) return;                                     // too close to the empty-day color
      if (picked.some(function (p) { return dist(moodRgb(p), rgb) <= apartMin; })) return; // too close to a mood already picked
      picked.push(c);
    });
    return picked;
  }
  var picked = pick(90, 60, []);
  if (picked.length < 5) picked = pick(40, 25, picked);   // pale themes: loosen the rules a little
  while (picked.length < 5) picked.push(moodInk);
  for (var k = 0; k < 5; k++) { var own = getThemeColor('--mood-' + (k + 1)); if (own) picked[k] = own; }
  moodColors = picked;
}

function moodFill(d) { var m = moodData[moodIso(d)]; return m === undefined ? moodPaper : moodColors[m]; }
function moodRnd(d, k) { var x = Math.sin(d * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); }

async function paintMood(d) {
  var iso = moodIso(d), before = moodData[iso];
  var clearing = before === moodBrush;
  if (clearing) delete moodData[iso]; else moodData[iso] = moodBrush;
  renderMood();
  if (!clearing) victory('pop', 'Mood logged');
  var res = clearing
    ? await sb.from('mood_logs').delete().eq('user_id', currentUser.id).eq('log_date', iso)
    : await sb.from('mood_logs').upsert({ user_id: currentUser.id, log_date: iso, mood: moodBrush }, { onConflict: 'user_id,log_date' });
  if (res.error) {
    if (before === undefined) delete moodData[iso]; else moodData[iso] = before;
    renderMood();
    setMoodMsg('Could not save: ' + res.error.message);
  }
}

function setMoodStyle(s) {
  moodStyle = s;
  renderMood();
  if (currentUser) sb.auth.updateUser({ data: { mood_style: s } }).then(function (r) { if (r && r.data && r.data.user) currentUser = r.data.user; });
}

function renderMood() {
  buildMoodColors();
  var mNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('mood-month').textContent = mNames[moodMonth - 1] + ' ' + moodYear;

  var brush = document.getElementById('mood-brush'); brush.innerHTML = '';
  MOOD_NAMES.forEach(function (name, i) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'sleep-q-btn mood-brush-btn' + (moodBrush === i ? ' on' : '');
    b.innerHTML = '<span class="mood-swatch" style="background:' + moodColors[i] + '"></span>' + name;
    b.addEventListener('click', function () { moodBrush = i; renderMood(); });
    brush.appendChild(b);
  });

  var tabs = document.getElementById('mood-styles'); tabs.innerHTML = '';
  MOOD_STYLES.forEach(function (s) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'sleep-q-btn' + (moodStyle === s[0] ? ' on' : '');
    b.textContent = s[1];
    b.addEventListener('click', function () { setMoodStyle(s[0]); });
    tabs.appendChild(b);
  });

  var chart = document.getElementById('mood-chart');
  var draw = { pixels: moodPixels, wheel: moodWheel, bars: moodBars, mush: moodMush, books: moodBooks, garden: moodGarden }[moodStyle] || moodPixels;
  chart.innerHTML = draw();
  chart.querySelectorAll('[data-d]').forEach(function (el) {
    el.addEventListener('click', function () { paintMood(+el.getAttribute('data-d')); });
  });

  var n = moodDays(), cnt = [0, 0, 0, 0, 0], logged = 0;
  for (var d = 1; d <= n; d++) { var m = moodData[moodIso(d)]; if (m !== undefined) { cnt[m]++; logged++; } }
  var top = logged ? MOOD_NAMES[cnt.indexOf(Math.max.apply(null, cnt))] : '-';
  var stats = '<b>' + logged + '/' + n + '</b> days logged · most common: <b>' + top + '</b><div class="mood-legend">';
  MOOD_NAMES.forEach(function (name, i) { stats += '<span><span class="mood-swatch" style="background:' + moodColors[i] + '"></span>' + name + ' ' + cnt[i] + '</span>'; });
  stats += '<span><span class="mood-swatch" style="background:' + moodPaper + '"></span>not logged</span></div>';
  document.getElementById('mood-stats').innerHTML = stats;
  renderMoodLine();
}

// "Mood over the month": one dot per day in that day's mood color, Rad at the top and Awful at the bottom,
// joined by a line. Days you skipped are left out (the line is dashed across them).
var moodLineChart = null;
function renderMoodLine() {
  var canvas = document.getElementById('moodLineChart'); if (!canvas || typeof Chart === 'undefined') return;
  var n = moodDays(), labels = [], vals = [], cols = [];
  for (var d = 1; d <= n; d++) {
    var m = moodData[moodIso(d)];
    labels.push(d);
    vals.push(m === undefined ? null : 4 - m);          // Rad (0) -> 4 at the top, Awful (4) -> 0 at the bottom
    cols.push(m === undefined ? 'transparent' : moodColors[m]);
  }
  var ink = getThemeColor('--c-text') || '#333', muted = getThemeColor('--c-text-muted') || '#888';
  if (moodLineChart) moodLineChart.destroy();
  moodLineChart = new Chart(canvas, {
    type: 'line',
    data: { labels: labels, datasets: [{ data: vals, spanGaps: true, tension: 0.25, borderColor: muted, borderWidth: 2,
      segment: { borderDash: function (c) { return (c.p0.skip || c.p1.skip || c.p1DataIndex - c.p0DataIndex > 1) ? [4, 4] : undefined; } },
      pointRadius: 6, pointHoverRadius: 8, pointBackgroundColor: cols, pointBorderColor: ink, pointBorderWidth: 1.5 }] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: {
        title: function (c) { var mn = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return mn[moodMonth - 1] + ' ' + c[0].label; },
        label: function (c) { return MOOD_NAMES[4 - c.raw]; } } } },
      scales: {
        x: { ticks: { color: muted, font: { size: 10 }, autoSkip: true, maxRotation: 0 }, grid: { display: false }, title: { display: true, text: 'Day of month', color: muted, font: { size: 10 } } },
        y: { min: -0.4, max: 4.4, ticks: { stepSize: 1, color: ink, font: { size: 11 }, callback: function (v) { return Number.isInteger(v) && v >= 0 && v <= 4 ? MOOD_NAMES[4 - v] : ''; } }, grid: { color: hexToRgba(muted, 0.2) } }
      } }
  });
  var got = vals.filter(function (v) { return v !== null; }), note = document.getElementById('mood-line-note');
  if (!got.length) { note.textContent = 'Pick a mood and tap a day above to start your line.'; return; }
  var avg = got.reduce(function (a, b) { return a + b; }, 0) / got.length;
  note.textContent = 'Average mood this month: ' + MOOD_NAMES[4 - Math.round(avg)] + ' · ' + got.length + ' of ' + n + ' days logged. Hover a dot to see the day.';
}

// ---- Chart styles. Each returns HTML/SVG; every day shape carries data-d="day number". ----
function moodPixels() {
  var n = moodDays(), off = (new Date(moodYear, moodMonth - 1, 1).getDay() + 6) % 7;
  var h = '<div class="mood-pixels">';
  ['M','T','W','T','F','S','S'].forEach(function (x) { h += '<div class="mood-pixel-head">' + x + '</div>'; });
  for (var i = 0; i < off; i++) h += '<div></div>';
  for (var d = 1; d <= n; d++) h += '<button type="button" class="mood-pixel" data-d="' + d + '" style="background:' + moodFill(d) + ';color:' + moodInk + ';border-color:' + moodInk + '">' + d + '</button>';
  return h + '</div>';
}

function moodWheel() {
  var n = moodDays(), cx = 150, cy = 150, R = 135, r = 42, ink = moodInk;
  var s = '<svg class="mood-svg mood-svg-wheel" viewBox="0 0 300 300" role="img" aria-label="Mood wheel">';
  function p(a, rr) { return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]; }
  for (var d = 1; d <= n; d++) {
    var a0 = -Math.PI / 2 + (d - 1) * 2 * Math.PI / n, a1 = a0 + 2 * Math.PI / n;
    var o0 = p(a0, R), o1 = p(a1, R), i1 = p(a1, r), i0 = p(a0, r), t = p((a0 + a1) / 2, R - 14);
    s += '<path data-d="' + d + '" d="M' + o0 + ' A' + R + ',' + R + ' 0 0 1 ' + o1 + ' L' + i1 + ' A' + r + ',' + r + ' 0 0 0 ' + i0 + 'Z" fill="' + moodFill(d) + '" stroke="' + ink + '" stroke-width="1.5"/>';
    s += '<text x="' + t[0] + '" y="' + (t[1] + 3) + '" text-anchor="middle" font-size="9" fill="' + ink + '" pointer-events="none">' + d + '</text>';
  }
  var mon = new Date(moodYear, moodMonth - 1, 1).toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
  return s + '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r - 4) + '" fill="' + moodPaper + '" stroke="' + ink + '" stroke-width="1.5"/><text x="' + cx + '" y="' + (cy + 4) + '" text-anchor="middle" font-size="12" font-weight="700" fill="' + ink + '">' + mon + '</text></svg>';
}

function moodBars() {
  var n = moodDays(), h = '<div class="mood-bars" style="grid-template-columns:repeat(' + n + ',minmax(0,1fr))">';
  for (var d = 1; d <= n; d++) {
    var m = moodData[moodIso(d)], ht = m === undefined ? 6 : (5 - m) * 28;
    h += '<button type="button" class="mood-bar" data-d="' + d + '" title="Day ' + d + '" style="height:' + ht + 'px;background:' + moodFill(d) + ';border-color:' + moodInk + '"></button>';
  }
  h += '</div><div class="mood-bar-days" style="grid-template-columns:repeat(' + n + ',minmax(0,1fr))">';
  for (var k = 1; k <= n; k++) h += '<span>' + (k % 5 === 1 || k === n ? k : '') + '</span>';
  return h + '</div><p class="mood-note">Taller bar = better mood</p>';
}

function moodMush() {
  var n = moodDays(), cols = 7, cw = 76, rh = 74, rows = Math.ceil(n / cols), H = rows * rh + 70, ink = moodInk, paper = moodPaper;
  var s = '<svg class="mood-svg" viewBox="0 0 580 ' + H + '" role="img" aria-label="Mushroom mood chart">';
  s += '<path d="M0,' + (H - 8) + ' Q145,' + (H - 18) + ' 290,' + (H - 8) + ' T580,' + (H - 8) + '" fill="none" stroke="' + ink + '" stroke-width="1.5"/>';
  for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
    var d = r * cols + c + 1; if (d > n) break;
    var sc = 0.72 + moodRnd(d, 1) * 0.38, x = c * cw + 44 + (r % 2 ? 22 : 0) + (moodRnd(d, 2) - 0.5) * 14;
    var yb = 72 + (r + 1) * rh - moodRnd(d, 3) * 10, cwid = 58 * sc, ch = 28 * sc, stH = 36 * sc, sw = 13 * sc, y0 = yb - stH, t = Math.floor(moodRnd(d, 4) * 3), cap;
    if (t === 0) cap = 'M' + (x - cwid / 2) + ',' + y0 + ' C' + (x - cwid / 2) + ',' + (y0 - ch * 1.35) + ' ' + (x + cwid / 2) + ',' + (y0 - ch * 1.35) + ' ' + (x + cwid / 2) + ',' + y0 + ' Q' + x + ',' + (y0 + 6) + ' ' + (x - cwid / 2) + ',' + y0 + 'Z';
    else if (t === 1) cap = 'M' + (x - cwid / 2) + ',' + y0 + ' Q' + (x - cwid * 0.1) + ',' + (y0 - ch * 1.7) + ' ' + x + ',' + (y0 - ch * 1.6) + ' Q' + (x + cwid * 0.1) + ',' + (y0 - ch * 1.7) + ' ' + (x + cwid / 2) + ',' + y0 + ' Q' + x + ',' + (y0 + 6) + ' ' + (x - cwid / 2) + ',' + y0 + 'Z';
    else cap = 'M' + (x - cwid * 0.6) + ',' + (y0 + 2) + ' Q' + x + ',' + (y0 - ch) + ' ' + (x + cwid * 0.6) + ',' + (y0 + 2) + ' Q' + x + ',' + (y0 - 2) + ' ' + (x - cwid * 0.6) + ',' + (y0 + 2) + 'Z';
    s += '<g data-d="' + d + '"><path d="M' + (x - sw / 2) + ',' + (y0 + 1) + ' Q' + (x - sw / 2 - 3) + ',' + ((y0 + yb) / 2) + ' ' + (x - sw / 2 - 1) + ',' + yb + ' L' + (x + sw / 2 + 1) + ',' + yb + ' Q' + (x + sw / 2 + 3) + ',' + ((y0 + yb) / 2) + ' ' + (x + sw / 2) + ',' + (y0 + 1) + 'Z" fill="' + paper + '" stroke="' + ink + '" stroke-width="1.3"/>';
    s += '<path d="M' + (x - 3) + ',' + yb + ' q-4,-9 -8,-12 M' + (x + 4) + ',' + yb + ' q3,-8 9,-11" fill="none" stroke="' + ink + '" stroke-width="1"/>';
    s += '<path d="' + cap + '" fill="' + moodFill(d) + '" stroke="' + ink + '" stroke-width="1.5"/>';
    for (var k = 0; k < 4; k++) {
      var dx = (moodRnd(d, 10 + k) - 0.5) * cwid * 0.6, dy = -(0.25 + moodRnd(d, 20 + k) * 0.55) * ch * (t === 2 ? 0.5 : 1);
      s += '<circle cx="' + (x + dx) + '" cy="' + (y0 + dy) + '" r="' + ((1.6 + moodRnd(d, 30 + k) * 1.8) * sc) + '" fill="' + paper + '" stroke="' + ink + '" stroke-width="0.9"/>';
    }
    s += '<text x="' + x + '" y="' + (yb - 4) + '" text-anchor="middle" font-size="' + (9 * sc + 1) + '" fill="' + ink + '" pointer-events="none">' + d + '</text></g>';
  }
  return s + '</svg>';
}

function moodBooks() {
  var n = moodDays(), per = 8, shelves = Math.ceil(n / per), sh = 112, H = shelves * sh + 16, ink = moodInk;
  var s = '<svg class="mood-svg" viewBox="0 0 580 ' + H + '" role="img" aria-label="Bookshelf mood chart">';
  for (var r = 0; r < shelves; r++) {
    var yb = (r + 1) * sh, ws = [];
    for (var i = 0; i < per; i++) { var dd = r * per + i + 1; if (dd > n) break; ws.push(46 + moodRnd(dd, 1) * 16); }
    var x = (580 - ws.reduce(function (a, b) { return a + b + 3; }, 0)) / 2;
    s += '<rect x="20" y="' + yb + '" width="540" height="10" fill="' + moodPaper + '" stroke="' + ink + '" stroke-width="1.5"/><path d="M40,' + (yb + 10) + ' l0,8 M540,' + (yb + 10) + ' l0,8" stroke="' + ink + '" stroke-width="1.5"/>';
    ws.forEach(function (w, j) {
      var d = r * per + j + 1, h = 68 + moodRnd(d, 2) * 28, y = yb - h, lean = (d % 7 === 3) ? -6 : 0;
      s += '<g data-d="' + d + '" transform="rotate(' + lean + ' ' + (x + w / 2) + ' ' + yb + ')"><rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="3" fill="' + moodFill(d) + '" stroke="' + ink + '" stroke-width="1.5"/>';
      s += '<path d="M' + x + ',' + (y + 10) + ' h' + w + ' M' + x + ',' + (y + h - 12) + ' h' + w + (moodRnd(d, 3) > 0.5 ? ' M' + x + ',' + (y + 15) + ' h' + w : '') + '" stroke="' + ink + '" stroke-width="1"/>';
      s += '<text x="' + (x + w / 2) + '" y="' + (y + h / 2 + 4) + '" text-anchor="middle" font-size="12" font-weight="700" fill="' + ink + '" pointer-events="none">' + d + '</text></g>';
      x += w + 3;
    });
  }
  return s + '</svg>';
}

function moodGarden() {
  var n = moodDays(), per = 8, rows = Math.ceil(n / per), rh = 104, H = rows * rh + 60, ink = moodInk, paper = moodPaper;
  var s = '<svg class="mood-svg" viewBox="0 0 580 ' + H + '" role="img" aria-label="Flower garden mood chart">';
  for (var r = 0; r < rows; r++) {
    var cnt = Math.min(per, n - r * per), gap = 540 / cnt;
    for (var i = 0; i < cnt; i++) {
      var d = r * per + i + 1, x = 20 + gap * (i + 0.5) + (moodRnd(d, 1) - 0.5) * 14, yb = 60 + (r + 1) * rh;
      var top = yb - 70 - moodRnd(d, 2) * 26, pr = 11 + moodRnd(d, 3) * 4, np = 5 + Math.floor(moodRnd(d, 4) * 3);
      s += '<path d="M' + x + ',' + yb + ' Q' + (x + (moodRnd(d, 5) - 0.5) * 16) + ',' + ((yb + top) / 2) + ' ' + x + ',' + top + '" fill="none" stroke="' + ink + '" stroke-width="1.5"/>';
      s += '<path d="M' + x + ',' + (yb - 18) + ' q12,-4 16,-14 q-12,0 -16,14Z" fill="' + paper + '" stroke="' + ink + '" stroke-width="1.1"/><g data-d="' + d + '">';
      for (var k = 0; k < np; k++) {
        var a = k * 360 / np + moodRnd(d, 6) * 40;
        s += '<ellipse cx="' + x + '" cy="' + (top - pr) + '" rx="' + (pr * 0.55) + '" ry="' + pr + '" transform="rotate(' + a + ' ' + x + ' ' + top + ')" fill="' + moodFill(d) + '" stroke="' + ink + '" stroke-width="1.2"/>';
      }
      s += '<circle cx="' + x + '" cy="' + top + '" r="' + (pr * 0.62) + '" fill="' + paper + '" stroke="' + ink + '" stroke-width="1.2"/><text x="' + x + '" y="' + (top + 3.5) + '" text-anchor="middle" font-size="10" font-weight="700" fill="' + ink + '" pointer-events="none">' + d + '</text></g>';
    }
  }
  return s + '<path d="M0,' + (H - 6) + ' H580" stroke="' + ink + '" stroke-width="1.5"/></svg>';
}

// ============================================
// MONEY TRACKER (saved in the Supabase "money_logs" table)
// Custom categories and accounts are saved to your account (like your theme),
// so they show up on every device.
// ============================================
var MONEY_CATS = {
  expense: ['Groceries / Food', 'Travel', 'Rent', 'Bills', 'Electronics', 'Shopping', 'Fun', 'Health', 'Credit', 'Other'],
  income: ['Salary', 'Side hustle', 'Etsy sales', 'Gift', 'Refund', 'Other']
};
var MONEY_ACCOUNTS = ['Personal', 'Business', 'Savings', 'Cash'];
var MONEY_VIEWS = [['today', 'Today'], ['day', 'Per day'], ['month', 'Monthly'], ['all', 'All time'], ['cat', 'Per category'], ['acc', 'Per account']];
var moneyLogs = [];
var moneyKind = 'expense';
var moneyView = 'all';

function toggleMoneyPage() {
  var page = document.getElementById('money-page');
  var opening = page.style.display !== 'block';
  page.style.display = opening ? 'block' : 'none';
  if (!opening) return;
  ['sleep-page', 'history-page', 'mood-page', 'shop-page', 'memory-page', 'every-page'].forEach(function (id) { var el = document.getElementById(id); if (el) el.style.display = 'none'; });
  document.getElementById('money-date').value = localISO(new Date());
  setMoneyKind(moneyKind);
  if (!moneyDistAnchor) moneyDistAnchor = new Date();
  ['mt-fa-date', 'mt-dp-date'].forEach(function (id) { document.getElementById(id).value = localISO(new Date()); });
  mtGo(mtTab);
  Promise.all([loadMoneyLogs(), mtLoadAll()]).then(renderMoney);
}

async function loadMoneyLogs() {
  if (!currentUser) return;
  var res = await sb.from('money_logs').select('*').eq('user_id', currentUser.id).order('log_date', { ascending: false });
  if (res.error) { moneyLogs = []; setMoneyMsg('Could not load entries: ' + res.error.message, 'error'); return; }
  moneyLogs = (res.data || []).map(function (r) { r.amount = Number(r.amount); return r; });
}

function setMoneyMsg(text, type) {
  var el = document.getElementById('money-msg');
  el.textContent = text;
  el.className = 'sleep-msg ' + (type || '');
}

function moneyEsc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
// Money amounts in your chosen currency (Settings or Setup tab). Default: US dollars.
function mtCurrency() { var m = currentUser && currentUser.user_metadata; return (m && m.money_currency) || 'USD'; }
function moneyFmt(n) {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: mtCurrency() }).format(n); }
  catch (e) { return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
}
function moneyDay(iso) { var p = iso.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
function moneyMonthName(ym) { var p = ym.split('-'); return new Date(+p[0], +p[1] - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }); }
function moneySums(list) {
  var inc = 0, exp = 0;
  list.forEach(function (r) { if (r.kind === 'income') inc += r.amount; else exp += r.amount; });
  return { inc: inc, exp: exp, net: inc - exp };
}

// ---- Categories and accounts: defaults + ones you added + ones already used in your entries ----
function moneyMeta(key) { var v = settingGet(key); return Array.isArray(v) ? v : []; }
function moneyUnique(list) {
  var seen = {}, out = [];
  list.forEach(function (x) { var k = String(x || '').trim(); if (k && !seen[k.toLowerCase()]) { seen[k.toLowerCase()] = 1; out.push(k); } });
  return out;
}
function moneyCategoryList(kind) {
  return moneyUnique(MONEY_CATS[kind].concat(moneyMeta('money_cats_' + kind),
    moneyLogs.filter(function (r) { return r.kind === kind; }).map(function (r) { return r.category; })));
}
function moneyAccountList() {
  return moneyUnique(MONEY_ACCOUNTS.concat(moneyMeta('money_accounts'), moneyLogs.map(function (r) { return r.account; })));
}
function fillMoneySelect(id, list, keep) {
  var sel = document.getElementById(id), cur = keep || sel.value;
  sel.innerHTML = '';
  list.forEach(function (x) { var o = document.createElement('option'); o.value = x; o.textContent = x; sel.appendChild(o); });
  var add = document.createElement('option'); add.value = '__custom__';
  add.textContent = id === 'money-cat' ? '+ Add new category…' : '+ Add new account…';
  sel.appendChild(add);
  if (cur && list.indexOf(cur) > -1) sel.value = cur;
}
function refreshMoneySelects(keepCat, keepAcc) {
  fillMoneySelect('money-cat', moneyCategoryList(moneyKind), keepCat);
  fillMoneySelect('money-acc', moneyAccountList(), keepAcc);
}
function onMoneySelect(which) {
  var sel = document.getElementById(which === 'cat' ? 'money-cat' : 'money-acc');
  var row = document.getElementById(which === 'cat' ? 'money-cat-new' : 'money-acc-new');
  row.style.display = sel.value === '__custom__' ? 'flex' : 'none';
  if (sel.value === '__custom__') row.querySelector('input').focus();
}
async function addMoneyCustom(which) {
  var row = document.getElementById(which === 'cat' ? 'money-cat-new' : 'money-acc-new');
  var input = row.querySelector('input'), val = input.value.trim();
  if (!val) return setMoneyMsg(which === 'cat' ? 'Type a category name first.' : 'Type an account name first.', 'error');
  val = val.charAt(0).toUpperCase() + val.slice(1);
  var key = which === 'cat' ? 'money_cats_' + moneyKind : 'money_accounts';
  var list = moneyUnique(moneyMeta(key).concat([val]));
  var data = {}; data[key] = list;
  var res = await sb.auth.updateUser({ data: data });
  if (res && res.error) return setMoneyMsg('Could not save: ' + res.error.message, 'error');
  if (res && res.data && res.data.user) currentUser = res.data.user;
  else { currentUser.user_metadata = currentUser.user_metadata || {}; currentUser.user_metadata[key] = list; }
  input.value = ''; row.style.display = 'none';
  if (which === 'cat') refreshMoneySelects(val, null); else refreshMoneySelects(null, val);
  setMoneyMsg('Added "' + val + '".', 'ok');
}

function setMoneyKind(k) {
  moneyKind = k;
  document.getElementById('money-kind-exp').className = 'sleep-q-btn' + (k === 'expense' ? ' on' : '');
  document.getElementById('money-kind-inc').className = 'sleep-q-btn' + (k === 'income' ? ' on' : '');
  document.getElementById('money-cat-new').style.display = 'none';
  refreshMoneySelects();
}

async function submitMoney() {
  var item = document.getElementById('money-item').value.trim();
  var amount = parseFloat(document.getElementById('money-amount').value);
  var date = document.getElementById('money-date').value;
  var cat = document.getElementById('money-cat').value, acc = document.getElementById('money-acc').value;
  if (!item) return setMoneyMsg('Give the entry a name.', 'error');
  if (!(amount > 0)) return setMoneyMsg('Enter an amount above 0.', 'error');
  if (!date) return setMoneyMsg('Pick a date.', 'error');
  if (cat === '__custom__' || acc === '__custom__') return setMoneyMsg('Finish adding the new category or account first.', 'error');
  setMoneyMsg('Saving...', 'ok');
  var row = { user_id: currentUser.id, kind: moneyKind, item: item, amount: Math.round(amount * 100) / 100, category: cat, account: acc, log_date: date };
  var goes = (document.getElementById('money-goes') || {}).value || '';
  if (goes.indexOf('f:') === 0) row.fund_id = +goes.slice(2);     // money put into a savings fund
  if (goes.indexOf('d:') === 0) row.debt_id = +goes.slice(2);     // a payment toward a debt
  var res = await sb.from('money_logs').insert(row);
  if (res.error) return setMoneyMsg('Could not save: ' + res.error.message, 'error');
  document.getElementById('money-item').value = '';
  document.getElementById('money-amount').value = '';
  await loadMoneyLogs();
  renderMoney();
  setMoneyMsg('Saved ' + (moneyKind === 'income' ? 'income' : 'expense') + ': ' + item + ' ' + moneyFmt(amount) + '.', 'ok');
  victory('pop', moneyKind === 'income' ? 'Money in! 💵' : 'Logged 💸');
}

async function deleteMoney(id) {
  if (!confirm('Delete this entry?')) return;
  var res = await sb.from('money_logs').delete().eq('id', id);
  if (res.error) return setMoneyMsg('Could not delete: ' + res.error.message, 'error');
  await loadMoneyLogs();
  renderMoney();
}

// ---- Spending distribution donut: expenses by category for a month, a week (Mon-Sun), or 2 weeks from a start date you pick ----
var moneyDistMode = 'month', moneyDistAnchor = null, moneyDistChart = null;
function moneyDistDate(iso) { var p = iso.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
function moneyDistRange() {
  var a = moneyDistAnchor ? new Date(moneyDistAnchor) : new Date(); a.setHours(0, 0, 0, 0);
  var from, to;
  if (moneyDistMode === 'month') { var per = mtPeriod(a); from = per.from; to = per.to; }
  else if (moneyDistMode === 'week') { from = new Date(a); from.setDate(a.getDate() - ((a.getDay() + 6) % 7)); to = new Date(from); to.setDate(from.getDate() + 6); }
  else { from = new Date(a); to = new Date(a); to.setDate(a.getDate() + 13); }
  return { from: from, to: to };
}
function moneyDistSetMode(m) {
  moneyDistMode = m;
  if (m === '2wk') {
    var saved = currentUser && currentUser.user_metadata && currentUser.user_metadata.money_2wk_start;
    if (saved) {   // keep the same 2-week cycle (e.g. your pay periods) and jump to the one that holds today
      var s0 = moneyDistDate(saved), t = new Date(); t.setHours(0, 0, 0, 0);
      var k = Math.floor((t - s0) / (14 * 86400000)); s0.setDate(s0.getDate() + k * 14); moneyDistAnchor = s0;
    } else { var d = new Date(); d.setDate(d.getDate() - 13); moneyDistAnchor = d; }
  } else moneyDistAnchor = new Date();
  renderMoneyDist();
}
function moneyDistShift(step) {
  var a = moneyDistRange().from;
  if (moneyDistMode === 'month') a.setMonth(a.getMonth() + step);
  else a.setDate(a.getDate() + step * (moneyDistMode === 'week' ? 7 : 14));
  moneyDistAnchor = a; renderMoneyDist();
}
function moneyDistSetStart(iso) {
  if (!iso) return;
  moneyDistAnchor = moneyDistDate(iso);
  mtSaveMeta({ money_2wk_start: iso });
  renderMoneyDist();
  var pay = document.getElementById('mt-s-pay'); if (pay) pay.value = iso;
}
// ---- Account filter on Home: "All accounts" or one account at a time (remembered on this device) ----
var moneyAccFilter = (function () { try { return localStorage.getItem('moneyAccFilter') || ''; } catch (e) { return ''; } })();
function moneyShown() { return moneyAccFilter ? moneyLogs.filter(function (r) { return r.account === moneyAccFilter; }) : moneyLogs; }
function setMoneyAccFilter(a) {
  moneyAccFilter = a;
  try { localStorage.setItem('moneyAccFilter', a); } catch (e) {}
  renderMoney();
}
function renderMoneyAccFilter() {
  var el = document.getElementById('money-acc-filter'); if (!el) return;
  var used = moneyUnique(moneyLogs.map(function (r) { return r.account; }));
  if (moneyAccFilter && used.indexOf(moneyAccFilter) < 0) moneyAccFilter = '';
  el.innerHTML = '';
  if (used.length < 2) { el.style.display = 'none'; return; }   // only one account so far: nothing to filter
  el.style.display = '';
  [['', 'All accounts']].concat(used.map(function (a) { return [a, a]; })).forEach(function (a) {
    var b = document.createElement('button'); b.type = 'button';
    b.className = 'sleep-q-btn' + (moneyAccFilter === a[0] ? ' on' : ''); b.textContent = a[1];
    b.onclick = function () { setMoneyAccFilter(a[0]); };
    el.appendChild(b);
  });
}

function renderMoneyDist() {
  var canvas = document.getElementById('moneyDistChart'); if (!canvas) return;
  var modes = document.getElementById('money-dist-modes'); modes.innerHTML = '';
  [['month', 'Month'], ['week', 'Week'], ['2wk', '2 weeks']].forEach(function (m) {
    var b = document.createElement('button'); b.type = 'button';
    b.className = 'sleep-q-btn' + (moneyDistMode === m[0] ? ' on' : ''); b.textContent = m[1];
    b.onclick = function () { moneyDistSetMode(m[0]); };
    modes.appendChild(b);
  });
  var r = moneyDistRange(), fromIso = localISO(r.from), toIso = localISO(r.to);
  var short = function (d) { return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
  document.getElementById('money-dist-label').textContent = moneyDistMode === 'month'
    ? mtPeriodLabel(r)
    : short(r.from) + ' – ' + short(r.to) + ', ' + r.to.getFullYear();
  document.getElementById('money-dist-start-row').style.display = moneyDistMode === '2wk' ? '' : 'none';
  if (moneyDistMode === '2wk') document.getElementById('money-dist-start').value = fromIso;

  var by = {}, total = 0;
  moneyShown().forEach(function (x) {
    if (x.kind !== 'expense' || x.fund_id || x.log_date < fromIso || x.log_date > toIso) return;   // savings transfers aren't spending
    var c = x.category || 'Other', a = Math.abs(Number(x.amount)) || 0;
    by[c] = (by[c] || 0) + a; total += a;
  });
  var cats = Object.keys(by).sort(function (a, b) { return by[b] - by[a]; });
  var colors = cats.map(function (c, i) { return colorForHabitIndex(i); });   // the theme's bar-graph colors
  var paper = getThemeColor('--c-body-bg') || '#fff', empty = getThemeColor('--c-body-bg-alt') || '#eee';
  if (moneyDistChart) moneyDistChart.destroy();
  moneyDistChart = new Chart(canvas, {
    type: 'doughnut',
    data: { labels: cats.length ? cats : ['No spending'], datasets: [{ data: cats.length ? cats.map(function (c) { return Math.round(by[c] * 100) / 100; }) : [1],
      backgroundColor: cats.length ? colors : [empty], borderColor: paper, borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '64%',
      plugins: { legend: { display: false }, tooltip: { enabled: cats.length > 0, callbacks: { label: function (c) { return c.label + ': ' + moneyFmt(c.raw) + ' · ' + Math.round(c.raw / total * 100) + '%'; } } } } }
  });
  document.getElementById('money-dist-total').innerHTML = '<b>' + moneyFmt(total) + '</b><span>spent</span>';
  var h = '';
  cats.forEach(function (c, i) {
    var pct = total ? by[c] / total * 100 : 0;
    h += '<div class="money-dist-row"><span class="money-dist-dot" style="background:' + colors[i] + '"></span><span class="money-dist-name">' + moneyEsc(c) + '</span><span class="money-dist-amt">' + moneyFmt(by[c]) + ' · ' + (pct > 0 && pct < 1 ? '<1' : Math.round(pct)) + '%</span></div>';
  });
  document.getElementById('money-dist-list').innerHTML = h || '<p class="sleep-empty">No spending in this period.</p>';
}

function renderMoney() {
  var per = mtPeriod(new Date()), pf = localISO(per.from), pt = localISO(per.to), m = { inc: 0, exp: 0, sav: 0 };
  renderMoneyAccFilter();
  moneyShown().forEach(function (r) {
    if (r.log_date < pf || r.log_date > pt) return;
    if (r.kind === 'income') m.inc += r.amount; else if (r.fund_id) m.sav += r.amount; else m.exp += r.amount;
  });
  var left = m.inc - m.exp - m.sav;
  renderMoneyDist();
  document.getElementById('mt-home-title').textContent = mtPeriodLabel(per) + (moneyAccFilter ? ' · ' + moneyAccFilter : '');
  document.getElementById('money-inc').textContent = moneyFmt(m.inc);
  document.getElementById('money-exp').textContent = moneyFmt(m.exp);
  var net = document.getElementById('money-net');
  net.textContent = moneyFmt(left);
  net.className = 'sleep-big ' + (left < 0 ? 'money-out' : 'money-net');
  document.getElementById('money-net-sub').textContent = m.sav ? 'after ' + moneyFmt(m.sav) + ' moved to savings' : '';
  mtRenderAll();

  var tabs = document.getElementById('money-views'); tabs.innerHTML = '';
  MONEY_VIEWS.forEach(function (v) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'sleep-q-btn' + (moneyView === v[0] ? ' on' : '');
    b.textContent = v[1];
    b.addEventListener('click', function () { moneyView = v[0]; renderMoney(); });
    tabs.appendChild(b);
  });

  var out = document.getElementById('money-out'), today = localISO(new Date()), h;
  if (moneyView === 'today') h = moneyTable(moneyShown().filter(function (r) { return r.log_date === today; }));
  else if (moneyView === 'all') h = moneyTable(moneyShown());
  else if (moneyView === 'day') h = moneyGrouped(function (r) { return r.log_date; }, 'Day', moneyDay);
  else if (moneyView === 'month') h = moneyGrouped(function (r) { return r.log_date.slice(0, 7); }, 'Month', moneyMonthName);
  else if (moneyView === 'cat') h = '<div class="money-pad"><p class="money-sub">Where your money went</p>' + moneyBars('expense') + '<p class="money-sub">Where your money came from</p>' + moneyBars('income') + '</div>';
  else h = moneyAccountsTable();
  out.innerHTML = h;
  out.querySelectorAll('[data-del]').forEach(function (b) { b.addEventListener('click', function () { deleteMoney(+b.getAttribute('data-del')); }); });
  refreshMoneySelects(document.getElementById('money-cat').value, document.getElementById('money-acc').value);
}

function moneyEmpty() { return '<p class="sleep-empty money-pad">Nothing here yet.</p>'; }

function moneyTable(list) {
  if (!list.length) return moneyEmpty();
  var s = moneySums(list);
  var h = '<table class="money-table"><tr><th>Item</th><th class="money-num">Expense</th><th class="money-num">Income</th><th>Category</th><th>Account</th><th>Date</th><th></th></tr>';
  list.forEach(function (r) {
    h += '<tr><td>' + moneyEsc(r.item) + '</td><td class="money-num money-out">' + (r.kind === 'expense' ? moneyFmt(r.amount) : '') + '</td><td class="money-num money-in">' + (r.kind === 'income' ? moneyFmt(r.amount) : '') + '</td><td>' + moneyEsc(r.category) + '</td><td>' + moneyEsc(r.account) + '</td><td>' + moneyDay(r.log_date) + '</td><td><button type="button" class="sleep-del" data-del="' + r.id + '" title="Delete this entry">x</button></td></tr>';
  });
  return h + '<tr class="money-total"><td>Total</td><td class="money-num money-out">' + moneyFmt(s.exp) + '</td><td class="money-num money-in">' + moneyFmt(s.inc) + '</td><td colspan="4">Net ' + moneyFmt(s.net) + '</td></tr></table>';
}

function moneyGrouped(keyFn, label, nameFn) {
  var list = moneyShown();
  if (!list.length) return moneyEmpty();
  var g = {};
  list.forEach(function (r) { var k = keyFn(r); (g[k] = g[k] || []).push(r); });
  var h = '<table class="money-table"><tr><th>' + label + '</th><th class="money-num">Expense</th><th class="money-num">Income</th><th class="money-num">Net</th><th class="money-num">Entries</th></tr>';
  Object.keys(g).sort().reverse().forEach(function (k) {
    var s = moneySums(g[k]);
    h += '<tr><td>' + nameFn(k) + '</td><td class="money-num money-out">' + moneyFmt(s.exp) + '</td><td class="money-num money-in">' + moneyFmt(s.inc) + '</td><td class="money-num ' + (s.net < 0 ? 'money-out' : 'money-in') + '"><b>' + moneyFmt(s.net) + '</b></td><td class="money-num">' + g[k].length + '</td></tr>';
  });
  return h + '</table>';
}

function moneyBars(kind) {
  var g = {};
  moneyShown().filter(function (r) { return r.kind === kind; }).forEach(function (r) { g[r.category] = (g[r.category] || 0) + r.amount; });
  var keys = Object.keys(g).sort(function (a, b) { return g[b] - g[a]; });
  if (!keys.length) return '<p class="sleep-empty">Nothing here yet.</p>';
  var max = Math.max.apply(null, keys.map(function (k) { return g[k]; }));
  return keys.map(function (k) {
    return '<div class="money-bar-row"><span>' + moneyEsc(k) + '</span><div class="sleep-bar"><i class="' + (kind === 'income' ? 'money-bar-in' : 'money-bar-out') + '" style="width:' + (g[k] / max * 100) + '%"></i></div><b class="money-num">' + moneyFmt(g[k]) + '</b></div>';
  }).join('');
}

function moneyAccountsTable() {
  if (!moneyLogs.length) return moneyEmpty();
  var g = {};
  moneyLogs.forEach(function (r) { (g[r.account] = g[r.account] || []).push(r); });
  var h = '<table class="money-table"><tr><th>Account</th><th class="money-num">Money in</th><th class="money-num">Money out</th><th class="money-num">Change</th></tr>';
  Object.keys(g).sort().forEach(function (a) {
    var s = moneySums(g[a]);
    h += '<tr><td>' + moneyEsc(a) + '</td><td class="money-num money-in">' + moneyFmt(s.inc) + '</td><td class="money-num money-out">' + moneyFmt(s.exp) + '</td><td class="money-num ' + (s.net < 0 ? 'money-out' : 'money-in') + '"><b>' + moneyFmt(s.net) + '</b></td></tr>';
  });
  return h + '</table>';
}


// ============================================
// BANK IMPORT (inside the Money tracker)
// Reads a .csv from your bank, walks through each transaction, and lets you sort
// similar ones together. "Group by these words" decides what counts as similar.
// Your answers are saved as rules (to your account) so later imports come pre-filled.
// ============================================
var IMPORT_STOP = ['THE', 'INC', 'CO', 'COM', 'PAYMENT', 'PENDING', 'NY', 'NEW', 'YORK', 'HELP', 'DIR', 'DEP', 'TO', 'FROM', 'CONF', 'PURCHASE', 'POS', 'DEBIT', 'CARD', 'ONLINE', 'TRANSFER', 'ID', 'REF', 'WEB', 'ACH', 'LLC'];
var importTx = [], importCur = 0, importDupes = 0, importSaved = 0;

function impWords(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean); }
function impAutoMatch(desc) {
  var w = impWords(desc).filter(function (x) { return x.length > 1 && !/\d/.test(x) && IMPORT_STOP.indexOf(x) < 0; });
  return (w.length ? w : impWords(desc)).slice(0, 2).join(' ');
}
function impMatches(desc, match) {
  var need = impWords(match); if (!need.length) return false;
  var have = impWords(desc);
  return need.every(function (w) { return have.indexOf(w) > -1; });
}
function impHighlight(desc, match) {
  var need = impWords(match);
  return moneyEsc(desc).replace(/[A-Za-z0-9]+/g, function (w) { return need.indexOf(w.toUpperCase()) > -1 ? '<mark class="money-mark">' + w + '</mark>' : w; });
}
function impRules() { return moneyMeta('money_rules'); }
// Amount check: a rule or group with "about $X ± $Y" only matches amounts in that range. No amount = any amount.
function impAmountOk(t, amt, tol) {
  if (amt === null || amt === undefined || amt === '' || isNaN(amt)) return true;
  return Math.abs(Math.abs(t.amt) - Number(amt)) <= Number(tol || 0) + 0.004;
}
function impRuleMatches(t, r) {
  return (r.kind === 'any' || r.kind === t.kind) && impMatches(t.desc, r.match) && impAmountOk(t, r.amt, r.tol);
}
// Most specific rule wins: rules with an amount first, then rules with more words.
function impRuleFor(t) {
  return impRules().filter(function (r) { return impRuleMatches(t, r); })
    .sort(function (a, b) { return ((b.amt != null) - (a.amt != null)) || (impWords(b.match).length - impWords(a.match).length); })[0];
}
function impPersistRules(list) {
  currentUser.user_metadata = currentUser.user_metadata || {};
  currentUser.user_metadata.money_rules = list;
  savePref({ money_rules: list });
}
function impSaveRule(match, kind, cat, acc, amt, tol) {
  var key = impWords(match).join(' ');
  var a = (amt === '' || amt === null || isNaN(amt)) ? null : Math.round(Number(amt) * 100) / 100;
  var tl = a === null ? null : Math.round(Number(tol || 0) * 100) / 100;
  var list = impRules().filter(function (r) { return !(r.kind === kind && r.match === key && (r.amt == null ? null : r.amt) === a); });
  list.push({ match: key, kind: kind, cat: cat, acc: acc, amt: a, tol: tl });
  impPersistRules(list);
}

// ---- Reading the CSV file ----
function impSplitLine(line, delim) {
  delim = delim || ',';
  var out = [], cell = '', q = false;
  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { out.push(cell.trim()); cell = ''; }
    else cell += ch;
  }
  out.push(cell.trim());
  return out;
}
function impDate(s) {
  s = String(s || '').trim();
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) { var y = m[3].length === 2 ? '20' + m[3] : m[3]; return y + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0'); }
  var d = new Date(s); return isNaN(d) ? null : localISO(d);
}
function impNum(s) { var v = parseFloat(String(s || '').replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1')); return isNaN(v) ? 0 : v; }
// ---- Reading the file: split into a heading row + data rows. Works with commas, tabs or semicolons. ----
function impReadTable(text) {
  var lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter(function (l) { return l.trim(); });
  if (lines.length < 2) return null;
  var first = lines[0], delim = ',';
  [['\t', (first.match(/\t/g) || []).length], [';', (first.match(/;/g) || []).length]].forEach(function (d) {
    if (d[1] > (first.match(/,/g) || []).length && d[1] > 0) delim = d[0];
  });
  var head = impSplitLine(lines.shift(), delim);
  var rows = lines.map(function (l) { return impSplitLine(l, delim); });
  return { head: head, rows: rows };
}

// How many different values a column has (a "Details" column that only says DEBIT/CREDIT has very few).
function impVariety(rows, i) {
  var seen = {};
  rows.slice(0, 200).forEach(function (r) { seen[String(r[i] || '').toUpperCase()] = 1; });
  return Object.keys(seen).length;
}

// Best guess for which column is which. Checks heading words in priority order.
function impGuessColumns(table) {
  var head = table.head.map(function (h) { return h.toLowerCase(); }), rows = table.rows;
  function find(words, okFn) {
    for (var w = 0; w < words.length; w++) for (var i = 0; i < head.length; i++)
      if (head[i].indexOf(words[w]) > -1 && (!okFn || okFn(i))) return i;
    return -1;
  }
  var manyValues = function (i) { return rows.length < 6 || impVariety(rows, i) > 3; };
  var g = {
    date: find(['posting date', 'transaction date', 'post date', 'date']),
    desc: find(['description', 'payee', 'merchant', 'name', 'memo', 'details', 'desc'], manyValues),
    amount: find(['amount']),
    debit: find(['debit', 'withdrawal']),
    credit: find(['credit', 'deposit'])
  };
  if (g.desc < 0) g.desc = find(['description', 'payee', 'merchant', 'name', 'memo', 'details', 'desc']);
  g.mode = g.amount > -1 ? 'single' : 'split';
  return g;
}

// Turns the table into transactions using the chosen columns.
function impBuildRows(table, map, flip) {
  return table.rows.map(function (c) {
    var amt = map.mode === 'single' ? impNum(c[map.amount]) : impNum(c[map.credit]) - Math.abs(impNum(c[map.debit]));
    if (flip) amt = -amt;
    var date = impDate(c[map.date]), desc = String(c[map.desc] || '').slice(0, 120);
    return { date: date, desc: desc, amt: amt, kind: amt < 0 ? 'expense' : 'income', done: false, skip: false };
  }).filter(function (t) { return t.date && t.desc && t.amt !== 0; });
}

// Kept for quick use: read + guess + build in one go.
function impParse(text, flip) {
  var table = impReadTable(text); if (!table) return null;
  var g = impGuessColumns(table);
  if (g.date < 0 || g.desc < 0 || (g.mode === 'single' ? g.amount < 0 : (g.debit < 0 && g.credit < 0))) return null;
  return impBuildRows(table, g, flip);
}

// ---- Step 1: upload, then ask the user to confirm the columns ----
var importTable = null, importFileName = '', importAccount = '';
function impHeaderKey(head) { return head.map(function (h) { return h.toLowerCase().trim(); }).join('|'); }

function onImportFile(input) {
  var f = input.files && input.files[0];
  if (!f) return;
  var status = document.getElementById('money-import-status');
  status.textContent = 'Reading ' + f.name + '...';
  var reader = new FileReader();
  reader.onload = function () {
    input.value = '';
    var table = impReadTable(String(reader.result));
    importTx = []; importDupes = 0;
    if (!table || table.head.length < 2) { status.textContent = 'That file does not look like a CSV with column headings.'; document.getElementById('money-import-review').innerHTML = ''; return; }
    importTable = table; importFileName = f.name;
    status.textContent = f.name + ': ' + table.rows.length + ' rows. Check the columns below, then click Continue.';
    renderColumnCheck();
  };
  reader.readAsText(f);
}

function renderColumnCheck() {
  var t = importTable, saved = (moneyMeta('money_csv_maps_list').filter(function (m) { return m.key === impHeaderKey(t.head); })[0] || {}).map;
  var savedEntry = moneyMeta('money_csv_maps_list').filter(function (m) { return m.key === impHeaderKey(t.head); })[0] || {};
  var g = saved || impGuessColumns(t), accs = moneyAccountList();
  function opts(chosen, allowNone) {
    return (allowNone ? '<option value="-1">(none)</option>' : '') + t.head.map(function (h, i) {
      return '<option value="' + i + '"' + (i === chosen ? ' selected' : '') + '>' + moneyEsc(h || ('Column ' + (i + 1))) + '</option>';
    }).join('');
  }
  document.getElementById('money-import-review').innerHTML =
    '<div class="money-colcheck">' +
    '<p class="money-import-done">Is this right? Pick the column that holds each piece.</p>' +
    (saved ? '<p class="mood-note">Using the setup you confirmed last time for this bank. Change anything that looks off.</p>' : '<p class="mood-note">These are the app\'s best guesses. Change any that look wrong.</p>') +
    '<div class="money-colcheck-acc"><p class="sleep-label">Which account is this file from?</p>' +
    '<select id="col-acc" class="sleep-input" onchange="document.getElementById(\'col-acc-new\').style.display=this.value===\'__custom__\'?\'\':\'none\'">' + impOptions(accs, savedEntry.acc || accs[0]) + '<option value="__custom__">+ New account…</option></select>' +
    '<input type="text" id="col-acc-new" class="sleep-input" placeholder="e.g. Chase Checking" style="display:none">' +
    '<p class="mood-note">Every transaction in this file is saved to this account. Next time you import a file from this bank, it is picked for you.</p></div>' +
    '<div class="money-colcheck-grid">' +
    '<div><p class="sleep-label">Date</p><select id="col-date" class="sleep-input">' + opts(g.date) + '</select></div>' +
    '<div><p class="sleep-label">Name / description</p><select id="col-desc" class="sleep-input">' + opts(g.desc) + '</select></div>' +
    '<div><p class="sleep-label">Money is in</p><select id="col-mode" class="sleep-input"><option value="single"' + (g.mode === 'single' ? ' selected' : '') + '>One Amount column</option><option value="split"' + (g.mode === 'split' ? ' selected' : '') + '>Separate Debit and Credit columns</option></select></div>' +
    '<div id="col-single-wrap"><p class="sleep-label">Amount</p><select id="col-amount" class="sleep-input">' + opts(g.amount, true) + '</select></div>' +
    '<div id="col-debit-wrap"><p class="sleep-label">Debit (money out)</p><select id="col-debit" class="sleep-input">' + opts(g.debit, true) + '</select></div>' +
    '<div id="col-credit-wrap"><p class="sleep-label">Credit (money in)</p><select id="col-credit" class="sleep-input">' + opts(g.credit, true) + '</select></div>' +
    '</div><p class="sleep-label">Preview (first 3 rows)</p><div id="col-preview" class="money-out-box"></div><p id="col-warn" class="sleep-msg error"></p>' +
    '<div class="money-import-btns"><button type="button" class="settings-btn" onclick="confirmColumns()">Looks right, continue</button><button type="button" class="sleep-q-btn" onclick="cancelImport()">Cancel</button></div></div>';
  ['col-date', 'col-desc', 'col-mode', 'col-amount', 'col-debit', 'col-credit'].forEach(function (id) { document.getElementById(id).addEventListener('change', renderColumnPreview); });
  document.getElementById('money-import-flip').addEventListener('change', renderColumnPreview);
  renderColumnPreview();
}

function readColumnChoice() {
  function v(id) { return parseInt(document.getElementById(id).value, 10); }
  return { date: v('col-date'), desc: v('col-desc'), mode: document.getElementById('col-mode').value, amount: v('col-amount'), debit: v('col-debit'), credit: v('col-credit') };
}

function renderColumnPreview() {
  if (!document.getElementById('col-preview')) return;
  var m = readColumnChoice(), single = m.mode === 'single';
  document.getElementById('col-single-wrap').style.display = single ? '' : 'none';
  document.getElementById('col-debit-wrap').style.display = single ? 'none' : '';
  document.getElementById('col-credit-wrap').style.display = single ? 'none' : '';
  var flip = document.getElementById('money-import-flip').checked;
  var h = '<table class="money-table"><tr><th>Date</th><th>Name</th><th class="money-num">Amount</th></tr>';
  importTable.rows.slice(0, 3).forEach(function (c) {
    var amt = single ? impNum(c[m.amount]) : impNum(c[m.credit]) - Math.abs(impNum(c[m.debit]));
    if (flip) amt = -amt;
    h += '<tr><td>' + moneyEsc(c[m.date] || '') + '</td><td>' + moneyEsc(c[m.desc] || '') + '</td><td class="money-num ' + (amt < 0 ? 'money-out' : 'money-in') + '">' + moneyFmt(amt) + '</td></tr>';
  });
  document.getElementById('col-preview').innerHTML = h + '</table>';
  var warn = '';
  if (m.desc === m.date || (single && m.desc === m.amount)) warn = 'The name column is the same as another column. Pick a different one.';
  else if (importTable.rows.length > 5 && impVariety(importTable.rows, m.desc) <= 3) warn = 'Almost every row has the same name ("' + moneyEsc(importTable.rows[0][m.desc] || '') + '"). Is that really the name column?';
  else if (single ? m.amount < 0 : (m.debit < 0 && m.credit < 0)) warn = 'Pick the column with the money amounts.';
  document.getElementById('col-warn').innerHTML = warn;
}

function cancelImport() {
  importTable = null; importTx = [];
  document.getElementById('money-import-review').innerHTML = '';
  document.getElementById('money-import-status').textContent = 'Import cancelled.';
}

function confirmColumns() {
  var m = readColumnChoice();
  if (m.date < 0 || m.desc < 0 || (m.mode === 'single' ? m.amount < 0 : (m.debit < 0 && m.credit < 0))) {
    document.getElementById('col-warn').textContent = 'Pick a column for the date, the name and the amount.'; return;
  }
  // Which account this file belongs to (a new name is added to your account list).
  var accSel = document.getElementById('col-acc').value;
  if (accSel === '__custom__') {
    var nv = document.getElementById('col-acc-new').value.trim();
    if (!nv) { document.getElementById('col-warn').textContent = 'Type a name for the new account.'; return; }
    accSel = nv.charAt(0).toUpperCase() + nv.slice(1);
    savePref({ money_accounts: moneyUnique(moneyMeta('money_accounts').concat([accSel])) });
  }
  importAccount = accSel;
  // Remember this bank's column setup and account (matched by its heading line) for next time.
  var key = impHeaderKey(importTable.head);
  var list = moneyMeta('money_csv_maps_list').filter(function (x) { return x.key !== key; });
  list.push({ key: key, map: m, acc: accSel });
  currentUser.user_metadata = currentUser.user_metadata || {};
  currentUser.user_metadata.money_csv_maps_list = list;
  savePref({ money_csv_maps_list: list });

  var rows = impBuildRows(importTable, m, document.getElementById('money-import-flip').checked);
  var status = document.getElementById('money-import-status');
  if (!rows.length) { document.getElementById('col-warn').textContent = 'No rows had a readable date, name and amount with these columns.'; return; }
  // Duplicate protection: skip anything already in your Money tracker (same date, description, amount and type).
  var have = {};
  moneyLogs.forEach(function (r) { have[r.log_date + '|' + r.item + '|' + Number(r.amount).toFixed(2) + '|' + r.kind] = 1; });
  importDupes = 0; importSaved = 0;
  importTx = rows.filter(function (t) {
    var k = t.date + '|' + t.desc + '|' + Math.abs(t.amt).toFixed(2) + '|' + t.kind;
    if (have[k]) { importDupes++; return false; }
    return true;
  });
  importCur = 0;
  status.textContent = importFileName + ': ' + rows.length + ' transactions' + (importDupes ? ', ' + importDupes + ' already in your tracker (skipped)' : '') + '.';
  impNext();
}

function impNext() { while (importCur < importTx.length && (importTx[importCur].done || importTx[importCur].skip)) importCur++; renderImport(); }
function impSimilar(t, match, amt, tol) { return importTx.filter(function (o) { return o !== t && !o.done && !o.skip && o.kind === t.kind && impMatches(o.desc, match) && impAmountOk(o, amt, tol); }); }
function impOptions(list, chosen) { if (chosen && list.indexOf(chosen) < 0) list = [chosen].concat(list); return list.map(function (x) { return '<option' + (x === chosen ? ' selected' : '') + '>' + moneyEsc(x) + '</option>'; }).join(''); }

function renderImport() {
  var box = document.getElementById('money-import-review');
  if (!importTx.length) { box.innerHTML = importDupes ? '<p class="sleep-empty">Everything in that file is already in your tracker.</p>' : ''; return; }
  var left = importTx.filter(function (t) { return !t.done && !t.skip; }).length;
  if (importCur >= importTx.length) {
    box.innerHTML = '<p class="money-import-done">All sorted! ' + importSaved + ' added to your Money tracker, ' + importTx.filter(function (t) { return t.skip; }).length + ' skipped' + (importDupes ? ', ' + importDupes + ' duplicates ignored' : '') + '.</p>';
    return;
  }
  var t = importTx[importCur], rule = impRuleFor(t), match = rule ? rule.match : impAutoMatch(t.desc);
  var cats = moneyCategoryList(t.kind), accs = moneyAccountList();
  box.innerHTML =
    '<div class="money-import-count"><b>' + (importTx.length - left + 1) + ' of ' + importTx.length + '</b><span>' + left + ' left</span></div>' +
    '<div class="sleep-bar money-import-progress"><i class="met" style="width:' + ((importTx.length - left) / importTx.length * 100) + '%"></i></div>' +
    '<div class="money-import-card"><div class="sleep-sub">' + moneyDay(t.date) + '</div><div id="imp-desc" class="money-import-desc"></div>' +
    '<div class="money-import-amt ' + (t.kind === 'expense' ? 'money-out' : 'money-in') + '">' + moneyFmt(t.amt) + ' <span>' + t.kind + '</span></div></div>' +
    '<p class="sleep-label">Group by these words (edit to make it more or less specific)</p>' +
    '<input type="text" id="imp-match" class="sleep-input money-import-match" value="' + moneyEsc(match) + '">' +
    '<p class="mood-note">A transaction matches when its description has <b>all</b> of these words (highlighted).</p>' +
    '<p class="sleep-label">Amount is about (optional)</p><div class="money-import-amtrow">$ <input type="number" id="imp-amt" class="sleep-input" min="0" step="0.01" placeholder="any amount" value="' + (rule && rule.amt != null ? rule.amt : '') + '"> ± $ <input type="number" id="imp-tol" class="sleep-input" min="0" step="1" value="' + (rule && rule.tol != null ? rule.tol : 25) + '"></div>' +
    '<div class="money-import-grid"><div><p class="sleep-label">Category' + (rule ? ' (suggested)' : '') + '</p><select id="imp-cat" class="sleep-input" onchange="onImpCatSelect(this)">' + impOptions(cats, rule && rule.cat) + '<option value="__custom__">+ Add new category…</option></select><div id="imp-cat-new" class="money-new-row" style="display:none;"><input type="text" class="sleep-input" placeholder="New category name"><button type="button" class="settings-btn" onclick="addImpCustomCat()">Add</button></div></div>' +
    '<div><p class="sleep-label">Account</p><select id="imp-acc" class="sleep-input">' + impOptions(accs, importAccount || (rule ? rule.acc : accs[0])) + '</select></div></div>' +
    '<div id="imp-sim" class="money-import-sim"></div><div id="imp-btns" class="money-import-btns"></div>';
  ['imp-match', 'imp-amt', 'imp-tol'].forEach(function (id) { document.getElementById(id).addEventListener('input', renderImportSimilar); });
  renderImportSimilar();
}

function renderImportSimilar() {
  var t = importTx[importCur], match = document.getElementById('imp-match').value;
  var amt = impAmountInput(), tol = document.getElementById('imp-tol').value, sim = impSimilar(t, match, amt, tol);
  var amtText = amt === null ? '' : ' about ' + moneyFmt(amt) + ' ± ' + moneyFmt(Number(tol || 0));
  document.getElementById('imp-desc').innerHTML = impHighlight(t.desc, match);
  var simEl = document.getElementById('imp-sim');
  if (!impWords(match).length) simEl.innerHTML = '<span class="money-out">Type at least one word to match on.</span>';
  else if (!impAmountOk(t, amt, tol)) simEl.innerHTML = '<span class="money-out">This transaction itself is not' + amtText + '. Widen the ± range or clear the amount.</span>';
  else if (!sim.length) simEl.innerHTML = '<span class="sleep-sub">No other transactions in this file match "' + moneyEsc(match.toUpperCase()) + '"' + amtText + '.</span>';
  else simEl.innerHTML = '<b>' + sim.length + ' more match "' + moneyEsc(match.toUpperCase()) + '"' + amtText + ':</b>' + sim.map(function (o) {
    return '<div>' + moneyDay(o.date) + ' · ' + impHighlight(o.desc, match) + ' · <span class="' + (o.kind === 'expense' ? 'money-out' : 'money-in') + '">' + moneyFmt(o.amt) + '</span></div>';
  }).join('');
  var btns = document.getElementById('imp-btns');
  btns.innerHTML = (sim.length
    ? '<button type="button" class="settings-btn" data-imp="all">Use for all ' + (sim.length + 1) + '</button><button type="button" class="sleep-q-btn" data-imp="one">Just this one</button>'
    : '<button type="button" class="settings-btn" data-imp="one">Save</button>') + '<button type="button" class="sleep-q-btn" data-imp="skip">Skip</button>';
  btns.querySelectorAll('[data-imp]').forEach(function (b) { b.addEventListener('click', function () { importAction(b.getAttribute('data-imp')); }); });
}

async function importAction(a) {
  var t = importTx[importCur];
  if (a === 'skip') { t.skip = true; importCur++; impNext(); return; }
  var match = document.getElementById('imp-match').value.trim();
  var amt = impAmountInput(), tol = document.getElementById('imp-tol').value;
  if (!impWords(match).length || !impAmountOk(t, amt, tol)) return;
  var cat = document.getElementById('imp-cat').value, acc = document.getElementById('imp-acc').value;
  if (cat === '__custom__') { document.getElementById('money-import-status').textContent = 'Finish adding the new category first (type a name and click Add).'; return; }
  var group = a === 'all' ? [t].concat(impSimilar(t, match, amt, tol)) : [t];
  var rows = group.map(function (o) {
    return { user_id: currentUser.id, kind: o.kind, item: o.desc, amount: Math.round(Math.abs(o.amt) * 100) / 100, category: cat, account: acc, log_date: o.date };
  });
  document.querySelectorAll('#imp-btns button').forEach(function (b) { b.disabled = true; });
  var res = await sb.from('money_logs').insert(rows);
  if (res.error) {
    document.getElementById('money-import-status').textContent = 'Could not save: ' + res.error.message;
    document.querySelectorAll('#imp-btns button').forEach(function (b) { b.disabled = false; });
    return;
  }
  group.forEach(function (o) { o.done = true; });
  importSaved += group.length;
  impSaveRule(match, t.kind, cat, acc, amt, tol);
  renderRules();
  importCur++;
  await loadMoneyLogs();
  renderMoney();
  impNext();
}

function impAmountInput() { var v = document.getElementById('imp-amt').value; return v === '' ? null : Math.abs(parseFloat(v)); }

// ---- "Your sorting rules" list: see, add and delete rules without importing anything ----
function toggleRules() {
  var p = document.getElementById('money-rules-panel');
  p.style.display = p.style.display === 'none' ? 'block' : 'none';
  renderRules();
}
function renderRules() {
  var btn = document.getElementById('money-rules-toggle');
  var rules = impRules();
  if (btn) btn.textContent = 'Your sorting rules (' + rules.length + ')';
  var p = document.getElementById('money-rules-panel');
  if (!p || p.style.display === 'none') return;
  var kindName = { any: 'Either', expense: 'Expense', income: 'Income' };
  var h = rules.length ? '' : '<p class="sleep-empty">No rules yet. Add one below, or sort transactions during an import.</p>';
  rules.forEach(function (r, i) {
    h += '<div class="money-rule-row"><span><b>' + moneyEsc(r.match) + '</b>' + (r.amt != null ? ' · about ' + moneyFmt(r.amt) + ' ± ' + moneyFmt(r.tol || 0) : '') +
      ' · ' + kindName[r.kind || 'any'] + ' → <b>' + moneyEsc(r.cat) + '</b> · ' + moneyEsc(r.acc) + '</span><button type="button" class="sleep-del" data-rule="' + i + '" title="Delete this rule">x</button></div>';
  });
  var cats = moneyUnique(moneyCategoryList('expense').concat(moneyCategoryList('income')));
  h += '<div class="money-rule-form"><p class="sleep-label">Add a rule</p>' +
    '<div class="money-rule-grid">' +
    '<div><p class="sleep-label">Description has all these words</p><input type="text" id="rule-words" class="sleep-input money-import-match" placeholder="e.g. NETFLIX"></div>' +
    '<div><p class="sleep-label">Amount about (optional)</p><div class="money-import-amtrow">$ <input type="number" id="rule-amt" class="sleep-input" min="0" step="0.01" placeholder="any"> ± $ <input type="number" id="rule-tol" class="sleep-input" min="0" step="1" value="25"></div></div>' +
    '<div><p class="sleep-label">Money in or out</p><select id="rule-kind" class="sleep-input"><option value="any">Either</option><option value="expense">Expense</option><option value="income">Income</option></select></div>' +
    '<div><p class="sleep-label">Category</p><select id="rule-cat" class="sleep-input">' + impOptions(cats, 'Rent') + '</select></div>' +
    '<div><p class="sleep-label">Account</p><select id="rule-acc" class="sleep-input">' + impOptions(moneyAccountList(), 'Personal') + '</select></div>' +
    '</div><button type="button" class="settings-btn money-rule-add" onclick="addRuleFromForm()">Add rule</button><p id="rule-msg" class="sleep-msg"></p></div>';
  p.innerHTML = h;
  p.querySelectorAll('[data-rule]').forEach(function (b) {
    b.addEventListener('click', function () {
      var list = impRules().slice(); list.splice(+b.getAttribute('data-rule'), 1);
      impPersistRules(list); renderRules();
    });
  });
}
function addRuleFromForm() {
  var words = document.getElementById('rule-words').value, msg = document.getElementById('rule-msg');
  if (!impWords(words).length) { msg.className = 'sleep-msg error'; msg.textContent = 'Type at least one word.'; return; }
  var amt = document.getElementById('rule-amt').value;
  impSaveRule(words, document.getElementById('rule-kind').value, document.getElementById('rule-cat').value,
    document.getElementById('rule-acc').value, amt === '' ? null : Math.abs(parseFloat(amt)), document.getElementById('rule-tol').value);
  renderRules();
  var m2 = document.getElementById('rule-msg'); m2.className = 'sleep-msg ok'; m2.textContent = 'Rule added.';
}

// ---- "+ Add new category…" inside the import review ----
function onImpCatSelect(sel) {
  var row = document.getElementById('imp-cat-new');
  row.style.display = sel.value === '__custom__' ? 'flex' : 'none';
  if (sel.value === '__custom__') row.querySelector('input').focus();
}
async function addImpCustomCat() {
  var t = importTx[importCur];
  var input = document.querySelector('#imp-cat-new input');
  var val = input.value.trim();
  if (!val) { input.focus(); return; }
  val = val.charAt(0).toUpperCase() + val.slice(1);
  var key = 'money_cats_' + t.kind;
  var list = moneyUnique(moneyMeta(key).concat([val]));
  var data = {}; data[key] = list;
  currentUser.user_metadata = currentUser.user_metadata || {};
  currentUser.user_metadata[key] = list;
  var res = await sb.auth.updateUser({ data: data });
  if (res && res.data && res.data.user) currentUser = res.data.user;
  var sel = document.getElementById('imp-cat');
  sel.innerHTML = impOptions(moneyCategoryList(t.kind), val) + '<option value="__custom__">+ Add new category…</option>';
  sel.value = val;
  input.value = '';
  document.getElementById('imp-cat-new').style.display = 'none';
  refreshMoneySelects();   // the "Add an entry" dropdown gets the new category too
}

// ---- Start-over buttons (Money tracker > Import box) ----
async function clearMoneyRules() {
  if (!confirm('Delete ALL your sorting rules and saved bank column setups?\n\nYour money entries stay.')) return;
  currentUser.user_metadata = currentUser.user_metadata || {};
  currentUser.user_metadata.money_rules = [];
  currentUser.user_metadata.money_csv_maps_list = [];
  savePref({ money_rules: [], money_csv_maps_list: [] });
  renderRules();
  document.getElementById('money-import-status').textContent = 'All sorting rules cleared.';
}
async function clearAllMoney() {
  if (!confirm('Delete EVERY entry in your Money tracker (imported and typed in)?\n\nThis cannot be undone.')) return;
  var res = await sb.from('money_logs').delete().eq('user_id', currentUser.id);
  if (res.error) { document.getElementById('money-import-status').textContent = 'Could not delete: ' + res.error.message; return; }
  importTx = []; importTable = null;
  document.getElementById('money-import-review').innerHTML = '';
  await loadMoneyLogs();
  renderMoney();
  document.getElementById('money-import-status').textContent = 'All money entries deleted.';
}

// ============================================
// PACE CHART (Month progress box, only when XP Mode is off)
// Solid line: habits done so far. Dashed line: what you should have done by each day.
// Uses the same rules as the "Habits done" bar, including "Hard habits optional".
// ============================================
var paceChartInstance = null;
function renderPaceChart() {
  var wrap = document.getElementById('pace-wrap'), el = document.getElementById('paceChart');
  if (!wrap || !el) return;
  if (paceChartInstance) { paceChartInstance.destroy(); paceChartInstance = null; }
  wrap.style.display = xpMode ? 'none' : '';
  if (xpMode) return;

  var now = new Date(), isThisMonth = (now.getMonth() + 1 === currentMonth && now.getFullYear() === currentYear);
  var isFuture = new Date(currentYear, currentMonth - 1, 1) > now;
  var lastDay = isThisMonth ? now.getDate() : (isFuture ? 0 : DAYS_IN_MONTH);
  var labels = [], done = [], pace = [], gap = [], runDone = 0, runGoal = 0, monthGoal = 0;

  for (var d = 1; d <= DAYS_IN_MONTH; d++) {
    var iso = currentYear + '-' + String(currentMonth).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    var dayGoal = 0, dayDone = 0;
    RAW_HABITS.forEach(function (h) {
      var req = dayRequirement(h, d);
      if (!(req > 0)) return;
      var got = Math.min((logsLookup[String(h.id)] && logsLookup[String(h.id)][iso]) || 0, req);
      dayGoal += isHardOptional(h) ? got : req;   // a missed hard habit isn't required when the toggle is on
      dayDone += got;
    });
    runGoal += dayGoal; monthGoal += dayGoal;
    if (d <= lastDay) runDone += dayDone;
    labels.push(d);
    pace.push(runGoal);
    done.push(d <= lastDay ? runDone : null);
    gap.push(d <= lastDay ? runGoal : null);
  }

  var pink = getThemeColor('--c-pink'), muted = getThemeColor('--c-text-muted');
  paceChartInstance = new Chart(el, {
    type: 'line',
    data: { labels: labels, datasets: [
      { label: 'gap', data: gap, borderWidth: 0, pointRadius: 0, fill: '+1', backgroundColor: hexToRgba(pink, 0.25) },
      { label: 'Habits done so far', data: done, borderColor: pink, backgroundColor: pink, borderWidth: 2.5, pointRadius: 2, tension: 0.15, fill: false },
      { label: 'On-pace line', data: pace, borderColor: muted, borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, fill: false }
    ] },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { filter: function (i) { return i.datasetIndex > 0; }, callbacks: { label: function (c) { return c.dataset.label + ': ' + Math.round(c.parsed.y); } } }
      },
      scales: {
        x: { ticks: { color: muted, font: { size: 10 }, autoSkip: true, maxRotation: 0 }, grid: { display: false } },
        y: { beginAtZero: true, suggestedMax: Math.max(1, monthGoal), ticks: { color: muted, font: { size: 10 } }, title: { display: true, text: 'habits', color: muted, font: { size: 10 } } }
      }
    }
  });

  var note = document.getElementById('pace-note');
  if (!lastDay) { note.textContent = 'This month has not started yet.'; return; }
  var target = pace[lastDay - 1], behind = Math.round(target - runDone);
  var daysLeft = DAYS_IN_MONTH - lastDay, remaining = Math.max(0, monthGoal - runDone);
  if (behind > 0) note.textContent = 'Day ' + lastDay + ': ' + runDone + ' done vs ' + Math.round(target) + ' on pace, about ' + behind + ' to catch up.' + (daysLeft ? ' To finish on goal: ' + Math.ceil(remaining / daysLeft) + ' a day.' : '');
  else note.textContent = 'Day ' + lastDay + ': ' + runDone + ' done vs ' + Math.round(target) + ' on pace. You are on track!';
}


// ============================================
// REWARD SHOP (tables: "shop_items" and "shop_purchases")
// Gold is worked out from your habit history (like XP), starting the day the shop
// was first opened. Unchecking a habit takes its gold back. Spending is subtracted.
// ============================================
var GOLD_VALUES = { easy: 2, medium: 5, hard: 10 };   // gold per completion
var GOLD_UNRANKED = 1;   // perfect days and streaks now pay out through the treasure chests (CHESTS)
var SHOP_TIERS = [
  { k: 'tiny', n: 'Tiny', lo: 15, hi: 25, takes: '1 day' },
  { k: 'small', n: 'Small', lo: 50, hi: 80, takes: '3 days' },
  { k: 'medium', n: 'Medium', lo: 150, hi: 250, takes: '1–2 weeks' },
  { k: 'big', n: 'Big', lo: 500, hi: 700, takes: '~1 month' },
  { k: 'epic', n: 'Epic', lo: 1500, hi: null, takes: '2–3 months' }
];
var SHOP_STARTERS = [
  ['tiny', 'Fancy coffee', 20], ['tiny', 'Bath bomb', 15], ['tiny', '30 min guilt-free scrolling', 25],
  ['small', 'Takeout', 70], ['small', 'New nail polish', 50], ['small', 'Movie night', 60],
  ['medium', 'Skincare product', 200], ['medium', 'Craft supplies', 150], ['medium', 'A lazy day off', 250],
  ['big', 'Clothing item', 600], ['big', 'Concert ticket', 700], ['big', 'Day trip', 500],
  ['epic', 'Gadget / big purchase', 1500]
];
var shopItems = [], shopPurchases = [], shopTaskRows = [], shopHistFilter = 'all';

function toggleShopPage() {
  var page = document.getElementById('shop-page');
  var opening = page.style.display !== 'block';
  page.style.display = opening ? 'block' : 'none';
  if (!opening) return;
  ['sleep-page', 'history-page', 'mood-page', 'money-page', 'memory-page', 'every-page'].forEach(function (id) { var el = document.getElementById(id); if (el) el.style.display = 'none'; });
  fillShopTierSelect();
  loadShop().then(renderShop);
}

// The day gold starts counting. Set once, the first time the shop is opened, and saved to your account.
function goldStartDate() {
  var meta = currentUser.user_metadata || {};
  if (meta.gold_start) return meta.gold_start;
  var today = localISO(new Date());
  currentUser.user_metadata = meta; meta.gold_start = today;
  sb.auth.updateUser({ data: { gold_start: today } }).then(function (r) { if (r && r.data && r.data.user) currentUser = r.data.user; });
  return today;
}

async function loadShop() {
  if (!currentUser) return;
  var a = await sb.from('shop_items').select('*').eq('user_id', currentUser.id).order('price', { ascending: true });
  if (a.error) { setShopMsg('Could not load the shop: ' + a.error.message); return; }
  shopItems = a.data || [];
  // First visit: stock the shop with the starter rewards (only once, even if you delete them later).
  if (!shopItems.length && !(currentUser.user_metadata && currentUser.user_metadata.shop_seeded)) {
    var rows = SHOP_STARTERS.map(function (s) { return { user_id: currentUser.id, tier: s[0], name: s[1], price: s[2] }; });
    var ins = await sb.from('shop_items').insert(rows);
    if (!ins.error) {
      currentUser.user_metadata = currentUser.user_metadata || {}; currentUser.user_metadata.shop_seeded = true;
      sb.auth.updateUser({ data: { shop_seeded: true } }).then(function (r) { if (r && r.data && r.data.user) currentUser = r.data.user; });
      var again = await sb.from('shop_items').select('*').eq('user_id', currentUser.id).order('price', { ascending: true });
      shopItems = again.data || [];
    }
  }
  var b = await sb.from('shop_purchases').select('*').eq('user_id', currentUser.id).order('bought_at', { ascending: false });
  if (b.error) { setShopMsg('Could not load purchases: ' + b.error.message); return; }
  shopPurchases = b.data || [];
  var c = await sb.from('weekly_tasks').select('week_number,month,year,is_checked,difficulty,task_text').eq('user_id', currentUser.id).eq('is_checked', true);
  shopTaskRows = (c.data || []).filter(function (r) { return r.difficulty && r.task_text && r.task_text.trim(); });
  setShopMsg('');
}

function setShopMsg(t) { var el = document.getElementById('shop-msg'); if (el) el.textContent = t; }

// ---- Gold math ----
function computeGold() {
  var start = goldStartDate(), today = localISO(new Date()), earned = 0;
  var byHabit = [], tasks = { count: 0, gold: 0 }, streaks = 0;   // breakdown for the hover box
  var dayEarn = {};   // gold earned on each date (for the "Gold over time" chart)
  function addDay(iso, g) { if (iso > today) iso = today; if (iso < start) iso = start; dayEarn[iso] = (dayEarn[iso] || 0) + g; }
  // 1) Habits: gold per completion, capped at what was required that day (extra ticks earn nothing).
  allHabits().forEach(function (h) {
    var per = GOLD_VALUES[h.difficulty] || GOLD_UNRANKED, hid = String(h.id), logs = allTimeLogs[hid] || {}, cnt = 0;
    Object.keys(logs).forEach(function (iso) {
      if (iso < start || iso > today) return;
      var n = logs[iso] || 0; if (n <= 0) return;
      var p = iso.split('-'), req = habitRequiredOn(h, +p[0], +p[1], +p[2]);
      var c = Math.min(n, req > 0 ? req : 1);
      cnt += c; addDay(iso, c * per);
    });
    earned += cnt * per;
    if (cnt) byHabit.push({ name: (h.icon ? h.icon + ' ' : '') + h.name, count: cnt, per: per, gold: cnt * per });
  });
  byHabit.sort(function (a, b) { return b.gold - a.gold; });
  // 2) Weekly tasks checked in a week that started on/after the start date.
  shopTaskRows.forEach(function (r) {
    var wk = localISO(new Date(r.year, r.month - 1, 1 + r.week_number * 7));
    var gv = GOLD_VALUES[r.difficulty] || 0;
    if (wk >= start && gv) { earned += gv; tasks.count++; tasks.gold += gv; addDay(wk, gv); }
  });
  // 3) Treasure chests (daily, 7-day streak, week, month). Past ones count automatically; today's count once you open them.
  var chestCount = { day: 0, streak: 0, week: 0, month: 0 }, perfect = 0;
  chestEarned().forEach(function (c) {
    if (c.iso < start) return;
    var g = CHESTS[c.type].gold;
    earned += g; chestCount[c.type]++; addDay(c.iso, g);
  });
  perfect = chestCount.day; streaks = chestCount.streak;
  var spent = shopPurchases.reduce(function (a, p) { return a + Number(p.price); }, 0);
  var daySpend = {};
  shopPurchases.forEach(function (p) {
    var iso = p.bought_at ? localISO(new Date(p.bought_at)) : today;
    if (iso < start) iso = start; if (iso > today) iso = today;
    daySpend[iso] = (daySpend[iso] || 0) + Number(p.price);
  });
  return { start: start, earned: earned, spent: spent, balance: earned - spent, perfect: perfect, byHabit: byHabit, tasks: tasks, streaks: streaks, chests: chestCount, dayEarn: dayEarn, daySpend: daySpend };
}

// ============================================
// TREASURE CHESTS
// Nothing is stored except which of today's chests you opened (chest_open in your account).
// Everything else is worked out from your check-ins, so unchecking a habit locks the chest again.
//   Daily chest   – today's required check-ins reach the target      +10 G (+15 XP in XP Mode)
//   7-day streak  – every 7th day in a row that reaches its target   +50 G (+50 XP)
//   Week chest    – a week block (days 1–7, 8–14 …) reaches target   +25 G (+40 XP)
//   Month chest   – the whole month reaches the target               +100 G (+150 XP)
//   Targets are 100% unless changed in Settings (50–100%).
// Chests from past days pay out on their own. Today's chest pays out when you tap it open.
// ============================================
var CHESTS = {
  day:    { name: 'Daily chest',  gold: 10,  xp: 15 },
  streak: { name: '7-day streak', gold: 50,  xp: 50 },
  week:   { name: 'Week chest',   gold: 25,  xp: 40 },
  month:  { name: 'Month chest',  gold: 100, xp: 150 }
};
var CHEST_SIDES = { today: ['day', 'streak'], month: ['week', 'month'] };

function chestOpened() { var m = currentUser && currentUser.user_metadata; return (m && m.chest_open) || {}; }

// Open targets (Settings → Treasure chest targets). 100 = every required check-in; 80 = 80% is enough.
// The streak target is how good each day has to be to count toward the 7 in a row.
var CHEST_TARGET_MIN = 50;
function chestTargets() {
  var m = currentUser && currentUser.user_metadata, t = (m && m.chest_targets) || {}, out = {};
  Object.keys(CHESTS).forEach(function (k) { var v = Number(t[k]); out[k] = (v >= CHEST_TARGET_MIN && v <= 100) ? Math.round(v) : 100; });
  return out;
}
function toggleChestTargets() {
  var el = document.getElementById('chest-targets'); if (!el) return;
  var opening = el.style.display === 'none';
  el.style.display = opening ? '' : 'none';
  if (!opening) return;
  var t = chestTargets(), labels = { day: 'Daily chest: today is at least', streak: '7-day streak: each day is at least', week: 'Week chest: the week is at least', month: 'Month chest: the month is at least' };
  el.innerHTML = '';
  Object.keys(CHESTS).forEach(function (k) {
    var row = document.createElement('label'); row.className = 'chest-target-row';
    row.innerHTML = '<span>' + labels[k] + '</span><span><input type="number" min="' + CHEST_TARGET_MIN + '" max="100" step="5" value="' + t[k] + '" data-chest="' + k + '"> %</span>';
    el.appendChild(row);
  });
  var reset = document.createElement('button'); reset.type = 'button'; reset.className = 'settings-btn'; reset.textContent = 'Back to 100% for all';
  reset.addEventListener('click', function () { el.querySelectorAll('input').forEach(function (i) { i.value = 100; }); saveChestTargets(); });
  el.appendChild(reset);
  el.querySelectorAll('input').forEach(function (i) { i.addEventListener('change', saveChestTargets); });
}
function saveChestTargets() {
  var el = document.getElementById('chest-targets'), t = {};
  el.querySelectorAll('input[data-chest]').forEach(function (i) {
    var v = Math.round(Number(i.value)); if (!(v >= CHEST_TARGET_MIN)) v = CHEST_TARGET_MIN; if (v > 100) v = 100;
    i.value = v; t[i.dataset.chest] = v;
  });
  savePref({ chest_targets: t });
  renderChests(); renderXpStats();
}

// Required habits on one date: how many are due and whether all are done.
function chestDay(dt) {
  var iso = localISO(dt), y = dt.getFullYear(), m = dt.getMonth() + 1, d = dt.getDate(), need = 0, req = 0, got = 0;
  RAW_HABITS.forEach(function (h) {
    if (isHardOptional(h)) return;   // "Hard habits optional" on: hard habits don't block a chest
    var created = h.created_at ? localISO(new Date(h.created_at)) : '';
    if (created && iso < created) return;
    var r = habitRequiredOn(h, y, m, d);
    if (!r) return;
    need++; req += r;
    got += Math.min(((allTimeLogs[String(h.id)] || {})[iso] || 0), r);
  });
  var pct = req ? Math.floor(got / req * 100) : 0;
  return { iso: iso, need: need, pct: pct };
}

// Every chest earned from your first check-in up to today, plus where today's chests stand.
// Week and month chests are dated the last day of their week/month, so this week's chest can open early
// once the whole week (days still to come count as not done) already reaches its target.
function chestScan() {
  var first = null, T = chestTargets();
  allHabits().forEach(function (h) { Object.keys(allTimeLogs[String(h.id)] || {}).forEach(function (iso) { if ((allTimeLogs[String(h.id)][iso] || 0) > 0 && (!first || iso < first)) first = iso; }); });
  var now = new Date(); now.setHours(0, 0, 0, 0);
  var today = localISO(now), list = [], run = 0, todayInfo = null;
  if (!first) first = today;
  var p = first.split('-'), dt = new Date(+p[0], +p[1] - 1, 1);   // start at the 1st so week/month blocks are whole
  for (; dt <= now; dt.setDate(dt.getDate() + 1)) {
    var y = dt.getFullYear(), m = dt.getMonth() + 1, d = dt.getDate(), dim = new Date(y, m, 0).getDate();
    var info = chestDay(dt), iso = info.iso, isToday = iso === today;
    info.met = info.need > 0 && info.pct >= T.day;
    if (info.met) list.push({ type: 'day', iso: iso, cur: isToday });
    if (info.need && info.pct >= T.streak) { run++; if (run % 7 === 0) list.push({ type: 'streak', iso: iso, cur: isToday }); }
    else if (info.need && !isToday) run = 0;
    var ws = d - ((d - 1) % 7), we = Math.min(ws + 6, dim);
    var endIso = function (dd) { return y + '-' + String(m).padStart(2, '0') + '-' + String(dd).padStart(2, '0'); };
    if (d === we || isToday) { var wp = chestPct(y, m, ws, we); if (wp.req && wp.pct >= T.week) list.push({ type: 'week', iso: endIso(we), cur: endIso(we) >= today }); }
    if (d === dim || isToday) { var mp = chestPct(y, m, 1, dim); if (mp.req && mp.pct >= T.month) list.push({ type: 'month', iso: endIso(dim), cur: endIso(dim) >= today }); }
    if (isToday) todayInfo = info;
  }
  return { list: list, today: today, todayInfo: todayInfo, run: run };
}

// Chests that pay out: anything before today, and today's only once opened.
function chestEarned(scan) {
  scan = scan || chestScan();
  var open = chestOpened();
  return scan.list.filter(function (c) { return !c.cur || open[c.type] === c.iso; });
}

// Percent of the required check-ins done between two days of a month (future days count as not done yet).
function chestPct(y, m, d1, d2) {
  var req = 0, got = 0;
  RAW_HABITS.forEach(function (h) {
    if (isHardOptional(h)) return;
    var created = h.created_at ? localISO(new Date(h.created_at)) : '';
    for (var d = d1; d <= d2; d++) {
      var iso = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      if (created && iso < created) continue;   // days before the habit existed don't count
      var r = habitRequiredOn(h, y, m, d); if (!r) continue;
      req += r; got += Math.min(((allTimeLogs[String(h.id)] || {})[iso]) || 0, r);
    }
  });
  return { req: req, pct: req ? Math.floor(got / req * 100) : 0 };
}

function chestSvg() {
  return '<svg viewBox="0 0 70 58" aria-hidden="true"><ellipse class="chest-glow" cx="35" cy="26" rx="26" ry="12"/>' +
    '<rect class="chest-wood" x="8" y="26" width="54" height="28" rx="3"/><rect class="chest-band" x="8" y="34" width="54" height="5"/>' +
    '<rect class="chest-lock" x="31" y="31" width="8" height="11" rx="1.5"/>' +
    '<g class="chest-lid"><path class="chest-lid-wood" d="M8 26 V18 Q35 4 62 18 V26 Z"/><path class="chest-lid-band" d="M8 22 Q35 9 62 22"/></g></svg>';
}

function renderChests() {
  var sides = { today: document.getElementById('chests-today'), month: document.getElementById('chests-month') };
  if (!sides.today && !sides.month) return;
  if (!currentUser) return;
  var scan = chestScan(), open = chestOpened(), today = scan.today, now = new Date();
  var y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate(), dim = new Date(y, m, 0).getDate();
  var ws = d - ((d - 1) % 7), we = Math.min(ws + 6, dim);
  var earnedToday = {}, T = chestTargets(); scan.list.forEach(function (c) { if (c.cur) earnedToday[c.type] = c.iso; });
  var ti = scan.todayInfo || { need: 0, met: false }, doneToday = 0;
  if (ti.need) RAW_HABITS.forEach(function (h) { if (isHardOptional(h)) return; var r = habitRequiredOn(h, y, m, d); if (r && (((allTimeLogs[String(h.id)] || {})[today]) || 0) >= r) doneToday++; });
  var status = {
    day: ti.need ? (T.day < 100 ? ti.pct + '% of ' + T.day + '%' : doneToday + ' / ' + ti.need + ' done') : 'nothing due today',
    streak: 'day ' + (scan.run % 7 || (earnedToday.streak ? 7 : 0)) + ' of 7',
    week: chestPct(y, m, ws, we).pct + '% of ' + T.week + '%',
    month: chestPct(y, m, 1, dim).pct + '% of ' + T.month + '%'
  };
  Object.keys(CHEST_SIDES).forEach(function (side) {
    var el = sides[side]; if (!el) return;
    el.innerHTML = '';
    CHEST_SIDES[side].forEach(function (type) {
      var c = CHESTS[type], state = !earnedToday[type] ? 'locked' : open[type] === earnedToday[type] ? 'open' : 'ready';
      var reward = '+' + c.gold + ' G' + (xpMode ? ' · +' + c.xp + ' XP' : '');
      var box = document.createElement('div');
      box.className = 'chest chest-' + state;
      box.title = c.name + ': ' + reward + (type === 'day' ? ' when today reaches ' + T.day + '%' : type === 'streak' ? ' every 7th day in a row at ' + T.streak + '% or more' : type === 'week' ? ' when this week block reaches ' + T.week + '%' : ' when the whole month reaches ' + T.month + '%') + ' (change targets in ⚙ Settings)';
      box.innerHTML = chestSvg() + '<div class="chest-name">' + c.name + '</div><div class="chest-status">' +
        (state === 'ready' ? 'tap to open!' : state === 'open' ? reward + ' ✓' : status[type]) + '</div>';
      if (state === 'ready') { box.setAttribute('role', 'button'); box.tabIndex = 0; box.addEventListener('click', function () { openChest(type, box, earnedToday[type]); }); }
      el.appendChild(box);
    });
  });
}

function openChest(type, box, key) {
  var open = Object.assign({}, chestOpened()), c = CHESTS[type];
  open[type] = key;   // the day this chest is dated (today, or the last day of this week/month)
  savePref({ chest_open: open });
  box.className = 'chest chest-open';
  for (var i = 0; i < 12; i++) {   // coins fly out of the chest
    var coin = document.createElement('i');
    coin.className = 'chest-coin';
    coin.style.setProperty('--dx', (Math.random() * 90 - 45) + 'px');
    coin.style.setProperty('--dy', (-30 - Math.random() * 40) + 'px');
    coin.style.animationDelay = (i * 0.03) + 's';
    box.appendChild(coin);
  }
  victory('big', c.name + '! +' + c.gold + ' G' + (xpMode ? ' +' + c.xp + ' XP' : ''));
  setTimeout(function () { renderChests(); renderXpStats(); }, 1100);
}

// "Gold over time" line: starts at 0 on your first day; each point is your balance at the END of that day
// (gold earned that day minus anything you bought that day), so the next day starts where the last one ended.
var goldHistoryChart = null;
function renderGoldHistory(g) {
  var canvas = document.getElementById('goldHistoryChart'); if (!canvas || typeof Chart === 'undefined') return;
  var p = g.start.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2]), end = new Date(); end.setHours(0, 0, 0, 0);
  var labels = ['Start'], vals = [0], info = [''], bal = 0;
  for (; d <= end; d.setDate(d.getDate() + 1)) {
    var iso = localISO(d), e = g.dayEarn[iso] || 0, s = g.daySpend[iso] || 0;
    bal += e - s;
    labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    vals.push(bal);
    info.push('+' + e + ' G earned' + (s ? ', −' + s + ' G spent' : ''));
  }
  var gold = getThemeColor('--shop-gold') || '#B8860B', muted = getThemeColor('--c-text-muted') || '#888';
  if (goldHistoryChart) goldHistoryChart.destroy();
  goldHistoryChart = new Chart(canvas, {
    type: 'line',
    data: { labels: labels, datasets: [{ data: vals, borderColor: gold, backgroundColor: hexToRgba(gold, 0.15), fill: true, tension: 0, borderWidth: 2, pointRadius: vals.length > 40 ? 0 : 3, pointBackgroundColor: gold }] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: {
        title: function (c) { return c[0].dataIndex === 0 ? 'Start of day 1' : 'End of ' + c[0].label; },
        label: function (c) { return 'Balance: ' + c.raw + ' G'; },
        afterLabel: function (c) { return info[c.dataIndex]; } } } },
      scales: {
        x: { ticks: { color: muted, font: { size: 10 }, autoSkip: true, maxRotation: 0 }, grid: { display: false } },
        y: { suggestedMin: 0, ticks: { color: muted, font: { size: 10 }, precision: 0 }, grid: { color: hexToRgba(muted, 0.2) } }
      } }
  });
}

// Hover box on "Your gold": which habits earned what. Hover on computer, tap on phone.
function renderGoldBreakdown(g) {
  var box = document.getElementById('gold-breakdown'); if (!box) return;
  var row = function (label, sub, gold, cls) {
    return '<div class="gold-row' + (cls ? ' ' + cls : '') + '"><span>' + label + (sub ? ' <small>' + sub + '</small>' : '') + '</span><b>' + gold + '</b></div>';
  };
  var h = '<div class="gold-bd-title">Where your gold came from</div>';
  if (!g.byHabit.length && !g.tasks.count && !g.perfect) h += '<p class="gold-bd-empty">Nothing earned yet. Check off a habit!</p>';
  g.byHabit.forEach(function (b) { h += row(moneyEsc(b.name), b.count + ' × ' + b.per + ' G', '+' + b.gold + ' G'); });
  if (g.tasks.count) h += row('Weekly tasks', g.tasks.count + ' done', '+' + g.tasks.gold + ' G');
  ['day', 'streak', 'week', 'month'].forEach(function (t) { var n = g.chests[t]; if (n) h += row(CHESTS[t].name + 's', n + ' × ' + CHESTS[t].gold + ' G', '+' + n * CHESTS[t].gold + ' G'); });
  h += row('Earned', '', g.earned + ' G', 'gold-total');
  if (g.spent) h += row('Spent in shop', '', '−' + g.spent + ' G');
  h += row('Balance', '', g.balance + ' G', 'gold-total');
  box.innerHTML = h;
}
function toggleGoldBreakdown(e) {
  if (e.target.closest('#gold-breakdown')) return;
  document.querySelector('.shop-wallet').classList.toggle('gold-open');
}

function shopDays(p) { return Math.max(1, Math.round(p / 20)); }
function shopPretty(iso) { return moneyDay(String(iso).slice(0, 10)); }

function renderShop() {
  var g = computeGold();
  var bal = document.getElementById('shop-balance');
  bal.textContent = g.balance + ' G';
  bal.className = 'shop-big ' + (g.balance < 0 ? 'money-out' : 'shop-gold');
  document.getElementById('shop-earned').textContent = 'Earned ' + g.earned + ' G · Spent ' + g.spent + ' G · counting since ' + shopPretty(g.start);
  renderGoldBreakdown(g);
  renderGoldHistory(g);

  var h = '';
  SHOP_TIERS.forEach(function (t) {
    var list = shopItems.filter(function (i) { return i.tier === t.k; });
    h += '<div class="shop-tier-head"><b>' + t.n + '</b><span>' + t.lo + (t.hi ? '–' + t.hi : '+') + ' G · takes about ' + t.takes + '</span></div><div class="shop-grid">';
    if (!list.length) h += '<p class="sleep-empty">No rewards in this tier yet.</p>';
    list.forEach(function (i) {
      var ok = g.balance >= i.price, dd = shopDays(i.price);
      h += '<div class="shop-card"><b>' + moneyEsc(i.name) + '</b><span><span class="shop-gold">' + i.price + ' G</span> <span class="sleep-sub">≈ ' + dd + ' good day' + (dd > 1 ? 's' : '') + '</span></span>' +
        (ok ? '' : '<span class="sleep-sub">' + (i.price - g.balance) + ' G to go</span>') +
        '<div class="shop-card-btns"><button type="button" class="settings-btn shop-buy' + (ok ? '' : ' shop-locked') + '" data-buy="' + i.id + '">' + (ok ? 'Buy' : '🔒 Buy') + '</button><button type="button" class="sleep-del" data-delitem="' + i.id + '" title="Remove from shop">x</button></div></div>';
    });
    h += '</div>';
  });
  var shop = document.getElementById('shop-list');
  shop.innerHTML = h;
  shop.querySelectorAll('[data-buy]').forEach(function (b) { b.addEventListener('click', function () { buyShopItem(+b.getAttribute('data-buy')); }); });
  shop.querySelectorAll('[data-delitem]').forEach(function (b) { b.addEventListener('click', function () { deleteShopItem(+b.getAttribute('data-delitem')); }); });
  renderShopHistory();
}

function renderShopHistory() {
  var tabs = document.getElementById('shop-hist-tabs'); tabs.innerHTML = '';
  var waiting = shopPurchases.filter(function (p) { return !p.redeemed; }).length;
  [['all', 'All'], ['todo', 'Not redeemed (' + waiting + ')'], ['done', 'Redeemed']].forEach(function (t) {
    var b = document.createElement('button'); b.type = 'button';
    b.className = 'sleep-q-btn' + (shopHistFilter === t[0] ? ' on' : ''); b.textContent = t[1];
    b.addEventListener('click', function () { shopHistFilter = t[0]; renderShopHistory(); });
    tabs.appendChild(b);
  });
  var list = shopPurchases.filter(function (p) { return shopHistFilter === 'all' || (shopHistFilter === 'todo' ? !p.redeemed : p.redeemed); });
  var el = document.getElementById('shop-history');
  if (!list.length) { el.innerHTML = '<p class="sleep-empty">' + (shopPurchases.length ? 'Nothing here.' : 'No purchases yet. Treat yourself!') + '</p>'; }
  else el.innerHTML = list.map(function (p) {
    return '<div class="shop-hist-row"><span>' + shopPretty(p.bought_at) + ' · <b>' + moneyEsc(p.item_name) + '</b></span><span class="money-out">−' + p.price + ' G</span>' +
      (p.redeemed
        ? '<span class="shop-status shop-redeemed">✓ Redeemed ' + (p.redeemed_at ? shopPretty(p.redeemed_at) : '') + ' <button type="button" class="sleep-del shop-undo" data-unredeem="' + p.id + '" title="Mark as not redeemed">↺</button></span>'
        : '<span class="shop-status"><button type="button" class="sleep-q-btn" data-redeem="' + p.id + '">Mark redeemed</button></span>') + '</div>';
  }).join('');
  el.querySelectorAll('[data-redeem]').forEach(function (b) { b.addEventListener('click', function () { setRedeemed(+b.getAttribute('data-redeem'), true); }); });
  el.querySelectorAll('[data-unredeem]').forEach(function (b) { b.addEventListener('click', function () { setRedeemed(+b.getAttribute('data-unredeem'), false); }); });
  var ym = localISO(new Date()).slice(0, 7);
  var month = shopPurchases.filter(function (p) { return String(p.bought_at).slice(0, 7) === ym; });
  document.getElementById('shop-hist-sum').textContent = month.length ? 'Spent this month: ' + month.reduce(function (a, p) { return a + Number(p.price); }, 0) + ' G on ' + month.length + ' treat' + (month.length > 1 ? 's' : '') + '.' : '';
}

async function buyShopItem(id) {
  var item = shopItems.filter(function (i) { return i.id === id; })[0]; if (!item) return;
  var g = computeGold();
  if (g.balance < item.price) { setShopMsg('Not enough gold for "' + item.name + '" yet: you need ' + (item.price - g.balance) + ' G more.'); return; }
  if (!confirm('Buy "' + item.name + '" for ' + item.price + ' G?')) return;
  var res = await sb.from('shop_purchases').insert({ user_id: currentUser.id, item_name: item.name, tier: item.tier, price: item.price, redeemed: false });
  if (res.error) { setShopMsg('Could not buy: ' + res.error.message); return; }
  await loadShop(); renderShop();
  setShopMsg('Bought "' + item.name + '"! It is in your purchase history, ready to redeem.');
  victory('big', 'Treat yourself! 🎁');
}

async function setRedeemed(id, on) {
  var res = await sb.from('shop_purchases').update({ redeemed: on, redeemed_at: on ? new Date().toISOString() : null }).eq('id', id);
  if (res.error) { setShopMsg('Could not update: ' + res.error.message); return; }
  if (on) victory('pop', 'Enjoy it! ✨');
  await loadShop(); renderShop();
}

async function deleteShopItem(id) {
  var item = shopItems.filter(function (i) { return i.id === id; })[0];
  if (!item || !confirm('Remove "' + item.name + '" from the shop?')) return;
  var res = await sb.from('shop_items').delete().eq('id', id);
  if (res.error) { setShopMsg('Could not remove: ' + res.error.message); return; }
  await loadShop(); renderShop();
}

function fillShopTierSelect() {
  var sel = document.getElementById('shop-new-tier');
  if (!sel.options.length) {
    sel.innerHTML = SHOP_TIERS.map(function (t) { return '<option value="' + t.k + '">' + t.n + ' (' + t.lo + (t.hi ? '–' + t.hi : '+') + ' G)</option>'; }).join('');
    suggestShopPrice();
  }
}
function suggestShopPrice() {
  var t = SHOP_TIERS.filter(function (x) { return x.k === document.getElementById('shop-new-tier').value; })[0];
  document.getElementById('shop-new-price').value = t.hi ? Math.round((t.lo + t.hi) / 2 / 5) * 5 : t.lo;
  shopPriceHint();
}
function shopPriceHint() {
  var p = +document.getElementById('shop-new-price').value, dd = shopDays(p);
  document.getElementById('shop-new-hint').textContent = p > 0 ? '≈ ' + dd + ' good day' + (dd > 1 ? 's' : '') + ' of habits (a good day ≈ 20 G)' : '';
}
async function addShopItem() {
  var name = document.getElementById('shop-new-name').value.trim();
  var price = Math.round(+document.getElementById('shop-new-price').value);
  if (!name) return setShopMsg('Name your reward first.');
  if (!(price > 0)) return setShopMsg('Enter a price above 0.');
  var res = await sb.from('shop_items').insert({ user_id: currentUser.id, tier: document.getElementById('shop-new-tier').value, name: name, price: price });
  if (res.error) return setShopMsg('Could not add: ' + res.error.message);
  document.getElementById('shop-new-name').value = '';
  await loadShop(); renderShop();
  setShopMsg('Added "' + name + '" to the shop.');
}


// ============================================
// MEMORY DUMP (table: "memory_logs")
// Jot down anything noteworthy. Several notes per day are allowed.
// Tags: a starter list plus your own (saved to your account as "memory_tags").
// ============================================
var MEM_DEFAULT_TAGS = ['win', 'grateful', 'work', 'family', 'friends', 'health', 'fun', 'creative', 'self-care', 'hard day'];
var memNotes = [], memYear = new Date().getFullYear(), memMonth = new Date().getMonth() + 1;
var memSelected = localISO(new Date()), memPicked = [], memEditId = null, memFilterTag = '';

function toggleMemoryPage() {
  var page = document.getElementById('memory-page');
  var opening = page.style.display !== 'block';
  page.style.display = opening ? 'block' : 'none';
  if (!opening) return;
  ['sleep-page', 'history-page', 'mood-page', 'money-page', 'shop-page', 'every-page'].forEach(function (id) { var el = document.getElementById(id); if (el) el.style.display = 'none'; });
  loadMemories().then(renderMemory);
}

async function loadMemories() {
  if (!currentUser) return;
  var r = await sb.from('memory_logs').select('*').eq('user_id', currentUser.id).order('log_date', { ascending: false }).order('created_at', { ascending: false });
  if (r.error) { setMemMsg('Could not load memories: ' + r.error.message, true); return; }
  memNotes = (r.data || []).map(function (n) { n.tags = Array.isArray(n.tags) ? n.tags : []; return n; });
}

function setMemMsg(t, isErr) { var el = document.getElementById('mem-msg'); if (!el) return; el.textContent = t; el.className = 'sleep-msg ' + (isErr ? 'error' : 'ok'); }
function memTagList() { return moneyUnique(MEM_DEFAULT_TAGS.concat(moneyMeta('memory_tags'))); }
function memIsCustom(t) { return MEM_DEFAULT_TAGS.indexOf(t) < 0; }
function memByDate() { var m = {}; memNotes.forEach(function (n) { (m[n.log_date] = m[n.log_date] || []).push(n); }); return m; }
function memPretty(iso) { var p = iso.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2]); return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }); }
function memShort(iso) { var p = iso.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }

function memShiftMonth(step) {
  memMonth += step;
  if (memMonth < 1) { memMonth = 12; memYear--; }
  if (memMonth > 12) { memMonth = 1; memYear++; }
  renderMemory();
}

function renderMemory() {
  renderMemCalendar(); renderMemStats(); renderMemDay(); renderMemTags(); renderMemList();
}

// Month calendar: Monday first, days with notes highlighted, today underlined, selected day outlined.
function renderMemCalendar() {
  var names = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('mem-month').textContent = names[memMonth - 1] + ' ' + memYear;
  var by = memByDate(), days = new Date(memYear, memMonth, 0).getDate();
  var lead = (new Date(memYear, memMonth - 1, 1).getDay() + 6) % 7, today = localISO(new Date()), logged = 0;
  var h = ['M','T','W','T','F','S','S'].map(function (x) { return '<div class="mem-cal-head">' + x + '</div>'; }).join('');
  for (var i = 0; i < lead; i++) h += '<div></div>';
  for (var d = 1; d <= days; d++) {
    var iso = memYear + '-' + String(memMonth).padStart(2, '0') + '-' + String(d).padStart(2, '0'), n = (by[iso] || []).length;
    if (n) logged++;
    h += '<button type="button" class="mem-day' + (n ? ' has' : '') + (iso === memSelected ? ' sel' : '') + (iso === today ? ' today' : '') + '" data-mem-day="' + iso + '" title="' + (n ? n + ' note' + (n > 1 ? 's' : '') : 'No notes') + '">' + d + (n > 1 ? '<small>' + n + '</small>' : '') + '</button>';
  }
  var cal = document.getElementById('mem-cal');
  cal.innerHTML = h;
  cal.querySelectorAll('[data-mem-day]').forEach(function (b) { b.onclick = function () { memSelectDay(b.getAttribute('data-mem-day')); }; });
  var isCur = (memYear === new Date().getFullYear() && memMonth === new Date().getMonth() + 1);
  document.getElementById('mem-month-count').textContent = logged + ' of ' + (isCur ? new Date().getDate() : days) + ' days logged';
}

function memSelectDay(iso) {
  memSelected = iso; cancelMemEdit(true);
  var p = iso.split('-'); memYear = +p[0]; memMonth = +p[1];
  renderMemCalendar(); renderMemDay();
}

function renderMemStats() {
  var pre = memYear + '-' + String(memMonth).padStart(2, '0');
  document.getElementById('mem-stat-month').textContent = memNotes.filter(function (n) { return n.log_date.indexOf(pre) === 0; }).length;
  document.getElementById('mem-stat-all').textContent = memNotes.length;
  // Streak: days in a row with a note, counting back from today (or yesterday, if today is still empty)
  var by = memByDate(), d = new Date(), streak = 0;
  if (!by[localISO(d)]) d.setDate(d.getDate() - 1);
  while (by[localISO(d)]) { streak++; d.setDate(d.getDate() - 1); }
  document.getElementById('mem-stat-streak').textContent = streak;
}

function memTagChips(tags) { return tags.map(function (t) { return '<span class="mem-chip">' + moneyEsc(t) + '</span>'; }).join(''); }

// Notes already written for the selected day, oldest first, each with Edit and delete.
function renderMemDay() {
  var today = localISO(new Date());
  document.getElementById('mem-day-title').textContent = memSelected === today ? 'Today · ' + memShort(today) : memPretty(memSelected);
  var list = (memByDate()[memSelected] || []).slice().reverse(), h = '';
  list.forEach(function (n) {
    var time = n.created_at ? new Date(n.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    h += '<div class="mem-note' + (n.id === memEditId ? ' editing' : '') + '"><div class="mem-note-top"><span class="sleep-sub">' + time + '</span><span>' +
      '<button type="button" class="settings-btn mem-small-btn" data-mem-edit="' + n.id + '">Edit</button> ' +
      '<button type="button" class="sleep-del" data-mem-del="' + n.id + '" title="Delete note">✕</button></span></div>' +
      '<p class="mem-note-text">' + moneyEsc(n.body) + '</p>' + (n.tags.length ? '<div>' + memTagChips(n.tags) + '</div>' : '') + '</div>';
  });
  var box = document.getElementById('mem-day-notes');
  box.innerHTML = h;
  box.querySelectorAll('[data-mem-edit]').forEach(function (b) { b.onclick = function () { startMemEdit(+b.getAttribute('data-mem-edit')); }; });
  box.querySelectorAll('[data-mem-del]').forEach(function (b) { b.onclick = function () { deleteMemory(+b.getAttribute('data-mem-del')); }; });
  document.getElementById('mem-write-label').textContent = memEditId ? 'Editing note' : (list.length ? 'Add another note' : 'New note');
}

// Tag buttons under the text box: tap to add/remove from this note. Your own tags have a small x to remove them from the list.
function renderMemTags() {
  var h = '';
  memTagList().forEach(function (t) {
    h += '<span class="mem-tag-wrap"><button type="button" class="sleep-q-btn mem-tag' + (memPicked.indexOf(t) > -1 ? ' on' : '') + '" data-mem-tag="' + moneyEsc(t) + '">' + moneyEsc(t) + '</button>' +
      (memIsCustom(t) ? '<button type="button" class="mem-tag-x" data-mem-untag="' + moneyEsc(t) + '" title="Remove this tag from your list">×</button>' : '') + '</span>';
  });
  var box = document.getElementById('mem-tags');
  box.innerHTML = h;
  box.querySelectorAll('[data-mem-tag]').forEach(function (b) { b.onclick = function () {
    var t = b.getAttribute('data-mem-tag'), i = memPicked.indexOf(t);
    if (i > -1) memPicked.splice(i, 1); else memPicked.push(t);
    renderMemTags();
  }; });
  box.querySelectorAll('[data-mem-untag]').forEach(function (b) { b.onclick = function () { removeMemTag(b.getAttribute('data-mem-untag')); }; });
}

function memWordCount() {
  var v = document.getElementById('mem-text').value.trim();
  document.getElementById('mem-count').textContent = (v ? v.split(/\s+/).length : 0) + ' words';
}

async function saveMemTags(list) {
  currentUser.user_metadata = currentUser.user_metadata || {}; currentUser.user_metadata.memory_tags = list;
  var r = await sb.auth.updateUser({ data: { memory_tags: list } });
  if (r && r.data && r.data.user) currentUser = r.data.user;
}

async function addMemTag() {
  var inp = document.getElementById('mem-newtag'), t = inp.value.trim().toLowerCase();
  if (!t) return;
  if (memTagList().some(function (x) { return x.toLowerCase() === t; })) { setMemMsg('You already have that tag.', true); return; }
  await saveMemTags(moneyMeta('memory_tags').concat([t]));
  inp.value = ''; memPicked.push(t); setMemMsg('Tag added.');
  renderMemTags(); renderMemFilterTags();
}

async function removeMemTag(t) {
  await saveMemTags(moneyMeta('memory_tags').filter(function (x) { return x !== t; }));
  memPicked = memPicked.filter(function (x) { return x !== t; });
  if (memFilterTag === t) memFilterTag = '';
  setMemMsg('Removed "' + t + '" from your tag list (old notes keep it).');
  renderMemTags(); renderMemList();
}

function startMemEdit(id) {
  var n = memNotes.find(function (x) { return x.id === id; }); if (!n) return;
  memEditId = id; memPicked = n.tags.slice();
  document.getElementById('mem-text').value = n.body;
  document.getElementById('mem-cancel').style.display = '';
  document.getElementById('mem-save').textContent = 'Save changes ✓';
  memWordCount(); renderMemDay(); renderMemTags();
  document.getElementById('mem-text').focus();
}

function cancelMemEdit(quiet) {
  memEditId = null; memPicked = [];
  document.getElementById('mem-text').value = '';
  document.getElementById('mem-cancel').style.display = 'none';
  document.getElementById('mem-save').textContent = 'Save ✓';
  memWordCount();
  if (!quiet) { renderMemDay(); renderMemTags(); }
  else renderMemTags();
}

async function saveMemory() {
  var body = document.getElementById('mem-text').value.trim();
  if (!body) { setMemMsg('Write something first.', true); return; }
  var r;
  if (memEditId) r = await sb.from('memory_logs').update({ body: body, tags: memPicked.slice() }).eq('id', memEditId);
  else r = await sb.from('memory_logs').insert({ user_id: currentUser.id, log_date: memSelected, body: body, tags: memPicked.slice() });
  if (r.error) { setMemMsg('Could not save: ' + r.error.message, true); return; }
  setMemMsg(memEditId ? 'Changes saved.' : 'Saved.');
  if (!memEditId) victory('pop', 'Memory saved 📝');
  cancelMemEdit(true);
  await loadMemories(); renderMemory();
}

async function deleteMemory(id) {
  if (!confirm('Delete this note?')) return;
  var r = await sb.from('memory_logs').delete().eq('id', id);
  if (r.error) { setMemMsg('Could not delete: ' + r.error.message, true); return; }
  if (memEditId === id) cancelMemEdit(true);
  setMemMsg('Deleted.');
  await loadMemories(); renderMemory();
}

// Tag filter row in the search box (only tags that are actually used somewhere).
function renderMemFilterTags() {
  var used = {}; memNotes.forEach(function (n) { n.tags.forEach(function (t) { used[t] = (used[t] || 0) + 1; }); });
  var h = Object.keys(used).sort().map(function (t) {
    return '<button type="button" class="sleep-q-btn mem-tag' + (memFilterTag === t ? ' on' : '') + '" data-mem-filter="' + moneyEsc(t) + '">' + moneyEsc(t) + ' ' + used[t] + '</button>';
  }).join('');
  var box = document.getElementById('mem-filter-tags');
  box.innerHTML = h;
  box.querySelectorAll('[data-mem-filter]').forEach(function (b) { b.onclick = function () {
    var t = b.getAttribute('data-mem-filter'); memFilterTag = memFilterTag === t ? '' : t; renderMemList();
  }; });
}

// With no search: this month's notes. With a word or a tag picked: matching notes from all time.
function renderMemList() {
  renderMemFilterTags();
  var q = document.getElementById('mem-search').value.trim().toLowerCase(), pre = memYear + '-' + String(memMonth).padStart(2, '0');
  var searching = !!(q || memFilterTag), names = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var list = memNotes.filter(function (n) {
    if (!searching) return n.log_date.indexOf(pre) === 0;
    if (memFilterTag && n.tags.indexOf(memFilterTag) < 0) return false;
    if (q && (n.body + ' ' + n.tags.join(' ')).toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
  document.getElementById('mem-list-head').textContent = searching ? list.length + ' matching note' + (list.length === 1 ? '' : 's') + ' (all time)' : names[memMonth - 1] + "'s memories";
  var h = '';
  list.forEach(function (n) {
    var text = moneyEsc(n.body);
    if (q) text = text.replace(new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'), '<mark class="mem-hit">$1</mark>');
    h += '<button type="button" class="mem-row" data-mem-go="' + n.log_date + '"><b>' + memShort(n.log_date) + '</b> <span>' + text + '</span>' + (n.tags.length ? '<span class="mem-row-tags">' + memTagChips(n.tags) + '</span>' : '') + '</button>';
  });
  if (!list.length) h = '<p class="sleep-empty">' + (searching ? 'No memories match that yet.' : 'No memories this month yet. Pick a day and write one!') + '</p>';
  var box = document.getElementById('mem-list');
  box.innerHTML = h;
  box.querySelectorAll('[data-mem-go]').forEach(function (b) { b.onclick = function () { memSelectDay(b.getAttribute('data-mem-go')); document.getElementById('memory-page').scrollTo({ top: 0, behavior: 'smooth' }); }; });
}


// ============================================
// MONEY TRACKER TABS: Setup, Home, Today, Calendar, Goals, Savings, Debt, Envelopes, Settings
// New Supabase tables: money_plans (calendar items), money_funds, money_debts, money_goals, money_envelopes.
// money_logs got 4 new columns: plan_id + due_date (which calendar item a tick paid),
// fund_id (money put into a savings fund) and debt_id (a payment toward a debt).
// ============================================
var MT_TABS = [['help', 'How to use', '❓'], ['setup', 'Setup', '⚙️'], ['home', 'Home', '🏠'], ['today', 'Today', '☀️'], ['cal', 'Calendar', '📅'], ['goals', 'Goals', '🎯'],
  ['sav', 'Savings', '🐷'], ['debt', 'Debt', '💳'], ['env', 'Envelopes', '✉️'], ['set', 'Settings', '🔧']];
var MT_KIND_NAMES = { income: 'Income', bill: 'Bill', savings: 'Savings transfer', debt: 'Debt payment', note: 'Note' };
var MT_KIND_CATS = { income: 'Salary', bill: 'Bills', savings: 'Savings', debt: 'Credit' };
var MT_GOAL_STATUS = ['Not started', 'In progress', 'Done ✓'];
var mtTab = (function () { try { return localStorage.getItem('moneyTab') || 'today'; } catch (e) { return 'today'; } })();
var mtPlans = [], mtFunds = [], mtDebts = [], mtGoals = [], mtEnvs = [], mtMissing = [];
var mtCalY = new Date().getFullYear(), mtCalM = new Date().getMonth(), mtCalSel = localISO(new Date()), mtCatSel = 'expense';

// ---- Small helpers ----
function mtMeta(k) { var m = currentUser && currentUser.user_metadata; return m ? m[k] : undefined; }
function mtSaveMeta(obj) {
  currentUser.user_metadata = currentUser.user_metadata || {};
  Object.keys(obj).forEach(function (k) { currentUser.user_metadata[k] = obj[k]; });
  return sb.auth.updateUser({ data: obj }).then(function (r) { if (r && r.data && r.data.user) currentUser = r.data.user; });
}
function mtDate(iso) { var p = iso.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
function mtDaysIn(y, m) { return new Date(y, m + 1, 0).getDate(); }
function mtShort(iso) { return mtDate(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
function mtMsg(id, t, type) { var el = document.getElementById(id); if (el) { el.textContent = t; el.className = 'sleep-msg ' + (type || 'ok'); } }
function mtNum(id) { return parseFloat(document.getElementById(id).value); }
function mtStartDay() { var s = +mtMeta('money_month_start'); return s >= 1 && s <= 28 ? s : 1; }

// Your "month": from your start day to the day before it next month (normally the 1st to the last day).
function mtPeriod(ref) {
  var S = mtStartDay(), d = new Date(ref); d.setHours(0, 0, 0, 0);
  var from = new Date(d.getFullYear(), d.getMonth(), Math.min(S, mtDaysIn(d.getFullYear(), d.getMonth())));
  if (d < from) from = new Date(d.getFullYear(), d.getMonth() - 1, Math.min(S, mtDaysIn(d.getFullYear(), d.getMonth() - 1)));
  var to = new Date(from.getFullYear(), from.getMonth() + 1, Math.min(S, mtDaysIn(from.getFullYear(), from.getMonth() + 1)));
  to.setDate(to.getDate() - 1);
  return { from: from, to: to };
}
function mtPeriodLabel(p) {
  if (mtStartDay() === 1) return p.from.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  return mtShort(localISO(p.from)) + ' – ' + mtShort(localISO(p.to)) + ', ' + p.to.getFullYear();
}

// ---- Loading ----
async function mtLoadAll() {
  if (!currentUser) return;
  mtMissing = [];
  async function get(table, order) {
    var r = await sb.from(table).select('*').eq('user_id', currentUser.id).order(order || 'id', { ascending: true });
    if (r.error) { mtMissing.push(table); return []; }
    return (r.data || []).map(function (x) {
      ['amount', 'target', 'start_amount', 'start_balance', 'apr', 'min_payment', 'monthly_limit'].forEach(function (k) { if (x[k] != null) x[k] = Number(x[k]); });
      return x;
    });
  }
  var res = await Promise.all([get('money_plans'), get('money_funds'), get('money_debts'), get('money_goals'), get('money_envelopes')]);
  mtPlans = res[0]; mtFunds = res[1]; mtDebts = res[2]; mtGoals = res[3]; mtEnvs = res[4];
}

// ---- Tabs ----
function mtGo(tab) {
  if (tab !== 'add' && !MT_TABS.some(function (t) { return t[0] === tab; })) tab = 'today';
  mtTab = tab;
  try { localStorage.setItem('moneyTab', tab); } catch (e) {}
  document.querySelectorAll('#money-page .mt-tab').forEach(function (sec) { sec.style.display = sec.getAttribute('data-mt') === tab ? '' : 'none'; });
  var side = document.getElementById('mt-side'), h = '<button type="button" class="settings-btn mt-add' + (tab === 'add' ? ' on' : '') + '" data-mt-go="add">+ Track spending</button>';
  MT_TABS.forEach(function (t) { h += '<button type="button" class="mt-nav' + (tab === t[0] ? ' on' : '') + '" data-mt-go="' + t[0] + '"><span aria-hidden="true">' + t[2] + '</span>' + t[1] + '</button>'; });
  side.innerHTML = h;
  side.querySelectorAll('[data-mt-go]').forEach(function (b) { b.onclick = function () { mtGo(b.getAttribute('data-mt-go')); }; });
  if (tab === 'home' && typeof moneyDistChart !== 'undefined' && moneyDistChart) setTimeout(function () { moneyDistChart.resize(); }, 0);
  var pg = document.getElementById('money-page'); if (pg && pg.scrollTop > 120) pg.scrollTo({ top: 0 });
}

// ---- Totals ----
function mtFundSaved(f) { return (f.start_amount || 0) + moneyLogs.reduce(function (a, r) { return a + (r.fund_id == f.id ? r.amount : 0); }, 0); }
function mtDebtLeft(d) { return Math.max(0, (d.start_balance || 0) - moneyLogs.reduce(function (a, r) { return a + (r.debt_id == d.id ? r.amount : 0); }, 0)); }
function mtPaidLog(planId, iso) { return moneyLogs.find(function (r) { return r.plan_id == planId && r.due_date === iso; }); }

// Every date a calendar item lands on between two dates (handles repeats).
function mtOccurrences(p, fromIso, toIso) {
  var out = [], start = mtDate(p.start_date), from = mtDate(fromIso), to = mtDate(toIso), d;
  if (!p.repeat || p.repeat === 'none') { if (p.start_date >= fromIso && p.start_date <= toIso) out.push(p.start_date); return out; }
  if (p.repeat === 'week' || p.repeat === '2weeks') {
    var step = p.repeat === 'week' ? 7 : 14, k = Math.max(0, Math.ceil((from - start) / (step * 86400000)));
    for (d = new Date(start); ; k++) { d = new Date(start); d.setDate(start.getDate() + k * step); if (d > to) break; if (d >= from) out.push(localISO(d)); }
    return out;
  }
  var months = p.repeat === 'year' ? 12 : 1, i = Math.max(0, Math.floor(((from.getFullYear() - start.getFullYear()) * 12 + from.getMonth() - start.getMonth()) / months) - 1);
  for (; ; i++) {
    var y = start.getFullYear(), m = start.getMonth() + i * months;
    d = new Date(y, m, Math.min(start.getDate(), mtDaysIn(y, m)));
    if (d > to) break;
    if (d >= from && d >= start) out.push(localISO(d));
  }
  return out;
}
function mtAllOccurrences(fromIso, toIso) {
  var list = [];
  mtPlans.forEach(function (p) { mtOccurrences(p, fromIso, toIso).forEach(function (iso) { list.push({ plan: p, iso: iso, paid: !!mtPaidLog(p.id, iso) }); }); });
  return list.sort(function (a, b) { return a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : (a.plan.kind === 'income' ? -1 : 1); });
}

// ---- Render everything (called by renderMoney after any change) ----
function mtRenderAll() {
  var miss = document.getElementById('mt-setup-msg');
  if (miss) miss.textContent = mtMissing.length ? 'To turn on Calendar, Goals, Savings, Debt and Envelopes, run the new SQL in Supabase (missing: ' + mtMissing.join(', ') + ').' : '';
  document.querySelectorAll('.mt-currency').forEach(function (sel) { sel.value = mtCurrency(); });
  mtFillGoesTo('money-goes', 'any');
  mtRenderToday(); mtRenderCal(); mtRenderGoals(); mtRenderFunds(); mtRenderDebts(); mtRenderEnvs(); mtRenderSettings();
}

// "Goes to" dropdowns: funds for savings transfers, debts for debt payments, or both for a normal entry.
function mtFillGoesTo(id, kind) {
  var sel = document.getElementById(id); if (!sel) return;
  var keep = sel.value, h = '<option value="">—</option>';
  if (kind === 'savings' || kind === 'any') mtFunds.forEach(function (f) { h += '<option value="f:' + f.id + '">🐷 ' + moneyEsc(f.name) + '</option>'; });
  if (kind === 'debt' || kind === 'any') mtDebts.forEach(function (d) { h += '<option value="d:' + d.id + '">💳 ' + moneyEsc(d.name) + '</option>'; });
  sel.innerHTML = h; sel.value = keep; if (sel.value !== keep) sel.value = '';
  sel.disabled = (kind === 'income' || kind === 'bill' || kind === 'note');
}

// ---- TODAY ----
function mtRenderToday() {
  var saved = 0, target = 0, owed = 0, mins = 0;
  mtFunds.forEach(function (f) { saved += mtFundSaved(f); target += f.target || 0; });
  mtDebts.forEach(function (d) { owed += mtDebtLeft(d); mins += d.min_payment || 0; });
  document.getElementById('mt-saved').textContent = moneyFmt(saved);
  document.getElementById('mt-saved-sub').textContent = mtFunds.length ? 'across ' + mtFunds.length + ' fund' + (mtFunds.length > 1 ? 's' : '') + (target ? ', toward ' + moneyFmt(target) : '') : 'add a fund in Savings';
  document.getElementById('mt-owed').textContent = moneyFmt(owed);
  document.getElementById('mt-owed-sub').textContent = mtDebts.length ? 'across ' + mtDebts.length + ' debt' + (mtDebts.length > 1 ? 's' : '') : 'add a debt in Debt';
  document.getElementById('mt-mins').textContent = moneyFmt(mins);
  document.getElementById('mt-goals-n').textContent = mtGoals.filter(function (g) { return g.status === 1; }).length;
  // Safe to spend = income (received + still expected) - spending so far - bills/transfers still due this month
  var per = mtPeriod(new Date()), pf = localISO(per.from), pt = localISO(per.to), safe = 0;
  moneyLogs.forEach(function (r) { if (r.log_date >= pf && r.log_date <= pt) safe += r.kind === 'income' ? r.amount : -r.amount; });
  mtAllOccurrences(pf, pt).forEach(function (o) { if (o.paid || o.plan.kind === 'note') return; safe += o.plan.kind === 'income' ? o.plan.amount : -o.plan.amount; });
  document.getElementById('mt-safe-label').textContent = (mtStartDay() === 1 ? per.from.toLocaleDateString('en-US', { month: 'long' }) : "This month's") + ' safe to spend';
  var se = document.getElementById('mt-safe'); se.textContent = moneyFmt(safe); se.className = 'sleep-big ' + (safe < 0 ? 'money-out' : 'money-in');
  // Coming up: anything not yet paid from the last week, plus the next 30 days
  var today = localISO(new Date()), back = new Date(); back.setDate(back.getDate() - 7);
  var ahead = new Date(); ahead.setDate(ahead.getDate() + 30), tom = new Date(); tom.setDate(tom.getDate() + 1);
  var list = mtAllOccurrences(localISO(back), localISO(ahead)).filter(function (o) { return o.iso >= today || (!o.paid && o.plan.kind !== 'note'); }).slice(0, 8);
  var el = document.getElementById('mt-coming');
  if (!list.length) { el.innerHTML = '<p class="sleep-empty">Nothing coming up. Add paychecks and bills in the Calendar tab.</p>'; return; }
  el.innerHTML = list.map(mtItemRow).join('');
  mtWireItems(el);
}
function mtItemRow(o, showDate) {
  var p = o.plan, today = localISO(new Date()), t = new Date(); t.setDate(t.getDate() + 1);
  var when = o.iso === today ? 'Today' : o.iso === localISO(t) ? 'Tomorrow' : mtShort(o.iso);
  if (o.iso < today && !o.paid) when += ' · late';
  var inc = p.kind === 'income', note = p.kind === 'note';
  return '<div class="mt-item' + (o.paid ? ' paid' : '') + '">' +
    (showDate === false ? '' : '<span class="mt-when' + (o.iso < today && !o.paid ? ' late' : '') + '">' + when + '</span>') +
    (note ? '<span></span>' : '<button type="button" class="mt-tick' + (o.paid ? ' on' : '') + '" data-mt-tick="' + p.id + '|' + o.iso + '" title="' + (o.paid ? 'Undo' : (inc ? 'Mark received' : 'Mark paid')) + '">' + (o.paid ? '✓' : '') + '</button>') +
    '<span class="mt-dot mt-k-' + p.kind + '"></span><span class="mt-name">' + moneyEsc(p.name) + (note ? '' : '') + '</span>' +
    '<span class="mt-amt' + (inc ? ' money-in' : '') + '">' + (note ? '' : (inc ? '+' : '') + moneyFmt(p.amount)) + '</span></div>';
}
function mtWireItems(el) {
  el.querySelectorAll('[data-mt-tick]').forEach(function (b) { b.onclick = function () { var x = b.getAttribute('data-mt-tick').split('|'); mtTogglePaid(+x[0], x[1]); }; });
  el.querySelectorAll('[data-mt-delplan]').forEach(function (b) { b.onclick = function () { mtDeletePlan(+b.getAttribute('data-mt-delplan')); }; });
}
// Ticking saves a real money entry (so it shows in Home, envelopes, funds and debts). Unticking removes it.
async function mtTogglePaid(planId, iso) {
  var p = mtPlans.find(function (x) { return x.id == planId; }); if (!p) return;
  var log = mtPaidLog(planId, iso), res;
  if (log) res = await sb.from('money_logs').delete().eq('id', log.id);
  else {
    var row = { user_id: currentUser.id, kind: p.kind === 'income' ? 'income' : 'expense', item: p.name, amount: p.amount,
      category: p.category || MT_KIND_CATS[p.kind] || 'Other', account: moneyAccountList()[0] || 'Personal', log_date: iso, plan_id: p.id, due_date: iso };
    if (p.fund_id) row.fund_id = p.fund_id;
    if (p.debt_id) row.debt_id = p.debt_id;
    res = await sb.from('money_logs').insert(row);
  }
  if (res.error) { alert('Could not save: ' + res.error.message); return; }
  if (!log) victory('pop', p.kind === 'income' ? 'Money in! 💵' : 'Paid ✓');
  await loadMoneyLogs(); renderMoney();
}

// ---- CALENDAR ----
function mtCalShift(step) { mtCalM += step; if (mtCalM < 0) { mtCalM = 11; mtCalY--; } if (mtCalM > 11) { mtCalM = 0; mtCalY++; } mtRenderCal(); }
function mtRenderCal() {
  var first = new Date(mtCalY, mtCalM, 1), days = mtDaysIn(mtCalY, mtCalM), lead = (first.getDay() + 6) % 7, today = localISO(new Date());
  var name = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  document.getElementById('mt-cal-title').textContent = name;
  var occ = mtAllOccurrences(localISO(first), localISO(new Date(mtCalY, mtCalM, days))), by = {};
  occ.forEach(function (o) { (by[o.iso] = by[o.iso] || []).push(o); });
  var inc = 0, out = 0; occ.forEach(function (o) { if (o.plan.kind === 'income') inc += o.plan.amount; else if (o.plan.kind !== 'note') out += o.plan.amount; });
  document.getElementById('mt-cal-month').textContent = 'Planned: +' + moneyFmt(inc) + ' in · ' + moneyFmt(out) + ' out';
  var h = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(function (x) { return '<div class="mem-cal-head">' + x + '</div>'; }).join('');
  for (var i = 0; i < lead; i++) h += '<div></div>';
  for (var d = 1; d <= days; d++) {
    var iso = localISO(new Date(mtCalY, mtCalM, d));
    h += '<button type="button" class="mt-day' + (iso === today ? ' today' : '') + (iso === mtCalSel ? ' sel' : '') + '" data-mt-day="' + iso + '"><b>' + d + '</b>';
    (by[iso] || []).forEach(function (o) { h += '<span class="mt-ev mt-k-' + o.plan.kind + (o.paid ? ' paid' : '') + '">' + (o.paid ? '✓ ' : '') + moneyEsc(o.plan.name) + (o.plan.kind === 'note' ? '' : ' ' + (o.plan.kind === 'income' ? '+' : '') + moneyFmt(o.plan.amount)) + '</span>'; });
    h += '</button>';
  }
  var cal = document.getElementById('mt-cal'); cal.innerHTML = h;
  cal.querySelectorAll('[data-mt-day]').forEach(function (b) { b.onclick = function () { mtCalSel = b.getAttribute('data-mt-day'); mtRenderCal(); }; });
  // The selected day: its items + the add form
  document.getElementById('mt-day-title').textContent = 'Add to ' + mtDate(mtCalSel).toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric' });
  var mine = mtAllOccurrences(mtCalSel, mtCalSel), box = document.getElementById('mt-day-items');
  box.innerHTML = mine.length ? mine.map(function (o) {
    return mtItemRow(o, false).replace(/<\/div>$/, '<span class="mt-rep">' + MT_KIND_NAMES[o.plan.kind] + ' · ' + ({ none: 'once', week: 'every week', '2weeks': 'every 2 weeks', month: 'every month', year: 'every year' }[o.plan.repeat] || 'once') + '</span><button type="button" class="sleep-del" data-mt-delplan="' + o.plan.id + '" title="Delete this item">✕</button></div>');
  }).join('') : '';
  mtWireItems(box);
  mtFillGoesTo('mt-p-goes', document.getElementById('mt-p-kind').value);
}
async function mtSavePlan() {
  var name = document.getElementById('mt-p-name').value.trim(), amount = mtNum('mt-p-amount'), kind = document.getElementById('mt-p-kind').value;
  if (!name) return mtMsg('mt-cal-msg', 'Give it a name.', 'error');
  if (kind !== 'note' && !(amount > 0)) return mtMsg('mt-cal-msg', 'Enter an amount above 0.', 'error');
  var goes = document.getElementById('mt-p-goes').value || '';
  var row = { user_id: currentUser.id, name: name, amount: kind === 'note' ? 0 : Math.round(amount * 100) / 100, kind: kind, start_date: mtCalSel, repeat: document.getElementById('mt-p-repeat').value,
    fund_id: goes.indexOf('f:') === 0 ? +goes.slice(2) : null, debt_id: goes.indexOf('d:') === 0 ? +goes.slice(2) : null };
  var r = await sb.from('money_plans').insert(row);
  if (r.error) return mtMsg('mt-cal-msg', 'Could not save: ' + r.error.message, 'error');
  document.getElementById('mt-p-name').value = ''; document.getElementById('mt-p-amount').value = '';
  mtMsg('mt-cal-msg', 'Saved "' + name + '".');
  await mtLoadAll(); renderMoney();
}
async function mtDeletePlan(id) {
  var p = mtPlans.find(function (x) { return x.id == id; }); if (!p) return;
  if (!confirm('Delete "' + p.name + '"' + (p.repeat && p.repeat !== 'none' ? ' and all its repeats' : '') + '?\n\nAnything you already ticked stays in your money history.')) return;
  var r = await sb.from('money_plans').delete().eq('id', id);
  if (r.error) return mtMsg('mt-cal-msg', 'Could not delete: ' + r.error.message, 'error');
  await mtLoadAll(); renderMoney();
}

// ---- GOALS ----
function mtLinkOptions(sel) {
  var keep = sel.value, h = '<option value="">—</option>';
  mtFunds.forEach(function (f) { h += '<option value="f:' + f.id + '">🐷 ' + moneyEsc(f.name) + '</option>'; });
  mtDebts.forEach(function (d) { h += '<option value="d:' + d.id + '">💳 ' + moneyEsc(d.name) + '</option>'; });
  sel.innerHTML = h; sel.value = keep; if (sel.value !== keep) sel.value = '';
}
function mtRenderGoals() {
  mtLinkOptions(document.getElementById('mt-g-link'));
  var h = '';
  mtGoals.forEach(function (g) {
    var link = '';
    var f = g.fund_id && mtFunds.find(function (x) { return x.id == g.fund_id; }), d = g.debt_id && mtDebts.find(function (x) { return x.id == g.debt_id; });
    if (f) link = '🐷 ' + moneyEsc(f.name) + ' · ' + (f.target ? Math.round(mtFundSaved(f) / f.target * 100) : 0) + '% saved';
    if (d) link = '💳 ' + moneyEsc(d.name) + ' · ' + (d.start_balance ? Math.round((1 - mtDebtLeft(d) / d.start_balance) * 100) : 0) + '% paid off';
    h += '<div class="mt-goal"><span><b>' + moneyEsc(g.name) + '</b>' + (link ? '<small>' + link + '</small>' : '') + '</span>' +
      '<span class="mt-goal-btns"><button type="button" class="sleep-q-btn mt-status mt-s' + (g.status || 0) + '" data-mt-status="' + g.id + '">' + MT_GOAL_STATUS[g.status || 0] + '</button>' +
      '<button type="button" class="sleep-del" data-mt-delgoal="' + g.id + '" title="Delete goal">✕</button></span></div>';
  });
  var el = document.getElementById('mt-goals');
  el.innerHTML = h || '<p class="sleep-empty">No goals yet. Add your first one below.</p>';
  el.querySelectorAll('[data-mt-status]').forEach(function (b) { b.onclick = function () { mtCycleGoal(+b.getAttribute('data-mt-status')); }; });
  el.querySelectorAll('[data-mt-delgoal]').forEach(function (b) { b.onclick = function () { mtDelete('money_goals', +b.getAttribute('data-mt-delgoal'), 'this goal', 'mt-goals-msg'); }; });
}
async function mtCycleGoal(id) {
  var g = mtGoals.find(function (x) { return x.id == id; }); if (!g) return;
  var next = ((g.status || 0) + 1) % 3, r = await sb.from('money_goals').update({ status: next }).eq('id', id);
  if (r.error) return mtMsg('mt-goals-msg', 'Could not save: ' + r.error.message, 'error');
  g.status = next; mtRenderGoals(); mtRenderToday();
  if (next === 2) victory('big', 'Goal reached! 🏆');
}
async function mtAddGoal() {
  var name = document.getElementById('mt-g-name').value.trim(), link = document.getElementById('mt-g-link').value || '';
  if (!name) return mtMsg('mt-goals-msg', 'Type a goal first.', 'error');
  var r = await sb.from('money_goals').insert({ user_id: currentUser.id, name: name, status: 0,
    fund_id: link.indexOf('f:') === 0 ? +link.slice(2) : null, debt_id: link.indexOf('d:') === 0 ? +link.slice(2) : null });
  if (r.error) return mtMsg('mt-goals-msg', 'Could not save: ' + r.error.message, 'error');
  document.getElementById('mt-g-name').value = ''; mtMsg('mt-goals-msg', 'Goal added.');
  await mtLoadAll(); renderMoney();
}
async function mtDelete(table, id, what, msgId) {
  if (!confirm('Delete ' + what + '?')) return;
  var r = await sb.from(table).delete().eq('id', id);
  if (r.error) return mtMsg(msgId, 'Could not delete: ' + r.error.message, 'error');
  await mtLoadAll(); renderMoney();
}

// ---- SAVINGS ----
function mtBar(pct, cls) { return '<div class="mt-bar"><i class="' + (cls || '') + '" style="width:' + Math.max(0, Math.min(100, pct)) + '%"></i></div>'; }
function mtRenderFunds() {
  var total = 0, h = '';
  mtFunds.forEach(function (f) {
    var s = mtFundSaved(f), pct = f.target ? Math.round(s / f.target * 100) : 0; total += s;
    h += '<div class="mt-prog"><div class="mt-prog-top"><b>' + moneyEsc(f.name) + '</b><span>' + moneyFmt(s) + (f.target ? ' of ' + moneyFmt(f.target) : '') +
      ' <button type="button" class="sleep-del" data-mt-delfund="' + f.id + '" title="Delete fund">✕</button></span></div>' + mtBar(pct) +
      '<small>' + pct + '% · ' + (f.target_date ? 'by ' + mtDate(f.target_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : 'No date') + (f.target && s < f.target ? ' · ' + moneyFmt(f.target - s) + ' to go' : (f.target ? ' · reached! 🎉' : '')) + '</small></div>';
  });
  document.getElementById('mt-funds-title').textContent = 'Your funds · ' + moneyFmt(total) + ' saved';
  var el = document.getElementById('mt-funds');
  el.innerHTML = h || '<p class="sleep-empty">No funds yet. Make one below (an emergency cushion, a trip...).</p>';
  el.querySelectorAll('[data-mt-delfund]').forEach(function (b) { b.onclick = function () { mtDelete('money_funds', +b.getAttribute('data-mt-delfund'), 'this fund (money you added stays in your history)', 'mt-funds-msg'); }; });
  var sel = document.getElementById('mt-fa-fund'), keep = sel.value;
  sel.innerHTML = mtFunds.map(function (f) { return '<option value="' + f.id + '">' + moneyEsc(f.name) + '</option>'; }).join('') || '<option value="">Make a fund first</option>';
  if (keep) sel.value = keep;
}
async function mtAddFund() {
  var name = document.getElementById('mt-f-name').value.trim(), target = mtNum('mt-f-target'), start = mtNum('mt-f-start') || 0;
  if (!name) return mtMsg('mt-funds-msg', 'Give the fund a name.', 'error');
  var r = await sb.from('money_funds').insert({ user_id: currentUser.id, name: name, target: target > 0 ? target : 0, target_date: document.getElementById('mt-f-date').value || null, start_amount: start });
  if (r.error) return mtMsg('mt-funds-msg', 'Could not save: ' + r.error.message, 'error');
  ['mt-f-name', 'mt-f-target', 'mt-f-date', 'mt-f-start'].forEach(function (id) { document.getElementById(id).value = ''; });
  mtMsg('mt-funds-msg', 'Fund added.'); await mtLoadAll(); renderMoney();
}
async function mtAddToFund() {
  var id = +document.getElementById('mt-fa-fund').value, amount = mtNum('mt-fa-amount'), date = document.getElementById('mt-fa-date').value;
  var f = mtFunds.find(function (x) { return x.id == id; });
  if (!f) return mtMsg('mt-funds-msg', 'Make a fund first.', 'error');
  if (!(amount > 0)) return mtMsg('mt-funds-msg', 'Enter an amount above 0.', 'error');
  var r = await sb.from('money_logs').insert({ user_id: currentUser.id, kind: 'expense', item: 'To ' + f.name, amount: Math.round(amount * 100) / 100, category: 'Savings', account: moneyAccountList()[0] || 'Personal', log_date: date || localISO(new Date()), fund_id: f.id });
  if (r.error) return mtMsg('mt-funds-msg', 'Could not save: ' + r.error.message, 'error');
  document.getElementById('mt-fa-amount').value = ''; mtMsg('mt-funds-msg', 'Added ' + moneyFmt(amount) + ' to ' + f.name + '.');
  victory('pop', 'Saved ' + moneyFmt(amount) + ' 💰');
  await loadMoneyLogs(); renderMoney();
}

// ---- DEBT ----
function mtRenderDebts() {
  var owed = 0, mins = 0, h = '';
  mtDebts.forEach(function (d) {
    var left = mtDebtLeft(d), pct = d.start_balance ? Math.round((1 - left / d.start_balance) * 100) : 0; owed += left; mins += d.min_payment || 0;
    h += '<div class="mt-prog"><div class="mt-prog-top"><b>' + moneyEsc(d.name) + '</b><span>' + moneyFmt(left) + ' left <button type="button" class="sleep-del" data-mt-deldebt="' + d.id + '" title="Delete debt">✕</button></span></div>' + mtBar(pct, 'paid') +
      '<small>' + pct + '% paid off' + (d.apr ? ' · ' + d.apr + '% interest' : '') + (d.min_payment ? ' · minimum ' + moneyFmt(d.min_payment) + '/mo' : '') + (left === 0 && d.start_balance ? ' · paid off! 🎉' : '') + '</small></div>';
  });
  document.getElementById('mt-d-owed').textContent = moneyFmt(owed);
  document.getElementById('mt-d-mins').textContent = moneyFmt(mins);
  var el = document.getElementById('mt-debts');
  el.innerHTML = h || '<p class="sleep-empty">No debts added. Lucky you! (Or add one below.)</p>';
  el.querySelectorAll('[data-mt-deldebt]').forEach(function (b) { b.onclick = function () { mtDelete('money_debts', +b.getAttribute('data-mt-deldebt'), 'this debt (payments stay in your history)', 'mt-debts-msg'); }; });
  var sel = document.getElementById('mt-dp-debt'), keep = sel.value;
  sel.innerHTML = mtDebts.map(function (d) { return '<option value="' + d.id + '">' + moneyEsc(d.name) + '</option>'; }).join('') || '<option value="">Add a debt first</option>';
  if (keep) sel.value = keep;
}
async function mtAddDebt() {
  var name = document.getElementById('mt-d-name').value.trim(), bal = mtNum('mt-d-bal');
  if (!name) return mtMsg('mt-debts-msg', 'Give the debt a name.', 'error');
  if (!(bal > 0)) return mtMsg('mt-debts-msg', 'Enter the balance you owe.', 'error');
  var r = await sb.from('money_debts').insert({ user_id: currentUser.id, name: name, start_balance: bal, apr: mtNum('mt-d-apr') || 0, min_payment: mtNum('mt-d-min') || 0 });
  if (r.error) return mtMsg('mt-debts-msg', 'Could not save: ' + r.error.message, 'error');
  ['mt-d-name', 'mt-d-bal', 'mt-d-apr', 'mt-d-min'].forEach(function (id) { document.getElementById(id).value = ''; });
  mtMsg('mt-debts-msg', 'Debt added.'); await mtLoadAll(); renderMoney();
}
async function mtPayDebt() {
  var id = +document.getElementById('mt-dp-debt').value, amount = mtNum('mt-dp-amount'), date = document.getElementById('mt-dp-date').value;
  var d = mtDebts.find(function (x) { return x.id == id; });
  if (!d) return mtMsg('mt-debts-msg', 'Add a debt first.', 'error');
  if (!(amount > 0)) return mtMsg('mt-debts-msg', 'Enter an amount above 0.', 'error');
  var r = await sb.from('money_logs').insert({ user_id: currentUser.id, kind: 'expense', item: d.name + ' payment', amount: Math.round(amount * 100) / 100, category: 'Credit', account: moneyAccountList()[0] || 'Personal', log_date: date || localISO(new Date()), debt_id: d.id });
  if (r.error) return mtMsg('mt-debts-msg', 'Could not save: ' + r.error.message, 'error');
  document.getElementById('mt-dp-amount').value = ''; mtMsg('mt-debts-msg', 'Logged ' + moneyFmt(amount) + ' toward ' + d.name + '.');
  await loadMoneyLogs(); renderMoney();
  if (d.start_balance && mtDebtLeft(d) === 0) victory('big', d.name + ' paid off! 🎉'); else victory('pop', 'Payment logged 💪');
}

// ---- ENVELOPES ----
function mtRenderEnvs() {
  var per = mtPeriod(new Date()), pf = localISO(per.from), pt = localISO(per.to), spent = {};
  moneyLogs.forEach(function (r) { if (r.kind === 'expense' && !r.fund_id && r.log_date >= pf && r.log_date <= pt) spent[r.category] = (spent[r.category] || 0) + r.amount; });
  document.getElementById('mt-env-title').textContent = mtPeriodLabel(per) + ' envelopes';
  var h = '';
  mtEnvs.forEach(function (e) {
    var s = spent[e.category] || 0, lim = e.monthly_limit || 0, over = s > lim, pct = lim ? s / lim * 100 : 0;
    h += '<div class="sleep-tile mt-env' + (over ? ' over' : '') + '"><div class="mt-prog-top"><b>✉️ ' + moneyEsc(e.category) + '</b><button type="button" class="sleep-del" data-mt-delenv="' + e.id + '" title="Delete envelope">✕</button></div>' + mtBar(pct, over ? 'over' : '') +
      '<small>' + moneyFmt(s) + ' of ' + moneyFmt(lim) + (over ? ' · ' + moneyFmt(s - lim) + ' over!' : ' · ' + moneyFmt(lim - s) + ' left') + '</small></div>';
  });
  var el = document.getElementById('mt-envs');
  el.innerHTML = h || '<p class="sleep-empty">No envelopes yet. Pick a category and a monthly limit below.</p>';
  el.querySelectorAll('[data-mt-delenv]').forEach(function (b) { b.onclick = function () { mtDelete('money_envelopes', +b.getAttribute('data-mt-delenv'), 'this envelope', 'mt-env-msg'); }; });
  var used = mtEnvs.map(function (e) { return e.category; });
  document.getElementById('mt-e-cat').innerHTML = moneyCategoryList('expense').filter(function (c) { return used.indexOf(c) < 0; }).map(function (c) { return '<option>' + moneyEsc(c) + '</option>'; }).join('');
}
async function mtAddEnvelope() {
  var cat = document.getElementById('mt-e-cat').value, lim = mtNum('mt-e-limit');
  if (!cat) return mtMsg('mt-env-msg', 'Every category already has an envelope.', 'error');
  if (!(lim > 0)) return mtMsg('mt-env-msg', 'Enter a monthly limit above 0.', 'error');
  var r = await sb.from('money_envelopes').insert({ user_id: currentUser.id, category: cat, monthly_limit: lim });
  if (r.error) return mtMsg('mt-env-msg', 'Could not save: ' + r.error.message, 'error');
  document.getElementById('mt-e-limit').value = ''; mtMsg('mt-env-msg', 'Envelope added.');
  await mtLoadAll(); renderMoney();
}

// ---- SETTINGS / SETUP ----
function mtSetCurrency(c) { mtSaveMeta({ money_currency: c }); renderMoney(); }
function mtSetMonthStart(v) { mtSaveMeta({ money_month_start: +v }); renderMoney(); mtMsg('mt-set-msg', 'Your month now starts on day ' + v + '.'); }
function mtSetPayStart(iso) { if (!iso) return; moneyDistSetStart(iso); mtMsg('mt-set-msg', 'Pay period start saved.'); }
function mtCatKind(k) { mtCatSel = k; mtRenderSettings(); }
function mtRenderSettings() {
  var st = document.getElementById('mt-s-start');
  if (!st.options.length) { var h = ''; for (var i = 1; i <= 28; i++) h += '<option value="' + i + '">' + i + '</option>'; st.innerHTML = h; }
  st.value = String(mtStartDay());
  var pay = mtMeta('money_2wk_start'); if (pay) document.getElementById('mt-s-pay').value = pay;
  document.getElementById('mt-cat-exp').className = 'sleep-q-btn' + (mtCatSel === 'expense' ? ' on' : '');
  document.getElementById('mt-cat-inc').className = 'sleep-q-btn' + (mtCatSel === 'income' ? ' on' : '');
  function chips(list, custom, key, boxId) {
    var box = document.getElementById(boxId);
    box.innerHTML = list.map(function (c) {
      var mine = custom.indexOf(c) > -1;
      return '<span class="mem-chip mt-chip">' + moneyEsc(c) + (mine ? '<button type="button" class="mem-tag-x" data-mt-rm="' + moneyEsc(c) + '" title="Remove">×</button>' : '') + '</span>';
    }).join('');
    box.querySelectorAll('[data-mt-rm]').forEach(function (b) { b.onclick = function () {
      var v = b.getAttribute('data-mt-rm'), o = {}; o[key] = moneyMeta(key).filter(function (x) { return x !== v; });
      mtSaveMeta(o).then(function () { refreshMoneySelects(); mtRenderSettings(); });
    }; });
  }
  chips(moneyCategoryList(mtCatSel), moneyMeta('money_cats_' + mtCatSel), 'money_cats_' + mtCatSel, 'mt-cats');
  chips(moneyAccountList(), moneyMeta('money_accounts'), 'money_accounts', 'mt-accs');
}
function mtAddListItem(which) {
  var inp = document.getElementById(which === 'cat' ? 'mt-cat-new' : 'mt-acc-new'), v = inp.value.trim();
  if (!v) return;
  var key = which === 'cat' ? 'money_cats_' + mtCatSel : 'money_accounts', list = which === 'cat' ? moneyCategoryList(mtCatSel) : moneyAccountList();
  if (list.some(function (x) { return x.toLowerCase() === v.toLowerCase(); })) return mtMsg('mt-set-msg', 'You already have that one.', 'error');
  var o = {}; o[key] = moneyMeta(key).concat([v]);
  mtSaveMeta(o).then(function () { inp.value = ''; refreshMoneySelects(); mtRenderSettings(); mtMsg('mt-set-msg', 'Added "' + v + '".'); });
}


// ============================================
// SETTINGS THAT FOLLOW YOU (XP Mode, Hard habits optional, Show optional habits, Victory animations)
// They used to live only in this browser's storage, so another browser, CodePen or another laptop
// started with them off. Now they're also saved to your account (Supabase user_metadata).
// ============================================
var victoryOn = true;   // on by default; turn off in Settings
try { var _vic = localStorage.getItem('habitTrackerVictory'); if (_vic !== null) victoryOn = _vic === '1'; } catch (e) {}
(function () { var cb = document.getElementById('victory-toggle'); if (cb) cb.checked = victoryOn; })();

var SYNCED_PREFS = [
  { meta: 'xp_mode',       local: 'habitTrackerXpMode',       box: 'xp-mode-toggle',       get: function () { return xpMode; },           set: function (v) { xpMode = v; } },
  { meta: 'hard_optional', local: 'habitTrackerHardOptional', box: 'hard-optional-toggle', get: function () { return hardOptional; },     set: function (v) { hardOptional = v; } },
  { meta: 'show_optional', local: 'habitTrackerShowOptional', box: 'show-optional-toggle', get: function () { return showOptionalToday; }, set: function (v) { showOptionalToday = v; } },
  { meta: 'extra_credit',  local: 'habitTrackerExtraCredit',  box: 'extra-credit-toggle',  get: function () { return extraCreditEnabled; }, set: function (v) { extraCreditEnabled = v; } },
  { meta: 'victory_anim',  local: 'habitTrackerVictory',      box: 'victory-toggle',       get: function () { return victoryOn; },        set: function (v) { victoryOn = v; } }
];

// Small settings go to your account profile (sent in batches, not one request per click).
// Bulky ones (layouts, presets, money rules, bank column setups) go to the user_settings table, so the login pass stays small.
var prefQueue = {}, prefTimer = null;
function savePref(obj) {
  if (!currentUser) return;
  currentUser.user_metadata = currentUser.user_metadata || {};
  Object.keys(obj).forEach(function (k) {
    if (BIG_KEYS[k]) { settingSet(k, obj[k]); return; }
    currentUser.user_metadata[k] = obj[k]; prefQueue[k] = obj[k];
  });
  clearTimeout(prefTimer);
  if (Object.keys(prefQueue).length) prefTimer = setTimeout(flushPrefs, 700);
}
function flushPrefs() {
  var data = prefQueue; prefQueue = {};
  if (!Object.keys(data).length) return;
  sb.auth.updateUser({ data: data }).then(function (r) {
    if (r && r.error) { showAppError('Could not save a setting: ' + r.error.message); return; }
    if (r && r.data && r.data.user) currentUser = r.data.user;
  });
}

var BIG_KEYS = { dash_layout: 1, dash_presets: 1, money_rules: 1, money_csv_maps_list: 1 };
var USER_SETTINGS = null, USER_SETTINGS_OK = false, settingTimers = {};
async function loadUserSettings() {
  if (USER_SETTINGS !== null || !currentUser) return;
  USER_SETTINGS = {};
  var r = await sb.from('user_settings').select('key,value').eq('user_id', currentUser.id);
  if (r.error) {
    USER_SETTINGS_OK = false; USER_SETTINGS = null;   // try again next load
    if (isReachError(r.error.message)) showAppError('Could not reach Supabase to load your settings: ' + r.error.message);
    else showAppError('Run the new user_settings SQL in Supabase so your layouts and money rules can be saved (' + r.error.message + ')');
    return;
  }
  USER_SETTINGS_OK = true;
  (r.data || []).forEach(function (row) { USER_SETTINGS[row.key] = row.value; });
  // Move anything bulky still stored in the profile into the table, then remove it from the profile.
  var m = currentUser.user_metadata || {}, clear = {};
  for (var k in BIG_KEYS) {
    if (m[k] === undefined || m[k] === null) continue;
    if (!(k in USER_SETTINGS)) { USER_SETTINGS[k] = m[k]; await sb.from('user_settings').upsert({ user_id: currentUser.id, key: k, value: m[k] }, { onConflict: 'user_id,key' }); }
    clear[k] = null;
  }
  if (Object.keys(clear).length) { Object.keys(clear).forEach(function (k) { m[k] = null; }); sb.auth.updateUser({ data: clear }); }
}
function settingGet(k) {
  if (BIG_KEYS[k]) {
    if (USER_SETTINGS && k in USER_SETTINGS) return USER_SETTINGS[k];
    try { var l = localStorage.getItem('habitTrackerSetting_' + k); if (l) return JSON.parse(l); } catch (e) {}
  }
  var m = currentUser && currentUser.user_metadata; return m ? m[k] : undefined;
}
function settingSet(k, v) {
  USER_SETTINGS = USER_SETTINGS || {}; USER_SETTINGS[k] = v;
  try { localStorage.setItem('habitTrackerSetting_' + k, JSON.stringify(v)); } catch (e) {}
  if (!currentUser || !USER_SETTINGS_OK) return;
  clearTimeout(settingTimers[k]);
  settingTimers[k] = setTimeout(function () {
    sb.from('user_settings').upsert({ user_id: currentUser.id, key: k, value: v, updated_at: new Date().toISOString() }, { onConflict: 'user_id,key' })
      .then(function (r) {
        if (!r || !r.error) return;
        if (/row-level security|JWT|not authenticated/i.test(r.error.message)) showAppError('Your login on this device expired, so ' + k.replace(/_/g, ' ') + ' could not be saved. Log out (⚙ Settings) and log back in.');
        else showAppError('Could not save ' + k.replace(/_/g, ' ') + ': ' + r.error.message);
      });
  }, 600);
}

async function applySyncedPrefs() {
  if (!currentUser) return;
  // getSession() can hand back an old copy saved in this browser, so ask the server for the latest settings.
  try { var r = await sb.auth.getUser(); if (r && r.data && r.data.user) currentUser = r.data.user; } catch (e) {}
  var meta = currentUser.user_metadata || {}, push = {}, changed = false;
  SYNCED_PREFS.forEach(function (p) {
    if (typeof meta[p.meta] === 'boolean') { if (meta[p.meta] !== p.get()) { p.set(meta[p.meta]); changed = true; } }   // your account's setting wins
    else push[p.meta] = p.get();                                                                                        // first time: save this browser's setting to your account
    try { localStorage.setItem(p.local, p.get() ? '1' : '0'); } catch (e) {}
    var cb = document.getElementById(p.box); if (cb) cb.checked = p.get();
  });
  if (Object.keys(push).length) savePref(push);
  if (typeof dashApplyLayout === 'function') dashApplyLayout();   // movable dashboard: use this account's saved layout
  if (typeof renderDashPresets === 'function') renderDashPresets();
  var t = meta.preferred_theme;   // same fix for the theme
  if (t && t !== document.body.getAttribute('data-theme')) { var sel = document.getElementById('theme-select'); if (sel) sel.value = t; changeTheme(t); }
  else if (changed) renderEverything();
}

function toggleVictory(on) {
  victoryOn = on;
  try { localStorage.setItem('habitTrackerVictory', on ? '1' : '0'); } catch (e) {}
  savePref({ victory_anim: on });
  if (on) victory('pop', 'Yay! 🎉');
}

// ============================================
// VICTORY ANIMATIONS
// victory('pop', text)  = little burst + word where you clicked
// victory('big', text)  = confetti rain + banner for bigger wins
// Colors come from the theme, so every theme gets its own confetti.
// ============================================
var vicPt = null;
document.addEventListener('pointerdown', function (e) { vicPt = { x: e.clientX, y: e.clientY, t: Date.now() }; }, true);
var VIC_CHEERS = ['Nice!', 'Yes!', 'Done!', 'Go you!', 'Slay!', '+1', 'Love that', 'Crushed it', 'On a roll', '✨'];

function vicColors() {
  var cs = getComputedStyle(document.body);
  return ['--c-pink', '--c-purple', '--c-orange', '--week-1-bg', '--week-2-bg', '--week-3-bg', '--week-4-bg']
    .map(function (v) { return cs.getPropertyValue(v).trim(); }).filter(Boolean);
}
function vicLayer() {
  var l = document.getElementById('victory-layer');
  if (!l) { l = document.createElement('div'); l.id = 'victory-layer'; l.setAttribute('aria-hidden', 'true'); document.body.appendChild(l); }
  return l;
}
function vicRemoveLater(el, ms) { setTimeout(function () { el.remove(); }, ms); }

function victory(kind, text) {
  if (!victoryOn) return;
  var calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;   // people who turned off motion in their computer settings get just the word
  if (kind === 'big') vicBig(text, calm);
  else vicPop(text || VIC_CHEERS[Math.floor(Math.random() * VIC_CHEERS.length)], calm);
}

function vicPop(text, calm) {
  var layer = vicLayer(), colors = vicColors();
  var p = (vicPt && Date.now() - vicPt.t < 5000) ? vicPt : { x: innerWidth / 2, y: innerHeight / 2 };
  var word = document.createElement('div');
  word.className = 'vic-word'; word.textContent = text;
  word.style.left = p.x + 'px'; word.style.top = p.y + 'px';
  layer.appendChild(word); vicRemoveLater(word, 1200);
  if (calm) return;
  for (var i = 0; i < 14; i++) {
    var s = document.createElement('i'), a = Math.random() * Math.PI * 2, d = 30 + Math.random() * 45;
    s.className = 'vic-spark' + (i % 3 === 0 ? ' round' : '');
    s.style.left = p.x + 'px'; s.style.top = p.y + 'px';
    s.style.setProperty('--dx', Math.cos(a) * d + 'px'); s.style.setProperty('--dy', Math.sin(a) * d + 'px');
    s.style.background = colors[i % colors.length];
    layer.appendChild(s); vicRemoveLater(s, 800);
  }
}

function vicBig(text, calm) {
  var layer = vicLayer(), colors = vicColors();
  var old = layer.querySelector('.vic-banner'); if (old) old.remove();
  var b = document.createElement('div');
  b.className = 'vic-banner'; b.textContent = text;
  layer.appendChild(b); vicRemoveLater(b, 2600);
  if (calm) return;
  for (var i = 0; i < 70; i++) {
    var c = document.createElement('i');
    c.className = 'vic-confetti';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = colors[i % colors.length];
    c.style.animationDelay = Math.random() * 0.6 + 's';
    c.style.animationDuration = 1.6 + Math.random() * 1.2 + 's';
    c.style.setProperty('--drift', (Math.random() * 160 - 80) + 'px');
    c.style.setProperty('--spin', (Math.random() * 720 - 360) + 'deg');
    layer.appendChild(c); vicRemoveLater(c, 3600);
  }
}

// Called whenever a habit box is ticked (monthly checklist or Today box).
function vicHabit(habitId, iso, before, after) {
  if (!victoryOn || !(after > before)) return;   // only when you add a check, not when you take one away
  var h = RAW_HABITS.filter(function (x) { return String(x.id) === String(habitId); })[0]; if (!h) return;
  var now = new Date(), todayIso = localISO(now);
  // Biggest win first: this tick finished ALL of today's required habits.
  if (iso === todayIso) {
    var items = [];
    RAW_HABITS.forEach(function (x) { var r = getTodayRequirement(x, now); if (r) items.push({ x: x, r: r }); });
    var mine = items.filter(function (it) { return String(it.x.id) === String(habitId); })[0];
    var allDone = items.length && items.every(function (it) { return ((allTimeLogs[String(it.x.id)] || {})[iso] || 0) >= it.r.required; });
    if (allDone && mine && before < mine.r.required) { victory('big', 'All of today\'s habits done! 🎉'); return; }
  }
  // Next: this tick finished the habit for the whole month on screen.
  var ym = currentYear + '-' + String(currentMonth).padStart(2, '0');
  if (iso.indexOf(ym) === 0) {
    var tot = 0, gotNow = 0, gotBefore = 0;
    for (var d = 1; d <= DAYS_IN_MONTH; d++) {
      var req = dayRequirement(h, d); if (!req) continue;
      var dIso = ym + '-' + String(d).padStart(2, '0'), n = (allTimeLogs[String(h.id)] || {})[dIso] || 0;
      tot += req; gotNow += Math.min(n, req); gotBefore += Math.min(dIso === iso ? before : n, req);
    }
    if (tot && gotNow >= tot && gotBefore < tot) { victory('big', (h.icon || '') + ' ' + h.name + ': month complete! 🏆'); return; }
  }
  // Otherwise a little pop. Habits you do more than once a day say when they're finished for the day.
  var dayReq = 1;
  if (iso.indexOf(ym) === 0) dayReq = dayRequirement(h, +iso.slice(8)) || 1;
  if (dayReq > 1 && after >= dayReq) victory('pop', after + '/' + dayReq + ' ✓');
  else victory('pop');
}


// ============================================
// BONUS CHECK-INS (archived habits + habits done on a day they weren't due)
// Always drawn on the charts in the striped bonus color.
// Percentages only count them when Extra credit is on (then they can go past 100%).
// ============================================
var COMEBACK_XP = 20, COMEBACK_GAP = 30;   // +20 XP for logging a habit you haven't touched in 30+ days
function bonusColor() { return getThemeColor('--bonus-color') || getThemeColor('--c-orange') || '#EF9F27'; }
function bonusPattern(color) {   // diagonal stripes for the Bonus bars
  var c = document.createElement('canvas'); c.width = c.height = 8;
  var x = c.getContext('2d');
  x.fillStyle = lightenColor(color, 0.55) || color; x.fillRect(0, 0, 8, 8);
  x.strokeStyle = color; x.lineWidth = 3; x.beginPath();
  x.moveTo(-2, 10); x.lineTo(10, -2); x.moveTo(-2, 2); x.lineTo(2, -2); x.moveTo(6, 10); x.lineTo(10, 6); x.stroke();
  return x.createPattern(c, 'repeat');
}
function isBonusDay(h, d) {   // d = day of the month on screen
  if (h.archived) return true;
  var iso = currentYear + '-' + String(currentMonth).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  if (habitAt(h, iso).freq_type === 'monthly') return false;   // "X times a month" days count on any day
  return dayRequirement(h, d) === 0;
}
function bonusForDay(d) {
  var iso = currentYear + '-' + String(currentMonth).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  var out = { count: 0, items: [], archived: [], offday: [] };
  allHabits().forEach(function (h) {
    var n = (logsLookup[String(h.id)] && logsLookup[String(h.id)][iso]) || 0;
    if (n > 0 && isBonusDay(h, d)) {
      out.count += n; out.items.push({ h: h, n: n });
      (h.archived ? out.archived : out.offday).push((h.icon ? h.icon + ' ' : '') + h.name + (n > 1 ? ' ×' + n : ''));
    }
  });
  return out;
}
function bonusTooltipLines(b) {
  if (!b || !b.count) return null;
  var lines = ['Bonus: ' + b.count + ' check-in' + (b.count > 1 ? 's' : '') + (extraCreditEnabled ? ' (extra credit on)' : '')];
  if (b.archived.length) { lines.push('Archived:'); b.archived.forEach(function (n) { lines.push('  ' + n); }); }
  if (b.offday.length) { lines.push('Not due that day:'); b.offday.forEach(function (n) { lines.push('  ' + n); }); }
  return lines;
}
function monthDayLabel(d) { return new Date(currentYear, currentMonth - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
function comebackDates(hid) {   // dates you logged a habit after a 30+ day gap
  var logs = allTimeLogs[hid] || {}, days = Object.keys(logs).filter(function (k) { return logs[k] > 0; }).sort(), out = [];
  for (var i = 1; i < days.length; i++) if (isoDiff(days[i - 1], days[i]) >= COMEBACK_GAP) out.push(days[i]);
  return out;
}
function isoToDate(iso) { var p = iso.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
function isoDiff(a, b) { return Math.round((isoToDate(b) - isoToDate(a)) / 86400000); }

// ============================================
// EVERY HABIT PAGE (🏆): Active and Archives tabs, trophy cards, levels, heatmaps
// ============================================
var EH_LEVELS = [0, 3, 7, 15, 25, 40, 60, 85, 115, 150, 200, 260, 330, 410, 500];   // check-ins needed for Lv 1, 2, 3...
var ehTab = 'active', ehSel = null, ehQuery = '';
function ehLevel(n) { var l = 1; for (var i = 0; i < EH_LEVELS.length; i++) if (n >= EH_LEVELS[i]) l = i + 1; return l; }
function ehTier(l) { return l >= 7 ? 'gold' : l >= 5 ? 'silver' : l >= 3 ? 'bronze' : ''; }
function ehInfo(h) {
  var hid = String(h.id), logs = allTimeLogs[hid] || {}, total = 0, days = 0, first = null, last = null, capped = 0;
  Object.keys(logs).forEach(function (iso) {
    var n = logs[iso] || 0; if (n <= 0) return;
    total += n; days++;
    if (!first || iso < first) first = iso; if (!last || iso > last) last = iso;
    var p = iso.split('-'), dow = (new Date(+p[0], +p[1] - 1, +p[2]).getDay() + 6) % 7, s = schedDays(habitAt(h, iso))[dow];
    capped += Math.min(n, (s && s.required > 0) ? s.required : 1);
  });
  var lv = ehLevel(total), today = localISO(new Date());
  return { total: total, days: days, first: first, last: last, lv: lv, next: EH_LEVELS[lv] || null,
    ago: last ? isoDiff(last, today) : null,
    xp: capped * (XP_VALUES[h.difficulty] || 0) + comebackDates(hid).length * COMEBACK_XP };
}
function ehAgoText(i) { return i.ago === null ? 'never logged' : i.ago === 0 ? 'today' : i.ago === 1 ? 'yesterday' : i.ago + ' days ago'; }

function toggleEveryPage(tab) {
  var page = document.getElementById('every-page');
  var opening = tab ? true : page.style.display !== 'block';
  page.style.display = opening ? 'block' : 'none';
  if (!opening) return;
  if (tab) ehTab = tab;
  ['sleep-page', 'history-page', 'mood-page', 'money-page', 'shop-page', 'memory-page'].forEach(function (id) { var el = document.getElementById(id); if (el) el.style.display = 'none'; });
  ehRender();
}

function ehBox(title, body, extra) {
  return '<div class="cell-border eh-box' + (extra || '') + '"><div class="title-bar"><span class="title-glyph"></span><span class="title-text">' + title + '</span><span class="title-dots"><span></span><span></span><span></span></span></div><div class="cell-body">' + body + '</div></div>';
}

function ehRender() {
  var root = document.getElementById('eh-root'); if (!root || document.getElementById('every-page').style.display !== 'block') return;
  var all = allHabits(), info = {};
  all.forEach(function (h) { info[h.id] = ehInfo(h); });
  var q = ehQuery.trim().toLowerCase();
  var list = q ? all.filter(function (h) { return h.name.toLowerCase().indexOf(q) > -1 || (h.category || '').toLowerCase().indexOf(q) > -1; })
               : (ehTab === 'archived' ? ARCHIVED_HABITS : RAW_HABITS).slice();
  list.sort(function (a, b) { return info[b.id].total - info[a.id].total || a.name.localeCompare(b.name); });

  // Collector stats
  var lv5 = all.filter(function (h) { return info[h.id].lv >= 5; }).length;
  var checks = all.reduce(function (a, h) { return a + info[h.id].total; }, 0);
  var stats = '<div class="eh-stats">' +
    '<div class="sleep-tile"><div class="sleep-big">' + all.length + '</div><div class="sleep-sub">habits ever tracked</div></div>' +
    '<div class="sleep-tile"><div class="sleep-big">' + lv5 + '</div><div class="sleep-sub">habits at Lv 5+</div></div>' +
    '<div class="sleep-tile"><div class="sleep-big">' + checks + '</div><div class="sleep-sub">lifetime check-ins</div></div>' +
    '<div class="sleep-tile"><div class="sleep-big">' + ARCHIVED_HABITS.length + '</div><div class="sleep-sub">archived</div></div></div>';

  var top = '<input id="eh-search" class="sleep-input eh-search" type="search" placeholder="🔍 Search every habit, then tap + to log it" value="' + moneyEsc(ehQuery) + '">' +
    '<div class="eh-tabs"><button type="button" class="sleep-q-btn' + (ehTab === 'active' && !q ? ' on' : '') + '" data-eh-tab="active">Active ' + RAW_HABITS.length + '</button>' +
    '<button type="button" class="sleep-q-btn' + (ehTab === 'archived' && !q ? ' on' : '') + '" data-eh-tab="archived">Archives ' + ARCHIVED_HABITS.length + '</button></div>' + stats;

  // 30-day nudge (Active tab only)
  var nudge = '';
  if (ehTab === 'active' && !q) {
    var stale = RAW_HABITS.filter(function (h) { var i = info[h.id]; if (i.ago !== null) return i.ago >= COMEBACK_GAP; return h.created_at && isoDiff(localISO(new Date(h.created_at)), localISO(new Date())) >= COMEBACK_GAP; });
    if (stale.length) nudge = '<div class="eh-nudge"><b>💤 Not done in 30+ days. Archive?</b>' + stale.map(function (h) {
      return '<div class="eh-nudge-row"><span>' + (h.icon || '') + ' ' + moneyEsc(h.name) + ' · ' + ehAgoText(info[h.id]) + '</span><button type="button" class="sleep-q-btn" data-eh-archive="' + h.id + '">📦 Archive</button></div>';
    }).join('') + '</div>';
  }

  var cards = list.map(function (h) {
    var i = info[h.id], tier = ehTier(i.lv), prev = EH_LEVELS[i.lv - 1] || 0, pct = i.next ? Math.round((i.total - prev) / (i.next - prev) * 100) : 100;
    return '<div class="eh-card' + (tier ? ' eh-' + tier : '') + (ehSel === h.id ? ' sel' : '') + (h.archived ? ' arch' : '') + '" data-eh-card="' + h.id + '">' +
      '<div class="eh-card-top"><span class="eh-lv">Lv ' + i.lv + '</span>' + (h.archived ? '<span class="eh-arch-tag">archived</span>' : '') +
      (h.archived ? '<button type="button" class="eh-trash" data-eh-delete="' + h.id + '" title="Delete forever (erases its history)">🗑</button>' : '') +
      '<button type="button" class="eh-plus" data-eh-log="' + h.id + '" title="Log it today">+</button></div>' +
      '<div class="eh-name">' + (h.icon || '✅') + ' ' + moneyEsc(h.name) + '</div>' +
      '<div class="eh-meta">' + i.total + ' times · ' + ehAgoText(i) + '</div>' +
      '<div class="eh-prog"><i style="width:' + pct + '%"></i></div>' +
      '<div class="eh-meta2">' + (i.next ? (i.next - i.total) + ' to Lv ' + (i.lv + 1) : 'Max level') + ' · ' + i.xp + ' XP</div></div>';
  }).join('');
  if (!cards) cards = q ? '<p class="sleep-empty">No habit called "' + moneyEsc(ehQuery) + '". Press Enter to add it as a new habit.</p>'
                        : (ehTab === 'archived' ? '<p class="sleep-empty">Nothing archived yet. Archive a habit with 📦 in Settings → Your habits.</p>' : '<p class="sleep-empty">No active habits yet.</p>');
  if (ehTab === 'archived' && !q && ARCHIVED_HABITS.length) nudge += '<div class="eh-purge"><span>Old test habits cluttering your stats? 🗑 on a card deletes it forever.</span><button type="button" class="sleep-q-btn" data-eh-purge="1">🧹 Delete all never-logged</button></div>';
  var legend = '<p class="eh-legend">Card border: <span class="eh-key eh-bronze">bronze Lv 3+</span> <span class="eh-key eh-silver">silver Lv 5+</span> <span class="eh-key eh-gold">gold Lv 7+</span> · logging a habit after 30+ days gives a +' + COMEBACK_XP + ' XP comeback bonus</p>';

  var detail = '';
  var sh = ehSel !== null && all.filter(function (h) { return h.id === ehSel; })[0];
  if (sh) detail = ehBox(moneyEsc(sh.name) + ' · all time', ehDetail(sh, info[sh.id]), ' eh-detail-box');

  var fame = all.slice().sort(function (a, b) { return info[b.id].total - info[a.id].total; }).filter(function (h) { return info[h.id].total > 0; }).slice(0, 10);
  var fameHtml = fame.map(function (h, k) { var i = info[h.id]; return '<div class="eh-fame-row"><span>' + (k + 1) + '. ' + (h.icon || '') + ' ' + moneyEsc(h.name) + (h.archived ? ' <small>(archived)</small>' : '') + '</span><span>Lv ' + i.lv + ' · ' + i.total + '</span></div>'; }).join('') || '<p class="sleep-empty">Log some habits to fill your Hall of Fame.</p>';

  var focus = document.activeElement && document.activeElement.id === 'eh-search', caret = focus ? document.activeElement.selectionStart : 0;
  root.innerHTML = ehBox(q ? 'Search results' : (ehTab === 'archived' ? 'Archives' : 'Active habits'), top + nudge + legend + '<div class="eh-grid">' + cards + '</div>') + detail + ehBox('Hall of fame', fameHtml);
  if (focus) { var se = document.getElementById('eh-search'); se.focus(); try { se.setSelectionRange(caret, caret); } catch (e) {} }
}

function ehDetail(h, i) {
  var hid = String(h.id), logs = allTimeLogs[hid] || {}, today = new Date(); today.setHours(0, 0, 0, 0);
  var startIso = i.first || localISO(today);
  if (h.created_at && localISO(new Date(h.created_at)) < startIso) startIso = localISO(new Date(h.created_at));
  var start = isoToDate(startIso), minStart = new Date(today); minStart.setDate(minStart.getDate() - 7 * 15);
  if (start > minStart) start = minStart;                       // always show at least ~16 weeks
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));  // back to Monday
  var cols = '', months = '', lastM = -1, sinceLabel = 9;
  for (var w = new Date(start); w <= today; w.setDate(w.getDate() + 7)) {
    var m = w.getMonth(), show = m !== lastM && sinceLabel >= 3;   // month name when the month changes (spaced out so names don't overlap)
    months += '<span>' + (show ? w.toLocaleDateString('en-US', { month: 'short' }) : '') + '</span>';
    if (m !== lastM && show) sinceLabel = 0; else sinceLabel++;
    if (show || m !== lastM) lastM = show ? m : lastM;
    cols += '<div class="eh-col">';
    for (var r = 0; r < 7; r++) {
      var d = new Date(w); d.setDate(w.getDate() + r);
      var iso = localISO(d), n = logs[iso] || 0, cls = d > today ? ' future' : n > 1 ? ' l2' : n ? ' l1' : '';
      cols += '<i class="eh-cell' + cls + '" title="' + d.toDateString() + (n ? ': ' + n + '×' : '') + '"></i>';
    }
    cols += '</div>';
  }
  var cb = comebackDates(hid).length;
  return '<div class="eh-detail-top"><span>' + i.days + ' days logged · ' + i.total + ' check-ins · Lv ' + i.lv + ' · ' + i.xp + ' XP' + (cb ? ' · ' + cb + ' comeback' + (cb > 1 ? 's' : '') : '') + (i.first ? ' · first ' + moneyDay(i.first) : '') + '</span>' +
      (h.archived ? '<span><button type="button" class="sleep-q-btn" onclick="restoreHabit(' + h.id + ')">↩ Restore to dashboard</button> <button type="button" class="sleep-q-btn" data-eh-delete="' + h.id + '">🗑 Delete forever</button></span>' : '<button type="button" class="sleep-q-btn" data-eh-archive="' + h.id + '">📦 Archive</button>') + '</div>' +
    '<div class="eh-heat"><div class="eh-months">' + months + '</div><div class="eh-cols">' + cols + '</div></div>' +
    '<div class="eh-sched"><div class="eh-sched-head"><b>Schedule history</b><button type="button" class="sleep-q-btn" onclick="openScheduleEditor(' + h.id + ')">📅 Edit schedule</button></div>' + schedHistoryHtml(h, false) + '</div>' +
    '<div class="eh-past"><span class="sleep-label">Forgot a day?</span><input type="date" id="eh-past-date" class="sleep-input" max="' + localISO(today) + '" value="' + localISO(today) + '">' +
    '<button type="button" class="settings-btn sleep-small-btn" data-eh-past="1" data-id="' + h.id + '">+ Log that day</button>' +
    '<button type="button" class="sleep-q-btn" data-eh-past="-1" data-id="' + h.id + '">− Remove one</button></div>';
}

async function ehLog(id, iso, delta) {
  var h = allHabits().filter(function (x) { return x.id === id; })[0]; if (!h) return;
  var hid = String(id), logs = allTimeLogs[hid] || {}, before = logs[iso] || 0, next = Math.max(0, before + delta);
  if (next === before) return;
  var prevDays = Object.keys(logs).filter(function (k) { return logs[k] > 0 && k < iso; }).sort();
  var comeback = delta > 0 && before === 0 && prevDays.length && isoDiff(prevDays[prevDays.length - 1], iso) >= COMEBACK_GAP;
  var lvBefore = ehInfo(h).lv;
  await saveLog(id, iso, next);   // also redraws the dashboard (and pops for active habits)
  var lvAfter = ehInfo(h).lv;
  if (delta > 0) {
    if (lvAfter > lvBefore) victory('big', (h.icon || '') + ' ' + h.name + ' reached Lv ' + lvAfter + '! 🏆');
    else if (comeback) victory('big', 'Comeback! +' + COMEBACK_XP + ' XP 🔥');
    else if (h.archived) victory('pop');
  }
  ehRender();
}

document.addEventListener('click', function (e) {
  var page = document.getElementById('every-page'); if (!page || !page.contains(e.target)) return;
  var t = e.target.closest('[data-eh-tab],[data-eh-log],[data-eh-archive],[data-eh-delete],[data-eh-purge],[data-eh-past],[data-eh-card]'); if (!t) return;
  if (t.hasAttribute('data-eh-delete')) { e.stopPropagation(); deleteHabitForever(+t.getAttribute('data-eh-delete')); return; }
  if (t.hasAttribute('data-eh-purge')) { deleteNeverLoggedArchived(); return; }
  if (t.hasAttribute('data-eh-tab')) { ehTab = t.getAttribute('data-eh-tab'); ehQuery = ''; ehRender(); return; }
  if (t.hasAttribute('data-eh-log')) { e.stopPropagation(); var id = +t.getAttribute('data-eh-log'); ehSel = id; ehLog(id, localISO(new Date()), 1); return; }
  if (t.hasAttribute('data-eh-archive')) { archiveHabit(+t.getAttribute('data-eh-archive')); return; }
  if (t.hasAttribute('data-eh-past')) {
    var iso = (document.getElementById('eh-past-date') || {}).value;
    if (!iso || iso > localISO(new Date())) { alert('Pick a day that is today or earlier.'); return; }
    ehLog(+t.getAttribute('data-id'), iso, +t.getAttribute('data-eh-past')); return;
  }
  if (t.hasAttribute('data-eh-card')) {
    var cid = +t.getAttribute('data-eh-card'); ehSel = ehSel === cid ? null : cid; ehRender();
    if (ehSel !== null) { var box = document.querySelector('.eh-detail-box'); if (box) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  }
});
document.addEventListener('input', function (e) { if (e.target && e.target.id === 'eh-search') { ehQuery = e.target.value; ehRender(); } });
document.addEventListener('keydown', function (e) {
  if (!e.target || e.target.id !== 'eh-search' || e.key !== 'Enter') return;
  var name = ehQuery.trim(); if (!name) return;
  var match = allHabits().filter(function (h) { return h.name.toLowerCase().indexOf(name.toLowerCase()) > -1; });
  if (match.length === 1) { ehSel = match[0].id; ehLog(match[0].id, localISO(new Date()), 1); return; }   // one match: Enter logs it
  if (match.length) return;
  if (!confirm('Add "' + name + '" as a new habit? Settings will open with the name filled in.')) return;
  toggleEveryPage(); toggleSettings();
  var f = document.getElementById('habit-name'); if (f) { f.value = name; f.scrollIntoView({ block: 'center' }); f.focus(); }
});



// ============================================
// SCHEDULE HISTORY: change a habit's schedule from a date on (or rewrite all history)
// Each change is saved as a version in the habit_schedule_versions table.
// A habit with no versions simply uses its current schedule for every date.
// ============================================
var SCHED_VERSIONS = {}, SCHED_TABLE_OK = true, SCHED_BEGIN = '1900-01-01';
var DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// "2026-10-15" means Oct 15 on your own calendar (new Date("2026-10-15") would read it as London midnight).
function parseLocalDate(s) {
  if (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  return new Date(s);
}
// One-time fix: "every X days" start dates used to be read one day early in the Americas.
// Save them as the day they've actually been showing, so your pattern stays exactly the same.
async function fixIntervalStartDates(rows) {
  if (!currentUser) return;
  try { var u = await sb.auth.getUser(); if (u && u.data && u.data.user) currentUser = u.data.user; } catch (e) {}
  if ((currentUser.user_metadata || {}).interval_dates_local) return;
  var ok = true;
  for (var i = 0; i < rows.length; i++) {
    var h = rows[i];
    if (h.freq_type !== 'interval' || !/^\d{4}-\d{2}-\d{2}$/.test(h.start_date || '')) continue;
    var old = new Date(h.start_date); old.setHours(0, 0, 0, 0);
    var shown = localISO(old);
    if (shown === h.start_date) continue;
    var r = await sb.from('habits').update({ start_date: shown }).eq('id', h.id);
    if (r && r.error) ok = false; else h.start_date = shown;
  }
  if (ok) savePref({ interval_dates_local: true });
}
async function loadScheduleVersions() {
  SCHED_VERSIONS = {};
  if (!currentUser) return;
  var r = await sb.from('habit_schedule_versions').select('*').eq('user_id', currentUser.id).order('effective_from', { ascending: true });
  if (r.error) { SCHED_TABLE_OK = false; return; }
  SCHED_TABLE_OK = true;
  (r.data || []).forEach(function (v) {
    var k = String(v.habit_id);
    (SCHED_VERSIONS[k] = SCHED_VERSIONS[k] || []).push({ id: v.id, effective_from: v.effective_from, freq_type: v.freq_type || 'days', freq_value: v.freq_value, start_date: v.start_date, days: v.days || {} });
  });
  Object.keys(SCHED_VERSIONS).forEach(function (k) { SCHED_VERSIONS[k].sort(function (a, b) { return a.effective_from < b.effective_from ? -1 : 1; }); });
}
// The habit as it was scheduled on a date. The newest version is always the habit's current schedule.
function habitAt(h, iso) {
  var vs = SCHED_VERSIONS[String(h.id)];
  if (!vs || !vs.length) return h;
  var v = vs[0];
  for (var i = 0; i < vs.length; i++) if (vs[i].effective_from <= iso) v = vs[i];
  if (v === vs[vs.length - 1]) return h;
  return { id: h.id, name: h.name, icon: h.icon, category: h.category, difficulty: h.difficulty, archived: h.archived, created_at: h.created_at,
    freq_type: v.freq_type, freq_value: v.freq_value, start_date: v.start_date, _sched: v.days };
}
function schedDays(h) { return h._sched || scheduleLookup[String(h.id)] || {}; }
// What a schedule asks for on one day: kind (days / interval / monthly), how many times, and whether it's a flexible day.
function schedReq(hh, y, m, d) {
  if (hh.freq_type === 'monthly') return { kind: 'monthly', req: 0, flexible: true };
  if (hh.freq_type === 'interval' && hh.freq_value && hh.start_date) {
    var ds = Math.round((new Date(y, m - 1, d) - parseLocalDate(hh.start_date)) / 86400000);
    return { kind: 'interval', req: (ds >= 0 && ds % hh.freq_value === 0) ? 1 : 0, flexible: false };
  }
  var s = schedDays(hh)[(new Date(y, m - 1, d).getDay() + 6) % 7];
  return { kind: 'days', req: (s && s.required > 0) ? s.required : 0, flexible: s ? !!s.flexible : true };
}
// "X times per month" goal for a month, prorated by the days each schedule covered.
function monthlyGoalFor(h, y, m) {
  var dim = new Date(y, m, 0).getDate(), g = 0;
  for (var d = 1; d <= dim; d++) { var hh = habitAt(h, y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0')); if (hh.freq_type === 'monthly') g += (hh.freq_value || 0) / dim; }
  return Math.round(g);
}
function schedChangeOn(hid, iso) {
  var vs = SCHED_VERSIONS[hid]; if (!vs || vs.length < 2) return '';
  for (var i = 1; i < vs.length; i++) if (vs[i].effective_from === iso) return schedDescribe(vs[i - 1]) + ' → ' + schedDescribe(vs[i]);
  return '';
}
function schedCurrent(h) {   // current schedule as a plain object
  var days = {}, sl = scheduleLookup[String(h.id)] || {};
  Object.keys(sl).forEach(function (k) { days[k] = { required: sl[k].required, flexible: !!sl[k].flexible }; });
  return { freq_type: h.freq_type || 'days', freq_value: h.freq_value, start_date: h.start_date, days: days };
}
function schedDescribe(v) {
  if (v.freq_type === 'monthly') return (v.freq_value || 0) + ' times per month, any day';
  if (v.freq_type === 'interval') return 'Every ' + v.freq_value + ' days' + (v.start_date ? ' (cycle from ' + moneyDay(v.start_date).replace(/, \d{4}$/, '') + ')' : '');
  var req = [], flex = [], per = 1;
  for (var i = 0; i < 7; i++) { var s = v.days && v.days[i]; if (!s || !(s.required > 0)) continue; if (s.required > per) per = s.required; (s.flexible ? flex : req).push(DAY_SHORT[i]); }
  var t = req.length === 7 ? 'Daily' : req.length ? req.join('/') : '';
  if (flex.length) t += (t ? ' · flexible ' : 'Flexible ') + flex.join('/');
  return (t || 'No days') + (per > 1 ? ' (' + per + '× a day)' : '');
}
function schedHistoryHtml(h, withUndo) {
  var vs = SCHED_VERSIONS[String(h.id)];
  if (!vs || vs.length < 2) return '<p class="se-hist-empty">No changes yet. Always: ' + moneyEsc(schedDescribe(schedCurrent(h))) + '</p>';
  return vs.map(function (v, i) {
    var from = v.effective_from <= '1901-01-01' ? 'Start' : moneyDay(v.effective_from);
    var to = i < vs.length - 1 ? moneyDay(localISO(new Date(parseLocalDate(vs[i + 1].effective_from).getTime() - 864e5))) : 'now';
    return '<div class="se-hist-row"><span><span class="se-hist-when">' + from + ' → ' + to + '</span> · ' + moneyEsc(schedDescribe(v)) + '</span>' +
      (withUndo && i > 0 ? '<button type="button" class="sleep-q-btn" onclick="undoScheduleVersion(' + h.id + ',' + v.id + ')">Undo</button>' : '') + '</div>';
  }).join('');
}

// ---------- The editor (a pop-up window) ----------
var SE = null;   // what's being edited
function openScheduleEditor(id) {
  var h = allHabits().filter(function (x) { return x.id === id; })[0]; if (!h) return;
  var cur = schedCurrent(h), today = localISO(new Date());
  var req = [], flex = [], per = 1;
  for (var i = 0; i < 7; i++) { var s = cur.days[i]; req.push(!!(s && s.required > 0 && !s.flexible)); flex.push(!!(s && s.required > 0 && s.flexible)); if (s && s.required > per) per = s.required; }
  SE = { h: h, type: cur.freq_type === 'interval' || cur.freq_type === 'monthly' ? cur.freq_type : 'days', req: req, flex: flex, per: per,
    every: cur.freq_type === 'interval' ? cur.freq_value || 2 : 2, cycle: today, times: cur.freq_type === 'monthly' ? cur.freq_value || 4 : 4,
    eff: today, mode: SCHED_TABLE_OK ? 'keep' : 'rewrite', msg: '' };
  document.getElementById('sched-modal').style.display = 'flex';
  seRender();
}
function closeScheduleEditor() { document.getElementById('sched-modal').style.display = 'none'; SE = null; }
function seNew() {   // the new schedule from the editor
  if (SE.type === 'monthly') return { freq_type: 'monthly', freq_value: SE.times, start_date: SE.h.start_date || null, days: {} };
  if (SE.type === 'interval') return { freq_type: 'interval', freq_value: SE.every, start_date: SE.cycle, days: {} };
  var days = {};
  for (var i = 0; i < 7; i++) if (SE.req[i] || SE.flex[i]) days[i] = { required: SE.per, flexible: !SE.req[i] };
  return { freq_type: 'days', freq_value: null, start_date: SE.h.start_date || null, days: days };
}
function seNextDue(h) {
  var out = [], t = new Date(); t.setHours(0, 0, 0, 0);
  if (habitAt(h, localISO(t)).freq_type === 'monthly') return 'Any day (' + monthlyGoalFor(h, t.getFullYear(), t.getMonth() + 1) + ' this month)';
  for (var i = 0; i < 120 && out.length < 5; i++) {
    var d = new Date(t); d.setDate(t.getDate() + i);
    if (schedReq(habitAt(h, localISO(d)), d.getFullYear(), d.getMonth() + 1, d.getDate()).req > 0) out.push(moneyDay(localISO(d)).replace(/, \d{4}$/, ''));
  }
  return out.length ? out.join(', ') : 'Nothing due soon';
}
function seRender() {
  if (!SE) return;
  var h = SE.h, nv = seNew(), rewrite = SE.mode === 'rewrite';
  var segBtn = function (t, label) { return '<button type="button" class="sleep-q-btn' + (SE.type === t ? ' on' : '') + '" data-se-type="' + t + '">' + label + '</button>'; };
  var dayBtns = function (key) { return SE[key].map(function (on, i) { return '<button type="button" class="day-toggle se-day' + (on ? ' selected' : '') + '" data-se-' + key + '="' + i + '">' + DAY_SHORT[i].charAt(0) + '</button>'; }).join(''); };
  var opts = SE.type === 'days'
    ? '<p class="sleep-label">Required days</p><div class="se-days">' + dayBtns('req') + '</div><p class="sleep-label">Flexible days <small>(optional, do them when you can)</small></p><div class="se-days">' + dayBtns('flex') + '</div><div class="se-row">Times per day <input type="number" class="sleep-input se-num" data-se-field="per" min="1" max="20" value="' + SE.per + '"></div>'
    : SE.type === 'interval'
      ? '<div class="se-row">Every <input type="number" class="sleep-input se-num" data-se-field="every" min="1" max="365" value="' + SE.every + '"> days</div><div class="se-row">Cycle starts on <input type="date" class="sleep-input se-date" data-se-field="cycle" value="' + SE.cycle + '"></div>'
      : '<div class="se-row"><input type="number" class="sleep-input se-num" data-se-field="times" min="1" max="31" value="' + SE.times + '"> times per month, any day</div>';
  var left = '<p class="se-title">' + (h.icon || '✅') + ' ' + moneyEsc(h.name) + (h.archived ? ' <small>(archived)</small>' : '') + '</p>' +
    '<p class="sleep-label">Current schedule</p><div class="se-cur"><b>' + moneyEsc(schedDescribe(schedCurrent(h))) + '</b><span>Next due: ' + moneyEsc(seNextDue(h)) + '</span></div>' +
    '<p class="sleep-label">New schedule</p><div class="se-seg">' + segBtn('days', 'Specific days') + segBtn('interval', 'Every X days') + segBtn('monthly', 'X times per month') + '</div>' +
    '<div class="se-opts">' + opts + '</div>' +
    '<p class="sleep-label">Change starts on</p><input type="date" class="sleep-input se-date" data-se-field="eff" value="' + SE.eff + '"' + (rewrite ? ' disabled' : '') + '>' +
    '<p class="sleep-label">Apply it how?</p>' +
    '<label class="se-radio"><input type="radio" name="se-mode" value="keep"' + (!rewrite ? ' checked' : '') + (SCHED_TABLE_OK ? '' : ' disabled') + '> From that date on (keep the past as it was)</label>' +
    '<label class="se-radio"><input type="radio" name="se-mode" value="rewrite"' + (rewrite ? ' checked' : '') + '> Rewrite all history with the new schedule</label>' +
    (SCHED_TABLE_OK ? '' : '<p class="sleep-msg error">To keep the past as it was, run the schedule-history SQL in Supabase first. Until then you can only rewrite all history.</p>') +
    '<div class="se-btns"><button type="button" class="settings-btn" data-se-save="1">Save</button><button type="button" class="sleep-q-btn" data-se-cancel="1">Cancel</button></div>' +
    '<p class="sleep-msg ok" id="se-msg">' + moneyEsc(SE.msg) + '</p>';

  // Preview month: the month the change starts in (or the month on screen when rewriting)
  var pm = rewrite ? { y: currentYear, m: currentMonth } : { y: +SE.eff.slice(0, 4), m: +SE.eff.slice(5, 7) };
  var dim = new Date(pm.y, pm.m, 0).getDate(), hid = String(h.id), ym = pm.y + '-' + String(pm.m).padStart(2, '0');
  var logs = allTimeLogs[hid] || {}, effDay = (!rewrite && SE.eff.slice(0, 7) === ym) ? +SE.eff.slice(8) : (rewrite ? 1 : 99);
  var kindOf = function (hh, d) { var r = schedReq(hh, pm.y, pm.m, d); return r.kind === 'monthly' ? 'any' : r.req > 0 ? 'req' : 'no'; };
  var cellHtml = function (k, n, mark) { return '<div class="se-b' + (k === 'req' ? ' req' : k === 'any' ? ' any' : '') + (n ? (k === 'no' ? ' bonus' : ' done') : '') + (mark ? ' mark' : '') + '"></div>'; };
  var rowHtml = function (fn) {
    var out = '';
    [[1, 16], [17, dim]].forEach(function (rg) {
      var hd = '', bx = '';
      for (var d = rg[0]; d <= rg[1]; d++) { var dt = new Date(pm.y, pm.m - 1, d); hd += '<div class="se-cell">' + 'MTWTFSS'.charAt((dt.getDay() + 6) % 7) + '<br>' + d + '</div>'; bx += fn(d); }
      for (d = rg[1] + 1; d < rg[0] + 16; d++) { hd += '<div></div>'; bx += '<div></div>'; }
      out += '<div class="se-grid">' + hd + bx + '</div>';
    });
    return out;
  };
  var newH = { id: h.id, freq_type: nv.freq_type, freq_value: nv.freq_value, start_date: nv.start_date, _sched: nv.days };
  var before = rowHtml(function (d) { var iso = ym + '-' + String(d).padStart(2, '0'); return cellHtml(kindOf(habitAt(h, iso), d), logs[iso] > 0, false); });
  var after = rowHtml(function (d) { var iso = ym + '-' + String(d).padStart(2, '0'); var use = d >= effDay ? newH : habitAt(h, iso); return cellHtml(kindOf(use, d), logs[iso] > 0, !rewrite && d === effDay); });
  var monthName = new Date(pm.y, pm.m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  var sum;
  if (rewrite) sum = 'All history: ' + schedDescribe(nv) + '. Days you logged that no longer fit become bonus check-ins (nothing is deleted).';
  else if (effDay > dim) sum = 'The change starts after ' + monthName + '.';
  else {
    var oldPart = effDay > 1 ? monthName.split(' ')[0].slice(0, 3) + ' 1–' + (effDay - 1) + ': ' + schedDescribe(schedCurrent(h)) + '. ' : '';
    if (nv.freq_type === 'monthly') { var rem = dim - effDay + 1; sum = oldPart + 'From ' + monthName.split(' ')[0].slice(0, 3) + ' ' + effDay + ': any day, goal about ' + Math.round(nv.freq_value * rem / dim) + ' for the rest of the month (prorated: ' + nv.freq_value + ' × ' + rem + '/' + dim + ' days). After that: ' + nv.freq_value + ' a month.'; }
    else sum = oldPart + 'From ' + monthName.split(' ')[0].slice(0, 3) + ' ' + effDay + ': ' + schedDescribe(nv) + '.';
  }
  var right = '<div class="se-box"><p class="se-sub"><b>Preview · ' + monthName + '</b></p><p class="se-sum">' + moneyEsc(sum) + '</p>' +
    '<p class="se-rowlbl">Before</p>' + before + '<p class="se-rowlbl">After saving</p>' + after +
    '<div class="se-key"><span><i class="se-b req"></i>required</span><span><i class="se-b req done"></i>done</span><span><i class="se-b any"></i>any day (times per month)</span><span><i class="se-b bonus"></i>bonus</span><span><i class="se-key-mark"></i>change date</span></div></div>' +
    '<div class="se-box"><p class="se-sub"><b>Schedule history</b> <small>· also on this habit\'s card in Every habit</small></p>' + schedHistoryHtml(h, true) + '</div>';
  document.getElementById('sched-dialog').innerHTML = '<div class="se-left">' + left + '</div><div class="se-right">' + right + '</div><button type="button" class="se-x" data-se-cancel="1" title="Close">✕</button>';
}

async function writeCurrentSchedule(hid, v) {
  var upd = { freq_type: v.freq_type, freq_value: v.freq_type === 'days' ? null : v.freq_value };
  if (v.freq_type === 'interval') upd.start_date = v.start_date;
  var r = await sb.from('habits').update(upd).eq('id', hid); if (r && r.error) return r.error.message;
  r = await sb.from('habit_schedule').delete().eq('habit_id', hid); if (r && r.error) return r.error.message;
  var rows = Object.keys(v.days || {}).map(function (k) { return { habit_id: hid, day_of_week: +k, times_required: v.days[k].required, is_flexible: !!v.days[k].flexible }; });
  if (rows.length) { r = await sb.from('habit_schedule').insert(rows); if (r && r.error) return r.error.message; }
  return '';
}
function seVersionRow(hid, eff, v) { return { user_id: currentUser.id, habit_id: hid, effective_from: eff, freq_type: v.freq_type, freq_value: v.freq_value, start_date: v.start_date || null, days: v.days || {} }; }

async function seSave() {
  var h = SE.h, hid = h.id, nv = seNew(), rewrite = SE.mode === 'rewrite', err = '';
  if (nv.freq_type === 'days' && !Object.keys(nv.days).length) { SE.msg = 'Pick at least one day.'; return seRender(); }
  if (nv.freq_type === 'interval' && (!(nv.freq_value >= 1) || !nv.start_date)) { SE.msg = 'Enter how many days and when the cycle starts.'; return seRender(); }
  if (nv.freq_type === 'monthly' && !(nv.freq_value >= 1)) { SE.msg = 'Enter how many times per month.'; return seRender(); }
  if (!rewrite && !/^\d{4}-\d{2}-\d{2}$/.test(SE.eff)) { SE.msg = 'Pick the date the change starts.'; return seRender(); }
  if (rewrite && !confirm('Rewrite ALL of "' + h.name + '"\'s history with the new schedule?\n\nYour logs stay, but past days are re-judged by the new schedule. Any saved schedule history for this habit is cleared.')) return;
  SE.msg = 'Saving…'; seRender();
  var vs = SCHED_VERSIONS[String(hid)] || [];
  if (rewrite) {
    if (vs.length) { var d = await sb.from('habit_schedule_versions').delete().eq('habit_id', hid); if (d && d.error) err = d.error.message; }
  } else {
    if (!vs.length) {   // first change: save the old schedule as the starting version
      var a = await sb.from('habit_schedule_versions').insert(seVersionRow(hid, SCHED_BEGIN, schedCurrent(h))); if (a && a.error) err = a.error.message;
    } else {
      for (var i = 0; i < vs.length && !err; i++) if (vs[i].effective_from >= SE.eff && vs[i].effective_from > SCHED_BEGIN) { var x = await sb.from('habit_schedule_versions').delete().eq('id', vs[i].id); if (x && x.error) err = x.error.message; }
    }
    if (!err) { var b = await sb.from('habit_schedule_versions').insert(seVersionRow(hid, SE.eff, nv)); if (b && b.error) err = b.error.message; }
  }
  if (!err) err = await writeCurrentSchedule(hid, nv);
  if (err) { SE.msg = 'Could not save: ' + err; return seRender(); }
  await loadHabits(); renderEverything(); ehRender();
  SE.h = allHabits().filter(function (x) { return x.id === hid; })[0] || h;
  SE.msg = 'Saved ✓'; seRender();
  victory('pop', 'Schedule saved 📅');
}

async function undoScheduleVersion(hid, vid) {
  var vs = (SCHED_VERSIONS[String(hid)] || []).slice(), idx = vs.findIndex(function (v) { return v.id === vid; }); if (idx < 1) return;
  if (!confirm('Undo the schedule change from ' + moneyDay(vs[idx].effective_from) + '?')) return;
  var r = await sb.from('habit_schedule_versions').delete().eq('id', vid);
  if (r && r.error) { alert('Could not undo: ' + r.error.message); return; }
  var wasLast = idx === vs.length - 1; vs.splice(idx, 1);
  if (wasLast) { var e = await writeCurrentSchedule(hid, vs[vs.length - 1]); if (e) { alert('Could not restore the schedule: ' + e); } }
  if (vs.length === 1) await sb.from('habit_schedule_versions').delete().eq('id', vs[0].id);   // only the start is left: no history needed
  await loadHabits(); renderEverything(); ehRender();
  if (SE) { SE.h = allHabits().filter(function (x) { return x.id === hid; })[0] || SE.h; SE.msg = 'Change undone.'; seRender(); }
}

document.addEventListener('click', function (e) {
  if (!SE) return;
  var modal = document.getElementById('sched-modal');
  if (e.target === modal) { closeScheduleEditor(); return; }
  if (!modal.contains(e.target)) return;
  var t = e.target.closest('[data-se-type],[data-se-req],[data-se-flex],[data-se-save],[data-se-cancel]'); if (!t) return;
  if (t.hasAttribute('data-se-cancel')) { closeScheduleEditor(); return; }
  if (t.hasAttribute('data-se-save')) { seSave(); return; }
  if (t.hasAttribute('data-se-type')) SE.type = t.getAttribute('data-se-type');
  if (t.hasAttribute('data-se-req')) { var i = +t.getAttribute('data-se-req'); SE.req[i] = !SE.req[i]; if (SE.req[i]) SE.flex[i] = false; }
  if (t.hasAttribute('data-se-flex')) { var j = +t.getAttribute('data-se-flex'); SE.flex[j] = !SE.flex[j]; if (SE.flex[j]) SE.req[j] = false; }
  SE.msg = ''; seRender();
});
document.addEventListener('change', function (e) {
  if (!SE || !e.target.closest || !e.target.closest('#sched-modal')) return;
  var f = e.target.getAttribute('data-se-field');
  if (f === 'per' || f === 'every' || f === 'times') SE[f] = Math.max(1, parseInt(e.target.value, 10) || 1);
  else if (f) SE[f] = e.target.value;
  if (e.target.name === 'se-mode') SE.mode = e.target.value;
  SE.msg = ''; seRender();
});


// ============================================
// HIGHLIGHT CURRENT DAY AND WEEKENDS (Settings toggle)
// Checklist: today's column pops, Sat/Sun columns are softly shaded.
// Charts with dates (Daily habit count, Daily trend, Actual vs intended, Month progress pace,
// XP growth, XP speed and acceleration, Mood over the month) get the same bands behind the data.
// ============================================
var highlightDays = false;
try { highlightDays = localStorage.getItem('habitTrackerHighlightDays') === '1'; } catch (e) {}
document.body.classList.toggle('hl-days', highlightDays);
(function () { var cb = document.getElementById('highlight-days-toggle'); if (cb) cb.checked = highlightDays; })();
SYNCED_PREFS.push({ meta: 'highlight_days', local: 'habitTrackerHighlightDays', box: 'highlight-days-toggle',
  get: function () { return highlightDays; }, set: function (v) { highlightDays = v; document.body.classList.toggle('hl-days', v); } });

function toggleHighlightDays(on) {
  highlightDays = on;
  document.body.classList.toggle('hl-days', on);
  try { localStorage.setItem('habitTrackerHighlightDays', on ? '1' : '0'); } catch (e) {}
  savePref({ highlight_days: on });
  if (currentUser) { renderEverything(); if (typeof renderMoodLine === 'function') renderMoodLine(); }
}
// Class for a day of the month on screen: 'hl-today', 'hl-we' (Sat/Sun), or ''.
function hlDayClass(d) {
  var now = new Date(), dow = (firstDayMonBased + d - 1) % 7;
  if (now.getFullYear() === currentYear && now.getMonth() + 1 === currentMonth && now.getDate() === d) return 'hl-today' + (dow >= 5 ? ' hl-we' : '');
  return dow >= 5 ? 'hl-we' : '';
}
var HL_MONTH_CHARTS = { barChart: 1, lineChart: 1, actualVsIntendedChart: 1, paceChart: 1 };
function hlDateFor(chart, label) {
  var id = chart.canvas && chart.canvas.id, pad = function (n) { return String(n).padStart(2, '0'); };
  if (typeof label === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(label)) return label;   // charts labelled with dates (XP charts)
  var d = +label; if (!(d >= 1 && d <= 31)) return null;
  if (HL_MONTH_CHARTS[id]) return currentYear + '-' + pad(currentMonth) + '-' + pad(d);
  if (id === 'moodLineChart' && typeof moodYear !== 'undefined') return moodYear + '-' + pad(moodMonth) + '-' + pad(d);
  return null;
}
function hlRgba(varName, a, fallback) { var c = getThemeColor(varName); return hexToRgb(c) ? hexToRgba(c, a) : fallback; }
if (typeof Chart !== 'undefined') Chart.register({
  id: 'dayHighlight',
  beforeDatasetsDraw: function (chart) {
    if (!highlightDays || chart.options.indexAxis === 'y') return;
    var x = chart.scales.x, area = chart.chartArea, labels = chart.data.labels || [];
    if (!x || !area || !labels.length) return;
    var today = localISO(new Date()), w = (x.right - x.left) / labels.length, ctx = chart.ctx;
    var weFill = hlRgba('--c-text-muted', 0.13, 'rgba(128,128,128,0.13)'), tFill = hlRgba('--c-pink', 0.26, 'rgba(255,105,180,0.26)'), tLine = getThemeColor('--c-pink') || '#ff69b4';
    ctx.save();
    for (var i = 0; i < labels.length; i++) {
      var iso = hlDateFor(chart, labels[i]); if (!iso) continue;
      var dow = (isoToDate(iso).getDay() + 6) % 7, isToday = iso === today;
      if (!isToday && dow < 5) continue;
      var cx = x.getPixelForValue(i), left = Math.max(area.left, cx - w / 2), right = Math.min(area.right, cx + w / 2);
      ctx.fillStyle = isToday ? tFill : weFill;
      ctx.fillRect(left, area.top, right - left, area.bottom - area.top);
      if (isToday) { ctx.strokeStyle = tLine; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(cx, area.top); ctx.lineTo(cx, area.bottom); ctx.stroke(); ctx.setLineDash([]); }
    }
    ctx.restore();
  }
});

// ============================================
// NEW DAY CHECK: when the date changes while the tracker is open (past midnight, or the laptop
// wakes up the next morning), redraw everything so "today" moves without a refresh.
// ============================================
var lastSeenDay = localISO(new Date());
function checkNewDay() {
  var today = localISO(new Date());
  if (today === lastSeenDay) return;
  var before = lastSeenDay; lastSeenDay = today;
  if (!currentUser) return;
  var viewing = currentYear + '-' + String(currentMonth).padStart(2, '0');
  if (before.slice(0, 7) !== today.slice(0, 7) && viewing === before.slice(0, 7)) { jumpToCurrentMonth(); return; }   // new month: move to it
  renderEverything();
}
setInterval(checkNewDay, 60000);   // every minute while the page is open
document.addEventListener('visibilitychange', function () { if (!document.hidden) checkNewDay(); });   // coming back to the tab
window.addEventListener('focus', checkNewDay);   // clicking back into the window (e.g. after the laptop slept overnight)

// ============================================
// MOVABLE DASHBOARD: snap-to-grid boxes you can drag by the title bar, minimize, resize or send to the dock.
// The three little dots on each title bar:  1st = minimize,  2nd = change size,  3rd = send to the dock.
// Layout is saved to your account: one layout for computers, a separate one for phones.
// ============================================
var DASH_SPANS = { 'summary': 3, 'weeks': 5, 'category-star-map': 4, 'month-progress': 12, 'rank-your-tasks': 12,
  'daily-habit-count': 7, 'habit-count-by-category': 5, 'todays-required-habits': 12, 'daily-trend': 12,
  'daily-checklist-monthly-progress': 12, 'top-habits-this-month': 6, 'habit-correlations': 6,
  'weekly-planned-tasks': 8, 'planned-vs-actual': 4, 'year-heatmap': 12, 'actual-vs-intended-completions': 6,
  'xp-growth': 6, 'best-streaks': 4, 'personal-bests': 4, 'habit-age': 4, 'xp-speed-and-acceleration': 12 };
var DASH_SIZES = [3, 4, 6, 8, 12];   // the size button cycles through these (out of 12 columns)
var DASH_MIN = { 'weeks': 4, 'daily-checklist-monthly-progress': 6 };   // narrowest a box can go (others: 2 columns)
function dashMin(id) { return DASH_MIN[id] || 2; }
var DASH_DEFAULT = [], dashLayoutCache = null;

function dashSlug(t) { return (t || '').toLowerCase().replace(/&amp;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function dashGrid() { return document.getElementById('dash-grid'); }
function dashBoxes() { var g = dashGrid(); return g ? Array.prototype.slice.call(g.children).filter(function (b) { return b.classList.contains('dash-box'); }) : []; }
function dashDevice() { return window.innerWidth <= 700 ? 'phone' : 'desktop'; }

// Build the grid once: move every dashboard box out of the old tables into one grid, in today's order.
(function dashBuild() {
  var screen = document.getElementById('tracker-screen'); if (!screen) return;
  var trackers = screen.querySelectorAll('.tracker'); if (!trackers.length) return;
  var boxes = Array.prototype.slice.call(screen.querySelectorAll('.tracker .cell-border')).filter(function (b) { return !b.parentElement.closest('.cell-border'); });
  var grid = document.createElement('div'); grid.id = 'dash-grid'; grid.className = 'dash-grid';
  trackers[0].insertBefore(grid, trackers[0].firstChild);
  var used = {};
  boxes.forEach(function (b) {
    var t = b.querySelector('.title-text'), id = dashSlug(t ? t.textContent : 'box');
    while (used[id]) id += '-2'; used[id] = 1;
    var tr = b.closest('tr');
    if (tr && tr.id === 'xp-rank-row') { tr.id = ''; b.id = 'xp-rank-row'; b.style.display = tr.style.display; }   // XP Mode shows/hides this box
    b.classList.add('dash-box'); b.dataset.box = id;
    b.dataset.span = DASH_SPANS[id] || 12;
    var dots = b.querySelectorAll('.title-bar .title-dots span');
    ['min', 'size', 'dock'].forEach(function (act, i) { if (dots[i]) { dots[i].dataset.dashAct = act; dots[i].dataset.glyph = ['–', '↔', '▾'][i]; dots[i].title = ['Minimize / open', 'Change size', 'Send to the dock'][i]; } });
    var glyph = b.querySelector('.title-bar .title-glyph'); if (glyph) { glyph.classList.add('dash-move'); glyph.title = 'Drag to move this box'; }   // top-left button = move
    var grip = document.createElement('div'); grip.className = 'dash-resize'; grip.title = 'Drag to change the width'; b.appendChild(grip);   // right edge = width
    grid.appendChild(b);
    DASH_DEFAULT.push(id);
  });
  // remove the now-empty old tables (anything that still has content stays)
  screen.querySelectorAll('.tracker table.layout').forEach(function (tb) { if (!tb.textContent.trim()) tb.remove(); });
  for (var i = 1; i < trackers.length; i++) if (!trackers[i].textContent.trim()) trackers[i].remove();
  var dock = document.createElement('div'); dock.id = 'dash-dock'; dock.className = 'dash-dock'; document.body.appendChild(dock);
  var guides = document.createElement('div'); guides.className = 'dash-cols'; guides.innerHTML = new Array(13).join('<i></i>'); grid.insertBefore(guides, grid.firstChild);   // column guides shown while resizing
})();

function dashReadLayouts() {
  var m = settingGet('dash_layout');
  if (m && typeof m === 'object') return m;
  try { var l = JSON.parse(localStorage.getItem('habitTrackerDashLayout') || 'null'); if (l) return l; } catch (e) {}
  return {};
}
function dashCurrentLayout() {
  var L = { order: [], span: {}, min: {}, dock: {} };
  dashBoxes().forEach(function (b) {
    var id = b.dataset.box; L.order.push(id);
    if (+b.dataset.span !== (DASH_SPANS[id] || 12)) L.span[id] = +b.dataset.span;
    if (b.classList.contains('dash-min')) L.min[id] = 1;
    if (b.classList.contains('dash-docked')) L.dock[id] = 1;
  });
  return L;
}
var dashSaveTimer = null;
function dashSave() {
  var all = dashReadLayouts(); all = JSON.parse(JSON.stringify(all || {}));
  all[dashDevice()] = dashCurrentLayout();
  try { localStorage.setItem('habitTrackerDashLayout', JSON.stringify(all)); } catch (e) {}
  clearTimeout(dashSaveTimer);
  dashSaveTimer = setTimeout(function () { savePref({ dash_layout: all }); }, 800);   // waits a moment so a drag saves once
  dashRenderDock();
}
function dashApplyLayout() {
  var g = dashGrid(); if (!g) return;
  var L = (dashReadLayouts() || {})[dashDevice()] || null;
  var byId = {}; dashBoxes().forEach(function (b) { byId[b.dataset.box] = b; });
  var order = (L && L.order ? L.order.filter(function (id) { return byId[id]; }) : []);
  DASH_DEFAULT.forEach(function (id, i) { if (order.indexOf(id) < 0) order.splice(Math.min(i, order.length), 0, id); });   // new boxes slot in at their usual place
  order.forEach(function (id) { g.appendChild(byId[id]); });
  dashBoxes().forEach(function (b) {
    var id = b.dataset.box;
    b.dataset.span = Math.max(dashMin(id), (L && L.span && L.span[id]) || DASH_SPANS[id] || 12);
    b.classList.toggle('dash-min', !!(L && L.min && L.min[id]));
    b.classList.toggle('dash-docked', !!(L && L.dock && L.dock[id]));
  });
  dashRenderDock();
}
function dashResetLayout() {
  if (!confirm('Put every dashboard box back where it started? (This resets the ' + (dashDevice() === 'phone' ? 'phone' : 'computer') + ' layout.)')) return;
  var all = JSON.parse(JSON.stringify(dashReadLayouts() || {})); delete all[dashDevice()];
  try { localStorage.setItem('habitTrackerDashLayout', JSON.stringify(all)); } catch (e) {}
  savePref({ dash_layout: all });
  dashApplyLayout();
  victory('pop', 'Layout reset ✨');
}
function dashBoxTitle(b) { var t = b.querySelector('.title-text'); return t ? t.textContent.trim() : b.dataset.box; }
function dashRenderDock() {
  var dock = document.getElementById('dash-dock'); if (!dock) return;
  var docked = dashBoxes().filter(function (b) { return b.classList.contains('dash-docked') && b.style.display !== 'none'; });
  dock.innerHTML = docked.map(function (b) { return '<button type="button" class="dash-chip" data-undock="' + b.dataset.box + '" title="Open this box">▣ ' + moneyEsc(dashBoxTitle(b)) + '</button>'; }).join('');
  dock.style.display = docked.length ? 'flex' : 'none';
}

// Dot buttons (minimize / size / dock) and dock chips
document.addEventListener('click', function (e) {
  var chip = e.target.closest && e.target.closest('[data-undock]');
  if (chip) {
    var b = dashBoxes().filter(function (x) { return x.dataset.box === chip.getAttribute('data-undock'); })[0];
    if (b) { b.classList.remove('dash-docked'); b.classList.remove('dash-min'); dashSave(); b.scrollIntoView({ behavior: 'smooth', block: 'center' }); b.classList.add('dash-flash'); setTimeout(function () { b.classList.remove('dash-flash'); }, 900); }
    return;
  }
  var dot = e.target.closest && e.target.closest('[data-dash-act]'); if (!dot) return;
  var box = dot.closest('.dash-box'); if (!box) return;
  var act = dot.getAttribute('data-dash-act');
  if (act === 'min') box.classList.toggle('dash-min');
  if (act === 'dock') { box.classList.add('dash-docked'); }
  if (act === 'size') {
    var cur = +box.dataset.span, next = DASH_SIZES.filter(function (s) { return s > cur; })[0] || DASH_SIZES[0];
    box.dataset.span = Math.max(next, dashMin(box.dataset.box));
  }
  dashSave();
});

// Dragging by the title bar (mouse: press and move; touch: long-press, then move)
var dashDrag = null;
document.addEventListener('pointerdown', function (e) {
  var g = dashGrid(); if (!g) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  var grip = e.target.closest && e.target.closest('.dash-resize');
  if (grip && g.contains(grip)) { dashStartResize(e, grip.parentElement); return; }
  var mv = e.target.closest && e.target.closest('.dash-move'); if (!mv || !g.contains(mv)) return;   // only the top-left button moves a box
  var box = mv.closest('.dash-box'); if (!box || box.parentElement !== g) return;
  e.preventDefault();
  dashDrag = { box: box, x: e.clientX, y: e.clientY, active: false, timer: null };
});
function dashStartDrag() {
  var d = dashDrag; if (!d || d.active) return;
  clearTimeout(d.timer); d.active = true;
  d.box.classList.add('dash-dragging'); document.body.classList.add('dash-is-dragging');
  var ghost = document.createElement('div'); ghost.className = 'dash-ghost'; ghost.textContent = '✥ ' + dashBoxTitle(d.box);
  document.body.appendChild(ghost); d.ghost = ghost;
  ghost.style.left = d.x + 'px'; ghost.style.top = d.y + 'px';
  if (navigator.vibrate) try { navigator.vibrate(15); } catch (e) {}
}
document.addEventListener('pointermove', function (e) {
  var d = dashDrag; if (!d) return;
  var dist = Math.hypot(e.clientX - d.x, e.clientY - d.y);
  if (!d.active) {
    if (dist < 5) return;
    dashStartDrag();
  }
  e.preventDefault();
  d.ghost.style.left = e.clientX + 'px'; d.ghost.style.top = e.clientY + 'px';
  var el = document.elementFromPoint(e.clientX, e.clientY), t = el && el.closest('.dash-box'), g = dashGrid();
  if (t && t !== d.box && t.parentElement === g) {
    var r = t.getBoundingClientRect(), wide = r.width > g.clientWidth * 0.7;
    var before = wide ? e.clientY < r.top + r.height / 2 : e.clientX < r.left + r.width / 2;
    var ref = before ? t : t.nextSibling;
    if (ref !== d.box && d.box.nextSibling !== ref) g.insertBefore(d.box, ref);
  }
  if (e.clientY < 70) window.scrollBy(0, -14); else if (e.clientY > window.innerHeight - 70) window.scrollBy(0, 14);   // scroll while dragging near the edges
}, { passive: false });
function dashEndDrag() {
  var d = dashDrag; dashDrag = null; if (!d) return;
  clearTimeout(d.timer);
  if (!d.active) return;
  d.box.classList.remove('dash-dragging'); document.body.classList.remove('dash-is-dragging');
  if (d.ghost) d.ghost.remove();
  dashSave();
}
document.addEventListener('pointerup', dashEndDrag);
document.addEventListener('pointercancel', dashEndDrag);
document.addEventListener('contextmenu', function (e) { if (e.target.closest && e.target.closest('#dash-grid .dash-move, #dash-grid .dash-resize')) e.preventDefault(); });

// Width: drag a box's right edge. Snaps to the 12 columns, never narrower than the box's minimum.
var dashSize = null;
function dashStartResize(e, box) {
  e.preventDefault();
  var badge = document.createElement('span'); badge.className = 'dash-size-badge'; badge.textContent = box.dataset.span + ' / 12'; box.appendChild(badge);
  dashSize = { box: box, badge: badge };
  box.classList.add('dash-sizing'); document.body.classList.add('dash-is-sizing');
}
document.addEventListener('pointermove', function (e) {
  var r = dashSize; if (!r) return;
  e.preventDefault();
  var g = dashGrid(), cs = getComputedStyle(g), gap = parseFloat(cs.columnGap) || 14;
  var inner = g.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), colW = (inner - gap * 11) / 12;
  var left = r.box.getBoundingClientRect().left;
  var n = Math.round((e.clientX - left + gap) / (colW + gap));
  n = Math.max(dashMin(r.box.dataset.box), Math.min(12, n));
  if (+r.box.dataset.span !== n) { r.box.dataset.span = n; r.badge.textContent = n + ' / 12'; }
}, { passive: false });
function dashEndResize() {
  var r = dashSize; dashSize = null; if (!r) return;
  r.badge.remove(); r.box.classList.remove('dash-sizing'); document.body.classList.remove('dash-is-sizing');
  dashSave();
}
document.addEventListener('pointerup', dashEndResize);
document.addEventListener('pointercancel', dashEndResize);   // no phone pop-up menu on long-press

// Switching between computer and phone size swaps to that layout
var dashLastDevice = dashDevice();
window.addEventListener('resize', function () { var dv = dashDevice(); if (dv !== dashLastDevice) { dashLastDevice = dv; dashApplyLayout(); } });
dashApplyLayout();

// ============================================
// BUTTON RIBBON: the last button folds the ribbon away, leaving ⚙ Settings and the button to open it again.
// ============================================
var ribbonMin = false;
try { ribbonMin = localStorage.getItem('habitTrackerRibbonMin') === '1'; } catch (e) {}
function applyRibbon() {
  var q = document.getElementById('quick-buttons'); if (!q) return;
  q.classList.toggle('ribbon-min', ribbonMin);
  var t = document.getElementById('ribbon-toggle');
  if (t) { t.textContent = ribbonMin ? '»' : '«'; t.title = ribbonMin ? 'Show all buttons' : 'Fold the buttons away'; }
}
function toggleRibbon() {
  ribbonMin = !ribbonMin;
  try { localStorage.setItem('habitTrackerRibbonMin', ribbonMin ? '1' : '0'); } catch (e) {}
  savePref({ ribbon_min: ribbonMin });
  applyRibbon();
}
SYNCED_PREFS.push({ meta: 'ribbon_min', local: 'habitTrackerRibbonMin', box: '', get: function () { return ribbonMin; }, set: function (v) { ribbonMin = v; applyRibbon(); } });
applyRibbon();

// ============================================
// LAYOUT PRESETS: save up to 4 dashboard layouts and switch between them (Settings > Dashboard layout)
// ============================================
var DASH_PRESET_COUNT = 4;
function dashPresets() {
  var p = settingGet('dash_presets');
  if (p && typeof p === 'object') return p;
  try { return JSON.parse(localStorage.getItem('habitTrackerDashPresets') || '{}') || {}; } catch (e) { return {}; }
}
function dashStorePresets(p) {
  try { localStorage.setItem('habitTrackerDashPresets', JSON.stringify(p)); } catch (e) {}
  savePref({ dash_presets: p });
}
function dashSavePreset(n) {
  var p = JSON.parse(JSON.stringify(dashPresets()));
  if (p[n] && !confirm('Preset ' + n + ' already has a layout. Replace it with the current layout?')) return;
  p[n] = { layout: dashCurrentLayout(), saved: localISO(new Date()), device: dashDevice() };
  dashStorePresets(p);
  renderDashPresets();
  victory('pop', 'Saved to preset ' + n + ' 💾');
}
function dashLoadPreset(n) {
  var pr = dashPresets()[n];
  if (!pr || !pr.layout) { alert('Preset ' + n + ' is empty. Arrange your boxes, then press "Save current layout to preset ' + n + '".'); return; }
  var all = JSON.parse(JSON.stringify(dashReadLayouts() || {}));
  all[dashDevice()] = JSON.parse(JSON.stringify(pr.layout));
  try { localStorage.setItem('habitTrackerDashLayout', JSON.stringify(all)); } catch (e) {}
  savePref({ dash_layout: all });
  dashApplyLayout();
  victory('pop', 'Preset ' + n + ' loaded ✨');
}
function renderDashPresets() {
  var el = document.getElementById('dash-presets'); if (!el) return;
  var p = dashPresets(), h = '';
  for (var n = 1; n <= DASH_PRESET_COUNT; n++) {
    var pr = p[n], info = pr ? 'saved ' + moneyDay(pr.saved).replace(/, \d{4}$/, '') + (pr.device === 'phone' ? ' on a phone' : ' on a computer') : 'empty';
    h += '<div class="dash-preset-row"><p class="dash-preset-name">Preset ' + n + ' <span>' + info + '</span></p>' +
      '<div class="dash-preset-btns"><button type="button" class="settings-btn" onclick="dashSavePreset(' + n + ')">💾 Save current layout to preset ' + n + '</button>' +
      '<button type="button" class="settings-btn"' + (pr ? '' : ' disabled') + ' onclick="dashLoadPreset(' + n + ')">Load</button></div></div>';
  }
  el.innerHTML = h;
}
renderDashPresets();


// If this device gets signed out in the background (for example the login expired), say so instead of failing quietly.
sb.auth.onAuthStateChange(function (event) {
  if (event === 'SIGNED_OUT' && currentUser) {
    setTimeout(function () { showAppError('You were logged out on this device. Log in again to keep saving your changes.'); }, 0);
  }
});
