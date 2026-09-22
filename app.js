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
    estimateId: null,
    lastResult: null,
    busy: false,
    galleryObjectUrls: [],
    historyRows: []
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
      await refreshSession();
      return rest(path, options, true);
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
      allowOther: num('allowOther')
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
    byId('estimateState').textContent = 'Saved estimate';
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
    byId('mobileClientLabel').textContent = active ? 'Internal' : 'Client';
    calculate();
  }

  function resetEstimate() {
    closeGallery();
    setClientMode(false);
    state.estimateId = null;
    byId('estimateState').textContent = 'New estimate';
    byId('galleryCount').textContent = '0';
    byId('clientName').value = '';
    byId('clientPhone').value = '';
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
    toast('New estimate started.');
  }

  async function saveEstimate() {
    if (state.busy) return;
    state.busy = true;
    setSync('Saving estimate', 'busy');
    try {
      const result = calculate();
      const userId = currentUserId();
      if (!userId) throw new Error('Not signed in');

      const payload = {
        client_name: byId('clientName').value.trim(),
        client_phone: byId('clientPhone').value.trim(),
        project_address: byId('projectAddress').value.trim(),
        status: 'estimate',
        room: collectRoom(),
        scope: collectScope(),
        selections: collectSelections(),
        pricing_snapshot: state.pricing,
        calculations: result,
        total_ex_vat: Number(result.totalExVat.toFixed(2)),
        vat_rate: Number(result.vatRate.toFixed(4)),
        total_inc_vat: Number(result.totalIncVat.toFixed(2)),
        notes: byId('notes').value.trim(),
        updated_at: nowIso()
      };

      if (state.estimateId) {
        const updated = await rest('bathroom_estimates?id=eq.' + encodeURIComponent(state.estimateId), {
          method: 'PATCH',
          body: payload,
          prefer: 'return=representation'
        });
        if (Array.isArray(updated) && updated[0]) fillEstimate(updated[0]);
      } else {
        payload.user_id = userId;
        const created = await rest('bathroom_estimates', {
          method: 'POST',
          body: payload,
          prefer: 'return=representation'
        });
        if (Array.isArray(created) && created[0]) fillEstimate(created[0]);
      }
      await loadRecent();
      setSync('Synced');
      toast('Estimate saved.');
    } catch (error) {
      setSync('Save failed', 'error');
      toast(error.message || 'Could not save estimate.', 'error');
    } finally {
      state.busy = false;
    }
  }

  function renderHistory(rows) {
    const list = byId('recentList');
    const items = Array.isArray(rows) ? rows : [];
    byId('historyCount').textContent = items.length + (items.length === 1 ? ' saved' : ' saved');

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
      return '<button class="recent-item" type="button" data-estimate-id="' + escapeHtml(row.id) + '">' +
        '<div><strong>' + escapeHtml(client) + '</strong>' +
        '<span>' + escapeHtml(address) + '</span>' +
        '<div class="history-meta">' +
        (updatedText ? '<span class="history-chip">Updated ' + escapeHtml(updatedText) + '</span>' : '') +
        (createdText ? '<span class="history-chip">Created ' + escapeHtml(createdText) + '</span>' : '') +
        '</div></div>' +
        '<div class="history-amount">' + euro(Number(row.total_inc_vat || 0)) + '</div></button>';
    }).join('');

    list.querySelectorAll('[data-estimate-id]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          setSync('Loading calculation', 'busy');
          const rows = await rest('bathroom_estimates?id=eq.' + encodeURIComponent(button.getAttribute('data-estimate-id')) + '&select=*&limit=1');
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
      const rows = await rest('bathroom_estimates?select=id,client_name,client_phone,project_address,total_inc_vat,status,created_at,updated_at&order=updated_at.desc');
      state.historyRows = Array.isArray(rows) ? rows : [];
      renderHistory(state.historyRows);
    } catch (error) {
      state.historyRows = [];
      byId('historyCount').textContent = '0 saved';
      byId('recentList').innerHTML = '<p class="muted">Could not load calculation history.</p>';
      setSync('Sync issue', 'error');
    }
  }

  async function enterApp() {
    byId('authGate').hidden = true;
    byId('app').hidden = false;
    setSync('Connecting', 'busy');
    try {
      await loadPricing();
      await loadRecent();
      calculate();
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
    byId('saveBtn').addEventListener('click', saveEstimate);
    byId('saveBtnMobile').addEventListener('click', saveEstimate);
    byId('mobileSaveBtn').addEventListener('click', saveEstimate);
    byId('newBtn').addEventListener('click', resetEstimate);
    byId('mobileNewBtn').addEventListener('click', resetEstimate);
    byId('saveRatesBtn').addEventListener('click', async () => {
      try { await savePricing(); } catch (error) {
        setSync('Save failed', 'error');
        toast(error.message || 'Could not save rates.', 'error');
      }
    });
    byId('refreshBtn').addEventListener('click', loadRecent);
    byId('historySearch').addEventListener('input', filterHistory);
    byId('printBtn').addEventListener('click', () => window.print());
    byId('galleryBtn').addEventListener('click', openGallery);
    byId('mobileGalleryBtn').addEventListener('click', openGallery);
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
    document.querySelectorAll('[data-gallery-close]').forEach((el) => el.addEventListener('click', closeGallery));

    function toggleClientView() {
      const active = !document.body.classList.contains('client-mode');
      setClientMode(active);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      toast(active ? 'Client presentation opened.' : 'Internal editing opened.');
    }

    byId('clientViewBtn').addEventListener('click', toggleClientView);
    byId('mobileClientBtn').addEventListener('click', toggleClientView);

    document.querySelectorAll('#app input, #app select, #app textarea').forEach((el) => {
      el.addEventListener('input', calculate);
      el.addEventListener('change', calculate);
    });
  }

  async function init() {
    bindEvents();
    document.querySelectorAll('input[type="number"]').forEach((el) => el.setAttribute('inputmode', 'decimal'));
    syncPricingInputs();
    calculate();
    const restored = await restoreSession();
    if (restored) await enterApp();
  }

  init();
})();
