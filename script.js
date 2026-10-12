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
  await sb.auth.signOut(); currentUser = null;
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
    var delBtn=document.createElement('button'); delBtn.className='habit-del-btn'; delBtn.textContent='🗑'; delBtn.title='Delete';
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
      initEmojiPicker();
      document.getElementById('emoji-picker-modal').style.display = 'block';
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
  if(!allTimeLogs[hid])allTimeLogs[hid]={}; allTimeLogs[hid][logDate]=timesCompleted;
  refreshCharts();
}
function buildScheduleLookup() {
  scheduleLookup={};
  RAW_HABITS.forEach(function(h){
    var hid=String(h.id);
    scheduleLookup[hid]={};
    (h.habit_schedule||[]).forEach(function(s){
      var isFlexible = s.is_flexible === true || s.is_flexible === 'true';
      scheduleLookup[hid][s.day_of_week]={required:s.times_required, flexible:isFlexible};
    });
  });
}
async function loadAndRender() {
  await loadHabits(); await loadLogs(); await loadAllTimeLogs(); await loadWeeklyTasks(); await loadTaskXpOtherMonths();
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
  'goth-noir':    { mode:'curated', palette:['#F2F2F2','#A6A6A6','#D0D0D0','#7A7A7A','#E3E3E3','#8E8E8E','#BBBBBB','#666666','#FFFFFF','#959595','#C8C8C8','#727272'] }
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
    monthGoal+=tp; monthDone+=td;
    var pct=tp>0?Math.round((td/tp)*100):0, offset=circ-(pct/100)*circ;
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
  el.innerHTML='<svg width="120" height="120" viewBox="0 0 100 100"><circle cx="50" cy="50" r="'+r+'" fill="none" stroke="'+track+'" stroke-width="10"></circle><circle cx="50" cy="50" r="'+r+'" fill="none" stroke="'+color+'" stroke-width="10" stroke-dasharray="'+circ+' '+circ+'" stroke-dashoffset="'+offset+'" transform="rotate(-90 50 50)" stroke-linecap="round"></circle><text x="50" y="57" text-anchor="middle" font-size="22" font-weight="700" fill="'+txt+'">'+pct+'%</text></svg><p>'+done+' of '+goal+' habits done</p>';
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
      var dow=(firstDayMonBased+d-1)%7, sched=scheduleLookup[hid]&&scheduleLookup[hid][dow];
      if(!sched||!(sched.required>0))continue;
      var iso=currentYear+'-'+String(currentMonth).padStart(2,'0')+'-'+String(d).padStart(2,'0');
      var n=(logsLookup[hid]&&logsLookup[hid][iso])||0;
      cats[cat].goal+=sched.required; cats[cat].done+=Math.min(n,sched.required);
    }
  });
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
  var grid=hexToRgba(muted,0.35);
  function pt(k,f){var a=-Math.PI/2+k*2*Math.PI/STAR_MAX; return [CX+Math.cos(a)*R*f, CY+Math.sin(a)*R*f];}
  function ring(f){var p=[];for(var k=0;k<STAR_MAX;k++){var q=pt(k,f);p.push(q[0].toFixed(1)+','+q[1].toFixed(1));}return p.join(' ');}
  var g='';
  [0.25,0.5,0.75,1].forEach(function(f){g+='<polygon points="'+ring(f)+'" fill="none" stroke="'+grid+'" stroke-width="1"/>';});
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
  svg.innerHTML=g;

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
  if(barChartInstance)barChartInstance.destroy(); if(lineChartInstance)lineChartInstance.destroy(); if(catChartInstance)catChartInstance.destroy();

  // Size the bar chart so one fully-done habit segment is about 6px tall.
  var yMax=Math.max(1,Math.ceil(Math.max.apply(null,lineData)));
  var barWrap=document.getElementById('barChart').parentElement;
  var BAR_PX_PER_HABIT=14, BAR_MIN_HEIGHT=260;  // change these two numbers to make the graph taller or shorter
  barWrap.style.height=Math.max(BAR_MIN_HEIGHT,yMax*BAR_PX_PER_HABIT+80)+'px';
  var catEl=document.getElementById('catChart');
  if(catEl) catEl.parentElement.style.height=barWrap.style.height;  // category chart matches the bar chart
  
  var axisTextColor=getThemeColor('--c-text-muted');
  
  barChartInstance=new Chart(document.getElementById('barChart'),{type:'bar',data:{labels:dayLabels,datasets:barDatasets},options:{responsive:true,maintainAspectRatio:false,scales:{y:{stacked:true,beginAtZero:true,max:yMax,ticks:{color:axisTextColor,stepSize:yMax>12?Math.ceil(yMax/8):1}},x:{stacked:true,ticks:{color:axisTextColor,autoSkip:true,maxRotation:0,font:{size:9}}}},plugins:{legend:{position:'bottom',labels:{color:getThemeColor('--c-text'),boxWidth:10,font:{size:10},filter:function(item){return top5.indexOf(item.datasetIndex)!==-1;}}},tooltip:{callbacks:{label:function(ctx){var r=ctx.dataset._rawCounts[ctx.dataIndex];return r&&r.done>0?ctx.dataset.label+': '+r.done+'/'+r.required:null;}}}}}});
  lineChartInstance=new Chart(document.getElementById('lineChart'),{type:'line',data:{labels:dayLabels,datasets:[{data:lineData,borderColor:getThemeColor('--c-pink'),backgroundColor:hexToRgba(getThemeColor('--c-pink'),0.2),fill:true,tension:0,pointRadius:2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{color:axisTextColor}},x:{ticks:{color:axisTextColor,autoSkip:true,maxRotation:0,font:{size:9}}}}}});
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
      var dow=(firstDayMonBased+d-1)%7, sched=scheduleLookup[hid]&&scheduleLookup[hid][dow];
      if(!sched||!(sched.required>0))continue;
      var iso=currentYear+'-'+String(currentMonth).padStart(2,'0')+'-'+String(d).padStart(2,'0');
      var n=(logsLookup[hid]&&logsLookup[hid][iso])||0;
      cats[cat].goal+=sched.required; cats[cat].done+=Math.min(n,sched.required);
    }
  });
  var names=Object.keys(cats).sort(function(a,b){return cats[b].goal-cats[a].goal;});
  var color=getThemeColor('--c-pink');
  catChartInstance=new Chart(el,{type:'bar',data:{labels:names,datasets:[
    {label:'Done',data:names.map(function(n){return cats[n].done;}),backgroundColor:color,borderRadius:2,borderWidth:0},
    {label:'Left to do',data:names.map(function(n){return cats[n].goal-cats[n].done;}),backgroundColor:hexToRgba(color,0.2),borderRadius:2,borderWidth:0}
  ]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,scales:{x:{stacked:true,beginAtZero:true,ticks:{color:axisTextColor}},y:{stacked:true,ticks:{color:axisTextColor,font:{size:10}}}},plugins:{legend:{position:'bottom',labels:{color:getThemeColor('--c-text'),boxWidth:10,font:{size:10}}}}}});
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
    var th=document.createElement('th'); th.innerHTML=dayInitials[(firstDayMonBased+d-1)%7]+'<br>'+d;
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
      var cell=document.createElement('td'), box=document.createElement('div'); box.className='day-box';
      var isoDate=currentYear+'-'+String(currentMonth).padStart(2,'0')+'-'+String(b.day).padStart(2,'0');
      var dow=(firstDayMonBased+b.day-1)%7, sched=scheduleLookup[hid]&&scheduleLookup[hid][dow];
      var timesRequired, isFlexible;

      if(h.freq_type==='monthly'){
        timesRequired=1; isFlexible=true;
      } else if(h.freq_type==='interval' && h.start_date && h.freq_value){
        var cellDate=new Date(currentYear,currentMonth-1,b.day);
        var startDate=new Date(h.start_date);
        cellDate.setHours(0,0,0,0); startDate.setHours(0,0,0,0);
        var daysSince=Math.round((cellDate-startDate)/86400000);
        var isOnDay=(daysSince>=0 && daysSince%h.freq_value===0);
        timesRequired=isOnDay?1:0;
        isFlexible=false;
      } else {
        timesRequired=sched?sched.required:0;
        isFlexible=sched?sched.flexible:true;
      }

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
function renderGridLegend() {
  var el=document.getElementById('grid-legend'); if(!el)return;
  var todayWeek=0; (function(){ var now=new Date(); if(now.getFullYear()===currentYear&&now.getMonth()+1===currentMonth) todayWeek=Math.min(4,Math.floor((now.getDate()-1)/7)); })();
  var w=todayWeek, base=weekColors[w]||'#8C5FD9';
  var items=[
    {label:'To do: scheduled, not done yet', make:function(b){ b.dataset.required='true'; applyBoxVisual(b,0,1,w,false); }},
    {label:'Done', make:function(b){ b.dataset.required='true'; applyBoxVisual(b,1,1,w,false); }},
    {label:'Partly done (e.g. 1 of 2 times)', make:function(b){ b.dataset.required='true'; applyBoxVisual(b,1,2,w,false); }},
    {label:'Flexible: optional, do it when you can', make:function(b){ b.dataset.required='false'; applyBoxVisual(b,0,1,w,true); }},
    {label:'Flexible, done', make:function(b){ b.dataset.required='false'; applyBoxVisual(b,1,1,w,true); }},
    {label:'Rest day: not scheduled (tap for a bonus)', make:function(b){ b.dataset.required='false'; applyBoxVisual(b,0,1,w,true); b.style.opacity='0.3'; }},
    {label:'Bonus: done on a rest day', make:function(b){ b.dataset.required='false'; b.style.display='flex'; b.style.alignItems='center'; b.style.justifyContent='center';
      b.style.background=base; b.style.color=weekTextColors[w]||'#fff'; b.textContent='\u2713'; b.style.fontSize='11px'; b.style.fontWeight='700'; b.style.border='1.5px dashed '+base; }}
  ];
  el.innerHTML='<p class="grid-legend-title">Key</p>';
  items.forEach(function(it){
    var row=document.createElement('div'); row.className='grid-legend-row';
    var box=document.createElement('div'); box.className='day-box grid-legend-box';
    applyCheckboxThemeStyle(box, false); it.make(box); box.removeAttribute('data-tip');
    var lab=document.createElement('span'); lab.textContent=it.label;
    row.appendChild(box); row.appendChild(lab); el.appendChild(row);
  });
  var tip=document.createElement('p'); tip.className='grid-legend-tip'; tip.textContent='Tap a box to add a tick. Right-click a box to take one tick away.';
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

  if(h.freq_type==='monthly' && h.freq_value){
    totalRequired=h.freq_value;
    Object.keys(logsLookup[hid]||{}).forEach(function(iso){
      if(iso.startsWith(currentYear+'-'+String(currentMonth).padStart(2,'0')))
        totalDone+=(logsLookup[hid][iso]||0);
    });
  } else if(h.freq_type==='interval' && h.freq_value && h.start_date){
    var startDate=new Date(h.start_date); startDate.setHours(0,0,0,0);
    for(var d=1;d<=DAYS_IN_MONTH;d++){
      var cellDate=new Date(currentYear,currentMonth-1,d); cellDate.setHours(0,0,0,0);
      var daysSince=Math.round((cellDate-startDate)/86400000);
      if(daysSince>=0 && daysSince%h.freq_value===0){
        totalRequired++;
        var iso=currentYear+'-'+String(currentMonth).padStart(2,'0')+'-'+String(d).padStart(2,'0');
        totalDone+=(logsLookup[hid]&&logsLookup[hid][iso])||0;
      }
    }
  } else {
    for(var d=1;d<=DAYS_IN_MONTH;d++){
      var dow=(firstDayMonBased+d-1)%7, sched=scheduleLookup[hid]&&scheduleLookup[hid][dow];
      if(sched&&sched.required>0){ totalRequired+=sched.required; var iso=currentYear+'-'+String(currentMonth).padStart(2,'0')+'-'+String(d).padStart(2,'0'); totalDone+=(logsLookup[hid]&&logsLookup[hid][iso])||0; }
    }
    if(totalRequired===0){ totalDone=Object.values(logsLookup[hid]||{}).reduce(function(a,b){return a+b;},0); totalRequired=DAYS_IN_MONTH; }
  }

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
  var habitPct=totalRequired>0?Math.min(100,Math.round((totalDone/totalRequired)*100)):0;
  var pink=getThemeColor('--c-pink'), purple=getThemeColor('--c-purple');
  el.innerHTML=[
    '<div><div style="display:flex;justify-content:space-between;font-size:10px;color:var(--c-text-muted);margin-bottom:4px;"><span>Time elapsed</span><span>'+dayOfMonth+' / '+DAYS_IN_MONTH+' days</span></div>',
    '<div style="background:var(--c-body-bg-alt);border:1px solid var(--c-dark);height:10px;border-radius:3px;overflow:hidden;"><div style="background:'+purple+';width:'+timePct+'%;height:100%;border-radius:3px;"></div></div></div>',
    '<div><div style="display:flex;justify-content:space-between;font-size:10px;color:var(--c-text-muted);margin-bottom:4px;"><span>Habits done</span><span>'+habitPct+'%</span></div>',
    '<div style="background:var(--c-body-bg-alt);border:1px solid var(--c-dark);height:10px;border-radius:3px;overflow:hidden;"><div style="background:'+pink+';width:'+habitPct+'%;height:100%;border-radius:3px;"></div></div></div>',
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
      } else {
        row.style.background=i%2===1?(weekFillColors[w]||'transparent'):'transparent';
      }

      var accentColor=weekColors[w]||'#ccc';
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
      var req=0;
      var sched=scheduleLookup[hid]&&scheduleLookup[hid][dow];
      if(sched && sched.required>0) {
        req=sched.required;
      } else if(h.freq_type==='interval' && h.freq_value && h.start_date){
        var cellDate=new Date(currentYear,currentMonth-1,d);
        var startDate=new Date(h.start_date);
        cellDate.setHours(0,0,0,0); startDate.setHours(0,0,0,0);
        var daysSince=Math.round((cellDate-startDate)/86400000);
        var isOnDay=(daysSince>=0 && daysSince%h.freq_value===0);
        req=isOnDay?1:0;
      }
      
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
  ['sleep-page','mood-page','money-page','shop-page','memory-page'].forEach(function(id){var el=document.getElementById(id); if(el)el.style.display='none';});
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
  var hid = String(h.id);
  var dow = (now.getDay()+6)%7;
  if (h.freq_type === 'monthly') return null;
  if (h.freq_type === 'interval' && h.start_date && h.freq_value) {
    var cellDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var startDate = new Date(h.start_date);
    startDate.setHours(0,0,0,0);
    var daysSince = Math.round((cellDate - startDate)/86400000);
    if (daysSince >= 0 && daysSince % h.freq_value === 0) return { required: 1, tag: 'every '+h.freq_value+' days' };
    return null;
  }
  var sched = scheduleLookup[hid] && scheduleLookup[hid][dow];
  if (!sched || sched.flexible || !(sched.required > 0)) return null;
  var fixedDays = [];
  for (var i = 0; i < 7; i++) {
    var s = scheduleLookup[hid][i];
    if (s && !s.flexible && s.required > 0) fixedDays.push(DAY_ABBR[i]);
  }
  return { required: sched.required, tag: fixedDays.length === 7 ? 'daily' : fixedDays.join(' ') };
}

