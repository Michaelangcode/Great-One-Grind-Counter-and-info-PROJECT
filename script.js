(function(){
  // ---------- Domain Lock ----------
  // Only allow the app to run on approved hosts. This is not real protection — the source is
  // still fully readable by anyone who views it here — it just stops a straight copy-paste
  // reupload of these files from functioning on an unapproved domain.
  const ALLOWED_HOSTS = ['greatonegrindlog.netlify.app', 'beta--greatonegrindlog.netlify.app', 'localhost', '127.0.0.1'];
  // Opening index.html straight from disk (double-click / drag into browser) uses the file:
  // protocol, which has no hostname at all — allow that too so local testing still works.
  const isLocalFile = window.location.protocol === 'file:';
  if (!isLocalFile && !ALLOWED_HOSTS.includes(window.location.hostname)) {
    document.body.innerHTML = '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;font-family:Nunito,sans-serif;background:#121c16;color:#e9e4d6;"><div><h1 style="font-family:Merriweather,serif;margin-bottom:8px;">Great One Grind Log</h1><p style="margin-bottom:8px;">This app only runs on its official site.</p><p><a href="https://greatonegrindlog.netlify.app" style="color:#c9a14a;">greatonegrindlog.netlify.app</a></p></div></div>';
    return;
  }

  const DATA_KEY = 'goGrind:data';
  const KEYBIND_KEY = 'goGrind:keybinds';
  const SETTINGS_KEY = 'goGrind:settings';
  const SAVE_DEBOUNCE_MS = 700;
  const NON_GO = 'Non-Great One Grind';
  const UNLISTED_GO = 'Unlisted Great One';
  const CUSTOM_DEFAULTS_KEY = 'goGrind:customDefaults';
  // Only these targets have a visible counter/sync control today. Older versions of the tool
  // let keys bind to now-removed counters (e.g. the old split-tier Diamond Lv2/4/8 button) —
  // a leftover binding like that fires silently on every matching keypress with nothing on
  // screen to show it, quietly inflating Diamond/Total Kills. Anything outside this list gets
  // stripped wherever keybinds enter the app (load, merge import, overwrite import).
  const VALID_KEYBIND_TARGETS = ['diamondLvl3', 'maxLevelOnly', 'other', 'rareCount'];
  const PLATFORMS = ['PC','PlayStation','Xbox'];
  const SPECIES = ['Black Bear','Fallow Deer','Gray Wolf','Jaguar','Moose','Mule Deer','Red Deer','Red Fox','Ring-Necked Pheasant','Roe Deer','Tahr','Whitetail Deer','Wild Boar'];
  const MAPS = [
    { name:'Askiy Ridge', species:['Whitetail Deer','Black Bear','Mule Deer','Ring-Necked Pheasant','Moose','Gray Wolf'] },
    { name:'Cuatro Colinas', species:['Roe Deer','Wild Boar','Ring-Necked Pheasant','Red Deer'] },
    { name:'Emerald Coast', species:['Red Fox','Red Deer','Fallow Deer'] },
    { name:'Hirschfeldon', species:['Fallow Deer','Red Deer','Wild Boar','Ring-Necked Pheasant','Red Fox','Roe Deer'] },
    { name:'Intisuyu', species:['Jaguar'] },
    { name:'Layton Lakes', species:['Moose','Whitetail Deer','Black Bear'] },
    { name:'Medved Tiaga', species:['Moose','Wild Boar','Gray Wolf'] },
    { name:'Mississippi Acres', species:['Whitetail Deer','Black Bear'] },
    { name:'New England Mountains', species:['Red Fox','Black Bear','Moose','Whitetail Deer','Ring-Necked Pheasant'] },
    { name:'Parque Fernando', species:['Red Deer','Mule Deer'] },
    { name:'Rancho Del Arroyo', species:['Whitetail Deer','Ring-Necked Pheasant','Mule Deer'] },
    { name:'Revontuli Coast', species:['Moose','Whitetail Deer'] },
    { name:'Salzwiesen Park', species:['Red Fox','Ring-Necked Pheasant'] },
    { name:'Silver Ridge Peaks', species:['Black Bear','Mule Deer'] },
    { name:'Sundarpatan', species:['Tahr'] },
    { name:'Te Awaroa', species:['Red Deer','Fallow Deer','Tahr'] },
    { name:'Torr Nan Sithean', species:['Fallow Deer','Red Deer','Red Fox','Wild Boar','Roe Deer','Ring-Necked Pheasant'] },
    { name:'Yukon Valley', species:['Moose','Gray Wolf','Red Fox'] }
  ];
  function mapsForSpecies(sp){ return MAPS.filter(m => m.species.includes(sp)).map(m => m.name).sort(); }

  const SPECIES_MAX_LEVEL = {
    'Whitetail Deer':3,'Ring-Necked Pheasant':3,'Roe Deer':3,
    'Moose':5,'Fallow Deer':5,'Tahr':5,'Mule Deer':5,'Wild Boar':5,
    'Red Deer':9,'Black Bear':9,'Red Fox':9,'Gray Wolf':9,'Jaguar':9
  };
  function maxLevelForSpecies(sp){ return SPECIES_MAX_LEVEL[sp] || 3; }

  // Species that have antlers or horns (show antler/horn field in trophy form)
  const ANTLERED_SPECIES = new Set(['Whitetail Deer','Red Deer','Fallow Deer','Mule Deer','Roe Deer','Moose','Tahr']);

  let grinds = [];
  let activeGrindId = null;
  let returnToGrindId = null;
  let browsingOpenGrinds = false;
  let wizardState = null;
  let pendingAction = null;
  let activeTab = 'current';
  let editingId = null;
  let openCounterEdit = null; // { grindId, g, panel, snapshot } while a logged grind's inline counter editor is open
  let storageAvailable = true;
  let saveTimer = null;
  let saveInFlight = false;
  let savePending = false;
  let lastFailedSave = null;
  let lastErrorDetail = '';
  let hasUnsavedChanges = false;
  let keybinds = {}; // { target: key }
  let twoStepDelete = false; // true = delete after 1 confirm only; false (default) = 2 confirms
  let buzzDefaultOn = false; // default state for new grinds' hotkey buzz feedback
  let rareDefaultOn = false; // default state for new grinds' rare fur tracking
  let hotkeySound = 'click'; // which synthesized sound plays on hotkey use: ding | click | thock | pop | blip
  let sessionGoal = null;       // { goal: number, killsAtStart: number } — resets on grind switch/end/GO log
  let sessionGoalDone = false;  // true when goal reached, show !

  const VALID_HOTKEY_SOUNDS = ['ding', 'click', 'thock', 'pop', 'blip'];
  function loadSettings(){
    try{
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}');
      twoStepDelete = s.twoStepDelete === true;
      buzzDefaultOn = s.buzzDefaultOn === true;
      // Rare Fur tracking defaults ON for brand-new installs (no settings ever saved yet).
      // Anyone who already has a saved preference (including an explicit off) keeps it.
      rareDefaultOn = s.rareDefaultOn === undefined ? true : s.rareDefaultOn === true;
      hotkeySound = VALID_HOTKEY_SOUNDS.includes(s.hotkeySound) ? s.hotkeySound : 'click';
    }catch(e){ twoStepDelete = false; buzzDefaultOn = false; rareDefaultOn = true; hotkeySound = 'click'; }
  }
  function saveSettings(){
    try{ localStorage.setItem(SETTINGS_KEY, JSON.stringify({ twoStepDelete, buzzDefaultOn, rareDefaultOn, hotkeySound })); }catch(e){}
  }
  function loadCustomDefaults(){
    try{
      const raw = JSON.parse(localStorage.getItem(CUSTOM_DEFAULTS_KEY)||'{}');
      if(Array.isArray(raw)) return {species:[], maps:[]};
      // species entries can be strings (legacy) or {name, maxLevel} objects
      const species = Array.isArray(raw.species) ? raw.species.map(s =>
        typeof s === 'string' ? {name:s, maxLevel:3} : s
      ) : [];
      return { species, maps: Array.isArray(raw.maps) ? raw.maps : [] };
    }catch(e){ return {species:[],maps:[]}; }
  }
  function saveCustomDefaults(obj){
    try{ localStorage.setItem(CUSTOM_DEFAULTS_KEY, JSON.stringify(obj)); }catch(e){}
  }
  function addCustomSpecies(name, maxLevel){
    const d = loadCustomDefaults();
    if(!d.species.find(s => s.name === name)){ d.species.push({name, maxLevel: maxLevel||3}); saveCustomDefaults(d); }
  }
  function addCustomMap(name){
    const d = loadCustomDefaults();
    if(!d.maps.includes(name)){ d.maps.push(name); saveCustomDefaults(d); }
  }
  function removeCustomSpecies(name){
    const d = loadCustomDefaults(); d.species = d.species.filter(s => s.name !== name); saveCustomDefaults(d);
    grinds = grinds.filter(g => !(g.species === UNLISTED_GO && g.unlistedName === name));
    if(activeGrindId && !grinds.find(g => g.id === activeGrindId)) activeGrindId = null;
    markDirty(); scheduleSave();
  }
  function removeCustomMap(name){
    const d = loadCustomDefaults(); d.maps = d.maps.filter(m => m !== name); saveCustomDefaults(d);
    grinds = grinds.filter(g => g.map !== name);
    if(activeGrindId && !grinds.find(g => g.id === activeGrindId)) activeGrindId = null;
    markDirty(); scheduleSave();
  }
  function getCustomSpeciesMaxLevel(name){
    const d = loadCustomDefaults();
    const entry = d.species.find(s => s.name === name);
    return entry ? entry.maxLevel : 3;
  }
  function renameCustomSpecies(oldName, newName){
    const d = loadCustomDefaults();
    d.species = d.species.map(s => s.name === oldName ? {...s, name:newName} : s);
    saveCustomDefaults(d);
    grinds.forEach(g => {
      if(g.species === UNLISTED_GO && g.unlistedName === oldName){
        g.unlistedName = newName;
        if(g.nickname) g.nickname = g.nickname.replace(oldName, newName);
        if(g.defaultName) g.defaultName = g.defaultName.replace(oldName, newName);
      }
    });
    markDirty(); scheduleSave();
  }
  function renameCustomMap(oldName, newName){
    const d = loadCustomDefaults();
    d.maps = d.maps.map(m => m === oldName ? newName : m);
    saveCustomDefaults(d);
    // Update all grinds using this map
    grinds.forEach(g => {
      if(g.map === oldName){
        g.map = newName;
        if(g.nickname) g.nickname = g.nickname.replace(oldName, newName);
        if(g.defaultName) g.defaultName = g.defaultName.replace(oldName, newName);
      }
    });
    markDirty(); scheduleSave();
  }

  const root = document.getElementById('appRoot');

  const diamondIcon = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6-6 6 6-6 11-6-11z"/><path d="M6 9h12M9 9l3 11M15 9l-3 11"/></svg>`;
  const antlerIcon = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 21V9M12 9c0-3 2-5 5-5M12 9c0-3-2-5-5-5M17 4l2 2M17 4l1 3M7 4l-2 2M7 4l-1 3"/></svg>`;
  const weightIcon = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v2M5 7h14l2 12H3L5 7z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg>`;
  const totalIcon = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="20" y2="12"/><line x1="8" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>`;
  const rareIcon = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>`;

  function totalDiamond(c){ return (c.diamondLvl3||0) + (c.diamondLvl2||0); }
  // diamondLvl3 = top-tier diamond (Lv3/Lv5/Lv9) — counts toward max-level
  // diamondLvl2 = lower diamond (Lv2/Lv4/Lv8) — does NOT count toward max-level
  function totalMaxLevel(c){ return (c.diamondLvl3||0) + (c.maxLevelOnly||0); }
  function totalMaxWeight(c){ return (c.diamondLvl3||0) + (c.diamondLvl2||0) + (c.maxLevelOnly||0) + (c.maxWeightOnly||0); }
  // Max-Weight Est is no longer tracked by the counter (removed from UI); Total Kills no longer includes it going forward.
  function totalKillsOf(c){ return (c.diamondLvl3||0) + (c.diamondLvl2||0) + (c.maxLevelOnly||0) + (c.other||0); }

  function grindNumberForCombo(species, map, unlistedName){
    return grinds.filter(g => {
      const label = grindSpeciesLabel(g);
      const thisLabel = (species === UNLISTED_GO && unlistedName) ? unlistedName : species;
      return label === thisLabel && g.map === map;
    }).length + 1;
  }

  function autoNameForGrind(species, map, num, unlistedName){
    if(species === NON_GO) return `${NON_GO} #${num}`;
    const displaySpecies = (species === UNLISTED_GO && unlistedName) ? unlistedName : species;
    return map ? `${map}, ${displaySpecies} #${num}` : `${displaySpecies} #${num}`;
  }

  function freshGrind(species, map, platform, unlistedName){
    const now = new Date().toISOString();
    const num = grindNumberForCombo(species, map, unlistedName);
    const autoName = autoNameForGrind(species, map, num, unlistedName);
    return {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2,6),
      species, map, platform, status:'open',
      nickname: autoName,
      defaultName: autoName,
      maxLevel: maxLevelForSpecies(species),
      lvl89toggle: false,
      diamondLvl3:0, diamondLvl2:0, maxLevelOnly:0, maxWeightOnly:0, other:0, rareCount:0, rareTracking:rareDefaultOn,
      buzzEnabled: buzzDefaultOn,
      counterMode: 'basic',
      notes:'', createdAt:now, lastUsedAt:now, loggedAt:null, cycle:null
    };
  }

  function normalizeGrind(g){
    const sp = g.species || 'Unknown';
    const autoName = g.map ? `${g.map}, ${sp} #1` : sp;
    return {
      id: g.id || (Date.now().toString(36) + Math.random().toString(36).slice(2,6)),
      species: sp, map: g.map || null, platform: g.platform || 'PC',
      status: g.status === 'completed' ? 'completed' : 'open',
      maxLevel: g.maxLevel || maxLevelForSpecies(sp),
      lvl89toggle: g.lvl89toggle || false,
      diamondLvl3:g.diamondLvl3||0, diamondLvl2:g.diamondLvl2||0, maxLevelOnly:g.maxLevelOnly||0, maxWeightOnly:g.maxWeightOnly||0, other:g.other||0,
      nickname:g.nickname||'', defaultName: g.defaultName || g.nickname || autoName,
      notes:g.notes||'', createdAt:g.createdAt||new Date().toISOString(), lastUsedAt:g.lastUsedAt||g.createdAt||new Date().toISOString(),
      loggedAt:g.loggedAt||null, cycle: typeof g.cycle === 'number' ? g.cycle : null,
      trophy: g.trophy || null,
      rareCount: g.rareCount||0, rareTracking: g.rareTracking||false,
      buzzEnabled: g.buzzEnabled === true,
      counterMode: g.counterMode === 'basic' ? 'basic' : 'advanced',
      unlistedName: g.unlistedName || ''
    };
  }

  function getActiveGrind(){ return grinds.find(g => g.id === activeGrindId) || null; }
  function grindSpeciesLabel(g){ return (g.species === UNLISTED_GO && g.unlistedName) ? g.unlistedName : g.species; }
  function openGrindsList(){ return grinds.filter(g => g.status === 'open').slice().sort((a,b) => new Date(b.lastUsedAt) - new Date(a.lastUsedAt)); }
  function completedGrindsList(){ return grinds.filter(g => g.status === 'completed' && g.species !== NON_GO); }
  function allCompletedGrindsList(){ return grinds.filter(g => g.status === 'completed'); }

  function checkStorageAvailable(){
    try{ localStorage.setItem('__test__','1'); localStorage.removeItem('__test__'); return true; }
    catch(e){ return false; }
  }

  function normalizeCountsLegacy(c){
    if(!c) return { diamondLvl3:0, diamondLvl2:0, maxLevelOnly:0, maxWeightOnly:0, other:0 };
    if(typeof c.diamondLvl3 === 'number' || typeof c.diamondLvl2 === 'number'){
      return { diamondLvl3:c.diamondLvl3||0, diamondLvl2:c.diamondLvl2||0, maxLevelOnly:c.maxLevelOnly||0, maxWeightOnly:c.maxWeightOnly||0, other:c.other||0 };
    }
    const maxLevelOnly = c.maxLevel || c.highLevel || 0;
    const diamondLegacy = c.diamond || 0;
    const maxWeightOnly = typeof c.maxWeightOnly === 'number' ? c.maxWeightOnly : Math.max(0, (c.maxWeight||0) - maxLevelOnly - diamondLegacy);
    return { diamondLvl3:0, diamondLvl2:diamondLegacy, maxLevelOnly, maxWeightOnly, other:c.other||0 };
  }

  function normalizeHistoryEntryLegacy(e){
    if(typeof e.diamondLvl3 === 'number' || typeof e.diamondLvl2 === 'number'){
      return Object.assign({}, e, { diamondLvl3:e.diamondLvl3||0, diamondLvl2:e.diamondLvl2||0, maxLevelOnly:e.maxLevelOnly||0, maxWeightOnly:e.maxWeightOnly||0, other:e.other||0 });
    }
    const maxLevelOnly = e.maxLevel || e.highLevel || 0;
    const diamondLegacy = e.diamond || 0;
    const maxWeightOnly = typeof e.maxWeightOnly === 'number' ? e.maxWeightOnly : Math.max(0, (e.maxWeight||0) - maxLevelOnly - diamondLegacy);
    return Object.assign({}, e, { diamondLvl3:0, diamondLvl2:diamondLegacy, maxLevelOnly, maxWeightOnly, other:e.other||0 });
  }

  function migrateOldShape(parsed){
    const newGrinds = (parsed.history || []).map(normalizeHistoryEntryLegacy).map(e => ({
      id:e.id, species:'Unknown', map:null, platform:'PC', status:'completed',
      diamondLvl3:e.diamondLvl3||0, diamondLvl2:e.diamondLvl2||0, maxLevelOnly:e.maxLevelOnly||0, maxWeightOnly:e.maxWeightOnly||0, other:e.other||0,
      nickname:'', defaultName:'Unknown',
      notes:e.notes||'', createdAt:e.loggedAt||new Date().toISOString(), lastUsedAt:e.loggedAt||new Date().toISOString(), loggedAt:e.loggedAt||new Date().toISOString(), cycle:e.cycle||null
    }));
    let newActiveId = null;
    const oldCounts = normalizeCountsLegacy(parsed.counts);
    const oldActiveSlot = parsed.activeSlot || { type:'new' };
    if(oldActiveSlot.type === 'history'){
      const match = newGrinds.find(g => g.id === oldActiveSlot.id);
      if(match) newActiveId = match.id;
    } else if(totalKillsOf(oldCounts) > 0){
      const now = new Date().toISOString();
      const openG = { id:'migrated-'+Date.now(), species:'Unknown', map:null, platform:'PC', status:'open',
        diamondLvl3:oldCounts.diamondLvl3, diamondLvl2:oldCounts.diamondLvl2, maxLevelOnly:oldCounts.maxLevelOnly, maxWeightOnly:oldCounts.maxWeightOnly, other:oldCounts.other,
        nickname:'', defaultName:'Unknown',
        notes:'', createdAt:now, lastUsedAt:now, loggedAt:null, cycle:null };
      newGrinds.push(openG);
      newActiveId = openG.id;
    }
    return { grinds:newGrinds, activeGrindId:newActiveId };
  }

  function setSyncStatus(state){
    const el = document.getElementById('syncStatus');
    if(!el) return;
    el.classList.remove('saving','error');
    if(state === 'saving'){
      el.classList.add('saving');
      el.innerHTML = 'Saving…';
    } else if(state === 'error'){
      el.classList.add('error');
      const detailHtml = lastErrorDetail ? `: ${escapeHtml(lastErrorDetail)}` : '';
      el.innerHTML = `⚠ Save failed${detailHtml} <button class="retry-btn" id="retryBtn">Retry</button>`;
      const btn = document.getElementById('retryBtn');
      if(btn) btn.addEventListener('click', () => { if(lastFailedSave) lastFailedSave(); });
    } else if(state === 'unavailable'){
      el.classList.add('saving');
      el.innerHTML = 'ℹ Auto-save isn\'t available in this session — your changes stay on screen but won\'t survive a reload. Use Export backup below before closing this tab.';
    } else {
      el.innerHTML = '✓ Saved — stored on your account, safe if this tab closes or WiFi drops';
    }
  }

  function markDirty(){ hasUnsavedChanges = true; }
  window.addEventListener('beforeunload', function(e){
    if(hasUnsavedChanges){ e.preventDefault(); e.returnValue=''; return ''; }
  });

  async function doSave(){
    if(!storageAvailable){ setSyncStatus('unavailable'); return; }
    if(saveInFlight){ savePending = true; return; }
    saveInFlight = true;
    setSyncStatus('saving');
    try{
      localStorage.setItem(DATA_KEY, JSON.stringify({ grinds, activeGrindId }));
      setSyncStatus('saved');
      lastFailedSave = null;
      hasUnsavedChanges = false;
    }catch(e){
      console.error('Save failed', e);
      try{ lastErrorDetail = (e && e.message) ? e.message : String(e); }catch(_){ lastErrorDetail=''; }
      setSyncStatus('error');
      lastFailedSave = doSave;
    }finally{
      saveInFlight = false;
      if(savePending){ savePending = false; doSave(); }
    }
  }

  function scheduleSave(){
    if(!storageAvailable){ setSyncStatus('unavailable'); return; }
    if(saveTimer) clearTimeout(saveTimer);
    setSyncStatus('saving');
    saveTimer = setTimeout(() => { saveTimer = null; doSave(); }, SAVE_DEBOUNCE_MS);
  }

  async function saveNow(){
    if(saveTimer){ clearTimeout(saveTimer); saveTimer = null; }
    await doSave();
  }

  function activateGrind(id){
    resetSessionGoal();
    const g = grinds.find(x => x.id === id);
    if(!g) return;
    g.lastUsedAt = new Date().toISOString();
    activeGrindId = id;
    browsingOpenGrinds = false;
    markDirty();
    renderCurrentPanel();
    renderStats(); renderChart(); renderLiveStat();
    switchTab('current');
    saveNow();
  }

  function returnFromRevisit(){
    returnToGrindId = null;
    activeGrindId = null;
    browsingOpenGrinds = false;
    markDirty();
    renderCurrentPanel();
    renderLiveStat();
    saveNow();
  }

  function logGreatOne(){
    const g = getActiveGrind();
    if(!g) return;
    resetSessionGoal();
    const isNonGo = g.species === NON_GO;
    const priorCompleted = completedGrindsList().length;
    g.status = 'completed';
    g.loggedAt = new Date().toISOString();
    if(!isNonGo){
      g.cycle = priorCompleted + 1;
      if(!g.trophy) g.trophy = null;
    }
    activeGrindId = null;
    returnToGrindId = null;
    browsingOpenGrinds = false;
    markDirty();
    renderCurrentPanel();
    renderStats(); renderChart(); renderLiveStat();
    saveNow();
    if(!isNonGo) showTrophyModal(g.id);
  }

  // Revert a completed grind back to open and make it active
  function revertToOpen(id){
    const g = grinds.find(x => x.id === id);
    if(!g) return;
    askConfirm(
      'Revert this Great One log entry back to an open grind? It will be removed from the log and placed back in your current grind slot. Your current active grind (if any) will be saved and accessible via "Select Other (Open) Grind."',
      async () => {
        // If there's an active open grind, just deactivate it (it stays open)
        activeGrindId = null;
        returnToGrindId = null;

        // Revert the completed grind
        g.status = 'open';
        g.loggedAt = null;
        g.cycle = null;
        g.trophy = null;

        // Re-number remaining completed grinds
        let c = 1;
        grinds.forEach(x => { if(x.status === 'completed') x.cycle = c++; });

        // Make reverted grind active
        g.lastUsedAt = new Date().toISOString();
        activeGrindId = g.id;
        browsingOpenGrinds = false;

        markDirty();
        await saveNow();
        renderCurrentPanel();
        renderStats(); renderChart(); renderGoLog(); renderLiveStat();
        switchTab('current');
      }
    );
  }

  function showTrophyModal(grindId){
    const modal = document.getElementById('trophyModal');
    if(!modal) return;
    modal.classList.remove('hidden');
    document.getElementById('trophyModalSkip').onclick = () => {
      modal.classList.add('hidden');
      const g = grinds.find(x => x.id === grindId);
      if(g && !g.trophy){
        g.trophy = { outcome:'N/A', weight:'', weightUnit:'kg', fur:'N/A', score:'N/A', antler:'N/A', notes:'' };
        markDirty(); saveNow(); renderGoLog();
      }
    };
    document.getElementById('trophyModalYes').onclick = () => {
      modal.classList.add('hidden');
      showTrophyForm(grindId);
    };
  }

  function showTrophyForm(grindId){
    const modal = document.getElementById('trophyFormModal');
    if(!modal) return;
    modal.classList.remove('hidden');
    const g = grinds.find(x => x.id === grindId);
    const hasAntler = g && ANTLERED_SPECIES.has(g.species);
    const existing = (g && g.trophy) ? g.trophy : null;
    const isAllNA = existing && existing.outcome === 'N/A' && existing.fur === 'N/A' && existing.score === 'N/A' && existing.antler === 'N/A' && !existing.weight && !existing.notes;
    document.getElementById('tfOutcome').value = (existing && !isAllNA) ? (existing.outcome||'') : '';
    document.getElementById('tfWeight').value = (existing && !isAllNA) ? (existing.weight||'') : '';
    document.getElementById('tfWeightUnit').value = (existing && existing.weightUnit) ? existing.weightUnit : 'kg';
    document.getElementById('tfFur').value = (existing && !isAllNA && existing.fur && existing.fur !== 'N/A') ? existing.fur : 'Fabled';
    document.getElementById('tfScore').value = (existing && !isAllNA && existing.score !== 'N/A') ? (existing.score||'') : '';

    const antlerRow = document.getElementById('tfAntlerRow');
    if(antlerRow) antlerRow.style.display = hasAntler ? '' : 'none';
    if(hasAntler){
      document.getElementById('tfAntler').value = (existing && !isAllNA && existing.antler !== 'N/A') ? (existing.antler||'') : '';
      document.getElementById('tfAntlerQuick').value = '';
    }

    document.getElementById('tfNotes').value = (existing && !isAllNA) ? (existing.notes||'') : '';
    const nameEl = modal.querySelector('.trophy-form-title');
    if(nameEl && g) nameEl.textContent = 'Trophy Details \u2014 ' + (g.nickname || g.species);
    const quickFill = document.getElementById('tfAntlerQuick');
    if(quickFill) quickFill.onchange = () => {
      if(quickFill.value){ document.getElementById('tfAntler').value = quickFill.value; quickFill.value = ''; }
    };
    document.getElementById('trophyFormCancel').onclick = () => modal.classList.add('hidden');
    document.getElementById('trophyFormSubmit').onclick = () => {
      if(!g) return;
      g.trophy = {
        outcome: document.getElementById('tfOutcome').value.trim(),
        weight: document.getElementById('tfWeight').value.trim(),
        weightUnit: document.getElementById('tfWeightUnit').value,
        fur: document.getElementById('tfFur').value.trim(),
        score: document.getElementById('tfScore').value.trim(),
        antler: hasAntler ? document.getElementById('tfAntler').value.trim() : 'N/A',
        notes: document.getElementById('tfNotes').value.trim()
      };
      modal.classList.add('hidden');
      markDirty(); saveNow();
      renderGoLog();
    };
  }

  function showCounterEditModal(grindId){
    // Toggle the inline counter panel on the card. Re-pressing the Edit Counter button
    // while it's already open is treated as an attempt to close it, so it goes through
    // the same save/revert confirmation as the in-panel Save Changes button.
    const existing = document.getElementById(`go-inline-counter-${grindId}`);
    if(existing){
      const g = grinds.find(x => x.id === grindId);
      if(g && existing._editSnapshot){
        promptCounterSaveOrRevert(g, grindId, existing, existing._editSnapshot);
      } else {
        existing.remove();
        if(openCounterEdit && openCounterEdit.grindId === grindId) openCounterEdit = null;
      }
      return;
    }
    const g = grinds.find(x => x.id === grindId);
    if(!g) return;

    // Snapshot the counter-relevant fields as they stood before this editing session,
    // so Save Changes can show a before/after diff and Revert can actually restore it.
    const snapshot = {
      diamondLvl3: g.diamondLvl3||0, diamondLvl2: g.diamondLvl2||0,
      maxLevelOnly: g.maxLevelOnly||0, other: g.other||0,
      rareCount: g.rareCount||0, rareTracking: g.rareTracking
    };

    // Build inline counter HTML (reuse same builder, scoped by grindId)
    const counterHTML = buildInlineCounterHTML(g, grindId);

    const panel = document.createElement('div');
    panel.id = `go-inline-counter-${grindId}`;
    panel.className = 'go-inline-counter';
    panel._editSnapshot = snapshot;
    panel.innerHTML = `
      <div class="go-inline-counter-header">
        <span class="go-inline-counter-title">Editing Counter</span>
        <div class="go-inline-counter-actions">
          <button class="go-inline-counter-save" data-id="${grindId}">💾 Save Changes</button>
          <button class="go-inline-counter-revert" data-id="${grindId}">↺ Revert to Original</button>
        </div>
      </div>
      ${counterHTML}
    `;

    // Insert the panel right after the go-log-body inside this card
    const card = document.querySelector(`.go-log-card[data-grind-id="${grindId}"]`);
    if(!card) return;
    card.appendChild(panel);
    openCounterEdit = { grindId, g, panel, snapshot };

    // Wire Save Changes — shows a before/after diff. Either choice keeps the panel open,
    // just applying either the saved or the reverted counts.
    panel.querySelector('.go-inline-counter-save').addEventListener('click', () => {
      showCounterEditConfirmModal(snapshot, g, () => {
        saveCounterEditInPlace(g, grindId, panel, snapshot);
      }, () => {
        revertCounterEditInPlace(g, grindId, panel, snapshot);
      });
    });
    // Wire Revert to Original — simple standalone confirm; canceling just keeps editing,
    // confirming reverts in place without closing the panel.
    panel.querySelector('.go-inline-counter-revert').addEventListener('click', () => {
      askConfirm('This will revert this grind’s counters back to their last saved baseline. It only undoes edits you haven’t saved yet — it won’t work on changes you’ve already confirmed with Save Changes. Continue?', () => {
        revertCounterEditInPlace(g, grindId, panel, snapshot);
      });
    });

    // Wire ctrl-btns — operate on grind directly
    panel.querySelectorAll('.ctrl-btn').forEach(btn => {
      let holdTimer = null, repeatTimer = null;
      function applyDelta(){
        const target = btn.dataset.target;
        const delta = btn.classList.contains('plus') ? 1 : -1;
        g[target] = Math.max(0, (g[target] || 0) + delta);
        renderInlineCounters(g, grindId);
        if(g.id === activeGrindId) renderLiveStat();
        markDirty(); scheduleSave();
        // Keep GO log stat row live
        const statRow = document.querySelector(`#go-inline-counter-${grindId}`)?.closest('.go-log-card')?.querySelector('.go-log-stats-row');
        if(statRow) updateGoLogStatRow(g, statRow);
        // Phone-only: +/- taps also get the click/ding feedback (hotkeys already had this).
        if(g.buzzEnabled && window.matchMedia('(max-width:640px)').matches){
          if(navigator.vibrate) navigator.vibrate(40);
          playHotkeySound();
        }
      }
      function startHold(){ applyDelta(); holdTimer = setTimeout(() => { repeatTimer = setInterval(applyDelta, 80); }, 750); }
      function stopHold(){ clearTimeout(holdTimer); clearInterval(repeatTimer); holdTimer=null; repeatTimer=null; }
      btn.addEventListener('mousedown', (e) => { if(e.button===0) startHold(); });
      btn.addEventListener('touchstart', (e) => { e.preventDefault(); startHold(); }, { passive:false });
      btn.addEventListener('mouseup', stopHold);
      btn.addEventListener('mouseleave', stopHold);
      btn.addEventListener('touchend', stopHold);
      btn.addEventListener('touchcancel', stopHold);
    });

    function inlineAfterApply(){
      renderInlineCounters(g, grindId);
      if(g.id === activeGrindId) renderLiveStat();
      markDirty(); scheduleSave();
      const statRow = document.querySelector(`#go-inline-counter-${grindId}`)?.closest('.go-log-card')?.querySelector('.go-log-stats-row');
      if(statRow) updateGoLogStatRow(g, statRow);
    }
    wireEditableCount(document.getElementById(`ic-${grindId}-diamondLvl3Count`), 'Diamond', () => g,
      gg => totalDiamond(gg), (gg,val) => { gg.diamondLvl3 = Math.max(0, val - (gg.diamondLvl2||0)); }, inlineAfterApply);
    wireEditableCount(document.getElementById(`ic-${grindId}-maxLevelCount`), 'Trolls', () => g,
      gg => gg.maxLevelOnly||0, (gg,val) => { gg.maxLevelOnly = val; }, inlineAfterApply);
    wireEditableCount(document.getElementById(`ic-${grindId}-totalCount`), 'Total Kills', () => g,
      gg => totalKillsOf(gg), (gg,val) => { const dia = totalDiamond(gg); const troll = gg.maxLevelOnly||0; gg.other = Math.max(0, val - dia - troll); }, inlineAfterApply);
    wireEditableCount(document.getElementById(`ic-${grindId}-rareCount`), 'Rare Fur', () => g,
      gg => gg.rareCount||0, (gg,val) => { gg.rareCount = val; }, inlineAfterApply);

    // Wire rare toggle
    const rareToggleEl = panel.querySelector('#rareToggle');
    if(rareToggleEl){
      rareToggleEl.addEventListener('click', () => {
        g.rareTracking = !g.rareTracking;
        markDirty(); scheduleSave();
        const rareCard = panel.querySelector('#rareCard');
        const rareMinusBtn = panel.querySelector('[data-target="rareCount"].minus');
        const rarePlusBtn = panel.querySelector('[data-target="rareCount"].plus');
        if(rareCard){ rareCard.classList.toggle('rare-off', !g.rareTracking); }
        if(rareMinusBtn) rareMinusBtn.disabled = !g.rareTracking;
        if(rarePlusBtn) rarePlusBtn.disabled = !g.rareTracking;
        rareToggleEl.classList.toggle('on', g.rareTracking);
        rareToggleEl.setAttribute('aria-checked', g.rareTracking ? 'true' : 'false');
      });
    }

    // Wire keybind buttons
    panel.querySelectorAll('.kb-sync-btn').forEach(btn => {
      btn.addEventListener('click', () => openKeybindModal(btn.dataset.target, btn.dataset.label));
    });
    panel.querySelectorAll('.kb-undo-btn').forEach(btn => {
      btn.addEventListener('click', () => confirmRemoveKeybind(btn.dataset.target, btn.dataset.label));
    });

    renderInlineCounters(g, grindId);
  }

  // Shared by the Save Changes button and by re-pressing Edit Counter to close the panel.
  // Shows the before/after diff; Confirm keeps the (already live-applied) edits, Cancel
  // reverts back to the pre-edit snapshot instead. Either way the panel closes.
  function promptCounterSaveOrRevert(g, grindId, panel, snapshot){
    showCounterEditConfirmModal(snapshot, g, () => {
      finishCounterEdit(grindId, panel);
    }, () => {
      revertGrindCounters(g, snapshot);
      finishCounterEdit(grindId, panel);
    });
  }

  function revertGrindCounters(g, snapshot){
    g.diamondLvl3 = snapshot.diamondLvl3;
    g.diamondLvl2 = snapshot.diamondLvl2;
    g.maxLevelOnly = snapshot.maxLevelOnly;
    g.other = snapshot.other;
    g.rareCount = snapshot.rareCount;
    g.rareTracking = snapshot.rareTracking;
  }

  function finishCounterEdit(grindId, panel){
    markDirty(); scheduleSave();
    if(openCounterEdit && openCounterEdit.grindId === grindId) openCounterEdit = null;
    if(panel && panel.parentNode) panel.remove();
    renderStats(); renderChart(); renderGoLog(); renderLiveStat();
  }

  // Refreshes the still-open inline editor panel's displayed numbers/toggle state after
  // an in-place save or revert, without rebuilding the Grind Log cards (which would
  // destroy the panel). Mirrors the live per-click update logic in showCounterEditModal.
  function refreshCounterEditUI(g, grindId, panel){
    renderInlineCounters(g, grindId);
    if(g.id === activeGrindId) renderLiveStat();
    const statRow = panel.closest('.go-log-card')?.querySelector('.go-log-stats-row');
    if(statRow) updateGoLogStatRow(g, statRow);
    const rareToggleEl = panel.querySelector('#rareToggle');
    if(rareToggleEl){
      const rareCard = panel.querySelector('#rareCard');
      const rareMinusBtn = panel.querySelector('[data-target="rareCount"].minus');
      const rarePlusBtn = panel.querySelector('[data-target="rareCount"].plus');
      if(rareCard) rareCard.classList.toggle('rare-off', !g.rareTracking);
      if(rareMinusBtn) rareMinusBtn.disabled = !g.rareTracking;
      if(rarePlusBtn) rarePlusBtn.disabled = !g.rareTracking;
      rareToggleEl.classList.toggle('on', g.rareTracking);
      rareToggleEl.setAttribute('aria-checked', g.rareTracking ? 'true' : 'false');
    }
  }

  // Confirms the current live-edited counts as the new baseline. The panel stays open —
  // the snapshot is advanced to match, so Revert to Original can no longer undo this
  // now-saved change (it only ever undoes edits made since the last save).
  function saveCounterEditInPlace(g, grindId, panel, snapshot){
    markDirty(); scheduleSave();
    Object.assign(snapshot, {
      diamondLvl3: g.diamondLvl3||0, diamondLvl2: g.diamondLvl2||0,
      maxLevelOnly: g.maxLevelOnly||0, other: g.other||0,
      rareCount: g.rareCount||0, rareTracking: g.rareTracking
    });
    refreshCounterEditUI(g, grindId, panel);
    renderStats(); renderChart(); renderLiveStat();
  }

  // Reverts to the current snapshot baseline in place, without closing the panel.
  function revertCounterEditInPlace(g, grindId, panel, snapshot){
    revertGrindCounters(g, snapshot);
    markDirty(); scheduleSave();
    refreshCounterEditUI(g, grindId, panel);
    renderStats(); renderChart(); renderLiveStat();
  }

  // True while a logged grind's inline counter editor is open AND its live counts differ
  // from the last-saved baseline — used to block navigating to another tab mid-edit.
  function hasUnsavedCounterEdits(){
    if(!openCounterEdit) return false;
    const { g, snapshot } = openCounterEdit;
    return g.diamondLvl3 !== snapshot.diamondLvl3
      || g.diamondLvl2 !== snapshot.diamondLvl2
      || g.maxLevelOnly !== snapshot.maxLevelOnly
      || g.other !== snapshot.other
      || g.rareCount !== snapshot.rareCount
      || g.rareTracking !== snapshot.rareTracking;
  }

  // Blocks a tab switch while there are unsaved counter edits — offers Save Changes,
  // Revert to Original, or Okay (just returns to editing without touching anything).
  function showFinishEditingFirstModal(){
    if(!openCounterEdit) return;
    const { grindId, g, panel, snapshot } = openCounterEdit;
    const modal = document.getElementById('confirmModal');
    const textEl = document.getElementById('modalText');
    const actionsBox = modal.querySelector('.modal-actions');

    textEl.textContent = 'Finish editing this grind’s counter before switching tabs.';

    const diffTable = document.getElementById('counterEditDiffTable');
    if(diffTable) diffTable.remove();

    actionsBox.innerHTML = `
      <button id="finishEditSaveBtn" class="confirm-go">💾 Save Changes</button>
      <button id="finishEditRevertBtn" class="go-inline-counter-revert">↺ Revert to Original</button>
      <button id="finishEditOkayBtn">Continue</button>
    `;
    modal.classList.remove('hidden');

    document.getElementById('finishEditSaveBtn').addEventListener('click', () => {
      modal.classList.add('hidden');
      restoreConfirmModal();
      saveCounterEditInPlace(g, grindId, panel, snapshot);
    });
    document.getElementById('finishEditRevertBtn').addEventListener('click', () => {
      modal.classList.add('hidden');
      restoreConfirmModal();
      revertCounterEditInPlace(g, grindId, panel, snapshot);
    });
    document.getElementById('finishEditOkayBtn').addEventListener('click', () => {
      modal.classList.add('hidden');
      restoreConfirmModal();
    });
  }

  // True while any rename input box (Current Grind, or a Grind Log entry) is open.
  function hasOpenRenameEditor(){
    const renameArea = document.getElementById('renameArea');
    if(renameArea && renameArea.style.display !== 'none') return true;
    if(document.querySelector('.go-rename-area:not(.hidden)')) return true;
    return false;
  }

  // Blocks a tab switch while a rename box is open — single Continue button just
  // dismisses the warning and returns to editing; it doesn't save or cancel anything.
  function showFinishRenamingFirstModal(){
    const modal = document.getElementById('confirmModal');
    const textEl = document.getElementById('modalText');
    const actionsBox = modal.querySelector('.modal-actions');

    textEl.textContent = 'Finish editing this name before switching tabs.';

    const diffTable = document.getElementById('counterEditDiffTable');
    if(diffTable) diffTable.remove();

    actionsBox.innerHTML = `<button id="finishRenameContinueBtn" class="confirm-go">Continue</button>`;
    modal.classList.remove('hidden');

    document.getElementById('finishRenameContinueBtn').addEventListener('click', () => {
      modal.classList.add('hidden');
      restoreConfirmModal();
    });
  }

  // Diff-style confirmation for saving counter edits on a logged grind — lists each
  // counter's prior vs. new count. Confirm = "Save Changes"; Cancel reverts back to
  // the pre-edit snapshot (labeled plain "Cancel" since it's this modal's only way out).
  function showCounterEditConfirmModal(snapshot, g, onConfirm, onCancel){
    const modal = document.getElementById('confirmModal');
    const textEl = document.getElementById('modalText');
    const confirmBtn = document.getElementById('modalConfirm');
    const cancelBtn = document.getElementById('modalCancel');

    textEl.textContent = 'Save these changes to the logged grind? This can’t be automatically reverted once saved.';

    let diffTable = document.getElementById('counterEditDiffTable');
    if(!diffTable){
      diffTable = document.createElement('div');
      diffTable.id = 'counterEditDiffTable';
      diffTable.className = 'wizard-review-table';
      diffTable.style.marginTop = '10px';
      textEl.insertAdjacentElement('afterend', diffTable);
    }
    const rows = [
      ['Diamond', totalDiamond(snapshot), totalDiamond(g)],
      ['Trolls', snapshot.maxLevelOnly||0, g.maxLevelOnly||0],
      ['Total Kills', totalKillsOf(snapshot), totalKillsOf(g)],
      ['Rare Fur', snapshot.rareCount||0, g.rareCount||0]
    ];
    diffTable.innerHTML = rows.map(([label, before, after]) =>
      `<div class="wizard-review-row"><span class="wizard-review-label">${label}</span><span class="wizard-review-val">${before} &rarr; ${after}</span></div>`
    ).join('');

    modal.classList.remove('hidden');

    const newConfirm = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
    newConfirm.className = 'confirm-go';
    newConfirm.textContent = 'Save Changes';
    newConfirm.addEventListener('click', () => {
      modal.classList.add('hidden');
      if(diffTable) diffTable.remove();
      restoreConfirmModal();
      if(onConfirm) onConfirm();
    });

    const newCancel = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
    newCancel.textContent = 'Cancel';
    newCancel.addEventListener('click', () => {
      modal.classList.add('hidden');
      if(diffTable) diffTable.remove();
      restoreConfirmModal();
      if(onCancel) onCancel();
    });
  }

  function buildInlineCounterHTML(g, grindId){
    // Identical structure to buildCounterHTML but IDs are scoped with grindId
    return `
      <section class="counters">
        <div class="counter-card diamond3">
          <div class="card-top"><span class="card-icon" style="color:var(--diamond3)">${diamondIcon}</span><span class="card-label">Diamond</span></div>
          <div class="card-sub">this grind</div>
          <div class="counter-controls">
            <button class="ctrl-btn minus" data-target="diamondLvl3" aria-label="Subtract">&minus;</button>
            <div class="count-display" id="ic-${grindId}-diamondLvl3Count">0</div>
            <button class="ctrl-btn plus" data-target="diamondLvl3" aria-label="Add">+</button>
          </div>
          <div class="breakdown" id="ic-${grindId}-basicDiamondBreakdown"></div>
          ${keybindFooter('diamondLvl3', 'Diamond')}
        </div>
        <div class="counter-card antler">
          <div class="card-top"><span class="card-icon" style="color:var(--antler)">${antlerIcon}</span><span class="card-label">Trolls</span></div>
          <div class="card-sub">this grind</div>
          <div class="counter-controls">
            <button class="ctrl-btn minus" data-target="maxLevelOnly" aria-label="Subtract">&minus;</button>
            <div class="count-display" id="ic-${grindId}-maxLevelCount">0</div>
            <button class="ctrl-btn plus" data-target="maxLevelOnly" aria-label="Add">+</button>
          </div>
          <div class="breakdown" id="ic-${grindId}-basicTrollBreakdown"></div>
          ${keybindFooter('maxLevelOnly', 'Trolls')}
        </div>
        <div class="total-rare-row">
          <div class="counter-card total">
            <div class="card-top"><span class="card-icon" style="color:var(--total)">${totalIcon}</span><span class="card-label">Total Kills</span></div>
            <div class="card-sub">total this grind</div>
            <div class="counter-controls">
              <button class="ctrl-btn minus" data-target="other" aria-label="Subtract">&minus;</button>
              <div class="count-display" id="ic-${grindId}-totalCount">0</div>
              <button class="ctrl-btn plus" data-target="other" aria-label="Add">+</button>
            </div>
            <div class="breakdown" id="ic-${grindId}-basicTotalBreakdown"></div>
            ${keybindFooter('other', 'Total Kills')}
          </div>
          <div class="counter-card rare ${g.rareTracking ? '' : 'rare-off'}" id="rareCard">
            <div class="card-top"><span class="card-icon" style="color:var(--rare)">${rareIcon}</span><span class="card-label">Rare Fur</span><button class="rare-switch ${g.rareTracking ? 'on' : ''}" id="rareToggle" role="switch" aria-checked="${g.rareTracking ? 'true' : 'false'}" data-hint="More advanced settings in the &quot;Settings&quot; section!" style="margin-left:auto;flex-shrink:0;"><span class="rare-switch-knob"></span></button></div>
            <div class="card-sub">this grind</div>
            <div class="counter-controls">
              <button class="ctrl-btn minus" data-target="rareCount" ${g.rareTracking ? '' : 'disabled'} aria-label="Subtract rare">&minus;</button>
              <div class="count-display" id="ic-${grindId}-rareCount">0</div>
              <button class="ctrl-btn plus" data-target="rareCount" ${g.rareTracking ? '' : 'disabled'} aria-label="Add rare">+</button>
            </div>
            <div class="rare-note">Does not affect any other counter, including Total Kills.</div>
            ${keybindFooter('rareCount', 'Rare Fur')}
          </div>
        </div>
      </section>`;
  }

  function renderInlineCounters(g, grindId){
    const pfx = `ic-${grindId}-`;
    // totalDiamond/totalKillsOf (not raw diamondLvl3) so legacy grinds with a
    // leftover diamondLvl2 value (from the old split-tier counter) still total correctly.
    const dia = totalDiamond(g);
    const tk = totalKillsOf(g);
    const d3El = document.getElementById(pfx+'diamondLvl3Count');
    const lEl  = document.getElementById(pfx+'maxLevelCount');
    const tEl  = document.getElementById(pfx+'totalCount');
    const rEl  = document.getElementById(pfx+'rareCount');
    const dBreak  = document.getElementById(pfx+'basicDiamondBreakdown');
    const tBreak  = document.getElementById(pfx+'basicTrollBreakdown');
    const totBreak= document.getElementById(pfx+'basicTotalBreakdown');
    if(d3El) d3El.textContent = dia;
    if(lEl)  lEl.textContent  = g.maxLevelOnly||0;
    if(tEl)  tEl.textContent  = tk;
    if(rEl)  rEl.textContent  = g.rareCount||0;
    if(dBreak)   dBreak.textContent   = `→ also adds to Total Kills`;
    if(tBreak)   tBreak.textContent   = `→ also adds to Total Kills`;
    if(totBreak){ totBreak.textContent = `= ${dia} diamond + ${g.maxLevelOnly||0} troll + ${g.other||0} other`; totBreak.dataset.tip = totBreak.textContent; }
  }

  function goLogStatsRowHTML(g){
    const rareItem = g.rareTracking ? `
      <span class="go-stat-sep">·</span>
      <span class="go-stat-item go-counter-rare"><span class="go-counter-lbl">Rares</span> <span class="go-counter-val">${g.rareCount||0}</span></span>` : '';
    return `
      <span class="go-stat-item"><span class="go-counter-lbl">Dia</span> <span class="go-counter-val">${totalDiamond(g)}</span></span>
      <span class="go-stat-sep">·</span>
      <span class="go-stat-item"><span class="go-counter-lbl">Max-Lvl</span> <span class="go-counter-val">${totalMaxLevel(g)}</span></span>
      <span class="go-stat-sep">·</span>
      <span class="go-stat-item go-counter-total"><span class="go-counter-lbl">Total</span> <span class="go-counter-val">${totalKillsOf(g)}</span></span>${rareItem}
      <span class="go-stat-sep">·</span>
      <span class="go-stat-item go-counter-rate"><span class="go-counter-lbl">Avg kills/dia</span> <span class="go-counter-val">${totalDiamond(g) === 0 ? '—' : (totalKillsOf(g)/totalDiamond(g)).toFixed(2)}</span></span>
    `;
  }
  function updateGoLogStatRow(g, statRow){
    statRow.innerHTML = goLogStatsRowHTML(g);
  }

  function renderGoLog(){
    const area = document.getElementById('goLogArea');
    if(!area) return;
    const allTrophies = allCompletedGrindsList().slice().reverse();
    if(allTrophies.length === 0){
      area.innerHTML = `<div class="empty-note">No Great Ones logged yet. Log a Great One on the Current Grind tab to start building this list.</div>`;
      return;
    }

    const speciesSet = [...new Set(allTrophies.map(g => grindSpeciesLabel(g)))].sort();
    const mapSet = [...new Set(allTrophies.map(g => g.map).filter(Boolean))].sort();
    const platformSet = [...new Set(allTrophies.map(g => g.platform).filter(Boolean))].sort();

    const prevSearch = document.getElementById('goLogSearch') ? document.getElementById('goLogSearch').value : '';
    const prevSpecies = document.getElementById('goLogSpeciesFilter') ? document.getElementById('goLogSpeciesFilter').value : '';
    const prevMap = document.getElementById('goLogMapFilter') ? document.getElementById('goLogMapFilter').value : '';
    const prevPlatform = document.getElementById('goLogPlatformFilter') ? document.getElementById('goLogPlatformFilter').value : '';

    area.innerHTML = `
      <div class="go-log-controls">
        <input type="text" id="goLogSearch" class="go-log-search" placeholder="Search by name, species, map, platform, fur, notes…" value="${escapeAttr(prevSearch)}">
        <div class="go-log-filters">
          <select id="goLogSpeciesFilter">
            <option value="">All species</option>
            ${speciesSet.map(s => `<option value="${escapeAttr(s)}" ${prevSpecies===s?'selected':''}>${escapeHtml(s)}</option>`).join('')}
          </select>
          <select id="goLogMapFilter">
            <option value="">All maps</option>
            ${mapSet.map(m => `<option value="${escapeAttr(m)}" ${prevMap===m?'selected':''}>${escapeHtml(m)}</option>`).join('')}
          </select>
          <select id="goLogPlatformFilter">
            <option value="">All platforms</option>
            ${platformSet.map(p => `<option value="${escapeAttr(p)}" ${prevPlatform===p?'selected':''}>${escapeHtml(p)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div id="goLogCards"></div>
    `;

    function applyFilters(){
      const search = document.getElementById('goLogSearch').value.toLowerCase();
      const spFilter = document.getElementById('goLogSpeciesFilter').value;
      const mapFilter = document.getElementById('goLogMapFilter').value;
      const platFilter = document.getElementById('goLogPlatformFilter').value;
      const cards = document.getElementById('goLogCards');
      const filtered = allTrophies.filter(g => {
        if(spFilter && grindSpeciesLabel(g) !== spFilter) return false;
        if(mapFilter && g.map !== mapFilter) return false;
        if(platFilter && g.platform !== platFilter) return false;
        if(search){
          const t = g.trophy || {};
          const haystack = [g.nickname, g.defaultName, grindSpeciesLabel(g), g.map, g.platform, t.fur, t.notes, t.score, t.antler, t.outcome].filter(Boolean).join(' ').toLowerCase();
          if(!haystack.includes(search)) return false;
        }
        return true;
      });

      if(filtered.length === 0){
        cards.innerHTML = `<div class="empty-note">No entries match your search/filter.</div>`;
        return;
      }

      cards.innerHTML = filtered.map(g => {
        const t = g.trophy || {};
        const isRenamed = g.nickname && g.defaultName && g.nickname !== g.defaultName;
        const displayName = g.nickname || g.defaultName || (g.species + (g.map ? ` \u2014 ${g.map}` : ''));
        const weightStr = t.weight ? `${t.weight} ${t.weightUnit}` : 'N/A';
        const outcomeVal = t.outcome || 'N/A';
        const outcomeClass = outcomeVal.toLowerCase().includes('botch') ? 'outcome-botched' : outcomeVal === 'N/A' ? 'outcome-na' : 'outcome-success';
        const ml = g.maxLevel || 3;
        const hasAntler = ANTLERED_SPECIES.has(g.species);

        return `
          <div class="go-log-card" data-grind-id="${g.id}">
            <div class="go-log-header">
              <div class="go-log-title-wrap">
                <div class="go-log-title-block">
                  <div class="go-log-title" id="go-title-${g.id}">${escapeHtml(displayName)}</div>
                  ${isRenamed ? `<div class="go-log-default-name">${escapeHtml(g.defaultName)}</div>` : ''}
                </div>
                <button class="go-rename-btn" data-id="${g.id}" title="Rename">✎</button>
              </div>
              <div class="go-log-meta">
                <span class="go-outcome ${outcomeClass}">${escapeHtml(outcomeVal)}</span>
                <span class="platform-tag">${escapeHtml(g.platform||'')}</span>
                <span class="go-log-cycle">#${g.cycle}</span>
              </div>
            </div>
            <div class="go-rename-area hidden" id="go-rename-${g.id}">
              <input type="text" class="go-rename-input" id="go-rename-input-${g.id}" value="${escapeAttr(g.nickname||displayName)}" maxlength="40">
              <button class="rename-save-btn go-rename-save" data-id="${g.id}">Save</button>
              <button class="rename-cancel-btn go-rename-cancel" data-id="${g.id}">Cancel</button>
            </div>
            <div class="go-log-body">
              <div class="go-log-left">
                <div class="go-log-date">Logged: ${formatDate(g.loggedAt)}</div>
                <div class="go-log-stats-row">${goLogStatsRowHTML(g)}</div>
                <div class="go-log-toggle" data-id="${g.id}">▸ Trophy Details</div>
                <div class="go-log-detail hidden" id="go-detail-${g.id}">
                  <div class="go-log-fields">
                    <span><strong>Weight:</strong> ${escapeHtml(weightStr)}</span>
                    <span><strong>Fur:</strong> ${escapeHtml(t.fur||'N/A')}</span>
                    <span><strong>Score:</strong> ${escapeHtml(t.score||'N/A')}</span>
                    ${hasAntler ? `<span><strong>Antler/Horn:</strong> ${escapeHtml(t.antler||'N/A')}</span>` : ''}
                  </div>
                  ${t.notes ? `<div class="go-log-notes">${escapeHtml(t.notes)}</div>` : ''}
                  <button class="go-edit-trophy-btn" data-id="${g.id}">✎ Edit Trophy Details</button>
                </div>
              </div>
              <div class="go-log-right">
                <button class="go-revert-btn" data-id="${g.id}">↺ Revert to Open Grind</button>
                <div class="go-log-counter-row">
                  <button class="go-share-btn" data-id="${g.id}">📤 Share</button>
                  <button class="go-download-btn" data-id="${g.id}">⬇ Download</button>
                  <button class="go-edit-counter-btn" data-id="${g.id}">✎ Edit Counter</button>
                  <button class="grind-delete-btn go-log-delete-btn" data-id="${g.id}" title="Delete this entry">✕ Delete</button>
                </div>
              </div>
            </div>
          </div>
        `;
      }).join('');

      cards.querySelectorAll('.go-log-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
          const detail = document.getElementById(`go-detail-${btn.dataset.id}`);
          const open = !detail.classList.contains('hidden');
          detail.classList.toggle('hidden', open);
          btn.textContent = open ? '▸ Trophy Details' : '▾ Trophy Details';
        });
      });
      cards.querySelectorAll('.go-edit-trophy-btn').forEach(btn => {
        btn.addEventListener('click', () => showTrophyForm(btn.dataset.id));
      });
      cards.querySelectorAll('.go-edit-counter-btn').forEach(btn => {
        btn.addEventListener('click', () => showCounterEditModal(btn.dataset.id));
      });
      cards.querySelectorAll('.go-share-btn').forEach(btn => {
        btn.addEventListener('click', () => shareSingleGrind(btn.dataset.id));
      });
      cards.querySelectorAll('.go-download-btn').forEach(btn => {
        btn.addEventListener('click', () => downloadSingleGrind(btn.dataset.id));
      });
      cards.querySelectorAll('.go-revert-btn').forEach(btn => {
        btn.addEventListener('click', () => revertToOpen(btn.dataset.id));
      });
      cards.querySelectorAll('.grind-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const g = grinds.find(x => x.id === btn.dataset.id);
          const name = g ? (g.nickname || g.defaultName || g.species) : '';
          askDeleteLoggedGrind(btn.dataset.id, name);
        });
      });
      cards.querySelectorAll('.go-rename-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.getElementById(`go-rename-${btn.dataset.id}`).classList.toggle('hidden');
        });
      });
      cards.querySelectorAll('.go-rename-save').forEach(btn => {
        btn.addEventListener('click', () => {
          const g = grinds.find(x => x.id === btn.dataset.id);
          if(!g) return;
          g.nickname = document.getElementById(`go-rename-input-${btn.dataset.id}`).value.trim();
          markDirty(); saveNow(); renderGoLog();
        });
      });
      cards.querySelectorAll('.go-rename-cancel').forEach(btn => {
        btn.addEventListener('click', () => {
          document.getElementById(`go-rename-${btn.dataset.id}`).classList.add('hidden');
        });
      });
    }

    applyFilters();
    document.getElementById('goLogSearch').addEventListener('input', applyFilters);
    document.getElementById('goLogSpeciesFilter').addEventListener('change', applyFilters);
    document.getElementById('goLogMapFilter').addEventListener('change', applyFilters);
    document.getElementById('goLogPlatformFilter').addEventListener('change', applyFilters);
  }

  function renumberDefaultNames(){
    // Group grinds by species+map combo, sorted by createdAt, reassign sequential defaultName
    const combos = {};
    grinds.forEach(g => {
      const key = (g.species||'') + '||' + (g.map||'');
      if(!combos[key]) combos[key] = [];
      combos[key].push(g);
    });
    Object.values(combos).forEach(list => {
      list.sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt));
      list.forEach((g, i) => {
        const newDefault = autoNameForGrind(g.species, g.map, i + 1, g.unlistedName);
        // Update nickname if it was tracking the defaultName (never custom-renamed)
        if(g.nickname === g.defaultName) g.nickname = newDefault;
        g.defaultName = newDefault;
      });
    });
  }

  async function deleteEntry(id){
    grinds = grinds.filter(g => g.id !== id);
    // Renumber cycles for completed grinds
    let c = 1;
    grinds.forEach(g => { if(g.status === 'completed') g.cycle = c++; });
    // Renumber defaultNames for all grinds
    renumberDefaultNames();
    if(activeGrindId === id) activeGrindId = null;
    if(returnToGrindId === id) returnToGrindId = null;
    markDirty();
    await saveNow();
    renderStats(); renderChart(); renderCurrentPanel(); renderGoLog(); renderLiveStat();
  }

  function askDeleteGrind(id, name){
    const label = name ? `"${name}"` : 'this grind';
    const doDelete = () => deleteEntry(id);

    if(twoStepDelete){
      // 1 confirm only
      askConfirm(`Delete ${label}? This is permanent and cannot be undone.`, doDelete);
    } else {
      // First confirm
      askConfirm(`Delete ${label}? This is permanent and cannot be undone.`, () => {
        // Second confirm — show with embedded two-step toggle
        showDeleteFinalModal(label, doDelete);
      });
    }
  }

  // Logged (completed) grinds carry real trophy data, so deleting one from the Grind Log
  // gets one extra confirmation up front before handing off to the normal askDeleteGrind flow.
  function askDeleteLoggedGrind(id, name){
    const label = name ? `"${name}"` : 'this logged grind';
    askConfirm(`This will permanently delete ${label} and its logged trophy data. Continue?`, () => {
      askDeleteGrind(id, name);
    });
  }

  function showDeleteFinalModal(label, doDelete){
    const modal = document.getElementById('confirmModal');
    const box = modal.querySelector('.modal-box');
    const textEl = document.getElementById('modalText');
    const confirmBtn = document.getElementById('modalConfirm');
    const cancelBtn = document.getElementById('modalCancel');

    textEl.textContent = `Final confirmation: permanently delete ${label}?`;

    // Inject a toggle row after the <p> if not already there
    let toggleRow = document.getElementById('delTwoStepRow');
    if(!toggleRow){
      toggleRow = document.createElement('div');
      toggleRow.id = 'delTwoStepRow';
      toggleRow.className = 'del-two-step-row';
      textEl.insertAdjacentElement('afterend', toggleRow);
    }
    toggleRow.innerHTML = `<label class="del-two-step-label"><input type="checkbox" id="twoStepToggle" ${twoStepDelete ? 'checked' : ''}>Enable two-step deletion (skip this confirmation in future)</label>`;

    modal.classList.remove('hidden');

    const newConfirm = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
    newConfirm.textContent = 'Confirm';
    newConfirm.addEventListener('click', () => {
      const cb = document.getElementById('twoStepToggle');
      if(cb && cb.checked !== twoStepDelete){ twoStepDelete = cb.checked; saveSettings(); }
      modal.classList.add('hidden');
      if(toggleRow) toggleRow.remove();
      restoreConfirmModal();
      doDelete();
    });

    const newCancel = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
    newCancel.addEventListener('click', () => {
      const cb = document.getElementById('twoStepToggle');
      if(cb && cb.checked !== twoStepDelete){ twoStepDelete = cb.checked; saveSettings(); }
      modal.classList.add('hidden');
      if(toggleRow) toggleRow.remove();
      restoreConfirmModal();
      pendingAction = null;
    });
  }

  function restoreConfirmModal(){
    // Re-wire the standard modal buttons after showDeleteFinalModal replaces them
    const modal = document.getElementById('confirmModal');
    const box = modal.querySelector('.modal-actions');
    box.innerHTML = '<button id="modalCancel">Cancel</button><button id="modalConfirm" class="confirm-danger">Confirm</button>';
    document.getElementById('modalText').textContent = '';
    document.getElementById('modalCancel').addEventListener('click', () => { pendingAction=null; modal.classList.add('hidden'); document.getElementById('modalConfirm').textContent='Confirm'; });
    document.getElementById('modalConfirm').addEventListener('click', () => {
      modal.classList.add('hidden');
      document.getElementById('modalConfirm').textContent='Confirm';
      if(pendingAction) pendingAction();
      pendingAction = null;
    });
  }

  async function doResetAll(){
    grinds = []; activeGrindId = null; returnToGrindId = null; browsingOpenGrinds = false; editingId = null;
    markDirty();
    await saveNow();
    renderCurrentPanel(); renderStats(); renderChart(); renderLiveStat();
  }

  function showInfo(title, message, onOk){
    const modal = document.getElementById('confirmModal');
    const box = modal.querySelector('.modal-actions');
    box.innerHTML = '<button id="modalInfoOk" class="confirm-merge">Got it</button>';
    document.getElementById('modalText').innerHTML = `<strong style="display:block;margin-bottom:8px;color:var(--antler)">${escapeHtml(title)}</strong>${escapeHtml(message)}`;
    modal.classList.remove('hidden');
    document.getElementById('modalInfoOk').addEventListener('click', () => {
      modal.classList.add('hidden');
      restoreConfirmModal();
      if(onOk) onOk();
    });
  }

  function startWizard(){
    wizardState = { step:'species', species:null, map:null, platform:null, unlistedName:'', unlistedMap:'', unlistedMapMode:'custom' };
    renderWizard();
    document.getElementById('wizardModal').classList.remove('hidden');
  }
  function closeWizard(){
    document.getElementById('wizardModal').classList.add('hidden');
    wizardState = null;
  }
  function wizardBack(){
    if(!wizardState) return;
    const isUnlisted = wizardState.species === UNLISTED_GO;
    if(wizardState.step === 'new-species'){ wizardState.step = 'species'; }
    else if(wizardState.step === 'confirm-species'){ wizardState.step = 'new-species'; }
    else if(wizardState.step === 'edit-species'){ wizardState.step = 'species'; }
    else if(wizardState.step === 'map'){ wizardState.step = 'species'; wizardState.map = null; }
    else if(wizardState.step === 'unlisted-map'){ wizardState.step = 'species'; }
    else if(wizardState.step === 'new-map'){ wizardState.step = wizardState._returnMapStep || (isUnlisted ? 'unlisted-map' : 'map'); }
    else if(wizardState.step === 'confirm-map'){ wizardState.step = 'new-map'; }
    else if(wizardState.step === 'edit-map'){ wizardState.step = wizardState._returnMapStep || (isUnlisted ? 'unlisted-map' : 'map'); }
    else if(wizardState.step === 'platform'){ wizardState.step = isUnlisted ? 'unlisted-map' : (wizardState.species === NON_GO ? 'species' : 'map'); }
    else if(wizardState.step === 'review'){ wizardState.step = 'platform'; wizardState.platform = null; }
    renderWizard();
  }
  function chooseSpecies(sp){
    wizardState.species = sp;
    if(sp === UNLISTED_GO){
      // Shouldn't be reached directly anymore, but guard just in case
      wizardState.step = 'unlisted-map'; renderWizard();
    } else if(sp === NON_GO){
      wizardState.step = 'platform';
      showInfo(
        'Non-Great One Grind',
        'Non-Great One grinds are excluded from All Grinds Summary stats and trends, since those are only meaningful for Great One grinds.',
        () => { renderWizard(); document.getElementById('wizardModal').classList.remove('hidden'); }
      );
      document.getElementById('wizardModal').classList.add('hidden');
    } else {
      // Custom species (from Custom Options) also go to unlisted-map with their name pre-set
      const isCustom = !SPECIES.includes(sp);
      if(isCustom){
        wizardState.species = UNLISTED_GO;
        wizardState.unlistedName = sp;
        wizardState.unlistedMaxLevel = getCustomSpeciesMaxLevel(sp);
        wizardState.step = 'unlisted-map';
      } else {
        wizardState.step = 'map';
      }
      renderWizard();
    }
  }
  function chooseMap(m){ wizardState.map = m; wizardState.step = 'platform'; renderWizard(); }
  function choosePlatform(p){
    wizardState.platform = p;
    if(wizardState.species === UNLISTED_GO){
      wizardState.step = 'review';
      renderWizard();
      return;
    }
    const sp = wizardState.species, mp = wizardState.species === NON_GO ? null : wizardState.map;
    const dup = grinds.find(x => x.status === 'open' && x.species === sp && x.map === mp && x.platform === p);
    if(dup){
      const dupName = dup.nickname ? `"${dup.nickname}"` : (sp === NON_GO ? NON_GO : `${sp} — ${mp}`);
      closeWizard();
      showDuplicateWarning(dupName);
      return;
    }
    const g = freshGrind(sp, mp, p);
    grinds.push(g);
    closeWizard();
    activateGrind(g.id);
  }

  function confirmUnlistedGrind(){
    const displayName = (wizardState.unlistedName || '').trim() || 'Unlisted';
    const mp = wizardState.unlistedMapExisting
      ? wizardState.unlistedMapExisting
      : ((wizardState.unlistedMap || '').trim() || null);
    const p = wizardState.platform;

    const dup = grinds.find(x => x.status === 'open' && x.species === UNLISTED_GO && x.unlistedName === displayName && x.map === mp && x.platform === p);
    if(dup){
      const dupName = dup.nickname ? `"${dup.nickname}"` : `${displayName}${mp ? ' — ' + mp : ''}`;
      closeWizard();
      showDuplicateWarning(dupName);
      return;
    }

    // Always save custom species; only save map if it's a newly typed unique entry
    addCustomSpecies(displayName);
    if(mp && wizardState.unlistedMap && !MAPS.find(m => m.name === mp)){
      addCustomMap(mp); // addCustomMap already deduplicates
    }

    const g = freshGrind(UNLISTED_GO, mp, p, displayName);
    g.unlistedName = displayName;
    if(wizardState.unlistedMaxLevel) g.maxLevel = wizardState.unlistedMaxLevel;
    grinds.push(g);
    closeWizard();
    activateGrind(g.id);
  }

  function showDuplicateWarning(dupName){
    showInfo(
      'Duplicate Grind',
      `You already have an open grind for this exact species, map, and platform combination: "${dupName}." Switch to it using "Select Other (Open) Grind" instead — a duplicate can't be created.`
    );
  }

  function renderWizard(){
    const content = document.getElementById('wizardContent');
    const backBtn = document.getElementById('wizardBackBtn');
    if(!content || !wizardState) return;
    backBtn.style.display = wizardState.step === 'species' ? 'none' : '';

    if(wizardState.step === 'species'){
      const { species: customSpecies } = loadCustomDefaults();
      content.innerHTML = `
        <div class="wizard-title">What animal will you be grinding for?</div>
        <div class="wizard-grid">
          ${SPECIES.map(sp => `<button class="wizard-sp-btn wizard-option-btn" data-sp="${escapeAttr(sp)}">${escapeHtml(sp)}</button>`).join('')}
          <button class="wizard-sp-btn wizard-option-btn special" data-sp="${escapeAttr(NON_GO)}">${escapeHtml(NON_GO)}</button>
        </div>
        ${customSpecies.length > 0 ? `
          <div class="wizard-section-label">Custom-Made Options</div>
          <div class="wizard-grid">
            ${customSpecies.map(sp => `
              <div class="wizard-custom-row">
                <button class="wizard-sp-btn wizard-option-btn unlisted-btn" data-sp="${escapeAttr(sp.name)}">${escapeHtml(sp.name)}</button>
                <button class="wizard-custom-edit" data-edit-sp="${escapeAttr(sp.name)}" title="Edit name">✎</button>
                <button class="wizard-custom-delete" data-remove-sp="${escapeAttr(sp.name)}" title="Delete">✕</button>
              </div>`).join('')}
          </div>` : ''}
        <div class="wizard-section-label">Create New</div>
        <div class="wizard-grid">
          <button class="wizard-option-btn unlisted-btn" id="createNewSpeciesBtn">➕ New / Unlisted Species</button>
        </div>
      `;
      content.querySelectorAll('.wizard-sp-btn').forEach(btn => btn.addEventListener('click', () => chooseSpecies(btn.dataset.sp)));
      content.querySelectorAll('.wizard-custom-delete[data-remove-sp]').forEach(btn => btn.addEventListener('click', e => {
        e.stopPropagation();
        const name = btn.dataset.removeSp;
        const wizModal = document.getElementById('wizardModal');
        const affected = grinds.filter(g => g.species === UNLISTED_GO && g.unlistedName === name).length;
        wizModal.classList.add('hidden');
        const doDelete = () => {
          removeCustomSpecies(name);
          wizModal.classList.remove('hidden');
          renderWizard(); renderCurrentPanel(); renderGoLog(); renderStats(); renderChart(); renderLiveStat();
        };
        const msg1 = affected > 0
          ? `Remove "${name}" from Custom-Made Options? This will permanently delete ${affected} grind${affected!==1?'s':''} that use this species.`
          : `Remove "${name}" from your Custom-Made Options?`;
        askConfirm(msg1, () => {
          if(affected > 0){
            askConfirm(`Are you absolutely sure? ${affected} grind${affected!==1?'s':''} will be permanently deleted and cannot be recovered.`, doDelete);
          } else {
            doDelete();
          }
        });
        document.getElementById('modalCancel').addEventListener('click', () => wizModal.classList.remove('hidden'), { once: true });
      }));
      content.querySelectorAll('.wizard-custom-edit[data-edit-sp]').forEach(btn => btn.addEventListener('click', e => {
        e.stopPropagation();
        wizardState._editSp = btn.dataset.editSp;
        wizardState._editText = btn.dataset.editSp;
        wizardState.step = 'edit-species'; renderWizard();
      }));
      content.querySelector('#createNewSpeciesBtn').addEventListener('click', () => {
        wizardState.step = 'new-species'; wizardState._newText = ''; renderWizard();
      });

    } else if(wizardState.step === 'new-species'){
      content.innerHTML = `
        <div class="wizard-title">New Species Name</div>
        <p class="info-note" style="margin-bottom:12px;">Enter the name of the new or unlisted Great One species.</p>
        <input type="text" id="newSpeciesInput" class="wizard-text-input" placeholder="e.g. Elk, Bison, Beaver…" maxlength="60" value="${escapeAttr(wizardState._newText||'')}">
        <button class="wizard-next-btn" id="newSpeciesNext">Next →</button>
      `;
      const inp = content.querySelector('#newSpeciesInput');
      inp.focus();
      const doNext = () => {
        const v = inp.value.trim(); if(!v) return;
        wizardState._newText = v; wizardState.step = 'confirm-species'; renderWizard();
      };
      content.querySelector('#newSpeciesNext').addEventListener('click', doNext);
      inp.addEventListener('keydown', e => { if(e.key === 'Enter') doNext(); });

    } else if(wizardState.step === 'confirm-species'){
      content.innerHTML = `
        <div class="wizard-title">Confirm New Species</div>
        <div class="wizard-review-table" style="margin-bottom:16px;">
          <div class="wizard-review-row"><span class="wizard-review-label">Species</span><span class="wizard-review-val">${escapeHtml(wizardState._newText)}</span></div>
        </div>
        <p class="info-note" style="margin-bottom:14px;">Is this correct? It will be saved to your Custom-Made Options.</p>
        <div class="wizard-review-actions">
          <button class="wizard-start-btn" id="confirmSpeciesYes">✓ Save</button>
          <button class="wizard-start-btn wizard-start-save-btn" id="confirmSpeciesNo">✎ Edit</button>
        </div>
      `;
      content.querySelector('#confirmSpeciesYes').addEventListener('click', () => {
        addCustomSpecies(wizardState._newText, 3);
        wizardState._newText = '';
        wizardState.step = 'species'; renderWizard();
      });
      content.querySelector('#confirmSpeciesNo').addEventListener('click', () => {
        wizardState.step = 'new-species'; renderWizard();
      });

    } else if(wizardState.step === 'map'){
      const maps = mapsForSpecies(wizardState.species);
      const { maps: customMaps } = loadCustomDefaults();
      content.innerHTML = `
        <div class="wizard-title">What map will it be on?</div>
        <p class="info-note" style="margin-bottom:12px;">Only maps with ${escapeHtml(wizardState.species)} Great Ones are shown.</p>
        <div class="wizard-grid">${maps.map(m => `<button class="wizard-map-btn wizard-option-btn" data-map="${escapeAttr(m)}">${escapeHtml(m)}</button>`).join('')}</div>
        ${customMaps.length > 0 ? `
          <div class="wizard-section-label">Custom-Made Options</div>
          <div class="wizard-grid">
            ${customMaps.map(m => `
              <div class="wizard-custom-row">
                <button class="wizard-map-btn wizard-option-btn unlisted-btn" data-map="${escapeAttr(m)}">${escapeHtml(m)}</button>
                <button class="wizard-custom-edit" data-edit-map="${escapeAttr(m)}" title="Edit name">✎</button>
                <button class="wizard-custom-delete" data-remove-map="${escapeAttr(m)}" title="Delete">✕</button>
              </div>`).join('')}
          </div>` : ''}
        <div class="wizard-section-label">Create New</div>
        <div class="wizard-grid">
          <button class="wizard-option-btn unlisted-btn" id="createNewMapBtn">➕ New / Unlisted Map</button>
        </div>
      `;
      content.querySelectorAll('.wizard-map-btn').forEach(btn => btn.addEventListener('click', () => chooseMap(btn.dataset.map)));
      content.querySelectorAll('.wizard-custom-delete[data-remove-map]').forEach(btn => btn.addEventListener('click', e => {
        e.stopPropagation();
        const name = btn.dataset.removeMap;
        const wizModal = document.getElementById('wizardModal');
        const affected = grinds.filter(g => g.map === name).length;
        wizModal.classList.add('hidden');
        const doDelete = () => {
          removeCustomMap(name);
          wizModal.classList.remove('hidden');
          renderWizard(); renderCurrentPanel(); renderGoLog(); renderStats(); renderChart(); renderLiveStat();
        };
        const msg1 = affected > 0
          ? `Remove "${name}" from Custom-Made Options? This will permanently delete ${affected} grind${affected!==1?'s':''} that use this map.`
          : `Remove "${name}" from your Custom-Made Options?`;
        askConfirm(msg1, () => {
          if(affected > 0){
            askConfirm(`Are you absolutely sure? ${affected} grind${affected!==1?'s':''} will be permanently deleted and cannot be recovered.`, doDelete);
          } else { doDelete(); }
        });
        document.getElementById('modalCancel').addEventListener('click', () => wizModal.classList.remove('hidden'), { once: true });
      }));
      content.querySelectorAll('.wizard-custom-edit[data-edit-map]').forEach(btn => btn.addEventListener('click', e => {
        e.stopPropagation();
        wizardState._editMap = btn.dataset.editMap; wizardState._editMapText = btn.dataset.editMap;
        wizardState._returnMapStep = 'map'; wizardState.step = 'edit-map'; renderWizard();
      }));
      content.querySelector('#createNewMapBtn').addEventListener('click', () => {
        wizardState._newMapText = ''; wizardState._returnMapStep = 'map'; wizardState.step = 'new-map'; renderWizard();
      });

    } else if(wizardState.step === 'unlisted-map'){
      const { maps: customMaps } = loadCustomDefaults();
      const allMapNames = MAPS.map(m => m.name).sort();
      content.innerHTML = `
        <div class="wizard-title">What map?</div>
        <div class="wizard-grid">
          ${allMapNames.map(m => `<button class="wizard-map-btn wizard-option-btn" data-map="${escapeAttr(m)}">${escapeHtml(m)}</button>`).join('')}
        </div>
        ${customMaps.length > 0 ? `
          <div class="wizard-section-label">Custom-Made Options</div>
          <div class="wizard-grid">
            ${customMaps.map(m => `
              <div class="wizard-custom-row">
                <button class="wizard-map-btn wizard-option-btn unlisted-btn" data-map="${escapeAttr(m)}">${escapeHtml(m)}</button>
                <button class="wizard-custom-edit" data-edit-map="${escapeAttr(m)}" title="Edit name">✎</button>
                <button class="wizard-custom-delete" data-remove-map="${escapeAttr(m)}" title="Delete">✕</button>
              </div>`).join('')}
          </div>` : ''}
        <div class="wizard-section-label">Create New</div>
        <div class="wizard-grid">
          <button class="wizard-option-btn unlisted-btn" id="createNewMapBtn">➕ New / Unlisted Map</button>
        </div>
      `;
      content.querySelectorAll('.wizard-map-btn').forEach(btn => btn.addEventListener('click', () => {
        wizardState.unlistedMapExisting = btn.dataset.map; wizardState.unlistedMap = '';
        wizardState.step = 'platform'; renderWizard();
      }));
      content.querySelectorAll('.wizard-custom-delete[data-remove-map]').forEach(btn => btn.addEventListener('click', e => {
        e.stopPropagation();
        const name = btn.dataset.removeMap;
        const wizModal = document.getElementById('wizardModal');
        const affected = grinds.filter(g => g.map === name).length;
        wizModal.classList.add('hidden');
        const doDelete = () => {
          removeCustomMap(name);
          wizModal.classList.remove('hidden');
          renderWizard(); renderCurrentPanel(); renderGoLog(); renderStats(); renderChart(); renderLiveStat();
        };
        const msg1 = affected > 0
          ? `Remove "${name}" from Custom-Made Options? This will permanently delete ${affected} grind${affected!==1?'s':''} that use this map.`
          : `Remove "${name}" from your Custom-Made Options?`;
        askConfirm(msg1, () => {
          if(affected > 0){
            askConfirm(`Are you absolutely sure? ${affected} grind${affected!==1?'s':''} will be permanently deleted and cannot be recovered.`, doDelete);
          } else { doDelete(); }
        });
        document.getElementById('modalCancel').addEventListener('click', () => wizModal.classList.remove('hidden'), { once: true });
      }));
      content.querySelectorAll('.wizard-custom-edit[data-edit-map]').forEach(btn => btn.addEventListener('click', e => {
        e.stopPropagation();
        wizardState._editMap = btn.dataset.editMap; wizardState._editMapText = btn.dataset.editMap;
        wizardState._returnMapStep = 'unlisted-map'; wizardState.step = 'edit-map'; renderWizard();
      }));
      content.querySelector('#createNewMapBtn').addEventListener('click', () => {
        wizardState._newMapText = ''; wizardState._returnMapStep = 'unlisted-map'; wizardState.step = 'new-map'; renderWizard();
      });

    } else if(wizardState.step === 'new-map'){
      content.innerHTML = `
        <div class="wizard-title">New Map Name</div>
        <p class="info-note" style="margin-bottom:12px;">Enter the name of the new or unlisted map.</p>
        <input type="text" id="newMapInput" class="wizard-text-input" placeholder="e.g. New Territory…" maxlength="60" value="${escapeAttr(wizardState._newMapText||'')}">
        <button class="wizard-next-btn" id="newMapNext">Confirm Name →</button>
      `;
      const inp = content.querySelector('#newMapInput');
      inp.focus();
      const doNext = () => {
        const v = inp.value.trim(); if(!v) return;
        wizardState._newMapText = v; wizardState.step = 'confirm-map'; renderWizard();
      };
      content.querySelector('#newMapNext').addEventListener('click', doNext);
      inp.addEventListener('keydown', e => { if(e.key === 'Enter') doNext(); });

    } else if(wizardState.step === 'confirm-map'){
      content.innerHTML = `
        <div class="wizard-title">Confirm Map Name</div>
        <div class="wizard-review-table" style="margin-bottom:16px;">
          <div class="wizard-review-row"><span class="wizard-review-label">Map</span><span class="wizard-review-val">${escapeHtml(wizardState._newMapText)}</span></div>
        </div>
        <p class="info-note" style="margin-bottom:14px;">Is this correct? It will be saved to your Custom-Made Options.</p>
        <div class="wizard-review-actions">
          <button class="wizard-start-btn" id="confirmMapYes">✓ Save</button>
          <button class="wizard-start-btn wizard-start-save-btn" id="confirmMapNo">✎ Edit Name</button>
        </div>
      `;
      content.querySelector('#confirmMapYes').addEventListener('click', () => {
        addCustomMap(wizardState._newMapText);
        wizardState._newMapText = '';
        wizardState.step = wizardState._returnMapStep || 'unlisted-map';
        renderWizard();
      });
      content.querySelector('#confirmMapNo').addEventListener('click', () => {
        wizardState.step = 'new-map'; renderWizard();
      });

    } else if(wizardState.step === 'edit-species'){
      content.innerHTML = `
        <div class="wizard-title">Edit Species Name</div>
        <input type="text" id="editSpInput" class="wizard-text-input" maxlength="60" value="${escapeAttr(wizardState._editText||'')}">
        <button class="wizard-next-btn" id="editSpSave">Save Changes</button>
      `;
      const inp = content.querySelector('#editSpInput'); inp.focus(); inp.select && inp.select();
      const doSave = () => {
        const v = inp.value.trim(); if(!v) return;
        renameCustomSpecies(wizardState._editSp, v);
        wizardState._editSp = null; wizardState._editText = '';
        wizardState.step = 'species'; renderWizard();
        renderGoLog(); renderStats();
      };
      content.querySelector('#editSpSave').addEventListener('click', doSave);
      inp.addEventListener('keydown', e => { if(e.key === 'Enter') doSave(); });

    } else if(wizardState.step === 'edit-map'){
      content.innerHTML = `
        <div class="wizard-title">Edit Map Name</div>
        <input type="text" id="editMapInput" class="wizard-text-input" maxlength="60" value="${escapeAttr(wizardState._editMapText||'')}">
        <button class="wizard-next-btn" id="editMapSave">Save Changes</button>
      `;
      const inp = content.querySelector('#editMapInput'); inp.focus(); inp.select && inp.select();
      const doSave = () => {
        const v = inp.value.trim(); if(!v) return;
        renameCustomMap(wizardState._editMap, v);
        wizardState._editMap = null; wizardState._editMapText = '';
        wizardState.step = wizardState._returnMapStep || 'unlisted-map'; renderWizard();
        renderGoLog(); renderStats();
      };
      content.querySelector('#editMapSave').addEventListener('click', doSave);
      inp.addEventListener('keydown', e => { if(e.key === 'Enter') doSave(); });

    } else if(wizardState.step === 'platform'){
      content.innerHTML = `
        <div class="wizard-title">What platform?</div>
        <div class="wizard-grid">${PLATFORMS.map(p => `<button class="wizard-option-btn" data-p="${escapeAttr(p)}">${escapeHtml(p)}</button>`).join('')}</div>
      `;
      content.querySelectorAll('.wizard-option-btn').forEach(btn => btn.addEventListener('click', () => choosePlatform(btn.dataset.p)));

    } else if(wizardState.step === 'review'){
      const displayMap = wizardState.unlistedMapExisting || wizardState.unlistedMap || '—';
      content.innerHTML = `
        <div class="wizard-title">Review & Start</div>
        <div class="wizard-review-table">
          <div class="wizard-review-row"><span class="wizard-review-label">Species</span><span class="wizard-review-val">${escapeHtml(wizardState.unlistedName||'Unlisted')}</span></div>
          <div class="wizard-review-row"><span class="wizard-review-label">Map</span><span class="wizard-review-val">${escapeHtml(displayMap)}</span></div>
          <div class="wizard-review-row"><span class="wizard-review-label">Platform</span><span class="wizard-review-val">${escapeHtml(wizardState.platform||'—')}</span></div>
        </div>
        <p class="info-note" style="margin-bottom:12px;">Your species and map will be saved to the selection lists for future grinds.</p>
        <div class="wizard-review-actions">
          <button class="wizard-start-btn" id="wizardStartBtn">Start Grind</button>
        </div>
      `;
      content.querySelector('#wizardStartBtn').addEventListener('click', () => confirmUnlistedGrind());
    }
  }

  // --- The Avg Kills/Diamond and Session Goal widgets can be dragged and snapped to
  // any of the four screen corners, on both phone (touch) and laptop (mouse) — Pointer
  // Events cover both input types with one set of handlers. Each widget's chosen corner
  // is remembered via localStorage. Whichever widget was most recently dropped into a
  // corner takes the position closest to the corner; if the other widget is already
  // sitting there, it gets pushed out past it — there's no fixed "always on top/bottom"
  // widget, ordering is purely whoever moved there last.
  const INNER_WIDGET_KEY = 'floatingWidgetInnerId';
  function applyWidgetCorner(el, corner, extraOffset){
    const margin = 10, off = extraOffset || 0;
    el.style.left = el.style.right = el.style.top = el.style.bottom = 'auto';
    if(corner === 'tl'){ el.style.top = (margin + off) + 'px'; el.style.left = margin + 'px'; }
    else if(corner === 'tr'){ el.style.top = (margin + off) + 'px'; el.style.right = margin + 'px'; }
    else if(corner === 'bl'){ el.style.bottom = (margin + off) + 'px'; el.style.left = margin + 'px'; }
    else { el.style.bottom = (margin + off) + 'px'; el.style.right = margin + 'px'; }
    el.dataset.corner = corner;
  }
  // Re-lays out both widgets. If they're in different corners, each just sits at its own
  // base position. If they're in the same corner, whichever one is "inner" (justMovedId,
  // or whoever claimed it last) sits flush in the corner and the other is pushed out past
  // it. Safe to call anytime, including before either widget has a corner assigned yet.
  function refreshWidgetStacking(justMovedId){
    const live = document.getElementById('liveStatWidget');
    const goal = document.getElementById('sessionGoalWidget');
    if(!live || !goal) return;
    if(!live.dataset.corner || !goal.dataset.corner) return;
    if(goal.style.display === 'none' || live.style.display === 'none') return;
    if(live.dataset.corner !== goal.dataset.corner){
      applyWidgetCorner(live, live.dataset.corner, 0);
      applyWidgetCorner(goal, goal.dataset.corner, 0);
      return;
    }
    let innerId = justMovedId;
    if(!innerId){
      try{ innerId = localStorage.getItem(INNER_WIDGET_KEY); }catch(e){}
    }
    if(innerId !== 'liveStatWidget' && innerId !== 'sessionGoalWidget') innerId = 'liveStatWidget';
    if(justMovedId){
      try{ localStorage.setItem(INNER_WIDGET_KEY, justMovedId); }catch(e){}
    }
    const innerEl = innerId === 'liveStatWidget' ? live : goal;
    const outerEl = innerId === 'liveStatWidget' ? goal : live;
    applyWidgetCorner(innerEl, innerEl.dataset.corner, 0);
    const innerRect = innerEl.getBoundingClientRect();
    applyWidgetCorner(outerEl, outerEl.dataset.corner, innerRect.height + 10);
  }
  function setupDraggableWidget(el, storageKey){
    if(!el) return;
    let dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;

    function onStart(e){
      const rect = el.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY;
      startLeft = rect.left; startTop = rect.top;
      el.style.left = startLeft + 'px';
      el.style.top = startTop + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      dragging = true;
      el.classList.add('widget-dragging');
      try{ el.setPointerCapture(e.pointerId); }catch(err){}
    }
    function onMove(e){
      if(!dragging) return;
      e.preventDefault();
      const dx = e.clientX - startX, dy = e.clientY - startY;
      const rect = el.getBoundingClientRect();
      const maxLeft = window.innerWidth - rect.width - 2;
      const maxTop = window.innerHeight - rect.height - 2;
      el.style.left = Math.max(2, Math.min(maxLeft, startLeft + dx)) + 'px';
      el.style.top = Math.max(2, Math.min(maxTop, startTop + dy)) + 'px';
    }
    function onEnd(){
      if(!dragging) return;
      dragging = false;
      el.classList.remove('widget-dragging');
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      const corner = (cy < window.innerHeight / 2 ? 't' : 'b') + (cx < window.innerWidth / 2 ? 'l' : 'r');
      applyWidgetCorner(el, corner);
      try{ localStorage.setItem(storageKey, corner); }catch(e){}
      refreshWidgetStacking(el.id);
    }
    el.addEventListener('pointerdown', onStart);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onEnd);
    el.addEventListener('pointercancel', onEnd);

    el._restoreWidgetCorner = function(){
      let corner = 'tr';
      try{ corner = localStorage.getItem(storageKey) || 'tr'; }catch(e){}
      applyWidgetCorner(el, corner);
    };
  }

  function buildShell(){
    root.innerHTML = `
      <header class="masthead">
        <div class="masthead-title-row">
          <img src="icon192.png" alt="Great One Grind Log logo" class="masthead-logo">
          <h1>GREAT ONE<br><span>GRIND LOG</span></h1>
        </div>
        <p class="subtitle">Track your (Great One) Grinds using this highly-specialized and detailed counter. Count kills, get averages, and log grinds!</p>
        <div class="sync-status" id="syncStatus"></div>
        <p class="storage-note">If auto-save shows "Saved," it's stored to your account and safe across tab closes. If it shows the auto-save notice instead, export a backup before closing this tab — you'll get a browser warning if you try to close with unexported changes.</p>
      </header>

      <div class="live-stat" id="liveStatWidget" style="display:none;">
        <span class="live-label">Avg kills / diamond</span>
        <span class="live-value" id="liveStatValue">—</span>
        <span class="live-sub">current grind</span>
      </div>

      <div class="live-stat session-goal-widget" id="sessionGoalWidget" style="display:none;"></div>

      <nav class="tabs" id="tabNav">
        <div class="tab-group">
          <div class="tab-group-label">Counter Tool</div>
          <div class="tab-group-btns">
            <button class="tab-btn" data-tab="current">Current Grind</button>
            <button class="tab-btn" data-tab="summary">All Grinds Summary</button>
            <button class="tab-btn" data-tab="golog">Grind Log</button>
          </div>
        </div>
        <div class="tab-group-divider"></div>
        <div class="tab-group">
          <div class="tab-group-label">Information</div>
          <div class="tab-group-btns">
            <button class="tab-btn" data-tab="counter-tool">How to Use Tool</button>
            <button class="tab-btn" data-tab="info">Grinding Info</button>
          </div>
        </div>
        <div class="tab-group-divider"></div>
        <div class="tab-group">
          <div class="tab-group-label">Settings/About</div>
          <div class="tab-group-btns">
            <button class="tab-btn" data-tab="tool-settings">Settings</button>
            <button class="tab-btn" data-tab="about">About</button>
          </div>
        </div>
      </nav>

      <div class="tab-panel" id="panel-current">
        <div id="currentPanelBody"></div>
      </div>

      <div class="tab-panel" id="panel-summary" style="display:none;">
        <section>
          <div class="section-header-row">
            <h2>Overview — All Grinds</h2>
            <div class="share-btn-group">
              <button id="shareOverviewBtn" class="share-btn">📤 Share Overview</button>
              <button id="downloadOverviewBtn" class="share-btn">⬇ Download Overview</button>
            </div>
          </div>
          <div class="stats-grid" id="statsGrid"></div>
        </section>
        <section>
          <h2>Trend Across Grinds</h2>
          <p class="corr-caveat">Filter to one species, map, and platform to see how repeat grinds of that exact combo have trended over time &mdash; leave any set to "All" to include everything.</p>
          <div id="chartArea"></div>
        </section>
        <section>
          <h2>Map Comparison</h2>
          <p class="corr-caveat">Select a species and 2 or more maps to compare averages across your logged grinds for that combination.</p>
          <div id="grindCompareArea"></div>
        </section>
        <section>
          <h2>Grinds by Species</h2>
          <div id="speciesCountGrid"></div>
        </section>
      </div>

      <div class="tab-panel" id="panel-golog" style="display:none;">
        <section>
          <h2>Grind Log</h2>
          <p class="info-note" style="margin-bottom:16px;">Trophy &amp; counter details for every Great One logged, most recent first.</p>
          <div id="goLogArea"></div>
        </section>
      </div>

      <div class="tab-panel" id="panel-counter-tool" style="display:none;">
        <section>
          <h2>How to Use This Tool</h2>
          <p class="info-text">This tool is an easy way to keep track of your grind at a higher level &mdash; instead of trying to remember exact numbers in your head while you hunt, you just tap a button each time you take a relevant kill, and the tool keeps the running totals for you.</p>
          <p class="info-text" style="margin-top:10px;">That info is then taken and used to build averages and trends across all your grinds &mdash; see the Analytics section below.</p>
          <p class="info-note">The accuracy of what this tool tells you is only as good as the accuracy of what you put into it. If a kill is miscounted or miscategorized, the averages built from it will be off too.</p>
          <p class="info-note" style="margin-top:6px;">Want to use this tool like an app on your phone or computer instead of a browser tab? See <a href="#installGuide" class="term-link">Installing as a Browser App</a> below.</p>
        </section>

        <section>
          <h2>The Counter</h2>

          <h3 class="how-it-works-subhead">Starting a grind</h3>
          <p class="info-text">To begin, hit <strong>+ Start New Grind</strong> on the Current Grind tab. A short step-by-step menu walks you through picking your species, map, and platform. Once you confirm, the counter is ready to use immediately.</p>
          <p class="info-text" style="margin-top:10px;">You can run multiple grinds at the same time &mdash; switch between them anytime using <strong>Select Other (Open) Grind</strong>.</p>

          <h3 class="how-it-works-subhead">Using the counter</h3>
          <p class="info-text">Each time you kill a relevant animal during your grind, tap the appropriate counter button once. You can also hold a button down to repeat quickly. The counters update in real time and save automatically &mdash; no manual saving needed.</p>
          <p class="info-text" style="margin-top:10px;">If you play on PC, you can also assign keyboard keys to any counter using the <strong>Sync Key</strong> button at the bottom of each counter card. Once set, pressing that key will increment the counter without touching the screen.</p>

          <h3 class="how-it-works-subhead">What each button counts</h3>
          <p class="info-text">The counter has three buttons, each tracking a specific kill type:</p>
          <ul class="how-it-works-list">
            <li><strong>Diamond</strong> &mdash; Any diamond-rank kill for the species, combined into one count.</li>
            <li><strong>Trolls</strong> &mdash; A max-level animal that didn't make diamond. Only tap this for trolled kills; your Diamond count is combined with Trolls automatically wherever a "Max-Level" figure is shown elsewhere (like All Grinds Summary), so you don't need to track that combination yourself.</li>
            <li><strong>Total Kills</strong> &mdash; Any other kill that doesn't fit the categories above. Only tap for kills not already counted.</li>
          </ul>

          <h3 class="how-it-works-subhead">Cascading totals</h3>
          <p class="info-text">Each kill is only ever entered once &mdash; into its own button. Diamond and Trolls both add straight to Total Kills; nothing else cascades between the buttons on the counter itself.</p>
          <p class="info-text" style="margin-top:10px;">For example: if you log 5 diamonds, 3 trolls, and 1 other kill, Total Kills shows <strong>9</strong> (5+3+1).</p>

          <h3 class="how-it-works-subhead">Rare fur counter</h3>
          <p class="info-text">An optional <strong>Rare Fur</strong> counter is available too. Enable it with the toggle if you want to track how many rare-furred animals you kill during a grind. This counter is completely independent &mdash; it does not feed into Total Kills or any other total or statistic.</p>
        </section>

        <section>
          <h2>The Log</h2>
          <p class="info-text">When your Great One finally spawns and you've taken the kill, hit <strong>Log Great One</strong> at the bottom of the counter. This closes the grind and moves it to the <strong>Grind Log</strong>, automatically saving your kill counts, diamonds, and average kills/diamond alongside it.</p>
          <p class="info-text" style="margin-top:10px;">From there you can fill in trophy details &mdash; hunt result, weight, fur, rack/antlers, personal notes &mdash; right away or later, and edit them anytime.</p>
          <p class="info-text" style="margin-top:10px;">The Grind Log lets you view any grind's full details and use the search/filter tool to find specific entries quickly by name, species, map, platform, or notes.</p>
          <p class="info-text" style="margin-top:10px;">Nothing's locked in: reopen the counter on any Grind Log card with <strong>Edit Counter</strong> to fix numbers after the fact, or use <strong>Revert to Open Grind</strong> if you logged it too early or by mistake.</p>
          <p class="info-text" style="margin-top:10px;">Any Grind Log card can be turned into a shareable image with <strong>Share</strong> or <strong>Download</strong> &mdash; Share opens your device's native share sheet where available, and falls back to a download otherwise. Your full All Grinds overview can be shared or downloaded the same way from the All Grinds Summary tab.</p>
          <p class="info-text" style="margin-top:10px;">Everything &mdash; grinds, keybinds, custom species/maps, and settings &mdash; auto-saves and syncs continuously as you use the tool, so nothing is lost if a tab closes unexpectedly. Use the Export/Import backup tools in Settings to move a full copy of your data to another browser or device.</p>
        </section>

        <section>
          <h2>Analytics</h2>
          <p class="info-text">Once you have at least one Great One grind logged, the <strong>All Grinds Summary</strong> tab begins to populate. (Non-Great-One grinds are excluded, since those stats are only meaningful for Great One grinds.)</p>
          <p class="info-text" style="margin-top:10px;">It shows an overview of averages &mdash; kills, diamonds, diamond rate, and more &mdash; across all your grinds, plus a trend chart showing how your kill counts have moved over time.</p>
          <p class="info-text" style="margin-top:10px;"><strong>Map Comparison</strong> lets you compare same-species grinds side-by-side across different maps, and <strong>Grinds by Species</strong> gives a full breakdown of how many grinds (open or completed) you have per species.</p>
        </section>

        <section>
          <h2>Export &amp; Import</h2>
          <p class="info-text">Found under <strong>Settings → Backup &amp; Transfer Data</strong>, these tools move your data in and out of the app.</p>
          <p class="info-text" style="margin-top:10px;"><strong>Export backup</strong> downloads a full JSON file containing all your grinds (open and logged), keybinds, custom species/maps, and settings &mdash; everything needed to fully restore your setup elsewhere.</p>
          <p class="info-text" style="margin-top:10px;"><strong>Import backup</strong> restores a previously exported JSON file. You'll be asked to choose <strong>Merge</strong> (adds what's new without touching what you already have &mdash; recommended) or <strong>Overwrite</strong> (replaces everything with the file's contents).</p>
          <p class="info-text" style="margin-top:10px;"><strong>Export CSV</strong> downloads your logged grinds as a spreadsheet you can open in Excel, Google Sheets, or Numbers to sort, filter, or build your own charts &mdash; handy for your own analysis, but it's a one-way export and can't be re-imported.</p>
          <p class="info-note">Since your data lives only in this browser, exporting a backup is the only way to move it to another browser or device, or to keep a safety copy in case you clear your browser data.</p>
        </section>

        <section id="installGuide">
          <h2>Installing as a Browser App</h2>
          <p class="info-text">This tool can be installed straight from your browser, so it opens like its own app instead of a browser tab &mdash; no app store needed. Steps vary by browser and device:</p>
          <p class="info-note">Browsers change their menus and options over time, so these instructions may not always be perfectly accurate or up to date. The browser-app experience also may not be available or fully optimized on every device or browser &mdash; sorry if yours isn't one of them!</p>

          <h3 class="how-it-works-subhead">Chrome / Edge (Windows, Mac, Linux)</h3>
          <ol class="how-it-works-list">
            <li>Look for an install icon in the address bar (usually a small monitor with a down arrow, or a "+").</li>
            <li>Click it, then click <strong>Install</strong>.</li>
            <li>If you don't see the icon, click the menu (&#8942;) in the top-right, then look for <strong>Install Great One Grind Log&hellip;</strong> or <strong>Apps &rarr; Install this site as an app</strong>.</li>
          </ol>

          <h3 class="how-it-works-subhead">Chrome (Android)</h3>
          <ol class="how-it-works-list">
            <li>Tap the menu (&#8942;) in the top-right corner.</li>
            <li>Tap <strong>Add to Home screen</strong> or <strong>Install app</strong>.</li>
            <li>Confirm by tapping <strong>Install</strong> or <strong>Add</strong>.</li>
          </ol>

          <h3 class="how-it-works-subhead">Safari (iPhone / iPad)</h3>
          <ol class="how-it-works-list">
            <li>Tap the <strong>Share</strong> button (the square with an arrow pointing up).</li>
            <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
            <li>Tap <strong>Add</strong> in the top-right corner.</li>
          </ol>
          <p class="info-note">iOS doesn't allow any app, including this one, to trigger this automatically &mdash; it always has to be done manually through the Share menu.</p>

          <h3 class="how-it-works-subhead">Safari (Mac)</h3>
          <ol class="how-it-works-list">
            <li>Click the <strong>Share</strong> button in the toolbar (or use the File menu).</li>
            <li>Select <strong>Add to Dock</strong>.</li>
            <li>Confirm the name and click <strong>Add</strong>.</li>
          </ol>

          <h3 class="how-it-works-subhead">Firefox</h3>
          <p class="info-text">Firefox has limited or no support for installing sites as apps depending on your platform and version. If you don't see an install option, bookmarking the page or using Chrome/Edge/Safari instead is the most reliable path to an app-like experience.</p>
        </section>
      </div>

      <div class="tab-panel" id="panel-info" style="display:none;">
        <section>
          <h2>What Is a Grind?</h2>
          <p class="info-text">A <strong>grind</strong> is just an efficient way to kill a large number of a target species at a respawn point, in order to expedite the eventual spawn of trophies of that species. These trophies include diamond rank animals, rare-furred animals, and most rarely, a <strong>Great One</strong> &mdash; the largest and rarest trophy animal in the game.</p>
          <p class="info-note">Please note that Great Ones are only able to spawn IF you are grinding a species with a Great One available (check below for which species have Great Ones available).</p>
        </section>

        <section>
          <h2>Species That Currently Have Great Ones:</h2>
          <ul class="info-list">
            <li>Whitetail Deer</li><li>Red Deer</li><li>Fallow Deer</li><li>Mule Deer</li><li>Roe Deer</li>
            <li>Moose</li><li>Tahr</li><li>Black Bear</li><li>Wild Boar</li><li>Red Fox</li>
            <li>Gray Wolf</li><li>Ring-Necked Pheasant</li><li>Jaguar</li>
          </ul>
          <p class="info-note">This reflects current Great One species as of writing &mdash; future updates/DLC may add more.</p>
        </section>

        <section>
          <h2>Species' Max Levels</h2>
          <div class="level-tier-grid">
            <div class="level-tier-card easy">
              <div class="level-tier-title">Max Level 3 &mdash; Very Easy</div>
              <ul class="level-tier-list"><li>Whitetail Deer</li><li>Ring-Necked Pheasant</li><li>Roe Deer</li></ul>
            </div>
            <div class="level-tier-card medium">
              <div class="level-tier-title">Max Level 5 &mdash; Medium</div>
              <ul class="level-tier-list"><li>Moose</li><li>Fallow Deer</li><li>Tahr</li><li>Mule Deer</li><li>Wild Boar</li></ul>
            </div>
            <div class="level-tier-card legendary">
              <div class="level-tier-title">Max Level 9 &mdash; Legendary</div>
              <ul class="level-tier-list"><li>Red Deer</li><li>Black Bear</li><li>Red Fox</li><li>Gray Wolf</li><li>Jaguar</li></ul>
            </div>
          </div>
        </section>

        <section>
          <h2>Tips for Grinding:</h2>
          <p class="info-note" style="margin-bottom:12px;">Underlined terms link to their own definition &mdash; click one to jump straight to it.</p>
          <ul class="term-def-list" id="tipsList"></ul>
        </section>

        <section>
          <h2>Common Grinding Terminology:</h2>
          <p class="info-note" style="margin-bottom:12px;">Underlined terms link to their own definition below &mdash; click one to jump straight to it.</p>
          <ul class="term-def-list" id="terminologyList"></ul>
        </section>

        <section>
          <h2>Why Only Male Animals? (For Great Ones):</h2>
          <p class="info-text">Currently, every Great One species in the game only has <strong>male</strong> Great Ones &mdash; there's no such thing as a female Great One for any species right now. Because of this, a grind is centered around killing only male animals of the target species.</p>
        </section>

        <section>
          <h2>By Male Terminology</h2>
          <div class="terminology-grid">
            <div class="term-card"><span class="term-label">Bucks</span><span class="term-species">Whitetail Deer, Red Deer, Fallow Deer, Mule Deer, Roe Deer</span></div>
            <div class="term-card"><span class="term-label">Bulls</span><span class="term-species">Moose, Tahr</span></div>
            <div class="term-card"><span class="term-label">Boars</span><span class="term-species">Black Bear, Wild Boar</span></div>
            <div class="term-card"><span class="term-label">Dogs</span><span class="term-species">Red Fox, Gray Wolf</span></div>
            <div class="term-card"><span class="term-label">Roosters</span><span class="term-species">Ring-Necked Pheasant</span></div>
            <div class="term-card"><span class="term-label">Toms</span><span class="term-species">Jaguar</span></div>
          </div>
        </section>
      </div>

      <div class="tab-panel" id="panel-tool-settings" style="display:none;">
        <section>
          <h2>Install as an App</h2>
          <p class="info-text">You can install this tool straight from your browser so it opens like its own app instead of a browser tab, no app store needed.</p>
          <div class="share-btn-group" style="margin-top:8px;">
            <button id="settingsInstallGuideBtn" class="share-btn">📲 Installing as a Browser App</button>
          </div>
        </section>

        <section>
          <h2>Display</h2>
          <div style="display:flex; align-items:center; gap:14px; margin-top:8px;">
            <button id="themeToggleBtn" class="theme-toggle-btn"><span class="theme-toggle-icon">&#9728;</span> Light mode</button>
            <span style="font-size:12px; color:var(--muted);">Switch between dark and light color themes.</span>
          </div>
        </section>

        <section>
          <h2>Grind Defaults</h2>
          <p class="info-text">Sets the starting state for brand-new grinds. You can still turn either on or off per-grind at any time from the counter screen — this only controls what a new grind starts with.</p>
          <div class="settings-toggle-row">
            <span class="grind-meta-label">Click/Ding on hotkey use</span>
            <button class="toggle-switch ${buzzDefaultOn ? 'on' : ''}" id="buzzDefaultToggle" role="switch" aria-checked="${buzzDefaultOn ? 'true' : 'false'}" aria-label="Toggle default click and ding on hotkey use for new grinds"><span class="toggle-switch-knob"></span></button>
          </div>
          <div class="settings-toggle-row">
            <span class="grind-meta-label">Hotkey sound</span>
            <div style="display:flex; align-items:center; gap:8px;">
              <select id="hotkeySoundSelect" class="compare-select">
                <option value="blip" ${hotkeySound==='blip'?'selected':''}>Blip</option>
                <option value="click" ${hotkeySound==='click'?'selected':''}>Click</option>
                <option value="ding" ${hotkeySound==='ding'?'selected':''}>Ding</option>
                <option value="thock" ${hotkeySound==='thock'?'selected':''}>Heavy Click</option>
                <option value="pop" ${hotkeySound==='pop'?'selected':''}>Pop</option>
              </select>
              <button id="hotkeySoundPreviewBtn" type="button" class="secondary-btn" style="padding:6px 12px; font-size:12px;">▶ Preview</button>
            </div>
          </div>
          <div class="settings-toggle-row">
            <span class="grind-meta-label">Rare Fur tracking</span>
            <button class="toggle-switch ${rareDefaultOn ? 'on' : ''}" id="rareDefaultToggle" role="switch" aria-checked="${rareDefaultOn ? 'true' : 'false'}" aria-label="Toggle default rare fur tracking for new grinds"><span class="toggle-switch-knob"></span></button>
          </div>
        </section>

        <section>
          <h2>Backup &amp; Transfer Data</h2>
          <p class="info-text">Your grinds, keybinds, custom species/maps, and other settings live only in this browser &mdash; they won't sync anywhere on their own. Export a backup to save a copy somewhere secure, or to move everything to a different browser or device. Import that file (here or elsewhere) any time to bring it back.</p>
          <div class="backup-toolbar" style="margin-top:12px;">
            <div class="backup-item">
              <button id="exportBtn" class="backup-btn export-btn">⬇ Export backup</button>
              <p class="backup-desc">Downloads a full JSON backup of all your grinds (open and logged), keybinds, custom species/maps, and settings.</p>
            </div>
            <div class="backup-item">
              <button id="importBtn" class="backup-btn import-btn">⬆ Import backup</button>
              <p class="backup-desc">Restores a previously exported JSON backup &mdash; choose to merge with or overwrite your current data.</p>
            </div>
            <div class="backup-item">
              <button id="exportCsvBtn" class="backup-btn csv-btn">⬇ Export CSV</button>
              <p class="backup-desc">Downloads your completed grinds as a spreadsheet. Open in Excel, Google Sheets, or Numbers to sort, filter, and build your own charts.</p>
            </div>
            <input type="file" id="importFile" accept="application/json" style="display:none">
          </div>
          <div id="importMsg" class="import-msg" style="margin-top:8px;"></div>
        </section>
      </div>

      <div class="tab-panel" id="panel-about" style="display:none;">
        <section>
          <h2>About</h2>
          <div class="about-profile-row">
            <img src="NyXHunt.png" alt="NyXHunt" class="about-avatar">
            <div class="about-profile-info">
              <div class="about-profile-name">NyXHunt</div>
              <a href="https://www.youtube.com/@NyXtheHunter" target="_blank" rel="noopener" class="about-profile-link" style="display:block;">▶ YouTube Channel</a>
              <a href="mailto:nyxhunting@gmail.com" class="about-profile-link" style="display:block; margin-top:2px;">✉ nyxhunting@gmail.com</a>
            </div>
          </div>
          <p class="info-text">Hi! My name is NyXHunt, I create content on theHunter Call of the Wild, and I'm also the creator of The Great One Grind Log.</p>
          <p class="info-text" style="margin-top:10px;">When I first started Great One grinding, I used a simple counter on my phone — it worked well enough. But the deeper I got into the grinding playstyle, the more quality-of-life features I found myself wishing existed in one place instead of scattered across notes and memory. Eventually, I was inspired to build this tool: The Great One Grind Log.</p>
          <p class="info-text" style="margin-top:10px;">The Great One Grind Log is an advanced tool packed with features and built specifically for grinders who want more convenience and simplicity in their grinds. Personally, it's been extremely useful for me and my playstyle, allowing me to count kills and store information without having to search for it each time. I hope that you love this tool and that it is as helpful to you as it is to me! Happy hunting!</p>
          <p class="info-text" style="margin-top:14px;">Say thank you or show support here:</p>
          <div class="share-btn-group" style="margin-top:8px;">
            <a href="https://ko-fi.com/nyxhunt" target="_blank" rel="noopener" class="share-btn kofi-btn">☕ Support on Ko-fi</a>
          </div>
          <p class="info-note" style="margin-top:16px;">Great One Grind Log is an unofficial, fan-made tool. Parts of the materials referenced are the property of Fatalist Development AB or its affiliates, including Expansive Worlds AB and Avalanche Studios Group, publishers and developers of theHunter: Call of the Wild. All rights reserved. This tool is not approved or endorsed by Fatalist Development AB or any of its affiliates.</p>
          <p class="info-note" style="margin-top:8px;">This tool is built to follow Avalanche Studios Group's Fan Content Policy.</p>
        </section>

        <section>
          <h2>FAQ and Feedback</h2>

          <h3 class="how-it-works-subhead">Who is this tool for?</h3>
          <p class="info-text">Everybody — this tool is built for the Hunter Call of the Wild community, from brand new grinders to seasoned pros. If grinding is your playstyle, this tool is an amazing addition to your toolbox.</p>

          <h3 class="how-it-works-subhead">What makes it different from notes or a spreadsheet?</h3>
          <p class="info-text">You could technically replicate many of this tool's features by hand, but this keeps everything in one place and does the math for you &mdash; no manual tallying or separate spreadsheet to maintain.</p>

          <h3 class="how-it-works-subhead">Do I use this tool myself?</h3>
          <p class="info-text">Yes. It saves me time and a headache, and using it for my own grinds allows me to understand what features should be added for the community!</p>

          <h3 class="how-it-works-subhead">How was this tool created?</h3>
          <p class="info-text">(Disclaimer) This tool was created through AI. I only claim creation through idea/concept and direction. I have had a significant hand in the layout, features, informational text, and processes; however, it is AI that has created the whole display that the user interfaces with. I have also heavily used AI to assist me in the process of making this tool available to the public.</p>

          <h3 class="how-it-works-subhead">Can I install this as an app?</h3>
          <p class="info-text">Yes &mdash; on most browsers, you can install it straight from your browser so it opens like its own app instead of a tab, no app store needed. See the step-by-step guide for your specific device/browser below.</p>
          <div class="share-btn-group" style="margin-top:8px;">
            <button id="aboutInstallGuideBtn" class="share-btn">📲 Installing as a Browser App</button>
          </div>

          <h3 class="how-it-works-subhead">Feedback and Future Changes</h3>
          <p class="info-text">This tool is still actively being developed, and if you're using an early/beta version, that means your feedback has a direct hand in what gets built or fixed next (and even if you aren't in beta, I'd still love to hear your feedback and experience with the tool! I might even implement it if it's a solid addition! Who knows?) Please let me know what you would like to see!</p>
          <p class="info-note">Feedback is genuinely appreciated and does directly shape what gets worked on — however, it is not guaranteed that every suggestion will be implemented. I reserve the right to distinguish what is added and when, based on what is best for the tool as a whole.</p>
          <div class="share-btn-group about-feedback-btns" style="margin-top:12px;">
            <a href="https://docs.google.com/forms/d/e/1FAIpQLScU90d8Ei4LFA3rb4ypUlC6rddMC9_ZJAhuuoNb7yFagav-zg/viewform" target="_blank" rel="noopener" class="share-btn">💬 Report a Bug / Give Feedback</a>
            <a href="changelog.html" target="_blank" rel="noopener" class="share-btn">📋 View Changelog</a>
            <a href="terms.html" target="_blank" rel="noopener" class="share-btn">📄 Terms of Service</a>
            <a href="privacy.html" target="_blank" rel="noopener" class="share-btn">🔒 Privacy Policy</a>
          </div>
        </section>

        <section>
          <h2>The Basic Idea</h2>

          <h3 class="how-it-works-subhead">1. The Counter</h3>
          <p class="info-text">The counter is simple to use but does a lot under the hood, and is full of personalized customization.</p>
          <ul class="how-it-works-list">
            <li>Choose from the game's Great One species and maps, or set up a custom grind for anything else.</li>
            <li>Support for running dozens of grinds at once (every open grind auto-saves, so you can pick any of them up at any time).</li>
            <li>Mouse or keyboard control with the ability to sync keys to counter, and cascade logic that keeps every kill tier accurate with a single tap. A full breakdown of how everything works is in the "How to Use Tool" tab.</li>
          </ul>

          <h3 class="how-it-works-subhead">2. The Log</h3>
          <p class="info-text">The log is where grinds and Great Ones are logged for future reference.</p>
          <ul class="how-it-works-list">
            <li>Logging a Great One auto-saves the grind to your Grind Log with kill count, diamonds, average diamond rate, and more.</li>
            <li>When you log a Great One, you can also fill in trophy details &mdash; hunt result, weight, fur, rack/antlers, personal notes &mdash; right away or later.</li>
            <li>From the Grind Log, you can view any grind's full details and use the filter tool to find specific ones quickly.</li>
            <li>Nothing's locked in. Edit any logged grind's details anytime, or revert it back into an Open Grind in the counter if you logged it too early.</li>
            <li>Share or download any logged grind &mdash; or your whole All Grinds overview &mdash; as a branded shareable image, right from the Grind Log.</li>
            <li>Your data auto-saves and syncs continuously as you play, so logged grinds and trophy details are safe even if a tab closes or you switch devices (with a backup export/import for full transfers).</li>
          </ul>

          <h3 class="how-it-works-subhead">3. Analytics</h3>
          <p class="info-text">Found in the All Grinds Summary tab, this shows stats on your logged grinds in more depth than you'd get tracking by hand. (Analytics only pull from LOGGED Great One grinds &mdash; Non-Great-One grinds are excluded.)</p>
          <ul class="how-it-works-list">
            <li>An overview of averages &mdash; kills, diamonds, diamond rate, etc &mdash; across all your grinds.</li>
            <li>A trend bar showing whether certain harvest types are trending up or down over time.</li>
            <li>Side-by-side comparison of the same-species grinds across different maps.</li>
            <li>A full breakdown of how many grinds (logged or open) you have per species.</li>
          </ul>

          <h3 class="how-it-works-subhead">4. The Info</h3>
          <p class="info-text">Basic info and advice for new grinders &mdash; all in the "Grinding Info" tab.</p>
          <ul class="how-it-works-list">
            <li>Current Great One species and their max levels.</li>
            <li>Basic grinding tips and common terminology.</li>
            <li>Male-animal terminology (bucks, boars, bulls, etc.)</li>
          </ul>
        </section>
      </div>

      <footer>
        <div id="resetBtnWrap" style="display:none; margin-bottom:14px;">
          <button id="resetBtn" class="reset-danger-btn">Reset all data</button>
        </div>
      </footer>
    `;

    document.getElementById('resetBtn').addEventListener('click', () => {
      askConfirm('Reset ALL grinds, open and completed? This cannot be undone.', () => {
        askConfirm('Are you absolutely sure? Every grind and Great One log entry will be permanently deleted with no way to recover them.', doResetAll);
      });
    });
    document.getElementById('exportBtn').addEventListener('click', exportData);
    document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
    document.getElementById('exportCsvBtn').addEventListener('click', exportCsv);
    (function(){
      const app = document.querySelector('.app');
      const btn = document.getElementById('themeToggleBtn');
      let light = false;
      btn.addEventListener('click', () => {
        light = !light;
        app.classList.toggle('theme-light', light);
        const icon = btn.querySelector('.theme-toggle-icon');
        icon.innerHTML = light ? '&#127769;' : '&#9728;';
        btn.lastChild.textContent = light ? ' Dark mode' : ' Light mode';
      });
    })();
    document.getElementById('buzzDefaultToggle').addEventListener('click', () => {
      buzzDefaultOn = !buzzDefaultOn;
      saveSettings();
      const btn = document.getElementById('buzzDefaultToggle');
      btn.classList.toggle('on', buzzDefaultOn);
      btn.setAttribute('aria-checked', buzzDefaultOn ? 'true' : 'false');
    });
    document.getElementById('rareDefaultToggle').addEventListener('click', () => {
      rareDefaultOn = !rareDefaultOn;
      saveSettings();
      const btn = document.getElementById('rareDefaultToggle');
      btn.classList.toggle('on', rareDefaultOn);
      btn.setAttribute('aria-checked', rareDefaultOn ? 'true' : 'false');
    });
    document.getElementById('hotkeySoundSelect').addEventListener('change', (e) => {
      hotkeySound = VALID_HOTKEY_SOUNDS.includes(e.target.value) ? e.target.value : 'click';
      saveSettings();
    });
    document.getElementById('hotkeySoundPreviewBtn').addEventListener('click', () => {
      playHotkeySound();
    });
    document.getElementById('importFile').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if(file) importData(file);
      e.target.value = '';
    });
    document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

    setupDraggableWidget(document.getElementById('liveStatWidget'), 'liveStatWidgetCorner');
    setupDraggableWidget(document.getElementById('sessionGoalWidget'), 'sessionGoalWidgetCorner');
    const liveStatEl = document.getElementById('liveStatWidget');
    const sessionGoalEl = document.getElementById('sessionGoalWidget');
    if(liveStatEl && liveStatEl._restoreWidgetCorner) liveStatEl._restoreWidgetCorner();
    if(sessionGoalEl && sessionGoalEl._restoreWidgetCorner) sessionGoalEl._restoreWidgetCorner();
    refreshWidgetStacking();

    function goToInstallGuide(){
      switchTab('counter-tool');
      setTimeout(() => {
        const el = document.getElementById('installGuide');
        if(el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    }
    const aboutInstallBtn = document.getElementById('aboutInstallGuideBtn');
    if(aboutInstallBtn) aboutInstallBtn.addEventListener('click', goToInstallGuide);
    const settingsInstallBtn = document.getElementById('settingsInstallGuideBtn');
    if(settingsInstallBtn) settingsInstallBtn.addEventListener('click', goToInstallGuide);
    document.getElementById('shareOverviewBtn').addEventListener('click', shareOverview);
    document.getElementById('downloadOverviewBtn').addEventListener('click', downloadOverview);
    document.getElementById('wizardCancelBtn').addEventListener('click', closeWizard);
    document.getElementById('wizardBackBtn').addEventListener('click', wizardBack);

    document.getElementById('keybindCancelBtn').addEventListener('click', closeKeybindModal);
    document.getElementById('keybindSaveBtn').addEventListener('click', () => {
      if(!pendingKey || !listeningFor) return;
      // Prevent same key being bound to a different counter
      const conflictTarget = Object.entries(keybinds).find(([t, k]) => k === pendingKey && t !== listeningFor);
      if(conflictTarget){
        const status = document.getElementById('keybindStatus');
        const saveBtn = document.getElementById('keybindSaveBtn');
        status.textContent = `"${formatKey(pendingKey)}" is already synced to another counter. Please enter a different key.`;
        status.className = 'keybind-status conflict';
        // Reset so Cancel returns to a blank waiting state
        pendingKey = null;
        saveBtn.classList.remove('lit');
        saveBtn.disabled = true;
        return;
      }
      keybinds[listeningFor] = pendingKey;
      saveKeybinds();
      closeKeybindModal();
      renderCurrentPanel();
    });

    renderCurrentPanel();
    buildTipsList();
    buildTerminologyList();
    switchTab(activeTab);

    // Session goal modals
    document.getElementById('sgMetCancel').addEventListener('click', () => {
      document.getElementById('sgGoalMetModal').classList.add('hidden');
      sessionGoal = null; sessionGoalDone = false; renderSessionGoal();
    });
    document.getElementById('sgMetNewGoal').addEventListener('click', () => {
      document.getElementById('sgGoalMetModal').classList.add('hidden');
      sessionGoal = null; sessionGoalDone = false;
      openSessionGoalModal(false);
    });
  }

  function switchTab(tab){
    // Block navigating away while a logged grind's counter editor has unsaved changes.
    if(hasUnsavedCounterEdits()){
      showFinishEditingFirstModal();
      return;
    }
    // Block navigating away while a rename box is open and not yet saved/canceled.
    if(hasOpenRenameEditor()){
      showFinishRenamingFirstModal();
      return;
    }
    // If ledger was previously active, redirect to golog
    if(tab === 'ledger') tab = 'golog';
    activeTab = tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.getElementById('panel-current').style.display = tab === 'current' ? '' : 'none';
    document.getElementById('panel-summary').style.display = tab === 'summary' ? '' : 'none';
    document.getElementById('panel-golog').style.display = tab === 'golog' ? '' : 'none';
    document.getElementById('panel-counter-tool').style.display = tab === 'counter-tool' ? '' : 'none';
    document.getElementById('panel-info').style.display = tab === 'info' ? '' : 'none';
    document.getElementById('panel-tool-settings').style.display = tab === 'tool-settings' ? '' : 'none';
    document.getElementById('panel-about').style.display = tab === 'about' ? '' : 'none';
    const resetWrap = document.getElementById('resetBtnWrap');
    if(resetWrap) resetWrap.style.display = tab === 'tool-settings' ? '' : 'none';
    if(tab === 'summary'){ renderStats(); renderChart(); }
    if(tab === 'golog'){ renderGoLog(); }
  }

  function resetSessionGoal(){
    sessionGoal = null;
    sessionGoalDone = false;
    renderSessionGoal();
  }

  function renderSessionGoal(){
    const widget = document.getElementById('sessionGoalWidget');
    if(!widget) return;
    const g = getActiveGrind();
    if(!g){ widget.style.display = 'none'; return; }
    widget.style.display = '';

    if(!sessionGoal){
      widget.innerHTML = `
        <span class="live-label">Grinding Session Goal</span>
        <div class="sg-empty">
          <button class="sg-set-btn" id="sgSetBtn">+ Set a kill goal</button>
        </div>`;
      document.getElementById('sgSetBtn').addEventListener('click', () => openSessionGoalModal());
      refreshWidgetStacking();
      return;
    }

    const startKills = sessionGoal.killsAtStart;
    const goal = sessionGoal.goal;
    const currentKills = totalKillsOf(g);
    const sessionKills = Math.max(0, currentKills - startKills);
    const pct = Math.min(100, goal > 0 ? (sessionKills / goal * 100) : 0);
    const pctLabel = Math.floor(pct) + '%';
    const wasAlreadyDone = sessionGoalDone;
    const done = sessionKills >= goal;

    if(done && !sessionGoalDone){
      sessionGoalDone = true;
      // Auto-popup
      if(!wasAlreadyDone) setTimeout(() => showGoalMetModal(), 50);
    }

    widget.innerHTML = `
      <span class="live-label">Grinding Session Goal</span>
      <div class="sg-counts">
        <span class="sg-kills">${sessionKills}</span>
        <span class="sg-sep"> / </span>
        <span class="sg-goal">${goal}</span>
        <button class="sg-edit-btn" id="sgEditBtn" title="Edit goal">✎</button>
      </div>
      <div class="sg-bar-wrap">
        <div class="sg-bar-fill" style="width:${pct}%"></div>
      </div>
      <div class="sg-pct">${pctLabel}</div>`;

    document.getElementById('sgEditBtn').addEventListener('click', () => openSessionGoalModal(true));
    refreshWidgetStacking();
  }

  function showGoalMetModal(){
    const modal = document.getElementById('sgGoalMetModal');
    if(!modal) return;
    modal.classList.remove('hidden');
  }

  function openSessionGoalModal(isEdit){
    const modal = document.getElementById('sgInputModal');
    if(!modal) return;
    const title = modal.querySelector('#sgModalTitle');
    const inp = modal.querySelector('#sgModalInput');
    title.textContent = isEdit ? 'Change your goal:' : 'How many kills this session?';
    inp.value = isEdit && sessionGoal ? sessionGoal.goal : '';
    modal.classList.remove('hidden');
    inp.focus();
    if(isEdit) inp.select && inp.select();

    const confirm = modal.querySelector('#sgModalConfirm');
    const cancel = modal.querySelector('#sgModalCancel');
    const deleteBtn = modal.querySelector('#sgModalDelete');
    // Clone to remove old listeners
    const newConfirm = confirm.cloneNode(true);
    const newCancel = cancel.cloneNode(true);
    const newDelete = deleteBtn.cloneNode(true);
    confirm.parentNode.replaceChild(newConfirm, confirm);
    cancel.parentNode.replaceChild(newCancel, cancel);
    deleteBtn.parentNode.replaceChild(newDelete, deleteBtn);

    newDelete.style.display = isEdit ? '' : 'none';
    newDelete.addEventListener('click', () => {
      modal.classList.add('hidden');
      sessionGoal = null; sessionGoalDone = false; renderSessionGoal();
    });

    newConfirm.addEventListener('click', () => {
      const v = parseInt(inp.value, 10);
      if(!v || v < 1) return;
      const g = getActiveGrind();
      if(!g) return;
      const kills = totalKillsOf(g);
      sessionGoal = { goal: v, killsAtStart: isEdit && sessionGoal ? sessionGoal.killsAtStart : kills };
      sessionGoalDone = false;
      modal.classList.add('hidden');
      renderSessionGoal();
    });
    newCancel.addEventListener('click', () => modal.classList.add('hidden'));
    inp.addEventListener('keydown', function onKey(e){
      if(e.key === 'Enter'){ newConfirm.click(); inp.removeEventListener('keydown', onKey); }
    });
  }

  function openSessionGoalInput(widget, g, isEdit){
    // Legacy stub — redirect to modal
    openSessionGoalModal(isEdit);
  }

  function renderLiveStat(){
    const el = document.getElementById('liveStatValue');
    const widget = document.getElementById('liveStatWidget');
    if(!el || !widget) return;
    const g = getActiveGrind();
    if(!g){ widget.style.display = 'none'; renderSessionGoal(); return; }
    widget.style.display = '';
    const dia = totalDiamond(g);
    const kills = totalKillsOf(g);
    el.textContent = dia === 0 ? '—' : (kills/dia).toFixed(2);
    renderSessionGoal();
  }

  function buildOpenGrindsListHtml(){
    const allOpen = openGrindsList();
    if(allOpen.length === 0){
      return `<div class="empty-note" style="margin-bottom:16px;">No open grinds yet.</div><button id="backFromBrowseBtn" class="secondary-btn">&larr; Back</button>`;
    }
    const speciesSet = [...new Set(allOpen.map(g => grindSpeciesLabel(g)).filter(Boolean))].sort();
    const mapSet = [...new Set(allOpen.map(g => g.map).filter(Boolean))].sort();
    const platformSet = [...new Set(allOpen.map(g => g.platform).filter(Boolean))].sort();

    function renderOpenCards(list){
      if(list.length === 0) return `<div class="empty-note">No open grinds match your filters.</div>`;
      return list.map(g => {
        const isNonGo = g.species === NON_GO;
        const baseTitle = isNonGo ? NON_GO : `${g.species} — ${g.map}`;
        const title = g.nickname ? g.nickname : baseTitle;
        const dia = totalDiamond(g), kills = totalKillsOf(g);
        const rate = dia === 0 ? '—' : (kills/dia).toFixed(2);
        return `
          <div class="open-grind-card" data-id="${g.id}">
            <div class="ogc-title">${escapeHtml(title)}</div>
            ${g.nickname && g.nickname !== g.defaultName ? `<div class="ogc-subtitle">${escapeHtml(baseTitle)}</div>` : ''}
            <div class="ogc-stats">
              <span>Total kills: <strong>${kills}</strong></span>
              <span>Diamonds: <strong>${dia}</strong></span>
              <span>Avg/diamond: <strong>${rate}</strong></span>
            </div>
            <div class="ogc-platform">${escapeHtml(g.platform)}</div>
            <div class="ogc-actions">
              <button class="grind-delete-btn go-log-delete-btn" data-id="${g.id}" title="Delete this grind">&#10005; Delete</button>
            </div>
          </div>
        `;
      }).join('');
    }

    setTimeout(() => {
      function applyOpenFilters(){
        const sp = document.getElementById('ogSpeciesFilter').value;
        const mp = document.getElementById('ogMapFilter').value;
        const pl = document.getElementById('ogPlatformFilter').value;
        const filtered = allOpen.filter(g => {
          if(sp && g.species !== sp) return false;
          if(mp && g.map !== mp) return false;
          if(pl && g.platform !== pl) return false;
          return true;
        });
        const scroll = document.getElementById('openGrindsScroll');
        if(scroll) scroll.innerHTML = renderOpenCards(filtered);
        document.querySelectorAll('.open-grind-card').forEach(card => card.addEventListener('click', () => activateGrind(card.dataset.id)));
        document.querySelectorAll('#openGrindsScroll .go-log-delete-btn').forEach(btn => {
          btn.addEventListener('click', e => {
            e.stopPropagation();
            const g = grinds.find(x => x.id === btn.dataset.id);
            const name = g ? (g.nickname || g.defaultName || g.species) : '';
            askDeleteGrind(btn.dataset.id, name);
          });
        });
      }
      ['ogSpeciesFilter','ogMapFilter','ogPlatformFilter'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.addEventListener('change', applyOpenFilters);
      });
    }, 0);

    return `
      <div class="go-log-controls">
        <div class="go-log-filters">
          <select id="ogSpeciesFilter">
            <option value="">All species</option>
            ${speciesSet.map(s => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join('')}
          </select>
          <select id="ogMapFilter">
            <option value="">All maps</option>
            ${mapSet.map(m => `<option value="${escapeAttr(m)}">${escapeHtml(m)}</option>`).join('')}
          </select>
          <select id="ogPlatformFilter">
            <option value="">All platforms</option>
            ${platformSet.map(p => `<option value="${escapeAttr(p)}">${escapeHtml(p)}</option>`).join('')}
          </select>
        </div>
      </div>
      <p class="link-note">Most recently used at top. Tap a grind to open its counter.</p>
      <div class="open-grinds-scroll" id="openGrindsScroll">${renderOpenCards(allOpen)}</div>
      <button id="backFromBrowseBtn" class="secondary-btn" style="margin-top:10px;">&larr; Back</button>
    `;
  }

  function keybindFooter(target, label){
    const key = keybinds[target];
    const syncBtn = `<button class="kb-sync-btn" data-target="${target}" data-label="${label}">⌨ Sync to keyboard${key ? ' (' + formatKey(key) + ')' : ''}</button>`;
    const undoBtn = key ? `<button class="kb-undo-btn" data-target="${target}" data-label="${label}">✕ Undo keyboard sync</button>` : '';
    return `<div class="kb-footer">${syncBtn}${undoBtn}</div>`;
  }

  function buildCounterHTML(g){
    return `
      <section class="counters">
        <div class="counter-card diamond3">
          <div class="card-top"><span class="card-icon" style="color:var(--diamond3)">${diamondIcon}</span><span class="card-label">Diamond</span></div>
          <div class="card-sub">this grind</div>
          <div class="counter-controls">
            <button class="ctrl-btn minus" data-target="diamondLvl3" aria-label="Subtract">&minus;</button>
            <div class="count-display" id="diamondLvl3Count">0</div>
            <button class="ctrl-btn plus" data-target="diamondLvl3" aria-label="Add">+</button>
          </div>
          <div class="breakdown" id="basicDiamondBreakdown"></div>
          ${keybindFooter('diamondLvl3', 'Diamond')}
        </div>
        <div class="counter-card antler">
          <div class="card-top"><span class="card-icon" style="color:var(--antler)">${antlerIcon}</span><span class="card-label">Trolls</span></div>
          <div class="card-sub">this grind</div>
          <div class="counter-controls">
            <button class="ctrl-btn minus" data-target="maxLevelOnly" aria-label="Subtract">&minus;</button>
            <div class="count-display" id="maxLevelCount">0</div>
            <button class="ctrl-btn plus" data-target="maxLevelOnly" aria-label="Add">+</button>
          </div>
          <div class="breakdown" id="basicTrollBreakdown"></div>
          ${keybindFooter('maxLevelOnly', 'Trolls')}
        </div>
        <div class="total-rare-row">
          <div class="counter-card total">
            <div class="card-top"><span class="card-icon" style="color:var(--total)">${totalIcon}</span><span class="card-label">Total Kills</span></div>
            <div class="card-sub">total this grind</div>
            <div class="counter-controls">
              <button class="ctrl-btn minus" data-target="other" aria-label="Subtract">&minus;</button>
              <div class="count-display" id="totalCount">0</div>
              <button class="ctrl-btn plus" data-target="other" aria-label="Add">+</button>
            </div>
            <div class="breakdown" id="basicTotalBreakdown"></div>
            ${keybindFooter('other', 'Total Kills')}
          </div>
          <div class="counter-card rare ${g.rareTracking ? '' : 'rare-off'}" id="rareCard">
            <div class="card-top"><span class="card-icon" style="color:var(--rare)">${rareIcon}</span><span class="card-label">Rare Fur</span><button class="rare-switch ${g.rareTracking ? 'on' : ''}" id="rareToggle" role="switch" aria-checked="${g.rareTracking ? 'true' : 'false'}" data-hint="More advanced settings in the &quot;Settings&quot; section!" style="margin-left:auto;flex-shrink:0;"><span class="rare-switch-knob"></span></button></div>
            <div class="card-sub">this grind</div>
            <div class="counter-controls">
              <button class="ctrl-btn minus" data-target="rareCount" ${g.rareTracking ? '' : 'disabled'} aria-label="Subtract rare">&minus;</button>
              <div class="count-display" id="rareCount">0</div>
              <button class="ctrl-btn plus" data-target="rareCount" ${g.rareTracking ? '' : 'disabled'} aria-label="Add rare">+</button>
            </div>
            <div class="rare-note">Does not affect any other counter, including Total Kills. Rare fur spawn rates are fixed and cannot be influenced by kill count or kill type.</div>
            ${keybindFooter('rareCount', 'Rare Fur')}
          </div>
        </div>
      </section>`;
  }

  function renderCurrentPanel(){
    const body = document.getElementById('currentPanelBody');
    if(!body) return;

    if(browsingOpenGrinds){
      body.innerHTML = buildOpenGrindsListHtml();
      body.querySelectorAll('.open-grind-card').forEach(card => card.addEventListener('click', () => activateGrind(card.dataset.id)));
      body.querySelectorAll('.grind-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const g = grinds.find(x => x.id === btn.dataset.id);
          const name = g ? (g.nickname || g.defaultName || g.species) : '';
          askDeleteGrind(btn.dataset.id, name);
        });
      });
      const back = document.getElementById('backFromBrowseBtn');
      if(back) back.addEventListener('click', () => { browsingOpenGrinds = false; renderCurrentPanel(); });
      return;
    }

    const g = getActiveGrind();
    if(!g){
      body.innerHTML = `
        <div class="empty-note" style="margin-bottom:16px;">No active grind right now. Start a new one, or pick up an open grind where you left off.</div>
        <div class="action-row">
          <button id="startNewBtn" class="go-btn">+ Start New Grind</button>
          <button id="selectOtherBtn" class="secondary-btn">Select Other (Open) Grind</button>
        </div>
      `;
      document.getElementById('startNewBtn').addEventListener('click', startWizard);
      document.getElementById('selectOtherBtn').addEventListener('click', () => { browsingOpenGrinds = true; renderCurrentPanel(); });
      return;
    }

    const isNonGo = g.species === NON_GO;
    const headerLabel = isNonGo ? NON_GO : `${g.species} \u2014 ${g.map}`;
    const statusLabel = g.status === 'completed' ? `COMPLETED #${g.cycle}` : 'OPEN';
    const isRenamed = g.nickname && g.defaultName && g.nickname !== g.defaultName;
    const displayName = g.nickname || g.defaultName || headerLabel;

    body.innerHTML = `
      <div class="grind-header">
        <div class="grind-header-title-wrap">
          <div>
            <div class="grind-header-title" id="grindDisplayName">${escapeHtml(displayName)}</div>
            ${isRenamed ? `<div class="grind-header-subtitle">${escapeHtml(g.defaultName)}</div>` : ''}
          </div>
          <button class="rename-btn" id="renameBtn" title="Rename this grind">✎</button>
        </div>
        <div class="grind-header-meta">
          <div class="grind-meta-col"><span class="grind-meta-label">Grind status:</span><span class="cycle-flag">${escapeHtml(statusLabel)}</span></div>
          <div class="grind-meta-col"><span class="grind-meta-label">Platform:</span><span class="platform-tag">${escapeHtml(g.platform)}</span></div>
          <div class="grind-meta-col"><span class="grind-meta-label"><span class="lbl-desktop">Click/Ding on hotkey:</span><span class="lbl-mobile">Click/Ding on +/- buttons:</span></span><button class="toggle-switch ${g.buzzEnabled ? 'on' : ''}" id="buzzToggle" role="switch" aria-checked="${g.buzzEnabled ? 'true' : 'false'}" aria-label="Toggle click and ding feedback" data-hint="More advanced settings in the &quot;Settings&quot; section!"><span class="toggle-switch-knob"></span></button></div>
        </div>
      </div>
      <div id="renameArea" style="display:none;" class="rename-area">
        <input type="text" id="renameInput" maxlength="40" placeholder="Custom name (optional)" value="${escapeAttr(g.nickname||'')}">
        <button id="renameSaveBtn" class="rename-save-btn">Save</button>
        <button id="renameCancelBtn" class="rename-cancel-btn">Cancel</button>
      </div>
      ${buildCounterHTML(g)}

      <section class="log-action">
        ${!isNonGo ? `<button id="logGOBtn" class="go-btn">Log Great One</button>` : `<button id="logGOBtn" class="go-btn" style="background:var(--antler)">End Grind</button>`}
      </section>

      <div class="action-row">
        <button id="startNewBtn" class="secondary-btn">+ Start New Grind</button>
        <button id="selectOtherBtn" class="secondary-btn">Select Other (Open) Grind</button>
      </div>
    `;

    body.querySelectorAll('.ctrl-btn').forEach(btn => {
      let holdTimer = null;
      let repeatTimer = null;

      function applyDelta(){
        const active = getActiveGrind();
        if(!active) return;
        const target = btn.dataset.target;
        const delta = btn.classList.contains('plus') ? 1 : -1;
        active[target] = Math.max(0, (active[target] || 0) + delta);
        renderCounters(target);
        renderLiveStat();
        renderStats();
        if(active.status === 'completed'){ renderChart(); }
        markDirty();
        scheduleSave();
        // Phone-only: +/- taps also get the click/ding feedback (hotkeys already had this).
        // navigator.vibrate has no effect on iOS Safari/PWA (unsupported), but costs nothing
        // to attempt — it'll work automatically wherever the platform does support it.
        if(active.buzzEnabled && window.matchMedia('(max-width:640px)').matches){
          if(navigator.vibrate) navigator.vibrate(40);
          playHotkeySound();
        }
      }

      function startHold(){
        applyDelta();
        holdTimer = setTimeout(() => {
          repeatTimer = setInterval(applyDelta, 80);
        }, 750);
      }

      function stopHold(){
        clearTimeout(holdTimer);
        clearInterval(repeatTimer);
        holdTimer = null; repeatTimer = null;
      }

      btn.addEventListener('mousedown', (e) => { if(e.button === 0) startHold(); });
      btn.addEventListener('touchstart', (e) => { e.preventDefault(); startHold(); }, { passive: false });
      btn.addEventListener('mouseup', stopHold);
      btn.addEventListener('mouseleave', stopHold);
      btn.addEventListener('touchend', stopHold);
      btn.addEventListener('touchcancel', stopHold);
    });

    function mainAfterApply(bumpTarget){
      return () => {
        const active = getActiveGrind();
        renderCounters(bumpTarget);
        renderLiveStat();
        renderStats();
        if(active && active.status === 'completed'){ renderChart(); }
        markDirty(); scheduleSave();
      };
    }
    wireEditableCount(document.getElementById('diamondLvl3Count'), 'Diamond', getActiveGrind,
      gg => totalDiamond(gg), (gg,val) => { gg.diamondLvl3 = Math.max(0, val - (gg.diamondLvl2||0)); }, mainAfterApply('diamondLvl3'));
    wireEditableCount(document.getElementById('maxLevelCount'), 'Trolls', getActiveGrind,
      gg => gg.maxLevelOnly||0, (gg,val) => { gg.maxLevelOnly = val; }, mainAfterApply('maxLevelOnly'));
    wireEditableCount(document.getElementById('totalCount'), 'Total Kills', getActiveGrind,
      gg => totalKillsOf(gg), (gg,val) => { const dia = totalDiamond(gg); const troll = gg.maxLevelOnly||0; gg.other = Math.max(0, val - dia - troll); }, mainAfterApply('other'));
    wireEditableCount(document.getElementById('rareCount'), 'Rare Fur', getActiveGrind,
      gg => gg.rareCount||0, (gg,val) => { gg.rareCount = val; }, mainAfterApply('rareCount'));

    const logBtn = document.getElementById('logGOBtn');
    if(logBtn){
      if(isNonGo){
        logBtn.addEventListener('click', () => askConfirm('End this grind? It will be moved to the Grind Log.', logGreatOne));
      } else {
        logBtn.addEventListener('click', () => askConfirm('Log your Great One? This will close the grind and move it to the Grind Log.', logGreatOne));
      }
    }

    const rareToggleEl = document.getElementById('rareToggle');
    if(rareToggleEl){
      rareToggleEl.addEventListener('click', () => {
        const active = getActiveGrind();
        if(!active) return;
        active.rareTracking = !active.rareTracking;
        markDirty(); scheduleSave();
        renderCurrentPanel();
      });
    }

    const buzzToggleEl = document.getElementById('buzzToggle');
    if(buzzToggleEl){
      buzzToggleEl.addEventListener('click', () => {
        const active = getActiveGrind();
        if(!active) return;
        active.buzzEnabled = !active.buzzEnabled;
        markDirty(); scheduleSave();
        renderCurrentPanel();
      });
    }

    body.querySelectorAll('.kb-sync-btn').forEach(btn => {
      btn.addEventListener('click', () => openKeybindModal(btn.dataset.target, btn.dataset.label));
    });
    body.querySelectorAll('.kb-undo-btn').forEach(btn => {
      btn.addEventListener('click', () => confirmRemoveKeybind(btn.dataset.target, btn.dataset.label));
    });
    document.getElementById('startNewBtn').addEventListener('click', startWizard);
    document.getElementById('selectOtherBtn').addEventListener('click', () => { browsingOpenGrinds = true; renderCurrentPanel(); });

    const renameBtn = document.getElementById('renameBtn');
    const renameArea = document.getElementById('renameArea');
    const renameInput = document.getElementById('renameInput');
    const renameSaveBtn = document.getElementById('renameSaveBtn');
    const renameCancelBtn = document.getElementById('renameCancelBtn');
    if(renameBtn){
      renameBtn.addEventListener('click', () => { renameArea.style.display = renameArea.style.display === 'none' ? '' : 'none'; if(renameArea.style.display !== 'none') renameInput.focus(); });
      renameSaveBtn.addEventListener('click', () => {
        const active = getActiveGrind();
        if(active){ active.nickname = renameInput.value.trim(); markDirty(); scheduleSave(); renderCurrentPanel(); }
      });
      renameCancelBtn.addEventListener('click', () => { renameArea.style.display = 'none'; });
    }

    renderCounters();
  }

  function renderCounters(bumpTarget){
    const g = getActiveGrind();
    if(!g) return;

    const d3El = document.getElementById('diamondLvl3Count');
    const lEl = document.getElementById('maxLevelCount');
    const tEl = document.getElementById('totalCount');
    if(!d3El) return;
    // totalDiamond/totalKillsOf (not raw diamondLvl3) so legacy grinds with a
    // leftover diamondLvl2 value (from the old split-tier counter) still total correctly.
    const dia = totalDiamond(g);
    const tk = totalKillsOf(g);
    d3El.textContent = dia;
    if(lEl) lEl.textContent = g.maxLevelOnly||0;
    if(tEl) tEl.textContent = tk;
    const dBreak = document.getElementById('basicDiamondBreakdown');
    const tBreak = document.getElementById('basicTrollBreakdown');
    const totBreak = document.getElementById('basicTotalBreakdown');
    if(dBreak){ dBreak.textContent = `→ also adds to Total Kills`; dBreak.dataset.tip = dBreak.textContent; }
    if(tBreak){ tBreak.textContent = `→ also adds to Total Kills`; tBreak.dataset.tip = tBreak.textContent; }
    if(totBreak){ totBreak.textContent = `= ${dia} diamond + ${g.maxLevelOnly||0} troll + ${g.other||0} other`; totBreak.dataset.tip = totBreak.textContent; }
    const rareEl = document.getElementById('rareCount');
    if(rareEl) rareEl.textContent = g.rareCount || 0;
    if(bumpTarget){
      const bumpMap = { diamondLvl3:d3El, maxLevelOnly:lEl, other:tEl, rareCount:rareEl };
      const el = bumpMap[bumpTarget];
      if(el){ el.classList.remove('bump'); requestAnimationFrame(() => { el.classList.add('bump'); setTimeout(() => el.classList.remove('bump'), 150); }); }
    }
  }

  function renderStats(){
    const grid = document.getElementById('statsGrid');
    if(!grid) return;
    const all = grinds;
    const completed = completedGrindsList();

    const totalAll = all.length;
    const totalOpen = all.filter(g => g.status === 'open').length;
    const totalDone = completed.length;

    if(completed.length === 0 && all.length === 0){
      grid.innerHTML = `<div class="empty-note" style="grid-column:1 / -1;">No grinds yet. Start your first grind on the Current Grind tab.</div>`;
    } else {
      const n = completed.length || 1;
      const sumDiamond = completed.reduce((s,e)=>s+totalDiamond(e),0);
      const sumL = completed.reduce((s,e)=>s+totalMaxLevel(e),0);
      const sumT = completed.reduce((s,e)=>s+totalKillsOf(e),0);
      const sumRare = completed.reduce((s,e)=>s+(e.rareCount||0),0);
      // Avg kills/diamond, Avg kills/max-level, Total rares/diamonds/max-levels/kills track the
      // currently active grind live (in sync with the counter section) as long as it's still open —
      // everything else only reflects grinds that have actually been logged.
      const active = getActiveGrind();
      const liveExtra = (active && active.status === 'open') ? active : null;
      const sumDiamondLive = sumDiamond + (liveExtra ? totalDiamond(liveExtra) : 0);
      const sumLLive = sumL + (liveExtra ? totalMaxLevel(liveExtra) : 0);
      const sumTLive = sumT + (liveExtra ? totalKillsOf(liveExtra) : 0);
      const sumRareLive = sumRare + (liveExtra ? (liveExtra.rareCount||0) : 0);
      const hasLiveData = completed.length > 0 || !!liveExtra;
      grid.innerHTML = `
        <div class="stat-box" style="grid-column:1; grid-row:1;"><div class="stat-num">${totalAll}</div><div class="stat-lbl">Total grinds (all time)</div></div>
        ${hasLiveData ? `
        <div class="stat-box diamond3" style="grid-column:2; grid-row:1;"><div class="stat-num">${sumDiamondLive === 0 ? '—' : (sumTLive/sumDiamondLive).toFixed(2)}</div><div class="stat-lbl">Avg kills per diamond (all time)</div></div>
        <div class="stat-box antler" style="grid-column:3; grid-row:1;"><div class="stat-num">${sumLLive === 0 ? '—' : (sumTLive/sumLLive).toFixed(2)}</div><div class="stat-lbl">Avg kills per max-level (all time)</div></div>
        ` : ''}
        <div class="stat-box diamond3" style="grid-column:4; grid-row:1;"><div class="stat-num">${(sumDiamond/n).toFixed(1)}</div><div class="stat-lbl">Avg diamonds / grind</div></div>
        <div class="stat-box antler" style="grid-column:5; grid-row:1;"><div class="stat-num">${(sumL/n).toFixed(1)}</div><div class="stat-lbl">Avg max-level / grind</div></div>
        <div class="stat-box total" style="grid-column:6; grid-row:1;"><div class="stat-num">${(sumT/n).toFixed(1)}</div><div class="stat-lbl">Avg total kills / grind</div></div>
        <div class="stat-box" style="grid-column:1; grid-row:2;"><div class="stat-num">${totalOpen}</div><div class="stat-lbl">Open grinds</div></div>
        <div class="stat-box" style="grid-column:2; grid-row:2;"><div class="stat-num">${totalDone}</div><div class="stat-lbl">Logged grinds</div></div>
        ${hasLiveData ? `
        <div class="stat-box rare" style="grid-column:3; grid-row:2;"><div class="stat-num">${sumRareLive}</div><div class="stat-lbl">Total rares</div></div>
        <div class="stat-box diamond3" style="grid-column:4; grid-row:2;"><div class="stat-num">${sumDiamondLive}</div><div class="stat-lbl">Total diamonds (all time)</div></div>
        <div class="stat-box antler" style="grid-column:5; grid-row:2;"><div class="stat-num">${sumLLive}</div><div class="stat-lbl">Total max-levels (all time)</div></div>
        <div class="stat-box total" style="grid-column:6; grid-row:2;"><div class="stat-num">${sumTLive}</div><div class="stat-lbl">Total kills (all time)</div></div>
        ` : ''}
      `;
    }

    const speciesGrid = document.getElementById('speciesCountGrid');
    if(speciesGrid){
      const speciesMap = {};
      all.forEach(g => {
        const sp = grindSpeciesLabel(g);
        if(!speciesMap[sp]) speciesMap[sp] = { total:0, open:0, done:0 };
        speciesMap[sp].total++;
        if(g.status === 'open') speciesMap[sp].open++; else speciesMap[sp].done++;
      });
      const rows = Object.keys(speciesMap).sort().map(sp => {
        const s = speciesMap[sp];
        return `<tr><td>${escapeHtml(sp)}</td><td class="num">${s.total}</td><td class="num">${s.open}</td><td class="num">${s.done}</td></tr>`;
      }).join('');
      speciesGrid.innerHTML = rows.length ? `
        <div class="table-scroll">
          <table>
            <thead><tr><th>Species</th><th>Total</th><th>Open</th><th>Completed</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>` : `<div class="empty-note">No grinds yet.</div>`;
    }

    renderGrindComparison();
  }

  function renderGrindComparison(){
    const area = document.getElementById('grindCompareArea');
    if(!area) return;
    const completed = completedGrindsList().filter(g => g.species !== NON_GO);

    if(completed.length === 0){
      area.innerHTML = `<div class="empty-note">No completed grinds yet. Log at least one Great One to use this tool.</div>`;
      return;
    }

    // Platform is required and scopes everything below it — species/map choices are
    // built only from grinds logged on the selected platform.
    const platformList = [...new Set(completed.map(g => g.platform).filter(Boolean))].sort();
    const prevPlatform = area.dataset.selPlatform || '';
    const selPlatform = platformList.includes(prevPlatform) ? prevPlatform : platformList[0];
    const platformCompleted = completed.filter(g => g.platform === selPlatform);

    // Build species → maps mapping (scoped to the selected platform)
    const speciesMaps = {};
    platformCompleted.forEach(g => {
      const sp = grindSpeciesLabel(g);
      if(!speciesMaps[sp]) speciesMaps[sp] = new Set();
      speciesMaps[sp].add(g.map || '—');
    });
    const speciesList = Object.keys(speciesMaps).sort();

    // Preserve selections across re-renders
    const prevSpecies = area.dataset.selSpecies || '';
    const selSpecies = speciesList.includes(prevSpecies) ? prevSpecies : speciesList[0];
    const availMaps = [...speciesMaps[selSpecies]].sort();
    const prevMaps = (area.dataset.selMaps || '').split('|').filter(Boolean);
    const selMaps = prevMaps.filter(m => availMaps.includes(m));

    // Platform selector
    const platformOpts = platformList.map(p =>
      `<option value="${escapeAttr(p)}" ${p === selPlatform ? 'selected' : ''}>${escapeHtml(p)}</option>`
    ).join('');

    // Species selector
    const speciesOpts = speciesList.map(s =>
      `<option value="${escapeAttr(s)}" ${s === selSpecies ? 'selected' : ''}>${escapeHtml(s)}</option>`
    ).join('');

    // Map checkboxes (only maps with ≥1 completed grind for selected species on this platform)
    const mapChecks = availMaps.map(m => {
      const checked = selMaps.includes(m) ? 'checked' : '';
      return `<label class="compare-map-label"><input type="checkbox" class="compare-map-cb" value="${escapeAttr(m)}" ${checked}> ${escapeHtml(m)}</label>`;
    }).join('');

    area.innerHTML = `
      <div class="compare-controls">
        <div class="compare-row">
          <label class="compare-label">Platform</label>
          <select id="comparePlatformSel" class="compare-select">${platformOpts}</select>
        </div>
        <div class="compare-row">
          <label class="compare-label">Species</label>
          <select id="compareSpeciesSel" class="compare-select">${speciesOpts}</select>
        </div>
        <div class="compare-row">
          <label class="compare-label">Maps <span class="compare-hint">(select 2 or more)</span></label>
          <div class="compare-map-checks">${mapChecks}</div>
        </div>
      </div>
      <div id="compareChart"></div>
    `;

    function drawChart(){
      const chartEl = document.getElementById('compareChart');
      if(!chartEl) return;
      if(selMaps.length < 2){
        chartEl.innerHTML = `<div class="empty-note" style="margin-top:12px;">Select 2 or more maps to compare.</div>`;
        return;
      }

      // Compute averages per map
      const metrics = [
        { key:'diamond', label:'Avg kills / Diamond', color:'var(--diamond3)' },
        { key:'maxlevel', label:'Avg kills / Max-Level', color:'var(--antler)' },
        { key:'total', label:'Avg kills / GO Spawn', color:'var(--blaze)' },
      ];

      const mapData = selMaps.map(map => {
        const gs = platformCompleted.filter(g => grindSpeciesLabel(g) === selSpecies && (g.map||'—') === map);
        const n = gs.length || 1;
        const sumD = gs.reduce((s,g)=>s+totalDiamond(g),0);
        const sumL = gs.reduce((s,g)=>s+totalMaxLevel(g),0);
        const sumT = gs.reduce((s,g)=>s+totalKillsOf(g),0);
        return {
          map,
          grinds: gs.length,
          diamond: sumD===0 ? 0 : sumT/sumD,
          maxlevel: sumL===0 ? 0 : sumT/sumL,
          total: sumT/n,
        };
      });

      // SVG grouped bar chart
      const numMaps = selMaps.length;
      const numMetrics = metrics.length;
      const barW = Math.max(16, Math.min(34, Math.floor(180 / Math.max(numMaps, 1))));
      const barGap = 5;
      const groupGap = 36;
      const groupW = numMaps * barW + (numMaps-1) * barGap;
      const topPad = 22;
      const labelH = 44;
      const chartH = 260 + topPad;
      const totalW = Math.max(480, numMetrics * (groupW + groupGap) + 60);
      const allVals = mapData.flatMap(d => metrics.map(m => d[m.key]));
      const maxVal = Math.max(1, ...allVals);

      // Map colors
      const mapColors = ['var(--diamond3)','var(--antler)','var(--blaze)','var(--weight)','#7ec8a4','#a78bfa','#f472b6','#38bdf8'];

      let bars = '';
      metrics.forEach((metric, mi) => {
        const groupX = 20 + mi * (groupW + groupGap);
        mapData.forEach((d, di) => {
          const val = d[metric.key];
          const h = Math.max(2, (val / maxVal) * (chartH - labelH - topPad - 10));
          const bx = groupX + di * (barW + barGap);
          const by = chartH - labelH - h;
          bars += `<rect x="${bx}" y="${by}" width="${barW}" height="${h}" fill="${mapColors[di]}" rx="2" opacity="0.88"></rect>`;
          bars += `<text x="${bx + barW/2}" y="${by - 5}" font-size="10" fill="${mapColors[di]}" text-anchor="middle" font-family="Nunito,sans-serif">${val === 0 ? '—' : val.toFixed(1)}</text>`;
        });
        // Group label
        const labelX = groupX + groupW / 2;
        const words = metric.label.split(' / ');
        bars += `<text x="${labelX}" y="${chartH - labelH + 15}" font-size="10.5" fill="var(--muted)" text-anchor="middle" font-family="Nunito,sans-serif">${escapeHtml(words[0])}</text>`;
        bars += `<text x="${labelX}" y="${chartH - labelH + 29}" font-size="10.5" fill="var(--muted)" text-anchor="middle" font-family="Nunito,sans-serif">${escapeHtml('/ ' + (words[1]||''))}</text>`;
      });

      // Legend
      const legend = selMaps.map((m, i) =>
        `<span><span class="swatch" style="background:${mapColors[i]}"></span>${escapeHtml(m)}</span>`
      ).join('');

      // Grind count note
      const countNote = mapData.map(d => `${escapeHtml(d.map)}: ${d.grinds} grind${d.grinds!==1?'s':''}`).join(' · ');

      const viewportH = 300;

      chartEl.innerHTML = `
        <div style="margin-top:14px;">
          <div class="compare-zoom-controls">
            <button class="compare-zoom-btn" id="czoomOut">−</button>
            <span class="compare-zoom-label" id="czoomLabel">100%</span>
            <button class="compare-zoom-btn" id="czoomIn">+</button>
            <button class="compare-zoom-btn compare-zoom-reset" id="czoomFit">Fit</button>
          </div>
          <div class="compare-pan-viewport" id="cViewport" style="height:${viewportH}px;">
            <div class="compare-pan-inner" id="cInner">
              <svg id="cSvg" viewBox="0 0 ${totalW} ${chartH}" width="${totalW}" height="${chartH}" style="display:block;">${bars}</svg>
            </div>
          </div>
          <div class="legend" style="margin-top:8px;">${legend}</div>
          <div class="compare-count-note">${countNote}</div>
        </div>
      `;

      // Zoom/pan state
      const inner = document.getElementById('cInner');
      const viewport = document.getElementById('cViewport');
      const label = document.getElementById('czoomLabel');

      // Fit scale: shrink so entire chart fits in both dimensions. Uses the pan
      // viewport's real measured width, not a guessed/capped estimate — previously this
      // was capped at a guessed 680px even when the real column was wider (e.g. on large
      // monitors), so the chart rendered smaller than necessary and "Fit"/centering were
      // computed against two different widths.
      const containerW = viewport.clientWidth || Math.min(680, window.innerWidth - 48);
      const fitScaleX = Math.min(1, containerW / totalW);
      const fitScaleY = Math.min(1, (viewportH - 12) / chartH);
      const fitScale = Math.min(fitScaleX, fitScaleY);

      let scale = fitScale;
      let panX = 0, panY = 0;

      function applyTransform(){
        const scaledW = totalW * scale;
        const scaledH = chartH * scale;
        const vpW = viewport.clientWidth || containerW;
        const vpH = viewport.clientHeight || viewportH;
        // Allow panning up to one full viewport past each edge so edges can be centered
        const overX = Math.max(0, scaledW - vpW);
        const overY = Math.max(0, scaledH - vpH);
        panX = Math.max(-(overX + vpW * 0.5), Math.min(vpW * 0.5, panX));
        panY = Math.max(-(overY + vpH * 0.5), Math.min(vpH * 0.5, panY));
        inner.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
        inner.style.transformOrigin = 'top left';
        label.textContent = Math.round(scale * 100) + '%';
      }

      // Center the chart in the viewport instead of anchoring it to the top-left corner
      // (previously panX/panY defaulted to 0, which left the chart pinned top-left with
      // empty space on the right/bottom any time it was smaller than the viewport).
      function centerContent(){
        const scaledW = totalW * scale;
        const scaledH = chartH * scale;
        const vpW = viewport.clientWidth || containerW;
        const vpH = viewport.clientHeight || viewportH;
        panX = (vpW - scaledW) / 2;
        panY = (vpH - scaledH) / 2;
      }

      centerContent();
      applyTransform();

      document.getElementById('czoomIn').addEventListener('click', () => {
        scale = Math.min(3, scale + 0.15);
        applyTransform();
      });
      document.getElementById('czoomOut').addEventListener('click', () => {
        scale = Math.max(0.1, scale - 0.15);
        applyTransform();
      });
      document.getElementById('czoomFit').addEventListener('click', () => {
        scale = fitScale;
        centerContent();
        applyTransform();
      });

      // Click-drag pan (X and Y)
      let dragging = false, dragStartX = 0, dragStartY = 0, panStartX = 0, panStartY = 0;
      viewport.addEventListener('mousedown', e => {
        dragging = true;
        dragStartX = e.clientX; dragStartY = e.clientY;
        panStartX = panX; panStartY = panY;
        viewport.style.cursor = 'grabbing';
        e.preventDefault();
      });
      window.addEventListener('mousemove', e => {
        if(!dragging) return;
        panX = panStartX + (e.clientX - dragStartX);
        panY = panStartY + (e.clientY - dragStartY);
        applyTransform();
      });
      window.addEventListener('mouseup', () => {
        dragging = false;
        viewport.style.cursor = 'grab';
      });

      // Touch pan (one finger) + pinch-to-zoom (two fingers). touchmove is non-passive so
      // we can preventDefault() while a touch is active on the viewport — otherwise the
      // whole page scrolls along underneath the chart while dragging it, instead of just
      // the chart itself moving.
      let touchStartX = 0, touchStartY = 0, touchPanStartX = 0, touchPanStartY = 0;
      let pinchStartDist = 0, pinchStartScale = 1, pinchStartPanX = 0, pinchStartPanY = 0, pinchMidX = 0, pinchMidY = 0;

      function touchDist(touches){
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.hypot(dx, dy);
      }

      viewport.addEventListener('touchstart', e => {
        if(e.touches.length === 2){
          pinchStartDist = touchDist(e.touches);
          pinchStartScale = scale;
          pinchStartPanX = panX; pinchStartPanY = panY;
          const rect = viewport.getBoundingClientRect();
          pinchMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
          pinchMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
        } else if(e.touches.length === 1){
          touchStartX = e.touches[0].clientX;
          touchStartY = e.touches[0].clientY;
          touchPanStartX = panX;
          touchPanStartY = panY;
        }
      }, { passive: true });

      viewport.addEventListener('touchmove', e => {
        if(e.touches.length === 2){
          e.preventDefault();
          const dist = touchDist(e.touches);
          const ratio = dist / (pinchStartDist || 1);
          const newScale = Math.max(0.1, Math.min(3, pinchStartScale * ratio));
          // Keep the point under the fingers stationary as the scale changes, so the
          // pinch feels anchored to where your fingers are instead of the viewport center.
          const contentX = (pinchMidX - pinchStartPanX) / pinchStartScale;
          const contentY = (pinchMidY - pinchStartPanY) / pinchStartScale;
          scale = newScale;
          panX = pinchMidX - contentX * newScale;
          panY = pinchMidY - contentY * newScale;
          applyTransform();
        } else if(e.touches.length === 1){
          e.preventDefault();
          panX = touchPanStartX + (e.touches[0].clientX - touchStartX);
          panY = touchPanStartY + (e.touches[0].clientY - touchStartY);
          applyTransform();
        }
      }, { passive: false });
    }

    drawChart();

    // Platform change resets species + map selections underneath it, since both are
    // scoped to whichever platform is selected.
    document.getElementById('comparePlatformSel').addEventListener('change', function(){
      area.dataset.selPlatform = this.value;
      area.dataset.selSpecies = '';
      area.dataset.selMaps = '';
      renderGrindComparison();
    });

    // Species change
    document.getElementById('compareSpeciesSel').addEventListener('change', function(){
      area.dataset.selSpecies = this.value;
      area.dataset.selMaps = '';
      renderGrindComparison();
    });

    // Map checkbox changes
    area.querySelectorAll('.compare-map-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        const checked = [...area.querySelectorAll('.compare-map-cb:checked')].map(c => c.value);
        area.dataset.selSpecies = selSpecies;
        area.dataset.selMaps = checked.join('|');
        selMaps.length = 0;
        checked.forEach(m => selMaps.push(m));
        drawChart();
      });
    });
  }

  function renderChart(){
    const area = document.getElementById('chartArea');
    if(!area) return;
    const allCompleted = completedGrindsList();
    if(allCompleted.length === 0){
      area.innerHTML = `<div class="empty-note">Your trend chart will appear here once you've logged at least one grind.</div>`;
      return;
    }

    const speciesSet = [...new Set(allCompleted.map(g => grindSpeciesLabel(g)))].sort();
    const mapSet = [...new Set(allCompleted.map(g => g.map).filter(Boolean))].sort();
    const platformSet = [...new Set(allCompleted.map(g => g.platform).filter(Boolean))].sort();

    const prevSpecies = area.dataset.trendSpecies || '';
    const prevMap = area.dataset.trendMap || '';
    const prevPlatform = area.dataset.trendPlatform || '';
    const selSpecies = speciesSet.includes(prevSpecies) ? prevSpecies : '';
    const selMap = mapSet.includes(prevMap) ? prevMap : '';
    const selPlatform = platformSet.includes(prevPlatform) ? prevPlatform : '';

    const speciesOpts = `<option value="">All species</option>` + speciesSet.map(s =>
      `<option value="${escapeAttr(s)}" ${s === selSpecies ? 'selected' : ''}>${escapeHtml(s)}</option>`
    ).join('');
    const mapOpts = `<option value="">All maps</option>` + mapSet.map(m =>
      `<option value="${escapeAttr(m)}" ${m === selMap ? 'selected' : ''}>${escapeHtml(m)}</option>`
    ).join('');
    const platformOpts = `<option value="">All platforms</option>` + platformSet.map(p =>
      `<option value="${escapeAttr(p)}" ${p === selPlatform ? 'selected' : ''}>${escapeHtml(p)}</option>`
    ).join('');

    area.innerHTML = `
      <div class="compare-controls" style="margin-bottom:14px;">
        <div class="compare-row">
          <label class="compare-label">Species</label>
          <select id="trendSpeciesSel" class="compare-select">${speciesOpts}</select>
        </div>
        <div class="compare-row">
          <label class="compare-label">Map</label>
          <select id="trendMapSel" class="compare-select">${mapOpts}</select>
        </div>
        <div class="compare-row">
          <label class="compare-label">Platform</label>
          <select id="trendPlatformSel" class="compare-select">${platformOpts}</select>
        </div>
      </div>
      <div id="trendChartArea"></div>
    `;

    function draw(){
      const chartEl = document.getElementById('trendChartArea');
      if(!chartEl) return;

      const completed = allCompleted
        .filter(g =>
          (!selSpecies || grindSpeciesLabel(g) === selSpecies) &&
          (!selMap || g.map === selMap) &&
          (!selPlatform || g.platform === selPlatform)
        )
        .slice()
        .sort((a,b) => new Date(a.loggedAt) - new Date(b.loggedAt));

      if(completed.length === 0){
        chartEl.innerHTML = `<div class="empty-note">No logged grinds match this filter.</div>`;
        return;
      }

      const n = completed.length;
      const vals = completed.flatMap(e => [totalDiamond(e), totalMaxLevel(e), totalKillsOf(e)]);
      const maxVal = Math.max(1, ...vals);
      const barW=8, gap=3, groupGap=20;
      const groupW = barW*3 + gap*2;
      const plotH = 132;
      const labelH = 24;
      const chartH = plotH + labelH;
      const totalW = Math.max(340, n*(groupW+groupGap) + 20);
      let bars = '';
      completed.forEach((e,i) => {
        const dia=totalDiamond(e), l=totalMaxLevel(e), tk=totalKillsOf(e);
        const x = i*(groupW+groupGap)+14;
        const series = [
          {v:dia, color:'var(--diamond3)', label:'Diamonds'},
          {v:l,   color:'var(--antler)',   label:'Max-Level'},
          {v:tk,  color:'var(--total)',    label:'Total Kills'}
        ];
        series.forEach((s, si) => {
          const h = (s.v/maxVal)*(plotH-20);
          const bx = x + si*(barW+gap);
          bars += `<rect x="${bx}" y="${plotH-h}" width="${barW}" height="${h}" fill="${s.color}" rx="2" data-tip="${escapeAttr(s.label)}: ${s.v}"></rect>`;
          bars += `<text x="${bx+barW/2}" y="${plotH-h-3}" font-size="7" fill="${s.color}" text-anchor="middle" font-family="Nunito" data-tip="${escapeAttr(s.label)}: ${s.v}">${s.v}</text>`;
        });
        const rawName = e.nickname || e.defaultName || grindSpeciesLabel(e);
        const labelX = x + groupW/2;
        const labelY = plotH + 15;
        bars += `<text x="${labelX}" y="${labelY}" font-size="9.5" fill="var(--muted)" text-anchor="middle" font-family="Nunito" data-tip="${escapeAttr(rawName)}">#${i+1}</text>`;
      });
      chartEl.innerHTML = `
        <div class="chart-scroll">
          <svg viewBox="0 0 ${totalW} ${chartH}" width="${totalW}" height="${chartH}" style="display:block; min-width:${totalW}px;">${bars}</svg>
          <div class="legend">
            <span><span class="swatch diamond3"></span>Diamonds</span>
            <span><span class="swatch antler"></span>Max-Level</span>
            <span><span class="swatch total"></span>Total Kills</span>
          </div>
        </div>
        <div class="chart-tooltip" id="trendTooltip"></div>
      `;

      const tooltip = document.getElementById('trendTooltip');
      chartEl.querySelectorAll('[data-tip]').forEach(el => {
        el.style.cursor = 'default';
        el.addEventListener('mouseenter', () => {
          tooltip.textContent = el.getAttribute('data-tip');
          tooltip.style.display = 'block';
        });
        el.addEventListener('mousemove', (ev) => {
          tooltip.style.left = (ev.clientX + 12) + 'px';
          tooltip.style.top = (ev.clientY + 12) + 'px';
        });
        el.addEventListener('mouseleave', () => {
          tooltip.style.display = 'none';
        });
      });
    }

    draw();

    document.getElementById('trendSpeciesSel').addEventListener('change', function(){
      area.dataset.trendSpecies = this.value;
      renderChart();
    });
    document.getElementById('trendMapSel').addEventListener('change', function(){
      area.dataset.trendMap = this.value;
      renderChart();
    });
    document.getElementById('trendPlatformSel').addEventListener('change', function(){
      area.dataset.trendPlatform = this.value;
      renderChart();
    });
  }


  function renderHistory(){ /* no-op — Previous Grinds tab removed */ }

  function formatDate(iso){ const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' }); }
  function escapeHtml(str){ const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
  function escapeAttr(str){ return String(str).replace(/"/g, '&quot;'); }
  function clampInt(v){ const n = parseInt(v,10); return isNaN(n)||n<0 ? 0 : n; }

  function exportData(){
    const count = grinds.length;
    askConfirm(`This will download a backup file containing all ${count} of your current grind${count!==1?'s':''} (open and logged), plus your keyboard sync bindings, custom species/maps, and other settings. Save it somewhere safe — you can use it to restore your data or move it to another browser/device.`, () => {
      const payload = {
        exportedAt: new Date().toISOString(),
        grinds, activeGrindId,
        keybinds,
        settings: { twoStepDelete, buzzDefaultOn, rareDefaultOn, hotkeySound },
        customDefaults: loadCustomDefaults()
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `great-one-grind-log-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      hasUnsavedChanges = false;
      if(!storageAvailable) setSyncStatus('unavailable');
      const msg = document.getElementById('importMsg');
      if(msg){ msg.textContent = 'Backup downloaded.'; setTimeout(() => { if(msg.textContent === 'Backup downloaded.') msg.textContent=''; }, 4000); }
    });
  }

  function exportCsv(){
    const completed = grinds.filter(g => g.loggedAt);
    const cols = ['Name','Species','Map','Platform','Diamonds','Max-Level','Total Kills','Avg Kills/Diamond','Rare Furs','Date Logged'];
    const escape = v => `"${String(v ?? '').replace(/"/g,'""')}"`;
    const rows = completed.map(g => {
      const dia = totalDiamond(g);
      const tk  = totalKillsOf(g);
      return [
        autoNameForGrind(g.species, g.map, g.grindNumber, g.unlistedName),
        grindSpeciesLabel(g),
        g.map || '',
        g.platform || '',
        dia, totalMaxLevel(g), tk,
        dia > 0 ? (tk / dia).toFixed(2) : '—',
        g.rareCount || 0,
        g.loggedAt ? new Date(g.loggedAt).toLocaleDateString() : ''
      ].map(escape).join(',');
    });
    const csv = [cols.map(escape).join(','), ...rows].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `great-one-grind-log-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    const msg = document.getElementById('importMsg');
    if(msg){ msg.textContent = 'CSV downloaded.'; setTimeout(() => { if(msg.textContent==='CSV downloaded.') msg.textContent=''; }, 4000); }
  }

  // ---------- Shareable Image Cards ----------
  const SHARE_SITE_URL = 'greatonegrindlog.netlify.app';

  function slugify(str){
    return String(str).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'') || 'grind';
  }

  function roundRect(ctx, x, y, w, h, r){
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.arcTo(x+w, y, x+w, y+h, r);
    ctx.arcTo(x+w, y+h, x, y+h, r);
    ctx.arcTo(x, y+h, x, y, r);
    ctx.arcTo(x, y, x+w, y, r);
    ctx.closePath();
  }

  function getThemeColors(){
    const appEl = document.querySelector('.app');
    const cs = appEl ? getComputedStyle(appEl) : null;
    const v = (name, fallback) => {
      const val = cs ? cs.getPropertyValue(name).trim() : '';
      return val || fallback;
    };
    return {
      bg: v('--bg', '#121c16'),
      bg2: v('--bg2', '#0e1611'),
      panel: v('--panel', '#1b2a21'),
      line: v('--line', '#33453a'),
      text: v('--text', '#e9e4d6'),
      muted: v('--muted', '#8fa089'),
      diamond3: v('--diamond3', '#9fd9e8'),
      antler: v('--antler', '#c9a14a'),
      total: v('--total', '#9aa7b0'),
      blaze: v('--blaze', '#e8612c'),
      rare: v('--rare', '#c47fc4'),
    };
  }

  function drawShareCard({ title, subtitle, badge, sections, footer }, theme, opts){
    const cols = (opts && opts.cols) || 2;
    const W = 900, DPR = 2, gap = 24, rowH = 96;
    const headerH = 130;
    const sectionLabelH = 30;
    const sectionGap = 10;
    const footerH = 50;

    const activeSections = sections.filter(s => s.stats && s.stats.length > 0);
    let gridH = 0;
    activeSections.forEach(sec => {
      const rows = Math.ceil(sec.stats.length / cols);
      gridH += (sec.label ? sectionLabelH : 0) + rows * rowH + sectionGap;
    });
    gridH = Math.max(0, gridH - sectionGap);
    const H = headerH + gridH + footerH;

    const canvas = document.createElement('canvas');
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    const ctx = canvas.getContext('2d');
    ctx.scale(DPR, DPR);

    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, theme.bg);
    grad.addColorStop(1, theme.bg2);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = theme.antler;
    ctx.lineWidth = 3;
    ctx.strokeRect(5, 5, W - 10, H - 10);

    ctx.fillStyle = theme.text;
    ctx.font = "700 32px Merriweather, serif";
    ctx.fillText(title, 32, 56);

    if(badge){
      ctx.font = "700 14px Nunito, sans-serif";
      const bw = ctx.measureText(badge).width + 24;
      ctx.fillStyle = theme.blaze;
      roundRect(ctx, W - 32 - bw, 28, bw, 30, 15);
      ctx.fill();
      ctx.fillStyle = theme.bg;
      ctx.fillText(badge, W - 32 - bw + 12, 49);
    }

    ctx.fillStyle = theme.muted;
    ctx.font = "600 16px Nunito, sans-serif";
    ctx.fillText(subtitle, 32, 84);

    ctx.fillStyle = theme.antler;
    ctx.fillRect(32, headerH - 20, W - 64, 2);

    const colW = (W - 64 - gap * (cols - 1)) / cols;
    let gy = headerH;
    activeSections.forEach(sec => {
      if(sec.label){
        ctx.fillStyle = theme.antler;
        ctx.font = "800 13px Nunito, sans-serif";
        ctx.fillText(sec.label.toUpperCase(), 32, gy + 13);
        gy += sectionLabelH;
      }
      sec.stats.forEach((s, i) => {
        const col = i % cols, row = Math.floor(i / cols);
        const x = 32 + col * (colW + gap);
        const y = gy + row * rowH;
        const boxH = rowH - 16;

        ctx.fillStyle = theme.panel;
        roundRect(ctx, x, y, colW, boxH, 10);
        ctx.fill();
        ctx.strokeStyle = theme.line;
        ctx.lineWidth = 1;
        roundRect(ctx, x, y, colW, boxH, 10);
        ctx.stroke();

        ctx.fillStyle = s.color || theme.antler;
        roundRect(ctx, x, y, colW, 4, 2);
        ctx.fill();

        ctx.fillStyle = s.color || theme.text;
        ctx.font = "900 28px Nunito, sans-serif";
        ctx.fillText(String(s.value), x + 16, y + 44);

        ctx.fillStyle = theme.muted;
        ctx.font = "600 12px Nunito, sans-serif";
        ctx.fillText(s.label.toUpperCase(), x + 16, y + 64);
      });
      const rows = Math.ceil(sec.stats.length / cols);
      gy += rows * rowH + sectionGap;
    });

    ctx.fillStyle = theme.muted;
    ctx.font = "500 13px Nunito, sans-serif";
    ctx.fillText(footer, 32, H - 20);
    const urlText = '🏆 ' + SHARE_SITE_URL;
    ctx.font = "700 13px Nunito, sans-serif";
    const urlW = ctx.measureText(urlText).width;
    ctx.fillStyle = theme.antler;
    ctx.fillText(urlText, W - 32 - urlW, H - 20);

    return canvas;
  }

  function triggerBlobDownload(blob, filename){
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadCanvasPNG(canvas, filename){
    canvas.toBlob(blob => { if(blob) triggerBlobDownload(blob, filename); }, 'image/png');
  }

  function exportShareCard(canvas, filename, shareTitle, shareText){
    canvas.toBlob(async (blob) => {
      if(!blob) return;
      let file = null;
      try{ file = new File([blob], filename, { type: 'image/png' }); }catch(e){}
      if(file && navigator.canShare && navigator.canShare({ files: [file] })){
        try{
          await navigator.share({ files: [file], title: shareTitle, text: shareText });
          return;
        }catch(err){
          if(err && err.name === 'AbortError') return;
        }
      }
      triggerBlobDownload(blob, filename);
    }, 'image/png');
  }

  function buildGrindShareCanvas(g){
    const theme = getThemeColors();
    const isNonGo = g.species === NON_GO;
    const displayName = g.nickname || g.defaultName || (isNonGo ? NON_GO : `${g.species} — ${g.map}`);
    const subtitle = (isNonGo ? NON_GO : `${g.species} — ${g.map}`) + (g.platform ? ` · ${g.platform}` : '') + (g.cycle ? ` · #${g.cycle}` : '');
    const dia = totalDiamond(g), tk = totalKillsOf(g);
    const t = g.trophy || {};
    const stats = [
      { label:'Diamond', value: dia, color: theme.diamond3 },
      { label:'Trolls', value: g.maxLevelOnly||0, color: theme.antler },
      { label:'Total Kills', value: tk, color: theme.total },
      { label:'Avg Kills / Diamond', value: dia === 0 ? '—' : (tk/dia).toFixed(2), color: theme.blaze },
    ];
    if(g.rareTracking && g.rareCount) stats.push({ label:'Rare Fur', value: g.rareCount, color: theme.rare });
    const canvas = drawShareCard({
      title: displayName,
      subtitle,
      badge: t.outcome || null,
      sections: [ { label: null, stats } ],
      footer: `Logged ${formatDate(g.loggedAt)}`,
    }, theme, { cols: 2 });
    return {
      canvas,
      filename: `${slugify(displayName)}-grind-card.png`,
      shareTitle: `${displayName} — Great One Grind`,
      shareText: `My Great One grind: ${displayName} — ${tk} total kills, ${dia} diamond.`,
    };
  }

  function shareSingleGrind(id){
    const g = grinds.find(x => x.id === id);
    if(!g) return;
    const { canvas, filename, shareTitle, shareText } = buildGrindShareCanvas(g);
    exportShareCard(canvas, filename, shareTitle, shareText);
  }

  function downloadSingleGrind(id){
    const g = grinds.find(x => x.id === id);
    if(!g) return;
    const { canvas, filename } = buildGrindShareCanvas(g);
    downloadCanvasPNG(canvas, filename);
  }

  function buildOverviewShareCanvas(){
    const theme = getThemeColors();
    const all = grinds;
    const completed = completedGrindsList();
    const totalAll = all.length;
    const totalOpen = all.filter(g => g.status === 'open').length;
    const totalDone = completed.length;
    const n = completed.length || 1;
    const sumDiamond = completed.reduce((s,e)=>s+totalDiamond(e),0);
    const sumL = completed.reduce((s,e)=>s+totalMaxLevel(e),0);
    const sumT = completed.reduce((s,e)=>s+totalKillsOf(e),0);
    const sumRare = completed.reduce((s,e)=>s+(e.rareCount||0),0);
    // Mirrors renderStats(): averages/totals include the live active grind (if still open)
    // so the shared/downloaded card matches what's on screen.
    const active = getActiveGrind();
    const liveExtra = (active && active.status === 'open') ? active : null;
    const sumDiamondLive = sumDiamond + (liveExtra ? totalDiamond(liveExtra) : 0);
    const sumLLive = sumL + (liveExtra ? totalMaxLevel(liveExtra) : 0);
    const sumTLive = sumT + (liveExtra ? totalKillsOf(liveExtra) : 0);
    const sumRareLive = sumRare + (liveExtra ? (liveExtra.rareCount||0) : 0);
    const hasLiveData = completed.length > 0 || !!liveExtra;

    const countStats = [
      { label:'Total Grinds (all time)', value: totalAll, color: theme.text },
      { label:'Open Grinds', value: totalOpen, color: theme.text },
      { label:'Logged Grinds', value: totalDone, color: theme.text },
    ];

    // Ordered so a 3-col grid lands diamond items in the left column, max-level items in
    // the middle column, and kills items in the right column (rares fall to the next row's
    // leftmost slot instead of getting their own column).
    const avgStats = [];
    if(hasLiveData){
      avgStats.push(
        { label:'Avg Kills / Diamond (all time)', value: sumDiamondLive === 0 ? '—' : (sumTLive/sumDiamondLive).toFixed(2), color: theme.diamond3 },
        { label:'Avg Kills / Max-Level (all time)', value: sumLLive === 0 ? '—' : (sumTLive/sumLLive).toFixed(2), color: theme.antler }
      );
    }
    if(completed.length > 0){
      avgStats.push(
        { label:'Avg Total Kills / Grind', value: (sumT/n).toFixed(1), color: theme.total },
        { label:'Avg Diamonds / Grind', value: (sumDiamond/n).toFixed(1), color: theme.diamond3 },
        { label:'Avg Max-Level / Grind', value: (sumL/n).toFixed(1), color: theme.antler }
      );
    }

    const totalStats = [];
    if(hasLiveData){
      totalStats.push(
        { label:'Total Diamonds (all time)', value: sumDiamondLive, color: theme.diamond3 },
        { label:'Total Max-Levels (all time)', value: sumLLive, color: theme.antler },
        { label:'Total Kills (all time)', value: sumTLive, color: theme.total },
        { label:'Total Rares', value: sumRareLive, color: theme.rare }
      );
    }

    const canvas = drawShareCard({
      title: 'My Great One Grind Overview',
      subtitle: 'All-time stats across every logged grind',
      badge: null,
      sections: [
        { label: 'Grind Counts', stats: countStats },
        { label: 'Averages', stats: avgStats },
        { label: 'All-Time Totals', stats: totalStats },
      ],
      footer: `Generated ${formatDate(new Date().toISOString())}`,
    }, theme, { cols: 3 });
    return {
      canvas,
      filename: 'great-one-grind-overview.png',
      shareTitle: 'My Great One Grind Overview',
      shareText: `${totalDone} Great Ones logged, ${sumTLive} total kills all-time.`,
    };
  }

  function shareOverview(){
    const { canvas, filename, shareTitle, shareText } = buildOverviewShareCanvas();
    exportShareCard(canvas, filename, shareTitle, shareText);
  }

  function downloadOverview(){
    const { canvas, filename } = buildOverviewShareCanvas();
    downloadCanvasPNG(canvas, filename);
  }

  function mergeIncomingGrinds(incomingGrinds){
    const existingIds = new Set(grinds.map(g => g.id));
    const toAdd = incomingGrinds.filter(g => !existingIds.has(g.id));
    grinds = grinds.concat(toAdd);
    renumberDefaultNames();
    return toAdd.length;
  }

  function mergeCustomDefaults(incomingCustom){
    if(!incomingCustom) return 0;
    const current = loadCustomDefaults();
    let added = 0;
    const speciesNames = new Set(current.species.map(s => s.name));
    (incomingCustom.species||[]).forEach(s => {
      const entry = typeof s === 'string' ? {name:s, maxLevel:3} : s;
      if(entry && entry.name && !speciesNames.has(entry.name)){
        current.species.push(entry); speciesNames.add(entry.name); added++;
      }
    });
    const mapNames = new Set(current.maps);
    (incomingCustom.maps||[]).forEach(m => {
      if(m && !mapNames.has(m)){ current.maps.push(m); mapNames.add(m); added++; }
    });
    if(added > 0) saveCustomDefaults(current);
    return added;
  }

  function mergeKeybinds(incomingKeybinds){
    if(!incomingKeybinds) return 0;
    let added = 0;
    Object.entries(incomingKeybinds).forEach(([target, key]) => {
      if(!VALID_KEYBIND_TARGETS.includes(target)) return;
      if(!keybinds[target]){ keybinds[target] = key; added++; }
    });
    if(added > 0) saveKeybinds();
    return added;
  }

  function showImportChoiceModal(currentCount, incomingCount, onMerge, onOverwrite){
    const modal = document.getElementById('confirmModal');
    const box = modal.querySelector('.modal-actions');
    const textEl = document.getElementById('modalText');
    textEl.textContent = `You have ${currentCount} grind${currentCount!==1?'s':''} saved; this file has ${incomingCount}. Double-check this is the right file and the action you actually want — it can't be undone. Merge (recommended) adds what's new (grinds, custom species/maps, keybinds) without touching anything you already have. Overwrite replaces everything — grinds, keybinds, custom options, and settings — with this file's contents.`;
    box.style.flexWrap = 'wrap';
    box.innerHTML = '<button id="importCancelBtn">Cancel</button><button id="importOverwriteBtn" class="confirm-danger">Overwrite</button><button id="importMergeBtn" class="confirm-merge">Merge</button>';
    modal.classList.remove('hidden');

    document.getElementById('importCancelBtn').addEventListener('click', () => {
      modal.classList.add('hidden');
      box.style.flexWrap = '';
      restoreConfirmModal();
    });
    document.getElementById('importOverwriteBtn').addEventListener('click', () => {
      modal.classList.add('hidden');
      box.style.flexWrap = '';
      restoreConfirmModal();
      onOverwrite();
    });
    document.getElementById('importMergeBtn').addEventListener('click', () => {
      modal.classList.add('hidden');
      box.style.flexWrap = '';
      restoreConfirmModal();
      onMerge();
    });
  }

  function importData(file){
    const reader = new FileReader();
    reader.onload = () => {
      const msg = document.getElementById('importMsg');
      try{
        const parsed = JSON.parse(reader.result);
        let incoming;
        if(Array.isArray(parsed.grinds)){
          incoming = { grinds: parsed.grinds.map(normalizeGrind), activeGrindId: parsed.activeGrindId || null };
        } else if(Array.isArray(parsed.history)){
          incoming = migrateOldShape(parsed);
        } else {
          if(msg) msg.textContent = "That file doesn't look like a valid backup.";
          return;
        }
        const incomingKeybinds = (parsed.keybinds && typeof parsed.keybinds === 'object') ? parsed.keybinds : null;
        const incomingSettings = (parsed.settings && typeof parsed.settings === 'object') ? parsed.settings : null;
        const incomingCustomDefaults = (parsed.customDefaults && typeof parsed.customDefaults === 'object') ? parsed.customDefaults : null;

        showImportChoiceModal(grinds.length, incoming.grinds.length,
          async () => {
            const added = mergeIncomingGrinds(incoming.grinds);
            const addedCustom = mergeCustomDefaults(incomingCustomDefaults);
            const addedKeys = mergeKeybinds(incomingKeybinds);
            markDirty();
            await saveNow();
            renderCurrentPanel(); renderStats(); renderChart(); renderLiveStat();
            const extras = (addedCustom || addedKeys) ? ', plus custom options/keybinds' : '';
            if(msg) msg.textContent = `Merged — added ${added} new grind${added!==1?'s':''}${extras}.`;
          },
          async () => {
            grinds = incoming.grinds;
            activeGrindId = incoming.activeGrindId;
            returnToGrindId = null; browsingOpenGrinds = false; editingId = null;
            if(incomingKeybinds){
              keybinds = {};
              Object.entries(incomingKeybinds).forEach(([target, key]) => {
                if(VALID_KEYBIND_TARGETS.includes(target)) keybinds[target] = key;
              });
              saveKeybinds();
            }
            if(incomingSettings){
              twoStepDelete = incomingSettings.twoStepDelete === true;
              buzzDefaultOn = incomingSettings.buzzDefaultOn === true;
              rareDefaultOn = incomingSettings.rareDefaultOn === true;
              hotkeySound = VALID_HOTKEY_SOUNDS.includes(incomingSettings.hotkeySound) ? incomingSettings.hotkeySound : 'click';
              saveSettings();
            }
            if(incomingCustomDefaults){ saveCustomDefaults({ species: incomingCustomDefaults.species||[], maps: incomingCustomDefaults.maps||[] }); }
            markDirty();
            await saveNow();
            renderCurrentPanel(); renderStats(); renderChart(); renderLiveStat();
            if(msg) msg.textContent = 'Backup imported (overwrite).';
          }
        );
      }catch(e){
        if(msg) msg.textContent = "Couldn't read that file.";
      }
    };
    reader.readAsText(file);
  }

  function askConfirm(text, onConfirm, onCancel){
    const modal = document.getElementById('confirmModal');
    document.getElementById('modalText').textContent = text;
    // Clone buttons to strip all old listeners (handles showDeleteFinalModal replacements)
    const oldConfirm = document.getElementById('modalConfirm');
    const oldCancel = document.getElementById('modalCancel');
    const newConfirm = oldConfirm.cloneNode(true);
    const newCancel = oldCancel.cloneNode(true);
    oldConfirm.parentNode.replaceChild(newConfirm, oldConfirm);
    oldCancel.parentNode.replaceChild(newCancel, oldCancel);
    newConfirm.textContent = 'Confirm';
    newConfirm.addEventListener('click', () => {
      modal.classList.add('hidden');
      if(onConfirm) onConfirm();
    });
    newCancel.addEventListener('click', () => {
      modal.classList.add('hidden');
      if(onCancel) onCancel();
    });
    modal.classList.remove('hidden');
  }

  // Makes a count-display element click-to-edit: click → inline number input →
  // Enter/blur → confirmation popup → applies on Confirm, reverts on Cancel.
  // getGrind: () => grind object (or null). getDisplayValue: (g) => number shown.
  // applyDisplayValue: (g, newVal) => mutates g's underlying field(s) so the
  // display recomputes to newVal. afterApply: () => re-render/save side effects.
  function wireEditableCount(el, label, getGrind, getDisplayValue, applyDisplayValue, afterApply){
    if(!el) return;
    el.classList.add('count-editable');
    el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', `${label} count, click to edit`);
    el.addEventListener('click', () => {
      if(el.querySelector('input')) return; // already editing
      const g = getGrind();
      if(!g) return;
      const current = getDisplayValue(g);
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.step = '1';
      input.inputMode = 'numeric';
      input.className = 'count-edit-input';
      input.value = current;
      el.textContent = '';
      el.appendChild(input);
      input.focus();
      input.select();

      let settled = false;
      function revert(){ el.textContent = current; }
      function commit(){
        if(settled) return;
        settled = true;
        const raw = parseInt(input.value, 10);
        const val = (isNaN(raw) || raw < 0) ? current : raw;
        if(val === current){ revert(); return; }
        askConfirm(`Set ${label} to ${val}? (currently ${current})`, () => {
          const gg = getGrind();
          if(!gg) return;
          applyDisplayValue(gg, val);
          if(afterApply) afterApply();
        }, revert);
      }
      input.addEventListener('keydown', (e) => {
        if(e.key === 'Enter'){ e.preventDefault(); commit(); }
        else if(e.key === 'Escape'){ e.preventDefault(); settled = true; revert(); }
      });
      input.addEventListener('blur', () => { if(!settled) commit(); });
      input.addEventListener('click', (e) => e.stopPropagation());
    });
  }

  const TERMS = [
    { id:'diamond', term:'Diamond', matches:['diamond'],
      def:'An animal that makes diamond score (can be max level, or one level below max level for some species).' },
    { id:'herd-management', term:'Herd Management (H/M)', matches:['herd management','herd managing','herd manage','h/m'],
      def:'A method of grinding that involves managing the whole population of a species. This method involves shooting down exterior zones to low-level animals, then rotating through main zones. This effectively min-maxes the species\u2019 population, greatly increasing the spawn rate of larger animals. The idea that Herd Management increases the odds of spawning a Great One is greatly contested and not officially confirmed; however, many believe it\u2019s an effective strategy and have used it to great effect.' },
    { id:'jumper', term:'Jumper', matches:['jumper','jumpers'],
      def:'An animal that "jumps" from the zones it usually drinks, feeds, and rests at, and joins another group of animals (of the same species) in their drink, feed, and rest zones. Once killed, these jumpers usually rejoin their original group.' },
    { id:'max-level', term:'Max Level', matches:['max level','max levels'],
      def:'An animal with the highest level available for that species. Max levels have the highest chance of making diamond score, but can sometimes "Troll."' },
    { id:'pressure', term:'Pressure', matches:['pressure'],
      def:'Pressure results when an animal or animals are killed. It appears as a purple splotch centered on the area you shot the animal (not where the animal died). Causing too much hunting pressure in one area (at least 4 animals killed without a hunting structure, or 15 animals with one) will cause any zones in the area to be deleted. This "deletion" doesn\u2019t erase the zone \u2014 it just moves to a new place, usually nearby. Pressure in one area can be cleared by creating pressure in another area.' },
    { id:'rare', term:'Rare', matches:['rare'],
      def:'An animal with a rare fur type. Different species can sometimes share the same rare fur type, or have completely unique ones \u2014 reference a fur chart to round out your knowledge.' },
    { id:'rotation', term:'Rotation', matches:['rotation','rotations','rotating','rotates'],
      def:'A rotation is a set order in which a player checks their zones for animals to kill. A set rotation is crucial no matter what style of grind you\u2019re using, or whether you\u2019re Herd Managing or not. This is because animals don\u2019t respawn immediately \u2014 rotating through main zones in a repetitive order gives killed animals time to respawn, creating a smooth and efficient grind.' },
    { id:'shot-down', term:'Shot down', matches:['shot down'],
      def:'A term that describes a zone which has been "managed" to have only small animals in it. This term is commonly used in Herd Management.' },
    { id:'stacking', term:'Stacking', matches:['stacking','stack','stacked'],
      def:'A method commonly used in Herd Management to help shoot down exterior zones. Stacking involves saving large animals (usually max levels) in main zones when they spawn there. This helps min-max the species\u2019 population by making it easier for smaller animals to spawn in exterior zones. Once the population has been managed to the player\u2019s satisfaction, the player rotates only on main zones, shooting the stacked animals and rotating on the respawns. These respawns are larger on average, since all other animals (not in rotation) are smaller.' },
    { id:'troll', term:'Troll', matches:['troll','trolling'],
      def:'A max level animal that doesn\u2019t make diamond score.' },
    { id:'zones', term:'Zones', matches:['zone','zones'],
      def:'An area where an animal or animals drink, feed, or rest. These zones are predictable \u2014 animals use them at specific, repetitive times in the game. For grinding, drink and feed zones are most commonly used.' },
    { id:'main-zone', term:'Main Zone', matches:['main zone','main zones'],
      def:'A zone (usually drink or feed) that\u2019s chosen to be part of the main rotation of a grind. These zones are selected based on the player\u2019s preferences, but usually prioritize good line of sight (from player to the animals\u2019 drink zone) and accessibility (via fast travel, ATV, or running) so the player can easily kill and harvest animals.' },
    { id:'exterior-zone', term:'Exterior Zone', matches:['exterior zone','exterior zones'],
      def:'A zone (usually drink or feed) that is NOT chosen to be part of the main rotation of a grind. These zones are selected based on player preference \u2014 it\u2019s usually a good idea to pick zones with bad line of sight or difficult accessibility as exterior zones.' }
  ];

  const TIPS = [
    { id:'pick-good-main-zones', term:'Pick good main zones', matches:['pick good main zones','good main zones'],
      def:'Choosing good main zones is one of the best ways to set yourself up for success on your grind! Good main zones usually have the following attributes: clear lines of sight (from player to animals), and good accessibility to harvest animals efficiently (via fast travel, ATV, or running/walking). Please note these are general tips and may not apply to all zones on your unique map \u2014 different players may prefer different attributes in their main zones.' },
    { id:'respawn-times', term:'Respawn times', matches:['respawn times','respawn time'],
      def:'After killing an animal, it takes time to reappear in its zone (about 15 minutes). Respawns can also be affected by how many kills you make of the species you\u2019re grinding. If not enough animals are killed in a rotation, respawns may take much longer than 15 minutes. Because of this, it\u2019s crucial to have a rotation that takes enough time and harvests enough animals to get consistent respawns.' },
    { id:'small-vs-large-animal', term:'What is a smaller animal and what is a larger animal(?)', matches:['smaller animal','smaller animals','larger animal','larger animals','small animal','small animals','large animal','large animals'],
      def:'This highly depends on player preference, and matters most if you decide to Herd Manage. Since different species have different max levels, what counts as a small or large animal for one species will often differ from another. For Max Level 3, a level 1 animal is universally accepted as small (good for leaving in exterior zones), while a level 3 animal is considered large (good for stacking). For Max Level 5, a level 2 (or below) animal is considered small, while a level 5 animal is considered large. For Max Level 9, a level 4 (or below) animal is considered small, while a level 9 animal is considered large. Please note these are general, but widely accepted, guidelines \u2014 some players may use different criteria for what counts as small or large.' },
    { id:'have-fun', term:'Have fun', matches:['have fun'],
      def:'Grinding is a method that requires persistent, often repetitive action. It can also get frustrating when you\u2019re trying to set it up and understand it. That said, grinding also lets you harvest more animals efficiently, increasing your chances of finding a trophy in a given amount of time. There are many different play-styles, and every player has their own preferences \u2014 everyone should play the game however THEY enjoy it.' }
  ];

  function allGlossaryEntries(){ return TERMS.concat(TIPS); }
  function escapeRegex(str){ return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function linkifyDefinition(current){
    const all = allGlossaryEntries();
    const alts = [];
    all.forEach(o => { if(o.id === current.id) return; o.matches.forEach(m => alts.push({ text:m, id:o.id })); });
    let html = escapeHtml(current.def);
    if(alts.length === 0) return html;
    alts.sort((a,b) => b.text.length - a.text.length);
    const pattern = alts.map(a => escapeRegex(a.text)).join('|');
    const re = new RegExp(`\\b(${pattern})\\b`, 'gi');
    html = html.replace(re, (match) => {
      const lower = match.toLowerCase();
      const found = alts.find(a => a.text.toLowerCase() === lower);
      return found ? `<span class="term-link" data-target="term-${found.id}">${match}</span>` : match;
    });
    return html;
  }

  function buildTerminologyList(){
    const list = document.getElementById('terminologyList');
    if(!list) return;
    list.innerHTML = TERMS.map(t => `<li id="term-${t.id}"><strong>${escapeHtml(t.term)}</strong> \u2014 ${linkifyDefinition(t)}</li>`).join('');
  }
  function buildTipsList(){
    const list = document.getElementById('tipsList');
    if(!list) return;
    list.innerHTML = TIPS.map(t => `<li id="term-${t.id}"><strong>${escapeHtml(t.term)}</strong> \u2014 ${linkifyDefinition(t)}</li>`).join('');
  }
  document.addEventListener('click', (e) => {
    const link = e.target.closest('.term-link');
    if(!link) return;
    const target = document.getElementById(link.dataset.target);
    if(!target) return;
    target.scrollIntoView({ behavior:'smooth', block:'center' });
    target.classList.add('term-flash');
    setTimeout(() => { target.classList.remove('term-flash'); }, 1200);
  });

  function loadKeybinds(){
    try{
      const raw = JSON.parse(localStorage.getItem(KEYBIND_KEY) || '{}');
      keybinds = {};
      let stale = false;
      Object.entries(raw).forEach(([target, key]) => {
        if(VALID_KEYBIND_TARGETS.includes(target)) keybinds[target] = key;
        else stale = true;
      });
      if(stale) saveKeybinds(); // permanently drop bindings left over from removed counters
    }catch(e){ keybinds = {}; }
  }
  function saveKeybinds(){
    try{ localStorage.setItem(KEYBIND_KEY, JSON.stringify(keybinds)); }catch(e){}
  }
  function formatKey(key){
    if(!key) return '';
    if(key === ' ') return 'Space';
    if(key.length === 1) return key.toUpperCase();
    return key;
  }

  // Short synthesized hotkey-feedback sounds — for platforms where navigator.vibrate does
  // nothing (desktop, iOS). No audio files needed; all built with the Web Audio API on the fly.
  let audioCtx = null;
  function getAudioCtx(){
    if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if(audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }
  function playHotkeyDing(){
    try{
      const ctx = getAudioCtx();
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, t0);
      osc.frequency.exponentialRampToValueAtTime(1318.5, t0 + 0.08);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.4);
    }catch(e){}
  }
  // Soft mechanical-keyswitch "clack" — short filtered noise burst, no tone/pitch.
  function playHotkeyClick(){
    try{
      const ctx = getAudioCtx();
      const t0 = ctx.currentTime;
      const bufferSize = Math.floor(ctx.sampleRate * 0.03);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for(let i=0;i<bufferSize;i++) data[i] = Math.random()*2-1;
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(2200, t0);
      filter.Q.value = 1.2;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.45, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.03);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start(t0);
      noise.stop(t0 + 0.05);
    }catch(e){}
  }
  // Deeper "thock" — same filtered-noise-burst technique as Click, tuned lower for a
  // heavier switch-bottoming-out feel instead of a sharp clack.
  function playHotkeyThock(){
    try{
      const ctx = getAudioCtx();
      const t0 = ctx.currentTime;
      const bufferSize = Math.floor(ctx.sampleRate * 0.045);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for(let i=0;i<bufferSize;i++) data[i] = Math.random()*2-1;
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(900, t0);
      filter.Q.value = 1.0;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.5, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.045);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start(t0);
      noise.stop(t0 + 0.07);
    }catch(e){}
  }
  // Quick descending "pop"/bubble.
  function playHotkeyPop(){
    try{
      const ctx = getAudioCtx();
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, t0);
      osc.frequency.exponentialRampToValueAtTime(140, t0 + 0.09);
      gain.gain.setValueAtTime(0.001, t0);
      gain.gain.exponentialRampToValueAtTime(0.3, t0 + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.15);
    }catch(e){}
  }
  // Single short tone — simpler/shorter than the two-tone ding.
  function playHotkeyBlip(){
    try{
      const ctx = getAudioCtx();
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1046.5, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.1);
    }catch(e){}
  }
  const HOTKEY_SOUND_PLAYERS = { ding: playHotkeyDing, click: playHotkeyClick, thock: playHotkeyThock, pop: playHotkeyPop, blip: playHotkeyBlip };
  function playHotkeySound(){
    (HOTKEY_SOUND_PLAYERS[hotkeySound] || playHotkeyClick)();
  }

  // Global keydown → fire +1 on bound counter
  document.addEventListener('keydown', function(e){
    // Ignore if typing in an input/textarea
    if(e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    // Ignore modifier-only keys
    if(['Control','Alt','Shift','Meta'].includes(e.key)) return;
    const g = getActiveGrind();
    if(!g) return;
    Object.entries(keybinds).forEach(([target, boundKey]) => {
      if(!VALID_KEYBIND_TARGETS.includes(target)) return;
      if(e.key === boundKey){
        e.preventDefault();
        // Rare counter only fires if tracking is on
        if(target === 'rareCount' && !g.rareTracking) return;
        g[target] = Math.max(0, (g[target] || 0) + 1);
        renderCounters(target);
        renderLiveStat();
        renderStats();
        if(g.status === 'completed'){ renderChart(); }
        markDirty();
        scheduleSave();
        if(g.buzzEnabled){
          if(navigator.vibrate) navigator.vibrate(40);
          playHotkeySound();
        }
      }
    });
  });

  // Keybind listening state
  let listeningFor = null;
  let pendingKey = null;

  function openKeybindModal(target, label){
    listeningFor = target;
    pendingKey = null;
    const modal = document.getElementById('keybindModal');
    const status = document.getElementById('keybindStatus');
    const saveBtn = document.getElementById('keybindSaveBtn');
    status.textContent = 'Press any key…';
    status.className = 'keybind-status waiting';
    saveBtn.classList.remove('lit');
    saveBtn.disabled = true;
    document.getElementById('keybindLabel').textContent = 'Sync key for: ' + label;
    modal.classList.remove('hidden');
  }

  function closeKeybindModal(){
    listeningFor = null; pendingKey = null;
    document.getElementById('keybindModal').classList.add('hidden');
  }

  document.addEventListener('keydown', function(e){
    if(!listeningFor) return;
    if(['Control','Alt','Shift','Meta'].includes(e.key)) return;
    e.preventDefault();
    pendingKey = e.key;
    const status = document.getElementById('keybindStatus');
    const saveBtn = document.getElementById('keybindSaveBtn');
    status.textContent = 'Key: ' + formatKey(pendingKey);
    status.className = 'keybind-status captured';
    saveBtn.classList.add('lit');
    saveBtn.disabled = false;
  });

  async function confirmRemoveKeybind(target, label){
    askConfirm(`Remove keyboard sync for "${label}"?`, () => {
      delete keybinds[target];
      saveKeybinds();
      renderCurrentPanel();
    });
  }

  async function init(){
    storageAvailable = checkStorageAvailable();
    if(storageAvailable){
      try{
        const d = await Promise.resolve({ value: localStorage.getItem(DATA_KEY) });
        if(d && d.value){
          const parsed = JSON.parse(d.value);
          if(Array.isArray(parsed.grinds)){
            grinds = parsed.grinds.map(normalizeGrind);
            activeGrindId = parsed.activeGrindId || null;
          } else {
            const migrated = migrateOldShape(parsed);
            grinds = migrated.grinds;
            activeGrindId = migrated.activeGrindId;
          }
        } else {
          grinds = []; activeGrindId = null;
        }
      }catch(e){ grinds = []; activeGrindId = null; }
    } else {
      grinds = []; activeGrindId = null;
    }

    loadKeybinds();
    loadSettings();
    buildShell();
    renderLiveStat();
    setSyncStatus(storageAvailable ? 'saved' : 'unavailable');
  }

  init();
})();
