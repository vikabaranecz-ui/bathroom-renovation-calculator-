(() => {
  'use strict';

  const SUPABASE_URL = 'https://xyvpresvfubmmfweyasf.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_4J-yHzPGBf1udf_UR8DS1w_j3mQo_WU';
  const SESSION_KEY = 'reno_bathroom_estimator_session_v1';

  const DEFAULT_PRICING = {
    laborRate: 30,
    overheadPct: 12,
    riskPct: 8,
    marginPct: 35,
    vatRate: 21,
    roundTo: 50,
    marginOnProducts: true,
    demoLightHours: 16,
    demoFullHours: 32,
    demoHeavyHours: 48,
    demoLightMaterials: 180,
    demoFullMaterials: 420,
    demoHeavyMaterials: 700,
    tileHoursPerM2: 1.55,
    tileMaterialsPerM2: 13,
    mortexHoursPerM2: 2.0,
    mortexMaterialsPerM2: 32,
    waterproofHoursPerM2: 0.45,
    waterproofMaterialsPerM2: 16,
    waterMoveHours: 4,
    waterMoveMaterials: 90,
    drainMoveHours: 6,
    drainMoveMaterials: 140,
    electricHours: 1.6,
    electricMaterials: 45
  };

  const state = {
    session: null,
    pricing: Object.assign({}, DEFAULT_PRICING),
    pricingProfileId: null,
    projectId: null,
    estimateId: null,
    lastResult: null,
    busy: false,
    galleryObjectUrls: [],
    historyRows: [],
    projectsRows: [],
    offerteProfileId: null,
    offerteProfile: null,
    currentOfferteId: null,
    currentOfferteBlob: null,
    currentOfferteFilename: null,
    autosaveTimer: null,
    lastSavedAt: null,
    dirty: false,
    allOffertesRows: [],
    wizardStep: 0
  };

  const byId = (id) => document.getElementById(id);
  const num = (id) => Math.max(0, Number(byId(id).value) || 0);
  const checked = (id) => Boolean(byId(id).checked);
  const euro = (value) => new Intl.NumberFormat('nl-BE', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0
  }).format(Number.isFinite(value) ? value : 0);
  const round1 = (value) => Math.round(value * 10) / 10;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const nowIso = () => new Date().toISOString();

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function setSync(message, type) {
    const el = byId('syncStatus');
    el.textContent = message;
    el.className = 'sync-status' + (type ? ' ' + type : '');
  }

  function savedTimeLabel() {
    if (!state.lastSavedAt) return 'Saved';
    return 'Saved ' + state.lastSavedAt.toLocaleTimeString('nl-BE',{hour:'2-digit',minute:'2-digit'});
  }

  function markUnsaved() {
    state.dirty = true;
    setSync('Unsaved changes', 'unsaved');
  }

  let toastTimer = null;
  function toast(message, type) {
    const el = byId('toast');
    el.textContent = message;
    el.className = 'toast show' + (type === 'error' ? ' error' : '');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { el.className = 'toast'; }, 2600);
  }

  function parseJwt(token) {
    try {
      const part = token.split('.')[1];
      const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
      return JSON.parse(atob(padded));
    } catch {
      return {};
    }
  }

  function persistSession(payload) {
    const expiresIn = Number(payload.expires_in || 3600);
    const session = {
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
      expires_at: Date.now() + expiresIn * 1000
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    state.session = session;
    return session;
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
    state.session = null;
  }

  async function authRequest(path, options) {
    const config = options || {};
    const headers = Object.assign({
      apikey: SUPABASE_KEY,
      'Content-Type': 'application/json'
    }, config.headers || {});
    const response = await fetch(SUPABASE_URL + '/auth/v1/' + path, {
      method: config.method || 'POST',
      headers,
      body: config.body ? JSON.stringify(config.body) : undefined
    });
    let data = null;
    try { data = await response.json(); } catch { data = {}; }
    if (!response.ok) {
      const message = data.msg || data.message || data.error_description || 'Authentication failed.';
      throw new Error(message);
    }
    return data;
  }

  async function refreshSession() {
    if (!state.session || !state.session.refresh_token) throw new Error('No refresh token');
    const data = await authRequest('token?grant_type=refresh_token', {
      body: { refresh_token: state.session.refresh_token }
    });
    return persistSession(data);
  }

  async function getValidToken() {
    if (!state.session) throw new Error('Not signed in');
    if (Date.now() > Number(state.session.expires_at || 0) - 60000) {
      await refreshSession();
    }
    return state.session.access_token;
  }

  async function rest(path, options, retried) {
    const config = options || {};
    const token = await getValidToken();
    const headers = Object.assign({
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json'
    }, config.headers || {});
    if (config.prefer) headers.Prefer = config.prefer;

    const response = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
      method: config.method || 'GET',
      headers,
      body: config.body == null ? undefined : JSON.stringify(config.body)
    });

    if (response.status === 401 && !retried) {
      try {
        await refreshSession();
        return rest(path, options, true);
      } catch {
        clearSession();
        throw new Error('Your session expired. Please sign in again.');
      }
    }

    const text = await response.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }
    if (!response.ok) {
      const message = data && (data.message || data.hint || data.details);
      throw new Error(message || ('Supabase request failed (' + response.status + ')'));
    }
    return data;
  }


  function encodeStoragePath(path) {
    return String(path).split('/').map(encodeURIComponent).join('/');
  }

  function clearGalleryObjectUrls() {
    state.galleryObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    state.galleryObjectUrls = [];
  }

  async function refreshGalleryCount() {
    if (!state.estimateId) {
      byId('galleryCount').textContent = '0';
      return 0;
    }
    try {
      const rows = await rest('bathroom_estimate_photos?estimate_id=eq.' + encodeURIComponent(state.estimateId) + '&select=id');
      const count = Array.isArray(rows) ? rows.length : 0;
      byId('galleryCount').textContent = String(count);
      return count;
    } catch {
      byId('galleryCount').textContent = '—';
      return 0;
    }
  }

  async function downloadPrivatePhoto(storagePath) {
    const token = await getValidToken();
    const response = await fetch(
      SUPABASE_URL + '/storage/v1/object/bathroom-estimate-photos/' + encodeStoragePath(storagePath),
      { headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + token } }
    );
    if (!response.ok) throw new Error('Could not load photo');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    state.galleryObjectUrls.push(url);
    return url;
  }

  async function loadGallery() {
    clearGalleryObjectUrls();
    const grid = byId('galleryGrid');
    if (!state.estimateId) {
      grid.innerHTML = '<p class="muted">Save the estimate before adding photos.</p>';
      byId('galleryCount').textContent = '0';
      return;
    }

    grid.innerHTML = '<div class="gallery-loading">Loading photos…</div>';
    const rows = await rest(
      'bathroom_estimate_photos?estimate_id=eq.' + encodeURIComponent(state.estimateId) +
      '&select=id,storage_path,caption,created_at&order=created_at.asc'
    );
    const photos = Array.isArray(rows) ? rows : [];
    byId('galleryCount').textContent = String(photos.length);

    if (!photos.length) {
      grid.innerHTML = '<div class="gallery-empty"><strong>No photos yet</strong><span>Take a photo on site or choose photos from your library.</span></div>';
      return;
    }

    const rendered = await Promise.all(photos.map(async (photo) => {
      try {
        const url = await downloadPrivatePhoto(photo.storage_path);
        return '<div class="gallery-card" data-photo-id="' + escapeHtml(photo.id) + '" data-storage-path="' + escapeHtml(photo.storage_path) + '">' +
          '<img src="' + url + '" alt="Bathroom inspection photo" />' +
          '<button class="gallery-delete" type="button">Delete</button></div>';
      } catch {
        return '<div class="gallery-card" data-photo-id="' + escapeHtml(photo.id) + '" data-storage-path="' + escapeHtml(photo.storage_path) + '">' +
          '<div class="photo-fallback">Photo saved, but preview is not available in this browser.</div>' +
          '<button class="gallery-delete" type="button">Delete</button></div>';
      }
    }));

    grid.innerHTML = rendered.join('');
    grid.querySelectorAll('.gallery-delete').forEach((button) => {
      button.addEventListener('click', async () => {
        const card = button.closest('.gallery-card');
        if (!card) return;
        try {
          button.disabled = true;
          const token = await getValidToken();
          const storagePath = card.getAttribute('data-storage-path');
          const response = await fetch(
            SUPABASE_URL + '/storage/v1/object/bathroom-estimate-photos',
            {
              method: 'DELETE',
              headers: {
                apikey: SUPABASE_KEY,
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ prefixes: [storagePath] })
            }
          );
          if (!response.ok) throw new Error('Could not delete photo file');
          await rest('bathroom_estimate_photos?id=eq.' + encodeURIComponent(card.getAttribute('data-photo-id')), {
            method: 'DELETE',
            prefer: 'return=minimal'
          });
          await loadGallery();
          toast('Photo deleted.');
        } catch (error) {
          button.disabled = false;
          toast(error.message || 'Could not delete photo.', 'error');
        }
      });
    });
  }

  async function uploadGalleryFiles(fileList) {
    const files = Array.from(fileList || []).filter((file) => file && file.type && file.type.startsWith('image/'));
    if (!files.length) return;

    if (!state.estimateId) {
      toast('Saving the estimate first…');
      await saveEstimate();
    }
    if (!state.estimateId) throw new Error('Save the estimate before adding photos.');

    const token = await getValidToken();
    const userId = currentUserId();
    setSync('Uploading photos', 'busy');

    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      const safeName = (file.name || 'photo').replace(/[^a-zA-Z0-9._-]/g, '-').slice(-90);
      const storagePath = userId + '/' + state.estimateId + '/' + Date.now() + '-' + i + '-' + safeName;
      const response = await fetch(
        SUPABASE_URL + '/storage/v1/object/bathroom-estimate-photos/' + encodeStoragePath(storagePath),
        {
          method: 'POST',
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: 'Bearer ' + token,
            'Content-Type': file.type || 'application/octet-stream',
            'x-upsert': 'false'
          },
          body: file
        }
      );
      if (!response.ok) {
        const detail = await response.text();
        throw new Error('Photo upload failed: ' + (detail || response.status));
      }

      await rest('bathroom_estimate_photos', {
        method: 'POST',
        body: {
          estimate_id: state.estimateId,
          user_id: userId,
          storage_path: storagePath,
          caption: ''
        },
        prefer: 'return=minimal'
      });
    }

    setSync('Synced');
    await loadGallery();
    toast(files.length === 1 ? 'Photo added.' : files.length + ' photos added.');
  }

  async function openGallery() {
    try {
      if (!state.estimateId) {
        toast('Saving the estimate before opening the gallery…');
        await saveEstimate();
      }
      if (!state.estimateId) return;
      byId('galleryProjectLabel').textContent =
        (byId('clientName').value.trim() || byId('projectAddress').value.trim() || 'Saved estimate') +
        (document.body.classList.contains('client-mode') ? ' · View only' : ' · Private photos');
      byId('galleryModal').hidden = false;
      await loadGallery();
    } catch (error) {
      toast(error.message || 'Could not open gallery.', 'error');
    }
  }

  function closeGallery() {
    byId('galleryModal').hidden = true;
    clearGalleryObjectUrls();
  }

  function currentUserId() {
    if (!state.session) return null;
    return parseJwt(state.session.access_token).sub || null;
  }

  async function signIn(email, password) {
    const data = await authRequest('token?grant_type=password', {
      body: { email: email.trim(), password }
    });
    persistSession(data);
    await enterApp();
  }

  async function signUp(email, password) {
    const data = await authRequest('signup', {
      body: { email: email.trim(), password }
    });
    if (data.access_token) {
      persistSession(data);
      await enterApp();
      return 'Account created and signed in.';
    }
    return 'Account created. Check your email if confirmation is required, then sign in.';
  }

  async function signOut() {
    try {
      if (state.session && state.session.access_token) {
        await authRequest('logout', {
          headers: { Authorization: 'Bearer ' + state.session.access_token }
        });
      }
    } catch {}
    clearSession();
    state.projectId = null;
    state.estimateId = null;
    closeGallery();
    byId('app').hidden = true;
    byId('authGate').hidden = false;
    byId('authPassword').value = '';
    byId('authMessage').textContent = '';
  }

  function syncPricingInputs() {
    document.querySelectorAll('[data-price]').forEach((el) => {
      const key = el.getAttribute('data-price');
      el.value = state.pricing[key];
    });
    document.querySelectorAll('[data-price-check]').forEach((el) => {
      const key = el.getAttribute('data-price-check');
      el.checked = Boolean(state.pricing[key]);
    });
  }

  function collectPricingFromInputs() {
    document.querySelectorAll('[data-price]').forEach((el) => {
      const key = el.getAttribute('data-price');
      state.pricing[key] = Math.max(0, Number(el.value) || 0);
    });
    document.querySelectorAll('[data-price-check]').forEach((el) => {
      const key = el.getAttribute('data-price-check');
      state.pricing[key] = Boolean(el.checked);
    });
  }

  async function loadPricing() {
    setSync('Loading rates', 'busy');
    const rows = await rest('bathroom_pricing_profiles?is_default=eq.true&select=id,config&limit=1');
    if (Array.isArray(rows) && rows.length) {
      state.pricingProfileId = rows[0].id;
      state.pricing = Object.assign({}, DEFAULT_PRICING, rows[0].config || {});
    } else {
      state.pricingProfileId = null;
      state.pricing = Object.assign({}, DEFAULT_PRICING);
    }
    syncPricingInputs();
    calculate();
    setSync('Synced');
  }

  async function savePricing() {
    collectPricingFromInputs();
    const userId = currentUserId();
    if (!userId) throw new Error('Not signed in');
    setSync('Saving rates', 'busy');

    const payload = {
      user_id: userId,
      name: 'Default',
      is_default: true,
      config: state.pricing,
      updated_at: nowIso()
    };

    if (state.pricingProfileId) {
      await rest('bathroom_pricing_profiles?id=eq.' + encodeURIComponent(state.pricingProfileId), {
        method: 'PATCH',
        body: payload,
        prefer: 'return=minimal'
      });
    } else {
      const created = await rest('bathroom_pricing_profiles', {
        method: 'POST',
        body: payload,
        prefer: 'return=representation'
      });
      if (Array.isArray(created) && created[0]) state.pricingProfileId = created[0].id;
    }
    setSync('Synced');
    toast('Pricing profile saved.');
  }

  function addLine(lines, name, hours, materials, meta) {
    const safeHours = Math.max(0, Number(hours) || 0);
    const safeMaterials = Math.max(0, Number(materials) || 0);
    if (safeHours === 0 && safeMaterials === 0) return;
    lines.push({ name, hours: safeHours, materials: safeMaterials, meta: meta || '' });
  }

  function calculate() {
    collectPricingFromInputs();
    const p = state.pricing;
    const length = num('length');
    const width = num('width');
    const height = num('height');
    const floor = length * width;
    const grossWalls = 2 * (length + width) * height;
    const wallFinishArea = grossWalls * clamp(num('wallTilePct'), 0, 100) / 100;
    const wallFinish = byId('wallFinish').value;
    const floorFinish = byId('floorFinish').value;
    const tiledWalls = wallFinish === 'tile' ? wallFinishArea : 0;
    const mortexWalls = wallFinish === 'mortex' ? wallFinishArea : 0;
    const tiledFloor = floorFinish === 'tile' ? floor : 0;
    const mortexFloor = floorFinish === 'mortex' ? floor : 0;
    const tileArea = tiledFloor + tiledWalls;
    const mortexArea = mortexFloor + mortexWalls;
    const tileBuyArea = tileArea * (1 + clamp(num('tileWastePct'), 0, 30) / 100);
    const wetWallArea = checked('shower') ? Math.min(wallFinishArea || grossWalls, 8) : 0;
    const waterproofArea = checked('waterproofing') ? floor + wetWallArea : 0;

    byId('floorArea').textContent = floor.toFixed(1) + ' m²';
    byId('wallArea').textContent = wallFinishArea.toFixed(1) + ' m²';
    byId('tileBuyArea').textContent = tileBuyArea.toFixed(1) + ' m²';
    byId('mortexArea').textContent = mortexArea.toFixed(1) + ' m²';

    const lines = [];
    const demolition = byId('demolition').value;
    if (demolition === 'light') addLine(lines, 'Light demolition', p.demoLightHours, p.demoLightMaterials);
    if (demolition === 'full') addLine(lines, 'Full bathroom strip-out', p.demoFullHours, p.demoFullMaterials);
    if (demolition === 'heavy') addLine(lines, 'Heavy demolition / difficult access', p.demoHeavyHours, p.demoHeavyMaterials);
    if (checked('wasteRemoval') && demolition !== 'none') addLine(lines, 'Debris removal & disposal', 4, 350);

    const substrate = byId('substrate').value;
    if (substrate === 'local') addLine(lines, 'Local substrate repairs', 10, 300);
    if (substrate === 'major') addLine(lines, 'Major levelling / substrate repair', 28, 800);
    if (substrate === 'rebuild') addLine(lines, 'Rebuild walls / floor base', 45, 1300);

    if (checked('waterproofing')) {
      addLine(lines, 'Waterproofing system', waterproofArea * p.waterproofHoursPerM2, waterproofArea * p.waterproofMaterialsPerM2, round1(waterproofArea) + ' m²');
    }
    if (tiledFloor > 0) {
      addLine(lines, 'Floor tiling', tiledFloor * p.tileHoursPerM2, tiledFloor * p.tileMaterialsPerM2, round1(tiledFloor) + ' m²');
    }
    if (tiledWalls > 0) {
      addLine(lines, 'Wall tiling', tiledWalls * p.tileHoursPerM2, tiledWalls * p.tileMaterialsPerM2, round1(tiledWalls) + ' m²');
    }
    if (mortexFloor > 0) {
      addLine(lines, 'Mortex floor finish', mortexFloor * p.mortexHoursPerM2, mortexFloor * p.mortexMaterialsPerM2, round1(mortexFloor) + ' m²');
    }
    if (mortexWalls > 0) {
      addLine(lines, 'Mortex wall finish', mortexWalls * p.mortexHoursPerM2, mortexWalls * p.mortexMaterialsPerM2, round1(mortexWalls) + ' m²');
    }

    const waterMoves = num('waterMoves');
    const drainMoves = num('drainMoves');
    const electricPoints = num('electricPoints');
    if (waterMoves) addLine(lines, 'Move water connections', waterMoves * p.waterMoveHours, waterMoves * p.waterMoveMaterials, waterMoves + ' point(s)');
    if (drainMoves) addLine(lines, 'Move drains', drainMoves * p.drainMoveHours, drainMoves * p.drainMoveMaterials, drainMoves + ' drain(s)');
    if (electricPoints) addLine(lines, 'Electrical work', electricPoints * p.electricHours, electricPoints * p.electricMaterials, electricPoints + ' point(s)');

    if (checked('shower')) addLine(lines, 'Install walk-in shower', 12, 180);
    if (checked('bath')) addLine(lines, 'Install bathtub', 10, 160);
    if (checked('toilet')) addLine(lines, 'Install toilet', 8, 120);
    if (checked('vanity')) addLine(lines, 'Install vanity & basin', 6, 90);
    if (checked('radiator')) addLine(lines, 'Install towel radiator', 5, 110);
    if (checked('ventilation')) addLine(lines, 'Mechanical ventilation', 5, 180);
    if (checked('ceilingPaint')) addLine(lines, 'Ceiling repair / painting', Math.max(6, floor * 0.7), Math.max(100, floor * 16));
    if (checked('floorHeating')) addLine(lines, 'Electric floor heating', Math.max(5, floor * 0.6), floor * 48, round1(floor) + ' m²');

    const totalHours = lines.reduce((sum, line) => sum + line.hours, 0);
    const constructionMaterials = lines.reduce((sum, line) => sum + line.materials, 0);
    const laborCost = totalHours * p.laborRate;

    let productCost = 0;
    if (tileArea > 0) productCost += tileBuyArea * num('tilePrice');
    if (checked('shower')) productCost += num('allowShower');
    if (checked('bath')) productCost += num('allowBath');
    if (checked('toilet')) productCost += num('allowToilet');
    if (checked('vanity')) productCost += num('allowVanity');
    if (checked('radiator') || checked('ventilation')) productCost += num('allowMechanical');
    productCost += num('allowOther');

    const coreDirectCost = laborCost + constructionMaterials;
    const overhead = coreDirectCost * clamp(p.overheadPct, 0, 100) / 100;
    const risk = (coreDirectCost + overhead) * clamp(p.riskPct, 0, 100) / 100;
    const coreBasis = coreDirectCost + overhead + risk;
    const margin = clamp(p.marginPct, 1, 70) / 100;
    const sellCore = coreBasis / (1 - margin);
    const sellProducts = p.marginOnProducts ? productCost / (1 - margin) : productCost;
    const rawExVat = sellCore + sellProducts;
    const roundTo = Math.max(1, Number(p.roundTo) || 1);
    const totalExVat = Math.ceil(rawExVat / roundTo) * roundTo;
    const vatRate = clamp(p.vatRate, 0, 100) / 100;
    const totalIncVat = totalExVat * (1 + vatRate);
    const totalCostBasis = coreBasis + productCost;
    const grossContribution = totalExVat - totalCostBasis;
    const actualMargin = totalExVat > 0 ? grossContribution / totalExVat * 100 : 0;

    const confidenceChecks = Array.from(document.querySelectorAll('.confidence'));
    const confidenceCount = confidenceChecks.filter((el) => el.checked).length;
    let confidenceLabel = 'Preliminary';
    if (confidenceCount >= 6) confidenceLabel = 'Ready for formal quote';
    else if (confidenceCount >= 4) confidenceLabel = 'Good estimate';

    const result = {
      areas: { floor, grossWalls, wallFinishArea, tiledWalls, tiledFloor, mortexWalls, mortexFloor, mortexArea, tileArea, tileBuyArea, waterproofArea },
      lines,
      totalHours,
      laborCost,
      constructionMaterials,
      productCost,
      overhead,
      risk,
      coreBasis,
      totalCostBasis,
      grossContribution,
      actualMargin,
      totalExVat,
      vatRate,
      totalIncVat,
      confidenceCount,
      confidenceLabel
    };
    state.lastResult = result;

    byId('totalIncVat').textContent = euro(totalIncVat);
    byId('totalExVat').textContent = euro(totalExVat) + ' excl. VAT';
    byId('summarySize').textContent = floor.toFixed(1) + ' m²';
    byId('summaryHours').textContent = Math.round(totalHours) + ' h';
    byId('summaryProducts').textContent = euro(productCost);
    byId('laborCost').textContent = euro(laborCost);
    byId('constructionMaterials').textContent = euro(constructionMaterials);
    byId('productCost').textContent = euro(productCost);
    byId('overheadCost').textContent = euro(overhead);
    byId('riskCost').textContent = euro(risk);
    byId('costBasis').textContent = euro(totalCostBasis);
    byId('grossContribution').textContent = euro(grossContribution);
    byId('actualMargin').textContent = actualMargin.toFixed(1) + '%';
    byId('confidenceBadge').textContent = confidenceLabel;

    renderBreakdown(lines);
    return result;
  }

  function renderBreakdown(lines) {
    const clientMode = document.body.classList.contains('client-mode');
    const el = byId('breakdown');
    if (!lines.length) {
      el.innerHTML = '<p class="muted">Add scope items to see the breakdown.</p>';
      return;
    }
    el.innerHTML = lines.map((line) => {
      const direct = line.hours * state.pricing.laborRate + line.materials;
      const detail = line.meta ? line.meta + ' · ' + round1(line.hours) + ' worker-h' : round1(line.hours) + ' worker-h';
      return '<div class="breakdown-row"><div><strong>' + escapeHtml(line.name) + '</strong><small>' +
        escapeHtml(clientMode ? (line.meta || 'Included in scope') : detail) +
        '</small></div><div class="breakdown-price">' +
        (clientMode ? 'Included' : euro(direct)) +
        '</div></div>';
    }).join('');
  }

  function collectRoom() {
    return {
      length: num('length'),
      width: num('width'),
      height: num('height'),
      wallTilePct: num('wallTilePct'),
      tileWastePct: num('tileWastePct'),
      wallFinish: byId('wallFinish').value,
      floorFinish: byId('floorFinish').value
    };
  }

  function collectScope() {
    return {
      demolition: byId('demolition').value,
      substrate: byId('substrate').value,
      wasteRemoval: checked('wasteRemoval'),
      waterproofing: checked('waterproofing'),
      wallFinish: byId('wallFinish').value,
      floorFinish: byId('floorFinish').value,
      ceilingPaint: checked('ceilingPaint'),
      floorHeating: checked('floorHeating'),
      waterMoves: num('waterMoves'),
      drainMoves: num('drainMoves'),
      electricPoints: num('electricPoints'),
      shower: checked('shower'),
      bath: checked('bath'),
      toilet: checked('toilet'),
      vanity: checked('vanity'),
      radiator: checked('radiator'),
      ventilation: checked('ventilation'),
      confidence: Array.from(document.querySelectorAll('.confidence')).map((el) => el.checked)
    };
  }

  function collectSelections() {
    return {
      tilePrice: num('tilePrice'),
      allowShower: num('allowShower'),
      allowBath: num('allowBath'),
      allowToilet: num('allowToilet'),
      allowVanity: num('allowVanity'),
      allowMechanical: num('allowMechanical'),
      allowOther: num('allowOther'),
      clientEmail: byId('clientEmail').value.trim()
    };
  }

  function setValue(id, value) {
    if (byId(id) && value != null) byId(id).value = value;
  }

  function setCheck(id, value) {
    if (byId(id)) byId(id).checked = Boolean(value);
  }

  function fillEstimate(record) {
    state.estimateId = record.id;
    state.projectId = record.project_id || state.projectId || null;
    byId('estimateState').textContent = 'Saved estimate';
    setWizardStep(6,{noScroll:true});
    setValue('clientName', record.client_name || '');
    setValue('clientPhone', record.client_phone || '');
    setValue('projectAddress', record.project_address || '');
    setValue('notes', record.notes || '');

    const room = record.room || {};
    setValue('length', room.length);
    setValue('width', room.width);
    setValue('height', room.height);
    setValue('wallTilePct', room.wallTilePct);
    setValue('tileWastePct', room.tileWastePct);

    const scope = record.scope || {};
    setValue('wallFinish', scope.wallFinish || room.wallFinish || (scope.tileWalls === false ? 'none' : 'tile'));
    setValue('floorFinish', scope.floorFinish || room.floorFinish || (scope.tileFloor === false ? 'none' : 'tile'));
    setValue('demolition', scope.demolition);
    setValue('substrate', scope.substrate);
    setCheck('wasteRemoval', scope.wasteRemoval);
    setCheck('waterproofing', scope.waterproofing);
    setCheck('ceilingPaint', scope.ceilingPaint);
    setCheck('floorHeating', scope.floorHeating);
    setValue('waterMoves', scope.waterMoves);
    setValue('drainMoves', scope.drainMoves);
    setValue('electricPoints', scope.electricPoints);
    setCheck('shower', scope.shower);
    setCheck('bath', scope.bath);
    setCheck('toilet', scope.toilet);
    setCheck('vanity', scope.vanity);
    setCheck('radiator', scope.radiator);
    setCheck('ventilation', scope.ventilation);
    const confidence = Array.isArray(scope.confidence) ? scope.confidence : [];
    Array.from(document.querySelectorAll('.confidence')).forEach((el, i) => { el.checked = Boolean(confidence[i]); });

    const selections = record.selections || {};
    setValue('tilePrice', selections.tilePrice);
    setValue('allowShower', selections.allowShower);
    setValue('allowBath', selections.allowBath);
    setValue('allowToilet', selections.allowToilet);
    setValue('allowVanity', selections.allowVanity);
    setValue('allowMechanical', selections.allowMechanical);
    setValue('allowOther', selections.allowOther);
    setValue('clientEmail', selections.clientEmail || '');

    if (record.pricing_snapshot && Object.keys(record.pricing_snapshot).length) {
      state.pricing = Object.assign({}, DEFAULT_PRICING, record.pricing_snapshot);
      syncPricingInputs();
    }

    calculate();
    refreshGalleryCount();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast('Estimate loaded.');
  }

  function setClientMode(active) {
    document.body.classList.toggle('client-mode', Boolean(active));
    byId('clientViewBtn').textContent = active ? 'Internal view' : 'Client view';
    const mobileClientLabel = byId('mobileClientLabel');
    if (mobileClientLabel) mobileClientLabel.textContent = active ? 'Internal' : 'Client';
    calculate();
  }


  const WIZARD_STEPS = [
    'Client & project',
    'Room measurements',
    'Demolition & preparation',
    'Plumbing & fixtures',
    'Client-selected products',
    'Inspection check',
    'Review & price'
  ];

  function setWizardStep(index, options) {
    const opts=options||{};
    const max=WIZARD_STEPS.length-1;
    state.wizardStep=Math.max(0,Math.min(max,Number(index)||0));
    document.querySelectorAll('[data-wizard-step]').forEach((el)=>{
      el.classList.toggle('is-active',Number(el.getAttribute('data-wizard-step'))===state.wizardStep);
    });
    byId('wizardStepLabel').textContent='Step '+(state.wizardStep+1)+' of '+WIZARD_STEPS.length;
    byId('wizardStepTitle').textContent=WIZARD_STEPS[state.wizardStep];
    byId('wizardProgressBar').style.width=(((state.wizardStep+1)/WIZARD_STEPS.length)*100)+'%';
    byId('wizardBackBtn').disabled=state.wizardStep===0;
    byId('wizardNextBtn').textContent=state.wizardStep===max?'Done':'Next';
    document.body.classList.toggle('wizard-final',state.wizardStep===max);
    if(!opts.noScroll){
      const target=byId('wizardStepLabel');
      if(target) target.scrollIntoView({behavior:'smooth',block:'start'});
    }
  }

  function wizardNext(){
    if(state.wizardStep<WIZARD_STEPS.length-1){
      setWizardStep(state.wizardStep+1);
    }else{
      window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'});
    }
  }

  function wizardBack(){
    if(state.wizardStep>0) setWizardStep(state.wizardStep-1);
  }

  function resetEstimate() {
    closeGallery();
    setClientMode(false);
    state.projectId = null;
    state.estimateId = null;
    byId('estimateState').textContent = 'New estimate';
    byId('galleryCount').textContent = '0';
    byId('clientName').value = '';
    byId('clientPhone').value = '';
    byId('clientEmail').value = '';
    byId('projectAddress').value = '';
    byId('notes').value = '';
    setValue('length', 0);
    setValue('width', 0);
    setValue('height', 0);
    setValue('wallTilePct', 0);
    setValue('tileWastePct', 0);
    setValue('tilePrice', 0);
    setValue('wallFinish', 'none');
    setValue('floorFinish', 'none');
    setValue('demolition', 'none');
    setValue('substrate', 'good');
    setCheck('wasteRemoval', false);
    setCheck('waterproofing', false);
    setCheck('ceilingPaint', false);
    setCheck('floorHeating', false);
    setValue('waterMoves', 0);
    setValue('drainMoves', 0);
    setValue('electricPoints', 0);
    setCheck('shower', false);
    setCheck('bath', false);
    setCheck('toilet', false);
    setCheck('vanity', false);
    setCheck('radiator', false);
    setCheck('ventilation', false);
    setValue('allowShower', 0);
    setValue('allowBath', 0);
    setValue('allowToilet', 0);
    setValue('allowVanity', 0);
    setValue('allowMechanical', 0);
    setValue('allowOther', 0);
    document.querySelectorAll('.confidence').forEach((el) => { el.checked = false; });
    calculate();
    const firstPanel = document.querySelector('.editor-column .panel');
    if (firstPanel) firstPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => byId('clientName').focus({ preventScroll: true }), 350);
    state.dirty=false;
    state.lastSavedAt=null;
    setSync('New calculation');
    setWizardStep(0,{noScroll:true});
    toast('New calculation started.');
  }


  async function saveEstimate(options) {
    const opts=options||{};
    const draft=Boolean(opts.draft);
    const silent=Boolean(opts.silent);

    if(state.busy){
      if(!draft&&!silent) toast('A save is already finishing. Try again in a moment.');
      return false;
    }

    state.busy=true;
    if(!silent) setSync(draft?'Autosaving…':'Saving calculation…','busy');
    try{
      const result=calculate();
      const userId=currentUserId();
      if(!userId) throw new Error('Not signed in');

      const payload={
        client_name:byId('clientName').value.trim(),
        client_phone:byId('clientPhone').value.trim(),
        project_address:byId('projectAddress').value.trim(),
        room:collectRoom(),
        scope:collectScope(),
        selections:collectSelections(),
        pricing_snapshot:state.pricing,
        calculations:result,
        total_ex_vat:Number(result.totalExVat.toFixed(2)),
        vat_rate:Number(result.vatRate.toFixed(4)),
        total_inc_vat:Number(result.totalIncVat.toFixed(2)),
        notes:byId('notes').value.trim()
      };

      const rows=await rest('rpc/save_bathroom_calculation',{
        method:'POST',
        body:{
          p_project_id:state.projectId,
          p_estimate_id:state.estimateId,
          p_payload:payload,
          p_create_version:!draft
        }
      });

      if(!Array.isArray(rows)||!rows[0]||!rows[0].project_id||!rows[0].estimate_id){
        throw new Error('The calculation was not returned after saving.');
      }

      state.projectId=rows[0].project_id;
      state.estimateId=rows[0].estimate_id;
      state.lastSavedAt=new Date(rows[0].saved_at||Date.now());
      state.dirty=false;
      byId('estimateState').textContent=draft?'Draft saved':'Saved calculation';
      setSync(savedTimeLabel());

      if(!silent){
        toast(draft?'Draft saved.':'Calculation saved successfully.');
        try{ await loadProjectsSpace(); }catch{}
      }
      return true;
    }catch(error){
      const message=error&&error.message?error.message:'Could not save calculation.';
      if(!silent){
        setSync('Save failed','error');
        toast('Save failed: '+message,'error');
      }
      return false;
    }finally{
      state.busy=false;
    }
  }

  function scheduleAutosave() {
    window.clearTimeout(state.autosaveTimer);
    if(!state.estimateId) return;
    state.autosaveTimer=window.setTimeout(()=>{
      if(state.dirty) saveEstimate({draft:true,silent:true});
    },1800);
  }

  function renderHistory(rows) {
    const list = byId('recentList');
    if(!list) return;
    const items = Array.isArray(rows) ? rows : [];
    const historyCount=byId('historyCount');
    if(historyCount) historyCount.textContent = items.length + (items.length === 1 ? ' saved' : ' saved');

    if (!items.length) {
      list.innerHTML = '<p class="muted">No saved calculations match your search.</p>';
      return;
    }

    list.innerHTML = items.map((row) => {
      const client = row.client_name || 'Unnamed client';
      const address = row.project_address || 'No address';
      const updated = row.updated_at ? new Date(row.updated_at) : null;
      const created = row.created_at ? new Date(row.created_at) : null;
      const updatedText = updated ? updated.toLocaleDateString('nl-BE') + ' ' + updated.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' }) : '';
      const createdText = created ? created.toLocaleDateString('nl-BE') : '';
      return '<div class="history-row">' +
        '<button class="recent-item" type="button" data-estimate-id="' + escapeHtml(row.id) + '">' +
        '<div><strong>' + escapeHtml(client) + '</strong>' +
        '<span>' + escapeHtml(address) + '</span>' +
        '<div class="history-meta">' +
        (updatedText ? '<span class="history-chip">Updated ' + escapeHtml(updatedText) + '</span>' : '') +
        (createdText ? '<span class="history-chip">Created ' + escapeHtml(createdText) + '</span>' : '') +
        '</div></div>' +
        '<div class="history-amount">' + euro(Number(row.total_inc_vat || 0)) + '</div></button>' +
        '<button class="btn btn-secondary compact history-versions-btn" type="button" data-project-versions="' + escapeHtml(row.project_id || '') + '" data-project-title="' + escapeHtml(client + ' · ' + address) + '">Versions</button>' +
        '</div>';
    }).join('');

    list.querySelectorAll('[data-project-versions]').forEach((button) => {
      button.addEventListener('click', async () => {
        const projectId = button.getAttribute('data-project-versions');
        if (!projectId) return;
        await openVersions(projectId, button.getAttribute('data-project-title') || 'Project');
      });
    });

    list.querySelectorAll('[data-estimate-id]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          setSync('Loading calculation', 'busy');
          const rows = await rest('bathroom_estimates?id=eq.' + encodeURIComponent(button.getAttribute('data-estimate-id')) + '&deleted_at=is.null&select=*&limit=1');
          if (Array.isArray(rows) && rows[0]) fillEstimate(rows[0]);
          setSync('Synced');
        } catch (error) {
          setSync('Load failed', 'error');
          toast(error.message || 'Could not load calculation.', 'error');
        }
      });
    });
  }

  function filterHistory() {
    const query = byId('historySearch').value.trim().toLowerCase();
    if (!query) {
      renderHistory(state.historyRows);
      return;
    }

    const filtered = state.historyRows.filter((row) => {
      const updated = row.updated_at ? new Date(row.updated_at).toLocaleString('nl-BE') : '';
      const created = row.created_at ? new Date(row.created_at).toLocaleString('nl-BE') : '';
      const haystack = [
        row.client_name,
        row.project_address,
        row.client_phone,
        row.status,
        row.total_inc_vat,
        updated,
        created
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(query);
    });
    renderHistory(filtered);
  }

  async function loadRecent() {
    try {
      const rows = await rest('bathroom_estimates?deleted_at=is.null&select=id,project_id,client_name,client_phone,project_address,total_inc_vat,status,created_at,updated_at&order=updated_at.desc');
      state.historyRows = Array.isArray(rows) ? rows : [];
    } catch (error) {
      state.historyRows = [];
      setSync('Sync issue', 'error');
    }
  }





  const DUTCH_SCOPE = {
    'Light demolition':'Lichte afbraakwerken',
    'Full bathroom strip-out':'Volledige afbraak van de badkamer',
    'Heavy demolition / difficult access':'Zware afbraakwerken / moeilijke toegang',
    'Debris removal & disposal':'Afvoer en verwerking van bouwafval',
    'Local substrate repairs':'Lokale herstellingen van de ondergrond',
    'Major levelling / substrate repair':'Uitvlakking en uitgebreide herstelling van de ondergrond',
    'Rebuild walls / floor base':'Heropbouw van wanden / vloeropbouw',
    'Waterproofing system':'Plaatsing van waterdichtingssysteem',
    'Floor tiling':'Plaatsing vloertegels',
    'Wall tiling':'Plaatsing wandtegels',
    'Mortex floor finish':'Mortex vloerafwerking',
    'Mortex wall finish':'Mortex wandafwerking',
    'Move water connections':'Verplaatsen van wateraansluitingen',
    'Move drains':'Verplaatsen van afvoeren',
    'Electrical work':'Elektriciteitswerken',
    'Install walk-in shower':'Plaatsing inloopdouche',
    'Install bathtub':'Plaatsing bad',
    'Install toilet':'Plaatsing toilet',
    'Install vanity & basin':'Plaatsing badkamermeubel en wastafel',
    'Install towel radiator':'Plaatsing handdoekradiator',
    'Mechanical ventilation':'Mechanische ventilatie',
    'Ceiling repair / painting':'Herstelling en schilderwerken plafond',
    'Electric floor heating':'Elektrische vloerverwarming'
  };

  function pdfEuro(value) {
    return '€ ' + Number(value || 0).toLocaleString('nl-BE',{minimumFractionDigits:2,maximumFractionDigits:2}).replace(/\u00a0/g,' ');
  }

  function dutchDate(value) {
    const d = value ? new Date(value) : new Date();
    return new Intl.DateTimeFormat('nl-BE',{day:'2-digit',month:'2-digit',year:'numeric'}).format(d);
  }

  function isoDateAfterDays(days) {
    const d = new Date();
    d.setDate(d.getDate() + Math.max(1, Number(days) || 14));
    return d.toISOString().slice(0,10);
  }

  async function loadOfferteProfile() {
    const rows = await rest('bathroom_offerte_profiles?select=*&limit=1');
    if (Array.isArray(rows) && rows[0]) {
      state.offerteProfileId = rows[0].id;
      state.offerteProfile = rows[0];
    } else {
      state.offerteProfileId = null;
      state.offerteProfile = {
        company_name:'BV Reno Rangers',
        company_address:'Bergensesteenweg 24/08',
        company_postal_city:'1600 Sint-Pieters-Leeuw',
        vat_number:'BE0793260159',
        email:'info@renorangers.be',
        phone:'+32 465 88 39 19',
        website:'www.renorangers.be',
        iban:'',
        validity_days:14,
        payment_terms:'10% bij ondertekening van de offerte; 40% vóór bestelling van de materialen; 30% bij de start van de werken; 20% bij oplevering van het project.'
      };
    }
    return state.offerteProfile;
  }

  function fillOfferteProfileForm(profile) {
    const p = profile || {};
    setValue('companyName', p.company_name || '');
    setValue('companyAddress', p.company_address || '');
    setValue('companyPostalCity', p.company_postal_city || '');
    setValue('companyVat', p.vat_number || '');
    setValue('companyEmail', p.email || '');
    setValue('companyPhone', p.phone || '');
    setValue('companyWebsite', p.website || '');
    setValue('companyIban', p.iban || '');
    setValue('companyPaymentTerms', p.payment_terms || '');
  }

  function collectOfferteProfileForm() {
    return {
      company_name: byId('companyName').value.trim(),
      company_address: byId('companyAddress').value.trim(),
      company_postal_city: byId('companyPostalCity').value.trim(),
      vat_number: byId('companyVat').value.trim(),
      email: byId('companyEmail').value.trim(),
      phone: byId('companyPhone').value.trim(),
      website: byId('companyWebsite').value.trim(),
      iban: byId('companyIban').value.trim(),
      validity_days: state.offerteProfile && state.offerteProfile.validity_days ? state.offerteProfile.validity_days : 14,
      payment_terms: byId('companyPaymentTerms').value.trim(),
      updated_at: nowIso()
    };
  }

  async function saveOfferteProfile() {
    const userId = currentUserId();
    if (!userId) throw new Error('Not signed in');
    const payload = collectOfferteProfileForm();
    payload.user_id = userId;

    if (state.offerteProfileId) {
      const rows = await rest('bathroom_offerte_profiles?id=eq.' + encodeURIComponent(state.offerteProfileId), {
        method:'PATCH', body:payload, prefer:'return=representation'
      });
      if (Array.isArray(rows) && rows[0]) state.offerteProfile = rows[0];
    } else {
      const rows = await rest('bathroom_offerte_profiles', {
        method:'POST', body:payload, prefer:'return=representation'
      });
      if (Array.isArray(rows) && rows[0]) {
        state.offerteProfileId = rows[0].id;
        state.offerteProfile = rows[0];
      }
    }
    toast('Bedrijfsgegevens opgeslagen.');
  }

  async function suggestOfferteNumber() {
    const year = new Date().getFullYear();
    const rows = await rest('bathroom_offertes?select=offerte_number&offerte_number=like.OFF-' + year + '-*&order=created_at.desc');
    let max = 0;
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const m = String(row.offerte_number || '').match(/OFF-\\d{4}-(\\d+)/);
      if (m) max = Math.max(max, Number(m[1]) || 0);
    });
    return 'OFF-' + year + '-' + String(max + 1).padStart(3,'0');
  }

  async function openOfferteModal() {
    try {
      if (!state.estimateId || !state.projectId) {
        toast('Project eerst opslaan…');
        const saved=await saveEstimate({draft:false});
        if(!saved) throw new Error('Save the calculation before creating an offerte.');
      }
      if (!state.estimateId || !state.projectId) throw new Error('Save the calculation before creating an offerte.');
      if (!state.offerteProfile) await loadOfferteProfile();

      fillOfferteProfileForm(state.offerteProfile);
      byId('offerteNumber').value = await suggestOfferteNumber();
      byId('offerteClientEmail').value = byId('clientEmail').value.trim();
      const days = Number(state.offerteProfile.validity_days || 14);
      byId('offerteValidityDate').value = isoDateAfterDays(days);
      const label = byId('clientName').value.trim() || byId('projectAddress').value.trim() || 'Badkamerrenovatie';
      byId('offerteProjectLabel').value = label;
      byId('offerteProjectPreview').textContent = label;
      byId('offerteTotalPreview').textContent = euro(state.lastResult ? state.lastResult.totalIncVat : 0);
      state.currentOfferteId = null;
      state.currentOfferteBlob = null;
      state.currentOfferteFilename = null;
      byId('offerteModal').hidden = false;
    } catch (error) {
      toast(error.message || 'Kon offerte niet openen.', 'error');
    }
  }

  function closeOfferteModal() {
    byId('offerteModal').hidden = true;
  }

  function addPdfWrappedText(doc, textValue, x, y, maxWidth, lineHeight) {
    const lines = doc.splitTextToSize(String(textValue || ''), maxWidth);
    doc.text(lines, x, y);
    return y + lines.length * lineHeight;
  }

  async function loadLogoDataUrl() {
    const response=await fetch('./assets/rr-logo.png');
    if(!response.ok) return null;
    const blob=await response.blob();
    return await new Promise((resolve)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(reader.result);
      reader.onerror=()=>resolve(null);
      reader.readAsDataURL(blob);
    });
  }

  async function generateOffertePdfBlob() {
    if(!window.jspdf||!window.jspdf.jsPDF) throw new Error('PDF module is nog niet geladen.');
    const profile=collectOfferteProfileForm();
    if(!profile.company_name) throw new Error('Vul eerst de bedrijfsnaam in.');
    const result=state.lastResult||calculate();
    const {jsPDF}=window.jspdf;
    const doc=new jsPDF({unit:'mm',format:'a4'});
    const pageW=210,pageH=297,m=16,red=[255,49,49],black=[0,0,0];
    const logo=await loadLogoDataUrl();

    function footer(){
      doc.setDrawColor(...red); doc.setLineWidth(0.8); doc.line(m,pageH-17,pageW-m,pageH-17);
      doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(80,80,80);
      const txt=[profile.company_name,profile.vat_number?'BTW '+profile.vat_number:'',profile.company_address,profile.company_postal_city,profile.email,profile.phone,profile.website].filter(Boolean).join('  |  ');
      doc.text(doc.splitTextToSize(txt,pageW-2*m),m,pageH-11);
    }
    function header(title){
      if(logo) doc.addImage(logo,'PNG',m,12,34,16);
      doc.setTextColor(...black); doc.setFont('helvetica','bold'); doc.setFontSize(22);
      doc.text(title,pageW-m,21,{align:'right'});
      doc.setDrawColor(...red); doc.setLineWidth(1.2); doc.line(m,33,pageW-m,33);
    }
    function newPage(title){doc.addPage(); header(title); footer();}
    function wrap(text,x,y,w,size=9,lh=4.4,bold=false){
      doc.setFont('helvetica',bold?'bold':'normal'); doc.setFontSize(size); doc.setTextColor(25,25,25);
      const lines=doc.splitTextToSize(String(text||''),w); doc.text(lines,x,y); return y+lines.length*lh;
    }

    // Cover
    header('OFFERTE');
    doc.setFont('helvetica','bold'); doc.setFontSize(17); doc.setTextColor(...black);
    doc.text('Voor badkamer renovatie project',m,51);
    doc.setFillColor(...red); doc.roundedRect(m,59,82,3,1,1,'F');
    doc.setFontSize(10); doc.setFont('helvetica','normal');
    doc.text('Klant',m,76); doc.setFont('helvetica','bold'); doc.text(byId('clientName').value.trim()||'Klant',m+28,76);
    doc.setFont('helvetica','normal'); doc.text('Adres',m,84); doc.setFont('helvetica','bold'); doc.text(byId('projectAddress').value.trim()||'-',m+28,84);
    doc.setFont('helvetica','normal'); doc.text('E-mail',m,92); doc.setFont('helvetica','bold'); doc.text(byId('offerteClientEmail').value.trim()||'-',m+28,92);

    const nr=byId('offerteNumber').value.trim();
    doc.setFont('helvetica','normal'); doc.setFontSize(9);
    doc.text('NUMMER:',pageW-76,74); doc.text(nr,pageW-m,74,{align:'right'});
    doc.text('DATUM:',pageW-76,82); doc.text(dutchDate(new Date()),pageW-m,82,{align:'right'});
    doc.text('VERVALDAG:',pageW-76,90); doc.text(dutchDate(byId('offerteValidityDate').value),pageW-m,90,{align:'right'});

    let y=116;
    y=wrap(byId('offerteIntro').value.trim(),m,y,pageW-2*m,10,5);
    y+=10;
    doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(...black); doc.text('BV RENO RANGERS',m,y); y+=6;
    doc.setFont('helvetica','normal'); doc.setFontSize(9);
    [profile.vat_number?'BTW '+profile.vat_number:'',profile.company_address,profile.company_postal_city,profile.email,profile.phone,profile.website].filter(Boolean).forEach(t=>{doc.text(t,m,y);y+=5;});
    footer();

    // Scope + totals
    newPage('WERKEN');
    y=48;
    doc.setFont('helvetica','bold'); doc.setFontSize(12); doc.text('Omschrijving van de werken',m,y); y+=8;
    (result.lines||[]).forEach((line,idx)=>{
      const title=DUTCH_SCOPE[line.name]||line.name;
      const meta=line.meta?String(line.meta):'';
      const block=doc.splitTextToSize((idx+1)+'. '+title+(meta?'  ·  '+meta:''),pageW-2*m-8);
      if(y+block.length*5>pageH-28){newPage('WERKEN');y=48;}
      doc.setFillColor(248,248,248); doc.roundedRect(m,y-4,pageW-2*m,block.length*5+4,2,2,'F');
      doc.setTextColor(...black); doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.text(block,m+4,y); y+=block.length*5+7;
    });
    if(y>220){newPage('TOTAAL');y=48;}
    const vatPct=Math.round((result.vatRate||0)*100),vatAmount=result.totalIncVat-result.totalExVat;
    doc.setDrawColor(...red); doc.setLineWidth(0.8); doc.line(112,y,194,y); y+=9;
    doc.setFontSize(10); doc.setTextColor(70,70,70); doc.text('Totaal excl. BTW',112,y); doc.setTextColor(...black); doc.text(pdfEuro(result.totalExVat),194,y,{align:'right'}); y+=7;
    doc.setTextColor(70,70,70); doc.text('BTW '+vatPct+'%',112,y); doc.setTextColor(...black); doc.text(pdfEuro(vatAmount),194,y,{align:'right'}); y+=9;
    doc.setFont('helvetica','bold'); doc.setFontSize(15); doc.text('TOTAAL INCL. BTW',112,y); doc.setTextColor(...red); doc.text(pdfEuro(result.totalIncVat),194,y,{align:'right'});
    y+=18;
    doc.setTextColor(...black); doc.setFontSize(10); doc.text('Betalingsvoorwaarden',m,y); y+=7;
    ['10% bij ondertekening van de offerte om het project in de planning te bevestigen.',
     '40% vóór bestelling van de materialen. Materialen worden pas besteld na ontvangst van deze betaling.',
     '30% bij de start van de werken, uiterlijk op de eerste werkdag.',
     '20% bij oplevering van het project, na afronding van de werken.'].forEach(t=>{y=wrap('• '+t,m,y,pageW-2*m,8.5,4.2);y+=2;});
    footer();

    // General conditions
    const terms=[
      ['1. Offerte en akkoord','De offerte is opgesteld op basis van de informatie, afmetingen, materiaalkeuzes en zichtbare toestand van de werf op het moment van opmaak. Door ondertekening of schriftelijke goedkeuring bevestigt de klant akkoord te gaan met de omschreven werken, prijzen, betalingsvoorwaarden en algemene voorwaarden.'],
      ['2. Omvang van de werken','Reno Rangers voert enkel de werken uit die duidelijk in de offerte vermeld staan. Niet-vermelde werken en noodzakelijke bijkomende werken door verborgen schade of technische aanpassingen kunnen apart worden aangerekend na overleg.'],
      ['3. Materialen en keuzes','De materiaalprijs is gebaseerd op de keuzes die gekend zijn bij opmaak. Wijzigingen in sanitaire toestellen, kranen, doucheglas, radiator, accessoires, vloerbekleding of andere materialen kunnen de eindprijs aanpassen.'],
      ['4. Prijs en btw','Alle prijzen zijn gebaseerd op de gekende situatie bij opmaak. Indien de voorwaarden voor het verlaagde btw-tarief van 6% niet vervuld zijn, wordt 21% toegepast.'],
      ['5. Betalingsvoorwaarden','10% bij ondertekening, 40% vóór bestelling van materialen, 30% bij de start van de werken en 20% bij oplevering.'],
      ['6. Planning en uitvoering','De planning wordt in overleg bepaald en is indicatief tenzij schriftelijk anders overeengekomen. Leveranciersvertraging, bijkomende werken, verborgen gebreken, ziekte of overmacht kunnen de planning wijzigen.'],
      ['7. Toegang tot de werf','De klant zorgt voor vrije toegang tot de werkzone, water, elektriciteit en voldoende ruimte voor materialen en gereedschap.'],
      ['8. Bescherming, stof en hinder','Reno Rangers neemt redelijke maatregelen om vloeren, trappen en omliggende zones te beschermen. Stof, lawaai en tijdelijke hinder kunnen bij renovatiewerken niet volledig worden uitgesloten.'],
      ['9. Verborgen gebreken','Verborgen gebreken zoals lekken, slechte leidingen, vochtproblemen, rotte constructies, onstabiele ondergronden of elektrische problemen worden gemeld en bijkomende werken gebeuren na overleg.'],
      ['10. Mortex en ambachtelijke afwerking','Lichte verschillen in kleur, textuur, structuur, glansgraad of schakering horen bij het ambachtelijke karakter van Mortex en gelden niet als gebrek.'],
      ['11. Wijzigingen tijdens de werken','Wijzigingen door de klant kunnen invloed hebben op prijs, planning, materiaalkeuze en technische uitvoering en worden bij voorkeur schriftelijk bevestigd.'],
      ['12. Oplevering','Na afronding gebeurt een controle met de klant. Zichtbare opmerkingen worden bij oplevering gemeld; kleine restpunten kunnen nadien worden ingepland.'],
      ['13. Garantie en aansprakelijkheid','De garantie geldt enkel op werken uitgevoerd door Reno Rangers en op materialen geleverd door Reno Rangers, binnen de toepasselijke voorwaarden.'],
      ['14. Annulatie door de klant','Bij annulatie na goedkeuring kunnen reeds gemaakte kosten, bestelde materialen, voorbereiding, gereserveerde planning en uitgevoerde werken worden aangerekend.'],
      ['15. Foto’s en portfolio','Reno Rangers mag foto’s nemen voor werfopvolging, kwaliteitscontrole en portfolio. Foto’s met personen, persoonsgegevens of herkenbare privé-elementen worden niet publiek gebruikt zonder toestemming.'],
      ['16. Overmacht','Reno Rangers is niet aansprakelijk voor vertraging of niet-uitvoering door omstandigheden buiten haar controle, zoals ziekte, leveringsproblemen, technische problemen, extreme weersomstandigheden of onvoorziene situaties op de werf.'],
      ['17. Betwistingen','Bij vragen of opmerkingen proberen klant en Reno Rangers eerst samen een redelijke oplossing te vinden. Op de overeenkomst is Belgisch recht van toepassing.'],
      ['18. Akkoordverklaring','Door ondertekening verklaart de klant: “Ik heb de offerte en de algemene voorwaarden gelezen, begrepen en goedgekeurd.”']
    ];
    newPage('ALGEMENE VOORWAARDEN');
    y=48;
    terms.forEach(([head,body])=>{
      const needed=8+doc.splitTextToSize(body,pageW-2*m).length*4.1;
      if(y+needed>pageH-25){newPage('ALGEMENE VOORWAARDEN');y=48;}
      doc.setFont('helvetica','bold');doc.setFontSize(9);doc.setTextColor(...black);doc.text(head,m,y);y+=5;
      y=wrap(body,m,y,pageW-2*m,8,4.1);y+=4;
    });

    if(y>225){newPage('AKKOORD');y=48;}
    y+=4; doc.setDrawColor(...red); doc.line(m,y,pageW-m,y); y+=10;
    doc.setFont('helvetica','bold');doc.setFontSize(11);doc.text('Voor akkoord',m,y);y+=18;
    doc.setDrawColor(150);doc.line(m,y,m+72,y);doc.line(pageW-m-72,y,pageW-m,y);
    doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(100);
    doc.text('Naam klant & datum',m,y+5);doc.text('Handtekening',pageW-m-72,y+5);
    footer();

    // Thank-you page
    newPage('BEDANKT VOOR UW VERTROUWEN');
    y=64;
    y=wrap('Bij Reno Rangers geloven we dat elke renovatie begint met vertrouwen en eindigt met tevredenheid.',m,y,pageW-2*m,13,6,true);y+=8;
    y=wrap('Bedankt dat u de tijd heeft genomen om onze offerte te bekijken. Wij waarderen uw interesse en de kans om mee te denken aan uw project.',m,y,pageW-2*m,10,5);y+=6;
    y=wrap('Of het nu gaat om één ruimte of een volledige renovatie – wij zorgen voor een vlotte samenwerking, duidelijke communicatie en een resultaat waar u trots op kunt zijn.',m,y,pageW-2*m,10,5);y+=14;
    doc.setFont('helvetica','bold');doc.setFontSize(16);doc.setTextColor(...red);doc.text('Uw woning, onze zorg.',m,y);y+=9;doc.text('Uw tevredenheid, onze motivatie.',m,y);
    footer();

    return doc.output('blob');
  }

  async function uploadPdfBlob(blob, storagePath) {
    const token = await getValidToken();
    const response = await fetch(
      SUPABASE_URL + '/storage/v1/object/bathroom-offertes/' + encodeStoragePath(storagePath),
      {
        method:'POST',
        headers:{
          apikey:SUPABASE_KEY,
          Authorization:'Bearer ' + token,
          'Content-Type':'application/pdf',
          'x-upsert':'false'
        },
        body:blob
      }
    );
    if (!response.ok) {
      const detail = await response.text();
      throw new Error('PDF upload failed: ' + (detail || response.status));
    }
  }

  async function ensureSavedOfferte() {
    if (state.currentOfferteId && state.currentOfferteBlob && state.currentOfferteFilename) {
      const existing = await rest('bathroom_offertes?id=eq.' + encodeURIComponent(state.currentOfferteId) + '&select=*&limit=1');
      if (Array.isArray(existing) && existing[0]) return existing[0];
    }

    await saveOfferteProfile();
    const blob = await generateOffertePdfBlob();
    const userId = currentUserId();
    const number = byId('offerteNumber').value.trim();
    if (!number) throw new Error('Offertenummer ontbreekt.');
    const filename = number.replace(/[^a-zA-Z0-9._-]/g,'-') + '.pdf';
    const storagePath = userId + '/' + state.projectId + '/' + Date.now() + '-' + filename;
    await uploadPdfBlob(blob,storagePath);

    const validity = byId('offerteValidityDate').value || null;
    const result = state.lastResult || calculate();
    const rows = await rest('bathroom_offertes',{
      method:'POST',
      body:{
        project_id:state.projectId,
        estimate_id:state.estimateId,
        user_id:userId,
        offerte_number:number,
        status:'draft',
        client_name:byId('clientName').value.trim(),
        client_email:byId('offerteClientEmail').value.trim(),
        project_address:byId('projectAddress').value.trim(),
        total_ex_vat:Number(result.totalExVat.toFixed(2)),
        vat_rate:Number(result.vatRate.toFixed(4)),
        total_inc_vat:Number(result.totalIncVat.toFixed(2)),
        validity_date:validity,
        storage_path:storagePath
      },
      prefer:'return=representation'
    });
    if (!Array.isArray(rows) || !rows[0]) throw new Error('Kon offerte niet opslaan.');
    state.currentOfferteId = rows[0].id;
    state.currentOfferteBlob = blob;
    state.currentOfferteFilename = filename;
    return rows[0];
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
  }

  async function downloadCurrentOfferte() {
    try {
      setSync('Offerte maken','busy');
      const row = await ensureSavedOfferte();
      downloadBlob(state.currentOfferteBlob,state.currentOfferteFilename);
      setSync('Synced');
      toast('Offerte ' + row.offerte_number + ' opgeslagen en gedownload.');
      await loadProjectOffertes(state.projectId);
      if(!byId('offersModal').hidden) await openOffersSpace();
    } catch (error) {
      setSync('Offerte failed','error');
      toast(error.message || 'Kon offerte niet maken.','error');
    }
  }

  async function sendCurrentOfferte() {
    try {
      setSync('Offerte maken','busy');
      const row = await ensureSavedOfferte();
      const file = new File([state.currentOfferteBlob], state.currentOfferteFilename, {type:'application/pdf'});
      const subject = 'Offerte ' + row.offerte_number + ' - badkamerrenovatie';
      const textBody = 'Beste ' + (byId('clientName').value.trim() || 'klant') + ',\n\nIn bijlage vindt u onze offerte voor de badkamerrenovatie.\n\nMet vriendelijke groeten,\n' + (byId('companyName').value.trim() || '');

      if (navigator.share && (!navigator.canShare || navigator.canShare({files:[file]}))) {
        await navigator.share({title:subject,text:textBody,files:[file]});
      } else {
        downloadBlob(state.currentOfferteBlob,state.currentOfferteFilename);
        const email = byId('offerteClientEmail').value.trim();
        window.location.href = 'mailto:' + encodeURIComponent(email) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(textBody + '\n\nDe PDF is gedownload en kan als bijlage worden toegevoegd.');
      }

      await rest('bathroom_offertes?id=eq.' + encodeURIComponent(row.id),{
        method:'PATCH',
        body:{status:'sent',sent_at:nowIso()},
        prefer:'return=minimal'
      });
      setSync('Synced');
      toast('Offerte gemarkeerd als verzonden.');
      await loadProjectOffertes(state.projectId);
      if(!byId('offersModal').hidden) await openOffersSpace();
    } catch (error) {
      if (error && error.name === 'AbortError') {
        setSync('Synced');
        toast('Versturen geannuleerd.');
      } else {
        setSync('Offerte failed','error');
        toast(error.message || 'Kon offerte niet versturen.','error');
      }
    }
  }

  async function downloadStoredOfferte(row) {
    const token = await getValidToken();
    const response = await fetch(SUPABASE_URL + '/storage/v1/object/bathroom-offertes/' + encodeStoragePath(row.storage_path),{
      headers:{apikey:SUPABASE_KEY,Authorization:'Bearer ' + token}
    });
    if (!response.ok) throw new Error('Kon PDF niet laden.');
    const blob = await response.blob();
    downloadBlob(blob,row.offerte_number + '.pdf');
  }


  function closeOffersSpace(){ byId('offersModal').hidden=true; }

  function renderAllOffertes(rows){
    const list=byId('allOffertesList');
    const items=Array.isArray(rows)?rows:[];
    byId('offersCount').textContent=items.length+(items.length===1?' offer':' offers');
    if(!items.length){
      list.innerHTML='<div class="project-empty"><strong>No offers yet</strong><span>Create an offerte from a saved calculation and it will appear here.</span></div>';
      return;
    }
    list.innerHTML=items.map((row)=>{
      const date=row.created_at?dutchDate(row.created_at):'';
      return '<article class="offer-card">'+
        '<div><h3>'+escapeHtml(row.offerte_number)+'</h3>'+
        '<div class="offer-client">'+escapeHtml(row.client_name||'Unnamed client')+' · '+escapeHtml(row.project_address||'No address')+'</div>'+
        '<div class="offer-meta"><span>'+escapeHtml(date)+'</span><span>'+escapeHtml(row.status||'draft')+'</span></div></div>'+
        '<div class="offer-actions"><div class="offer-total">'+euro(Number(row.total_inc_vat||0))+'</div>'+
        '<button class="btn btn-secondary compact" type="button" data-all-offer-pdf="'+escapeHtml(row.id)+'">PDF</button></div>'+
      '</article>';
    }).join('');
    list.querySelectorAll('[data-all-offer-pdf]').forEach((button)=>{
      button.addEventListener('click',async()=>{
        const row=items.find((x)=>x.id===button.getAttribute('data-all-offer-pdf'));
        if(!row)return;
        try{await downloadStoredOfferte(row);}catch(error){toast(error.message||'Could not load PDF.','error');}
      });
    });
  }

  function filterAllOffertes(){
    const q=byId('offersSearch').value.trim().toLowerCase();
    if(!q){renderAllOffertes(state.allOffertesRows);return;}
    renderAllOffertes(state.allOffertesRows.filter((row)=>
      [row.offerte_number,row.client_name,row.project_address,row.status,row.total_inc_vat]
        .filter((v)=>v!=null).join(' ').toLowerCase().includes(q)
    ));
  }

  async function openOffersSpace(){
    byId('offersModal').hidden=false;
    byId('offersSearch').value='';
    byId('allOffertesList').innerHTML='<div class="gallery-loading">Loading offers…</div>';
    try{
      const rows=await rest('bathroom_offertes?select=*&order=created_at.desc');
      state.allOffertesRows=Array.isArray(rows)?rows:[];
      renderAllOffertes(state.allOffertesRows);
    }catch(error){
      byId('allOffertesList').innerHTML='<div class="project-empty"><strong>Could not load offers</strong><span>'+escapeHtml(error.message||'Please try again.')+'</span></div>';
    }
  }

  async function loadProjectOffertes(projectId) {
    const list = byId('projectOffertesList');
    if (!list) return;
    try {
      const rows = await rest(
        'bathroom_offertes?project_id=eq.' + encodeURIComponent(projectId) +
        '&select=*&order=created_at.desc'
      );
      const items = Array.isArray(rows) ? rows : [];
      if (!items.length) {
        list.innerHTML = '<p class="muted">Nog geen offertes voor dit project.</p>';
        return;
      }
      list.innerHTML = items.map((row)=> {
        const when = row.created_at ? dutchDate(row.created_at) : '';
        return '<div class="offerte-row">' +
          '<div><strong>' + escapeHtml(row.offerte_number) + '</strong><small>' + escapeHtml(when) + ' · ' + euro(Number(row.total_inc_vat||0)) + '</small></div>' +
          '<div class="offerte-row-actions"><span class="offerte-status">' + escapeHtml(row.status) + '</span>' +
          '<button class="btn btn-secondary compact" type="button" data-offerte-download="' + escapeHtml(row.id) + '">PDF</button></div>' +
        '</div>';
      }).join('');
      list.querySelectorAll('[data-offerte-download]').forEach((button)=>{
        button.addEventListener('click',async()=>{
          const row = items.find((x)=>x.id===button.getAttribute('data-offerte-download'));
          if (!row) return;
          try { await downloadStoredOfferte(row); } catch(error){ toast(error.message || 'Kon PDF niet laden.','error'); }
        });
      });
    } catch {
      list.innerHTML = '<p class="muted">Kon offertes niet laden.</p>';
    }
  }


  async function deleteCurrentCalculation() {
    if(!state.estimateId){
      toast('This calculation has not been saved yet.','error');
      return;
    }

    const client=byId('clientName').value.trim()||'this client';
    const amount=state.lastResult?euro(state.lastResult.totalIncVat):'';
    const message='Delete this calculation for '+client+(amount?' ('+amount+')':'')+'?\n\nThe calculation and its saved versions will be removed. The Project, Photos and Offertes stay available.';
    if(!window.confirm(message)) return;

    const estimateId=state.estimateId;
    const projectId=state.projectId;
    try{
      setSync('Deleting…','busy');
      const rows=await rest('rpc/delete_bathroom_calculation',{
        method:'POST',
        body:{p_estimate_id:estimateId}
      });
      if(!Array.isArray(rows)||!rows[0]) throw new Error('Delete was not confirmed by the database.');

      state.estimateId=null;
      state.projectId=projectId;
      resetEstimate();
      state.projectId=projectId;
      setSync('Deleted');
      toast('Calculation deleted.');
      try{await loadProjectsSpace();}catch{}
      if(!byId('versionsModal').hidden){
        closeVersions();
      }
    }catch(error){
      setSync('Delete failed','error');
      toast('Delete failed: '+(error.message||'Could not delete calculation.'),'error');
    }
  }

  function openSettings() {
    if(state.offerteProfile) fillOfferteProfileForm(state.offerteProfile);
    byId('settingsModal').hidden=false;
  }

  function closeSettings() {
    byId('settingsModal').hidden=true;
  }

  function closeProjectsSpace() {
    byId('projectsModal').hidden = true;
  }

  function renderProjects(rows) {
    const list = byId('projectsList');
    const items = Array.isArray(rows) ? rows : [];
    byId('projectsCount').textContent = items.length + (items.length === 1 ? ' project' : ' projects');

    if (!items.length) {
      list.innerHTML = '<div class="project-empty"><strong>No saved projects yet</strong><span>Save an estimate and it will appear here.</span></div>';
      return;
    }

    list.innerHTML = items.map((row) => {
      const title = row.client_name || row.title || row.project_address || 'Bathroom project';
      const address = row.project_address || 'No address';
      const updated = row.updated_at ? new Date(row.updated_at) : null;
      const updatedText = updated ? updated.toLocaleDateString('nl-BE') + ' ' + updated.toLocaleTimeString('nl-BE', { hour:'2-digit', minute:'2-digit' }) : '';
      const latest = row.latest_estimate || null;
      const total = latest ? euro(Number(latest.total_inc_vat || 0)) : 'No estimate';
      const versions = Number(row.version_count || 0);
      return '<article class="project-card" data-project-card="' + escapeHtml(row.id) + '">' +
        '<div>' +
          '<h3>' + escapeHtml(title) + '</h3>' +
          '<div class="project-address">' + escapeHtml(address) + '</div>' +
          '<div class="project-meta">' +
            (updatedText ? '<span>Updated ' + escapeHtml(updatedText) + '</span>' : '') +
            '<span>' + versions + (versions === 1 ? ' saved version' : ' saved versions') + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="project-actions">' +
          '<div class="project-total">' + escapeHtml(total) + '</div>' +
          '<button class="btn btn-primary compact" type="button" data-project-details="' + escapeHtml(row.id) + '">Open project</button>' +
        '</div>' +
      '</article>';
    }).join('');

    list.querySelectorAll('[data-project-details]').forEach((button) => {
      button.addEventListener('click', async () => {
        await openSavedProject(button.getAttribute('data-project-details'), true);
      });
    });
  }

  function filterProjects() {
    const query = byId('projectsSearch').value.trim().toLowerCase();
    if (!query) {
      renderProjects(state.projectsRows);
      return;
    }
    renderProjects(state.projectsRows.filter((row) => {
      return [row.title,row.client_name,row.client_phone,row.project_address,row.status]
        .filter(Boolean).join(' ').toLowerCase().includes(query);
    }));
  }

  async function loadProjectsSpace() {
    const list=byId('projectsList');
    list.innerHTML='<div class="gallery-loading">Loading saved projects…</div>';
    const rows=await rest('rpc/get_bathroom_project_summaries',{method:'POST',body:{}});
    state.projectsRows=(Array.isArray(rows)?rows:[]).map((row)=>Object.assign({},row,{
      latest_estimate:row.latest_estimate_id?{
        id:row.latest_estimate_id,
        total_inc_vat:row.latest_total_inc_vat,
        updated_at:row.latest_estimate_updated_at
      }:null,
      version_count:Number(row.version_count||0)
    }));
    renderProjects(state.projectsRows);
  }

  async function openProjectsSpace() {
    try {
      byId('projectsModal').hidden = false;
      byId('projectsSearch').value = '';
      await loadProjectsSpace();
    } catch (error) {
      byId('projectsList').innerHTML = '<div class="project-empty"><strong>Could not load projects</strong><span>' + escapeHtml(error.message || 'Please try again.') + '</span></div>';
    }
  }

  async function openSavedProject(projectId, showDetails) {
    try {
      const rows = await rest(
        'bathroom_estimates?project_id=eq.' + encodeURIComponent(projectId) +
        '&deleted_at=is.null&select=*&order=updated_at.desc&limit=1'
      );
      const estimate = Array.isArray(rows) && rows[0] ? rows[0] : null;
      const project = state.projectsRows.find((row) => row.id === projectId);

      if (estimate) {
        fillEstimate(estimate);
      } else {
        state.projectId = projectId;
      }

      closeProjectsSpace();

      if (showDetails) {
        if (estimate) {
          const count = await refreshGalleryCount();
          byId('projectPhotoCount').textContent = String(count);
        } else {
          byId('projectPhotoCount').textContent = '0';
        }
        const label = project ?
          (project.client_name || project.title || project.project_address || 'Bathroom project') :
          'Bathroom project';
        await openVersions(projectId, label);
        await loadProjectOffertes(projectId);
      } else {
        toast('Project opened.');
      }
    } catch (error) {
      toast(error.message || 'Could not open project.', 'error');
    }
  }

  async function openCurrentProject() {
    try {
      if (!state.projectId || !state.estimateId) {
        toast('Saving project first…');
        await saveEstimate();
      }
      if (!state.projectId) return;

      const label =
        byId('clientName').value.trim() ||
        byId('projectAddress').value.trim() ||
        'Bathroom project';

      const count = await refreshGalleryCount();
      byId('projectPhotoCount').textContent = String(count);
      await openVersions(state.projectId, label);
    } catch (error) {
      toast(error.message || 'Could not open project.', 'error');
    }
  }

  async function openVersions(projectId, label) {
    byId('versionsProjectLabel').textContent = label || 'Project';
    loadProjectOffertes(projectId);
    byId('versionsModal').hidden = false;
    const list = byId('versionsList');
    list.innerHTML = '<div class="gallery-loading">Loading calculations…</div>';
    try {
      const rows = await rest(
        'bathroom_calculation_versions?project_id=eq.' + encodeURIComponent(projectId) +
        '&select=id,project_id,estimate_id,snapshot,total_inc_vat,saved_at&order=saved_at.desc'
      );
      const items = Array.isArray(rows) ? rows : [];
      if (!items.length) {
        list.innerHTML = '<p class="muted">No saved calculation versions yet.</p>';
        return;
      }
      list.innerHTML = items.map((row, index) => {
        const date = row.saved_at ? new Date(row.saved_at) : null;
        const when = date ? date.toLocaleDateString('nl-BE') + ' ' + date.toLocaleTimeString('nl-BE', { hour:'2-digit', minute:'2-digit' }) : '';
        return '<button class="version-item" type="button" data-version-id="' + escapeHtml(row.id) + '">' +
          '<div><strong>Calculation ' + (items.length - index) + '</strong><span>' + escapeHtml(when) + '</span></div>' +
          '<b>' + euro(Number(row.total_inc_vat || 0)) + '</b></button>';
      }).join('');
      list.querySelectorAll('[data-version-id]').forEach((button) => {
        button.addEventListener('click', async () => {
          try {
            const rows = await rest('bathroom_calculation_versions?id=eq.' + encodeURIComponent(button.getAttribute('data-version-id')) + '&select=*&limit=1');
            if (!Array.isArray(rows) || !rows[0]) return;
            const version = rows[0];
            const snapshot = version.snapshot || {};
            fillEstimate({
              id: version.estimate_id,
              project_id: version.project_id,
              client_name: snapshot.client_name || '',
              client_phone: snapshot.client_phone || '',
              project_address: snapshot.project_address || '',
              status: snapshot.status || 'estimate',
              room: snapshot.room || {},
              scope: snapshot.scope || {},
              selections: snapshot.selections || {},
              pricing_snapshot: snapshot.pricing_snapshot || {},
              calculations: snapshot.calculations || {},
              notes: snapshot.notes || ''
            });
            byId('estimateState').textContent = 'Historical calculation';
            setWizardStep(6,{noScroll:true});
            closeVersions();
            toast('Saved calculation loaded.');
          } catch (error) {
            toast(error.message || 'Could not load calculation version.', 'error');
          }
        });
      });
    } catch (error) {
      list.innerHTML = '<p class="muted">Could not load project calculations.</p>';
    }
  }

  function closeVersions() {
    byId('versionsModal').hidden = true;
  }

  async function enterApp() {
    byId('authGate').hidden = true;
    byId('app').hidden = false;
    setSync('Connecting', 'busy');
    try {
      await loadPricing();
      await loadOfferteProfile();
      calculate();
      await openProjectsSpace();
    } catch (error) {
      setSync('Sync issue', 'error');
      toast(error.message || 'Connected, but some data could not load.', 'error');
      calculate();
    }
  }

  async function restoreSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return false;
      state.session = JSON.parse(raw);
      if (!state.session || !state.session.access_token) {
        clearSession();
        return false;
      }
      await getValidToken();
      return true;
    } catch {
      clearSession();
      return false;
    }
  }

  function bindEvents() {
    byId('authForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const message = byId('authMessage');
      message.className = 'message';
      message.textContent = 'Signing in…';
      try {
        await signIn(byId('authEmail').value, byId('authPassword').value);
        message.textContent = '';
      } catch (error) {
        message.className = 'message error';
        message.textContent = error.message || 'Sign in failed.';
      }
    });

    byId('signUpBtn').addEventListener('click', async () => {
      const message = byId('authMessage');
      message.className = 'message';
      message.textContent = 'Creating account…';
      try {
        const result = await signUp(byId('authEmail').value, byId('authPassword').value);
        message.className = 'message ok';
        message.textContent = result;
      } catch (error) {
        message.className = 'message error';
        message.textContent = error.message || 'Could not create account.';
      }
    });

    byId('signOutBtn').addEventListener('click', signOut);
    byId('saveBtn').addEventListener('click', () => saveEstimate({draft:false}));
    byId('saveBtnMobile').addEventListener('click', () => saveEstimate({draft:false}));
    byId('mobileSaveBtn').addEventListener('click', () => saveEstimate({draft:false}));
    byId('newBtn').addEventListener('click', resetEstimate);
    byId('wizardBackBtn').addEventListener('click', wizardBack);
    byId('wizardNextBtn').addEventListener('click', wizardNext);
    byId('mobileNewBtn').addEventListener('click', resetEstimate);
    byId('saveRatesBtn').addEventListener('click', async () => {
      try { await savePricing(); } catch (error) {
        setSync('Save failed', 'error');
        toast(error.message || 'Could not save rates.', 'error');
      }
    });
    byId('deleteCalculationBtn').addEventListener('click', deleteCurrentCalculation);
    byId('projectDeleteCalculationBtn').addEventListener('click', async () => {
      closeVersions();
      await deleteCurrentCalculation();
    });
    byId('offerteBtn').addEventListener('click', openOfferteModal);
    byId('mobileProjectBtn').addEventListener('click', openProjectsSpace);
    byId('projectsBtn').addEventListener('click', openProjectsSpace);
    byId('topOffersBtn').addEventListener('click', openOffersSpace);
    byId('projectsOffersBtn').addEventListener('click', openOffersSpace);
    byId('offersCloseBtn').addEventListener('click', closeOffersSpace);
    byId('offersSearch').addEventListener('input', filterAllOffertes);
    document.querySelectorAll('[data-offers-close]').forEach((el)=>el.addEventListener('click',closeOffersSpace));
    byId('projectsNewBtn').addEventListener('click', () => { closeProjectsSpace(); resetEstimate(); });
    byId('settingsBtn').addEventListener('click', openSettings);
    byId('projectsSettingsBtn').addEventListener('click', openSettings);
    byId('settingsCloseBtn').addEventListener('click', closeSettings);
    document.querySelectorAll('[data-settings-close]').forEach((el)=>el.addEventListener('click',closeSettings));
    byId('topOfferteBtn').addEventListener('click', openOfferteModal);
    byId('mobileOfferteBtn').addEventListener('click', openOfferteModal);
    byId('summaryClientBtn').addEventListener('click', () => {
      setClientMode(true);
      window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'});
    });
    byId('galleryCameraBtn').addEventListener('click', () => byId('galleryCameraInput').click());
    byId('galleryUploadBtn').addEventListener('click', () => byId('galleryInput').click());
    byId('galleryCameraInput').addEventListener('change', async (event) => {
      try {
        await uploadGalleryFiles(event.target.files);
      } catch (error) {
        setSync('Upload failed', 'error');
        toast(error.message || 'Could not upload photo.', 'error');
      } finally {
        event.target.value = '';
      }
    });
    byId('galleryInput').addEventListener('change', async (event) => {
      try {
        await uploadGalleryFiles(event.target.files);
      } catch (error) {
        setSync('Upload failed', 'error');
        toast(error.message || 'Could not upload photos.', 'error');
      } finally {
        event.target.value = '';
      }
    });
    byId('galleryCloseBtn').addEventListener('click', closeGallery);
    byId('versionsCloseBtn').addEventListener('click', closeVersions);
    byId('projectsCloseBtn').addEventListener('click', closeProjectsSpace);
    byId('projectsSearch').addEventListener('input', filterProjects);
    byId('projectNewOfferteBtn').addEventListener('click', () => {
      closeVersions();
      openOfferteModal();
    });
    byId('offerteCloseBtn').addEventListener('click', closeOfferteModal);
    byId('saveOfferteProfileBtn').addEventListener('click', async () => {
      try { await saveOfferteProfile(); } catch(error){ toast(error.message || 'Kon bedrijfsgegevens niet opslaan.','error'); }
    });
    byId('downloadOfferteBtn').addEventListener('click', downloadCurrentOfferte);
    byId('sendOfferteBtn').addEventListener('click', sendCurrentOfferte);
    document.querySelectorAll('[data-offerte-close]').forEach((el)=>el.addEventListener('click',closeOfferteModal));

    byId('projectCalculationsTab').addEventListener('click', () => {
      const target=byId('versionsList');
      if(target) target.scrollIntoView({behavior:'smooth',block:'start'});
    });
    byId('projectOffertesTab').addEventListener('click', () => {
      const target=byId('projectOffertesList');
      if(target) target.scrollIntoView({behavior:'smooth',block:'start'});
    });
    byId('projectPhotosBtn').addEventListener('click', async () => {
      closeVersions();
      await openGallery();
    });
    document.querySelectorAll('[data-versions-close]').forEach((el) => el.addEventListener('click', closeVersions));
    document.querySelectorAll('[data-projects-close]').forEach((el) => el.addEventListener('click', closeProjectsSpace));
    document.querySelectorAll('[data-gallery-close]').forEach((el) => el.addEventListener('click', closeGallery));

    function toggleClientView() {
      const active = !document.body.classList.contains('client-mode');
      setClientMode(active);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      toast(active ? 'Client presentation opened.' : 'Internal editing opened.');
    }

    byId('clientViewBtn').addEventListener('click', toggleClientView);

    document.querySelectorAll('#app input, #app select, #app textarea').forEach((el) => {
      const onEdit = () => {
        calculate();
        if(!el.matches('[data-price],[data-price-check]')){
          markUnsaved();
          scheduleAutosave();
        }
      };
      el.addEventListener('input', onEdit);
      el.addEventListener('change', onEdit);
    });
  }

  async function init() {
    bindEvents();
    document.querySelectorAll('input[type="number"]').forEach((el) => el.setAttribute('inputmode', 'decimal'));
    syncPricingInputs();
    calculate();
    setWizardStep(0,{noScroll:true});
    const restored = await restoreSession();
    if (restored) await enterApp();
  }

  init();
})();