// Optional habits = every habit that is NOT required today (flexible days, "X per month" habits, and off days).
// Returns {required, tag} or null if the habit is already in the required list.
function getTodayOptional(h, now) {
  if (getTodayRequirement(h, now)) return null;
  var hid = String(h.id);
  var dow = (now.getDay()+6)%7;
  if (h.freq_type === 'monthly') {
    var ym = localISO(now).slice(0, 7), total = 0;
    Object.keys(allTimeLogs[hid] || {}).forEach(function(d) { if (d.indexOf(ym) === 0) total += allTimeLogs[hid][d] || 0; });
    return { required: 1, tag: h.freq_value ? total + '/' + h.freq_value + ' this month' : 'any day' };
  }
  var sched = scheduleLookup[hid] && scheduleLookup[hid][dow];
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

  // The counter and bar only count the required habits.
  var doneCount = items.filter(function(it) { return it.done >= it.req.required; }).length;
  document.getElementById('today-done').textContent = doneCount;
  document.getElementById('today-total').textContent = items.length;
  var pct = items.length ? Math.round((doneCount / items.length) * 100) : 0;
  document.getElementById('today-bar-fill').style.width = pct + '%';

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
  if (!currentUser) return;
  renderGrid();
  renderWeeklyTasks();
  renderXpRankPanel();
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
  RAW_HABITS.forEach(function (h) {
    var cat = h.category || 'General';
    if (byCat[cat] === undefined) byCat[cat] = 0;
    var per = XP_VALUES[h.difficulty] || 0;
    if (!per) return;
    var hid = String(h.id), logs = allTimeLogs[hid] || {}, times = 0;
    Object.keys(logs).forEach(function (iso) {
      var n = logs[iso] || 0;
      if (n <= 0) return;
      var p = iso.split('-');
      var dow = (new Date(+p[0], +p[1] - 1, +p[2]).getDay() + 6) % 7;
      var s = scheduleLookup[hid] && scheduleLookup[hid][dow];
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
  return { total: total + tasksXp, byCat: byCat, tasksXp: tasksXp };
}

// How many times a habit is required on a given date (0 = not required that day).
// Same rules as the monthly grid and Today's box.
function habitRequiredOn(h, y, m, d) {
  if (h.freq_type === 'monthly') return 0;
  var dow = (new Date(y, m - 1, d).getDay() + 6) % 7;
  if (h.freq_type === 'interval' && h.start_date && h.freq_value) {
    var cellDate = new Date(y, m - 1, d);
    var startDate = new Date(h.start_date);
    cellDate.setHours(0, 0, 0, 0); startDate.setHours(0, 0, 0, 0);
    var daysSince = Math.round((cellDate - startDate) / 86400000);
    return (daysSince >= 0 && daysSince % h.freq_value === 0) ? 1 : 0;
  }
  var s = scheduleLookup[String(h.id)] && scheduleLookup[String(h.id)][dow];
  return (s && !s.flexible && s.required > 0) ? s.required : 0;
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
    var h = Math.max(2, Math.round(pct / 100 * 90));
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
  RAW_HABITS.forEach(function (h) {
    var per = XP_VALUES[h.difficulty] || 0;
    if (!per) return;
    var hid = String(h.id), logs = allTimeLogs[hid] || {};
    Object.keys(logs).forEach(function (iso) {
      var n = logs[iso] || 0;
      if (n <= 0) return;
      var p = iso.split('-');
      var dow = (new Date(+p[0], +p[1] - 1, +p[2]).getDay() + 6) % 7;
      var s = scheduleLookup[hid] && scheduleLookup[hid][dow];
      var cap = (s && s.required > 0) ? s.required : 1;
      perDay[iso] = (perDay[iso] || 0) + Math.min(n, cap) * per;
    });
  });
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
  var purple = getThemeColor('--c-purple');
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
      var hid = String(h.id), req = 0;
      var s = scheduleLookup[hid] && scheduleLookup[hid][dow];
      if (s && s.required > 0) req = s.required;
      else if (h.freq_type === 'interval' && h.freq_value && h.start_date) {
        var st = new Date(h.start_date); st.setHours(0, 0, 0, 0);
        var ds = Math.round((d - st) / 86400000);
        req = (ds >= 0 && ds % h.freq_value === 0) ? 1 : 0;
      }
      if (req > 0) {
        var n = (allTimeLogs[hid] && allTimeLogs[hid][iso]) || 0;
        if (isHardOptional(h)) { var got = Math.min(n, req); goal += got; done += got; }
        else { goal += req; done += n; }
      }
    });
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
  if (currentUser) { renderDonuts(); renderMonthProgress(); renderXpStats(); }
}


// How many times a habit is due on day d of the month on screen.
// "Every X days" habits count on the days they come due; "specific days" habits use their schedule.
// "X times per month" habits have no set day, so they return 0.
function dayRequirement(h, d) {
  if (h.freq_type === 'interval' && h.freq_value && h.start_date) {
    var cellDate = new Date(currentYear, currentMonth - 1, d);
    var startDate = new Date(h.start_date);
    cellDate.setHours(0, 0, 0, 0); startDate.setHours(0, 0, 0, 0);
    var daysSince = Math.round((cellDate - startDate) / 86400000);
    return (daysSince >= 0 && daysSince % h.freq_value === 0) ? 1 : 0;
  }
  var dow = (firstDayMonBased + d - 1) % 7;
  var sched = scheduleLookup[String(h.id)] && scheduleLookup[String(h.id)][dow];
  return (sched && sched.required > 0) ? sched.required : 0;
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
  ['history-page', 'mood-page', 'money-page', 'shop-page', 'memory-page'].forEach(function (id) { var el = document.getElementById(id); if (el) el.style.display = 'none'; });
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
  ['sleep-page', 'history-page', 'money-page', 'shop-page', 'memory-page'].forEach(function (id) { var el = document.getElementById(id); if (el) el.style.display = 'none'; });
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
  ['sleep-page', 'history-page', 'mood-page', 'shop-page', 'memory-page'].forEach(function (id) { var el = document.getElementById(id); if (el) el.style.display = 'none'; });
  document.getElementById('money-date').value = localISO(new Date());
  setMoneyKind(moneyKind);
  loadMoneyLogs().then(renderMoney);
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
function moneyFmt(n) { return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function moneyDay(iso) { var p = iso.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
function moneyMonthName(ym) { var p = ym.split('-'); return new Date(+p[0], +p[1] - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }); }
function moneySums(list) {
  var inc = 0, exp = 0;
  list.forEach(function (r) { if (r.kind === 'income') inc += r.amount; else exp += r.amount; });
  return { inc: inc, exp: exp, net: inc - exp };
}

// ---- Categories and accounts: defaults + ones you added + ones already used in your entries ----
function moneyMeta(key) { var m = currentUser && currentUser.user_metadata; return (m && Array.isArray(m[key])) ? m[key] : []; }
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
  var res = await sb.from('money_logs').insert({
    user_id: currentUser.id, kind: moneyKind, item: item, amount: Math.round(amount * 100) / 100,
    category: cat, account: acc, log_date: date
  });
  if (res.error) return setMoneyMsg('Could not save: ' + res.error.message, 'error');
  document.getElementById('money-item').value = '';
  document.getElementById('money-amount').value = '';
  await loadMoneyLogs();
  renderMoney();
  setMoneyMsg('Saved ' + (moneyKind === 'income' ? 'income' : 'expense') + ': ' + item + ' ' + moneyFmt(amount) + '.', 'ok');
}

async function deleteMoney(id) {
  if (!confirm('Delete this entry?')) return;
  var res = await sb.from('money_logs').delete().eq('id', id);
  if (res.error) return setMoneyMsg('Could not delete: ' + res.error.message, 'error');
  await loadMoneyLogs();
  renderMoney();
}

function renderMoney() {
  var ym = localISO(new Date()).slice(0, 7);
  var m = moneySums(moneyLogs.filter(function (r) { return r.log_date.slice(0, 7) === ym; }));
  document.getElementById('money-inc').textContent = moneyFmt(m.inc);
  document.getElementById('money-exp').textContent = moneyFmt(m.exp);
  var net = document.getElementById('money-net');
  net.textContent = moneyFmt(m.net);
  net.className = 'sleep-big ' + (m.net < 0 ? 'money-out' : 'money-net');

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
  if (moneyView === 'today') h = moneyTable(moneyLogs.filter(function (r) { return r.log_date === today; }));
  else if (moneyView === 'all') h = moneyTable(moneyLogs);
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
  if (!moneyLogs.length) return moneyEmpty();
  var g = {};
  moneyLogs.forEach(function (r) { var k = keyFn(r); (g[k] = g[k] || []).push(r); });
  var h = '<table class="money-table"><tr><th>' + label + '</th><th class="money-num">Expense</th><th class="money-num">Income</th><th class="money-num">Net</th><th class="money-num">Entries</th></tr>';
  Object.keys(g).sort().reverse().forEach(function (k) {
    var s = moneySums(g[k]);
    h += '<tr><td>' + nameFn(k) + '</td><td class="money-num money-out">' + moneyFmt(s.exp) + '</td><td class="money-num money-in">' + moneyFmt(s.inc) + '</td><td class="money-num ' + (s.net < 0 ? 'money-out' : 'money-in') + '"><b>' + moneyFmt(s.net) + '</b></td><td class="money-num">' + g[k].length + '</td></tr>';
  });
  return h + '</table>';
}

function moneyBars(kind) {
  var g = {};
  moneyLogs.filter(function (r) { return r.kind === kind; }).forEach(function (r) { g[r.category] = (g[r.category] || 0) + r.amount; });
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
  sb.auth.updateUser({ data: { money_rules: list } }).then(function (r) { if (r && r.data && r.data.user) currentUser = r.data.user; });
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
var importTable = null, importFileName = '';
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
  var g = saved || impGuessColumns(t);
  function opts(chosen, allowNone) {
    return (allowNone ? '<option value="-1">(none)</option>' : '') + t.head.map(function (h, i) {
      return '<option value="' + i + '"' + (i === chosen ? ' selected' : '') + '>' + moneyEsc(h || ('Column ' + (i + 1))) + '</option>';
    }).join('');
  }
  document.getElementById('money-import-review').innerHTML =
    '<div class="money-colcheck">' +
    '<p class="money-import-done">Is this right? Pick the column that holds each piece.</p>' +
    (saved ? '<p class="mood-note">Using the setup you confirmed last time for this bank. Change anything that looks off.</p>' : '<p class="mood-note">These are the app\'s best guesses. Change any that look wrong.</p>') +
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
  // Remember this bank's column setup (matched by its heading line) for next time.
  var key = impHeaderKey(importTable.head);
  var list = moneyMeta('money_csv_maps_list').filter(function (x) { return x.key !== key; });
  list.push({ key: key, map: m });
  currentUser.user_metadata = currentUser.user_metadata || {};
  currentUser.user_metadata.money_csv_maps_list = list;
  sb.auth.updateUser({ data: { money_csv_maps_list: list } }).then(function (r) { if (r && r.data && r.data.user) currentUser = r.data.user; });

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
    '<div><p class="sleep-label">Account</p><select id="imp-acc" class="sleep-input">' + impOptions(accs, rule ? rule.acc : accs[0]) + '</select></div></div>' +
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
  var res = await sb.auth.updateUser({ data: { money_rules: [], money_csv_maps_list: [] } });
  if (res && res.data && res.data.user) currentUser = res.data.user;
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
var GOLD_UNRANKED = 1, GOLD_PERFECT_DAY = 5, GOLD_STREAK_7 = 20;
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
  ['sleep-page', 'history-page', 'mood-page', 'money-page', 'memory-page'].forEach(function (id) { var el = document.getElementById(id); if (el) el.style.display = 'none'; });
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
  RAW_HABITS.forEach(function (h) {
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
  // 3) Perfect days (+5) and every 7 perfect days in a row (+20).
  var p0 = start.split('-'), d = new Date(+p0[0], +p0[1] - 1, +p0[2]), end = new Date(), run = 0, perfect = 0;
  end.setHours(0, 0, 0, 0);
  for (; d <= end; d.setDate(d.getDate() + 1)) {
    var iso = localISO(d), need = 0, met = true;
    RAW_HABITS.forEach(function (h) {
      if (isHardOptional(h)) return;   // with "Hard habits optional" on, hard habits don't block a perfect day
      var r = habitRequiredOn(h, d.getFullYear(), d.getMonth() + 1, d.getDate());
      if (!r) return;
      need++;
      if (((allTimeLogs[String(h.id)] || {})[iso] || 0) < r) met = false;
    });
    if (!need) continue;
    if (met) { perfect++; earned += GOLD_PERFECT_DAY; addDay(iso, GOLD_PERFECT_DAY); run++; if (run % 7 === 0) { earned += GOLD_STREAK_7; streaks++; addDay(iso, GOLD_STREAK_7); } }
    else if (iso !== today) run = 0;
  }
  var spent = shopPurchases.reduce(function (a, p) { return a + Number(p.price); }, 0);
  var daySpend = {};
  shopPurchases.forEach(function (p) {
    var iso = p.bought_at ? localISO(new Date(p.bought_at)) : today;
    if (iso < start) iso = start; if (iso > today) iso = today;
    daySpend[iso] = (daySpend[iso] || 0) + Number(p.price);
  });
  return { start: start, earned: earned, spent: spent, balance: earned - spent, perfect: perfect, byHabit: byHabit, tasks: tasks, streaks: streaks, dayEarn: dayEarn, daySpend: daySpend };
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
  if (g.perfect) h += row('Perfect days', g.perfect + ' × ' + GOLD_PERFECT_DAY + ' G', '+' + g.perfect * GOLD_PERFECT_DAY + ' G');
  if (g.streaks) h += row('7-day streak bonus', g.streaks + ' × ' + GOLD_STREAK_7 + ' G', '+' + g.streaks * GOLD_STREAK_7 + ' G');
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
}

async function setRedeemed(id, on) {
  var res = await sb.from('shop_purchases').update({ redeemed: on, redeemed_at: on ? new Date().toISOString() : null }).eq('id', id);
  if (res.error) { setShopMsg('Could not update: ' + res.error.message); return; }
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
  ['sleep-page', 'history-page', 'mood-page', 'money-page', 'shop-page'].forEach(function (id) { var el = document.getElementById(id); if (el) el.style.display = 'none'; });
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
