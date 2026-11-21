// ===== 雪夜世界：分成五層，每層的視差深度不同 =====
// 天空（最遠）→ 遠山 → 中景山與森林 → 近景（湖、木屋、路燈）→ 前景（大松樹、雪堆）
// 每一層都有一張「靜態畫布」（換畫面大小時畫一次）和一張「動畫畫布」（每一格重畫會動的東西）
// 這個檔案要在 index.html 的主程式之前載入；noise()、rand()、ambTime 這些共用的東西在主程式裡

const WORLD = {
  el: document.getElementById('world'),
  built: false, w: 0, h: 0, R: 1, t: 0,
  layers: {},          // 每層的 { div, st, an, sctx, actx }
  pos: {},             // 木屋窗戶、路燈、煙囪、月亮在各層裡的位置（給動畫和雪花用）
  stars: [], lights: [], smoke: [], shooting: null, nextShoot: 6
};
const WORLD_LAYERS = ['wSky', 'wFar', 'wMid', 'wNear', 'wFore'];
WORLD_LAYERS.forEach(id => {
  const div = document.getElementById(id);
  const st = div.querySelector('.st'), an = div.querySelector('.an');
  WORLD.layers[id] = { div, st, an, sctx: st.getContext('2d'), actx: an ? an.getContext('2d') : null };
});

// 多層噪聲疊在一起（fbm）：山的稜線、雪的邊緣都用這個，看起來比較自然
function fbm(x, y, oct) {
  let v = 0, a = .5, f = 1;
  for (let i = 0; i < (oct || 5); i++) { v += noise(x * f, y * f) * a; f *= 2.03; a *= .5; }
  return v;
}

// ---------------------------------------------------------------------
// 共用的畫圖小工具
// ---------------------------------------------------------------------
// 松樹：一層一層的三角形，每層上緣蓋一層參差不齊的雪
function pine(g, x, base, hgt, col, snowCol, snowAmt) {
  const tiers = 6 + Math.floor(hgt / 120);
  const trunkH = hgt * .08, top = base - hgt;
  g.fillStyle = col; g.fillRect(x - hgt * .022, base - trunkH, hgt * .044, trunkH);
  for (let i = 0; i < tiers; i++) {
    const t0 = i / tiers, t1 = (i + 1.35) / tiers;
    const ty = top + (hgt - trunkH) * t0 * .95, by = Math.min(base - trunkH * .6, top + (hgt - trunkH) * t1);
    const hw = hgt * (.07 + .2 * ((i + 1) / tiers));
    // 樹葉
    g.fillStyle = col; g.beginPath(); g.moveTo(x, ty);
    g.lineTo(x + hw, by);
    const teeth = 5 + i;
    for (let k = teeth; k >= 0; k--) { const px = x - hw + (2 * hw) * k / teeth; g.lineTo(px, by - (k % 2 ? hgt * .018 : 0)); }
    g.lineTo(x - hw, by); g.closePath(); g.fill();
    // 雪：蓋在這一層的上半部，下緣鋸齒狀
    const sy = ty + (by - ty) * (.3 + .25 * snowAmt), shw = hw * (.55 + .3 * snowAmt);
    g.fillStyle = snowCol; g.beginPath(); g.moveTo(x, ty - 1);
    g.lineTo(x + shw, sy);
    for (let k = 6; k >= 0; k--) { const px = x - shw + 2 * shw * k / 6; g.lineTo(px, sy - (k % 2 ? 0 : (by - ty) * .12) + rand(-1, 1)); }
    g.closePath(); g.fill();
  }
}

// 柔和的光暈
function glow(g, x, y, r, rgb, a) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, `rgba(${rgb},${a})`); gr.addColorStop(.4, `rgba(${rgb},${a * .35})`); gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
}

// 山：用 fbm 做稜線，山頂有積雪，背對月亮那一面的雪比較暗
function mountains(g, w, h, opt) {
  const freq = opt.freq * Math.max(1, (w / h) / .7);          // 橫的畫面比較寬，山峰多一點
  const ridge = x => h * opt.base - (fbm(x / w * freq + opt.seed, opt.seed, 6) + .5) * h * opt.amp;
  const depth = x => h * opt.cap * (.5 + (fbm(x / w * freq * 4 + 9, opt.seed + 4, 4) + .5) * 1.2);
  // 山體
  let grad = g.createLinearGradient(0, h * (opt.base - opt.amp), 0, h * (opt.base + .15));
  grad.addColorStop(0, opt.top); grad.addColorStop(1, opt.bottom);
  g.fillStyle = grad; g.beginPath(); g.moveTo(0, h);
  for (let x = 0; x <= w; x += 2) g.lineTo(x, ridge(x));
  g.lineTo(w, h); g.fill();
  // 積雪：沿著稜線往下一條不規則的帶子，越往下越透明
  g.save();
  g.beginPath(); g.moveTo(0, ridge(0));
  for (let x = 0; x <= w; x += 2) g.lineTo(x, ridge(x));
  for (let x = w; x >= 0; x -= 2) g.lineTo(x, ridge(x) + depth(x));
  g.closePath(); g.clip();
  grad = g.createLinearGradient(0, h * (opt.base - opt.amp), 0, h * opt.base);
  grad.addColorStop(0, opt.snowLit); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  // 背光面：斜坡往右上升的地方（月亮在右上）蓋一層藍灰色陰影
  g.fillStyle = opt.snowShade;
  // 坡度用左右各 1.5% 畫面寬的範圍算，再換成 0～1 的連續數值：陰影會慢慢變深，不會有硬邊
  const span = w * .015, k = h * .012;
  for (let x = 0; x < w; x += 1) {
    const sl = (ridge(x - span) - ridge(x + span)) / k;       // 正的 = 往右上升 = 背光
    const a = Math.max(0, Math.tanh(sl));
    if (a < .02) continue;
    g.globalAlpha = a; g.fillRect(x, 0, 1.3, h);
  }
  g.globalAlpha = 1;
  g.restore();
  return ridge;
}

// ---------------------------------------------------------------------
// 1. 天空（靜態）：夜空漸層、銀河、上千顆星星、月亮
// ---------------------------------------------------------------------
function drawSky(g, w, h) {
  const S = Math.min(w, h * .75);
  let gr = g.createLinearGradient(0, 0, 0, h * .7);
  gr.addColorStop(0, '#040817'); gr.addColorStop(.45, '#0e1836'); gr.addColorStop(.8, '#22325a'); gr.addColorStop(1, '#3a4d7a');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  // 銀河：一條斜斜的帶子，帶子中間星星特別密，還有淡淡的星雲
  const ax = w * -.1, ay = h * .05, bx = w * 1.1, by = h * .42;
  const len = Math.hypot(bx - ax, by - ay), nx = -(by - ay) / len, ny = (bx - ax) / len;
  for (let i = 0; i < 26; i++) {
    const t = Math.random(), cx = ax + (bx - ax) * t, cy = ay + (by - ay) * t, off = rand(-1, 1) * S * .06;
    glow(g, cx + nx * off, cy + ny * off, S * rand(.12, .25), ['150,120,210', '110,140,230', '200,170,230'][i % 3], rand(.04, .08));
  }
  for (let i = 0; i < 4000; i++) {
    const t = Math.random(), spread = (Math.random() + Math.random() + Math.random() - 1.5) * S * .12;
    const x = ax + (bx - ax) * t + nx * spread, y = ay + (by - ay) * t + ny * spread;
    if (y > h * .62) continue;
    g.fillStyle = `rgba(235,240,255,${rand(.15, .7)})`; g.fillRect(x, y, rand(.4, 1.1), rand(.4, 1.1));
  }
  // 暗色的塵埃帶（銀河中間那條黑縫）
  g.save(); g.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 14; i++) { const t = i / 14 + rand(-.02, .02); glow(g, ax + (bx - ax) * t, ay + (by - ay) * t, S * rand(.05, .09), '40,40,70', .5); }
  g.restore();
  // 一般的星星
  for (let i = 0; i < 1600; i++) {
    const x = Math.random() * w, y = Math.pow(Math.random(), 1.4) * h * .62, s = Math.pow(Math.random(), 3) * 1.8 + .3;
    g.fillStyle = `rgba(${Math.random() < .15 ? '255,225,200' : Math.random() < .3 ? '200,215,255' : '245,248,255'},${rand(.3, .95) * (1 - y / (h * .7))})`;
    g.beginPath(); g.arc(x, y, s * .6, 0, 7); g.fill();
  }
  // 月亮：外圈光暈、本體漸層、隕石坑
  const mx = w * .74, my = h * .13, mr = S * .075;
  WORLD.pos.moon = { x: mx / w, y: my / h };
  glow(g, mx, my, mr * 9, '170,190,240', .22);
  glow(g, mx, my, mr * 3.5, '220,230,255', .35);
  gr = g.createRadialGradient(mx - mr * .35, my - mr * .35, mr * .1, mx, my, mr);
  gr.addColorStop(0, '#fbfcff'); gr.addColorStop(.7, '#e4e9f5'); gr.addColorStop(1, '#c9d2e6');
  g.fillStyle = gr; g.beginPath(); g.arc(mx, my, mr, 0, 7); g.fill();
  g.save(); g.beginPath(); g.arc(mx, my, mr, 0, 7); g.clip();
  for (let i = 0; i < 16; i++) {
    const a = rand(0, 6.28), d = Math.sqrt(Math.random()) * mr * .85, cr = mr * rand(.06, .2);
    const cx = mx + Math.cos(a) * d, cy = my + Math.sin(a) * d;
    g.fillStyle = `rgba(150,160,185,${rand(.15, .35)})`; g.beginPath(); g.arc(cx, cy, cr, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.arc(cx - cr * .25, cy - cr * .25, cr * .7, 0, 7); g.fill();
  }
  // 月面左下角的陰影（不是全滿月，比較有立體感）
  gr = g.createRadialGradient(mx + mr * .5, my + mr * .45, mr * .4, mx + mr * .2, my + mr * .2, mr * 1.4);
  gr.addColorStop(0, 'rgba(40,50,80,0)'); gr.addColorStop(1, 'rgba(40,50,80,.35)');
  g.fillStyle = gr; g.fillRect(mx - mr, my - mr, mr * 2, mr * 2);
  g.restore();
  // 地平線附近的大氣光
  gr = g.createLinearGradient(0, h * .45, 0, h * .7);
  gr.addColorStop(0, 'rgba(120,145,200,0)'); gr.addColorStop(1, 'rgba(120,145,200,.35)');
  g.fillStyle = gr; g.fillRect(0, h * .45, w, h * .3);
  // 會閃的亮星（動畫畫布每一格畫）
  WORLD.stars = Array.from({ length: 160 }, () => ({
    x: Math.random() * w, y: Math.pow(Math.random(), 1.3) * h * .55, r: rand(.7, 1.8),
    ph: rand(0, 6.28), sp: rand(.5, 2.2), big: Math.random() < .08, col: Math.random() < .2 ? '255,220,190' : '235,242,255'
  }));
}

// ---------------------------------------------------------------------
// 2. 遠山
// ---------------------------------------------------------------------
function drawFar(g, w, h) {
  mountains(g, w, h, { base: .6, amp: .2, freq: 2.2, seed: 3.1, cap: .05,
    top: '#46588a', bottom: '#2c3a62', snowLit: 'rgba(215,226,248,.95)', snowShade: 'rgba(40,55,95,.45)' });
  // 遠處的大氣霧，讓山看起來很遠
  const gr = g.createLinearGradient(0, h * .4, 0, h * .66);
  gr.addColorStop(0, 'rgba(70,90,140,0)'); gr.addColorStop(1, 'rgba(90,110,160,.55)');
  g.fillStyle = gr; g.fillRect(0, h * .4, w, h * .3);
}

// ---------------------------------------------------------------------
// 3. 中景：較近的山＋整片遠方森林＋山腳下的村莊燈火（燈火會閃，在動畫畫布）
// ---------------------------------------------------------------------
function drawMid(g, w, h) {
  mountains(g, w, h, { base: .65, amp: .1, freq: 3.4, seed: 7.7, cap: .028,
    top: '#2c3a5f', bottom: '#1c2541', snowLit: 'rgba(180,196,232,.8)', snowShade: 'rgba(25,35,65,.45)' });
  // 一整排很小的松樹（遠方森林）
  const fy = h * .655;
  for (let x = -10; x < w + 10; x += rand(3, 7)) {
    const ht = h * rand(.018, .038) * (.7 + .6 * (fbm(x / w * 6, 2.2, 2) + .5));
    pine(g, x, fy + rand(-2, 3), ht, '#141c30', 'rgba(175,190,225,.55)', .4);
  }
  // 森林下方一層淡霧
  const gr = g.createLinearGradient(0, h * .63, 0, h * .68);
  gr.addColorStop(0, 'rgba(120,140,190,0)'); gr.addColorStop(1, 'rgba(120,140,190,.4)');
  g.fillStyle = gr; g.fillRect(0, h * .6, w, h * .1);
  // 村莊燈火的位置
  WORLD.lights = Array.from({ length: 16 }, () => ({ x: rand(.05, .95) * w, y: fy - rand(0, h * .012), ph: rand(0, 6.28), sp: rand(.4, 1.4), r: rand(1, 1.8) }));
}

// ---------------------------------------------------------------------
// 4. 近景：雪地、結冰的湖、木屋、路燈、籬笆、腳印
// ---------------------------------------------------------------------
function drawNear(g, w, h) {
  const S = Math.min(w, h * .75);
  // 雪地
  let gr = g.createLinearGradient(0, h * .66, 0, h);
  gr.addColorStop(0, '#9fb0d4'); gr.addColorStop(.3, '#c3cfe8'); gr.addColorStop(1, '#e6ecf8');
  g.fillStyle = gr; g.beginPath(); g.moveTo(0, h);
  for (let x = 0; x <= w; x += 4) g.lineTo(x, h * .665 + fbm(x / w * 4, 5.5, 3) * h * .012);
  g.lineTo(w, h); g.fill();
  // 雪地上的起伏陰影（月光從右上照下來，陰影偏藍）
  for (let i = 0; i < 70; i++) {
    const x = rand(0, w), y = rand(h * .69, h), r = rand(.05, .16) * w;
    g.save(); g.translate(x, y); g.scale(1, .18);
    const sg = g.createRadialGradient(-r * .2, 0, 0, 0, 0, r);
    sg.addColorStop(0, `rgba(90,110,165,${rand(.06, .14)})`); sg.addColorStop(1, 'rgba(90,110,165,0)');
    g.fillStyle = sg; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
    g.restore();
  }
  // 結冰的湖
  const lx = w * .78, ly = h * .705, lw = w * .38, lh = h * .028;
  WORLD.pos.lake = { x: lx / w, y: ly / h, w: lw / w, h: lh / h };
  gr = g.createLinearGradient(0, ly - lh, 0, ly + lh);
  gr.addColorStop(0, '#2b3a62'); gr.addColorStop(1, '#41548a');
  g.fillStyle = gr; g.beginPath(); g.ellipse(lx, ly, lw, lh, 0, 0, 7); g.fill();
  g.save(); g.beginPath(); g.ellipse(lx, ly, lw, lh, 0, 0, 7); g.clip();
  g.strokeStyle = 'rgba(200,215,245,.18)'; g.lineWidth = .8;                       // 冰的裂紋
  for (let i = 0; i < 14; i++) {
    let x = lx + rand(-lw, lw), y = ly + rand(-lh, lh); g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 5; k++) { x += rand(-18, 18); y += rand(-3, 3); g.lineTo(x, y); }
    g.stroke();
  }
  g.restore();
  g.strokeStyle = 'rgba(235,242,255,.8)'; g.lineWidth = 2.2;                       // 湖岸的雪
  g.beginPath(); g.ellipse(lx, ly - 1, lw, lh, 0, Math.PI * 1.02, Math.PI * 1.98); g.stroke();
  // 後排的松樹（左右兩叢）
  for (let i = 0; i < 9; i++) pine(g, rand(-.02, .26) * w, h * rand(.672, .69), h * rand(.08, .14), '#101828', 'rgba(220,230,250,.85)', .7);
  for (let i = 0; i < 6; i++) pine(g, rand(.52, .66) * w, h * rand(.668, .68), h * rand(.06, .1), '#121a2b', 'rgba(210,222,248,.8)', .7);
  // ---- 木屋 ----
  const cx = w * .37, cy = h * .742, cw = S * .3, ch = cw * .55;
  // 木屋的影子
  g.save(); g.translate(cx - cw * .1, cy + 2); g.scale(1, .16);
  glow(g, 0, 0, cw * .9, '50,60,100', .45); g.restore();
  // 牆：一根一根橫的原木
  g.fillStyle = '#3a2a25'; g.fillRect(cx - cw / 2, cy - ch, cw, ch);
  for (let i = 0; i < 9; i++) {
    const y = cy - ch + ch * i / 9;
    g.fillStyle = i % 2 ? '#43312a' : '#35261f'; g.fillRect(cx - cw / 2, y, cw, ch / 9);
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(cx - cw / 2, y + ch / 9 - 1, cw, 1);
    g.fillStyle = '#4b3830'; g.beginPath(); g.arc(cx - cw / 2, y + ch / 18, ch / 18, 0, 7); g.arc(cx + cw / 2, y + ch / 18, ch / 18, 0, 7); g.fill();  // 原木的截面
  }
  // 兩扇窗、一扇門
  const win = (x, y, ww, wh) => {
    g.fillStyle = '#2a1c16'; g.fillRect(x - 2, y - 2, ww + 4, wh + 4);
    const wg = g.createLinearGradient(x, y, x, y + wh); wg.addColorStop(0, '#ffe3a3'); wg.addColorStop(1, '#ffb257');
    g.fillStyle = wg; g.fillRect(x, y, ww, wh);
    g.fillStyle = '#2a1c16'; g.fillRect(x + ww / 2 - 1, y, 2, wh); g.fillRect(x, y + wh / 2 - 1, ww, 2);
    g.fillStyle = 'rgba(240,245,255,.9)'; g.fillRect(x - 3, y - 4, ww + 6, 3);        // 窗台上的雪
  };
  win(cx - cw * .38, cy - ch * .7, cw * .2, ch * .34);
  win(cx + cw * .16, cy - ch * .7, cw * .2, ch * .34);
  WORLD.pos.window = { x: (cx - cw * .28) / w, y: (cy - ch * .53) / h };
  WORLD.pos.window2 = { x: (cx + cw * .26) / w, y: (cy - ch * .53) / h };
  g.fillStyle = '#2b1d17'; g.fillRect(cx - cw * .08, cy - ch * .62, cw * .16, ch * .62);
  g.fillStyle = '#d9a35a'; g.beginPath(); g.arc(cx + cw * .05, cy - ch * .3, 1.6, 0, 7); g.fill();   // 門把
  // 屋頂和厚厚的積雪、冰柱
  const rl = cx - cw * .64, rr = cx + cw * .64, rt = cy - ch - cw * .42, rb = cy - ch + 2;
  g.fillStyle = '#231a1d'; g.beginPath(); g.moveTo(rl, rb); g.lineTo(cx, rt); g.lineTo(rr, rb); g.fill();
  g.fillStyle = '#eef3fc'; g.beginPath(); g.moveTo(rl - 4, rb + 1); g.lineTo(cx, rt - 6); g.lineTo(rr + 4, rb + 1);
  for (let k = 12; k >= 0; k--) { const x = rl + (rr - rl) * k / 12; g.lineTo(x, rb - 5 + Math.sin(k * 1.7) * 2.5); }
  g.fill();
  g.fillStyle = 'rgba(160,180,220,.5)'; g.beginPath(); g.moveTo(cx, rt - 6); g.lineTo(rr + 4, rb + 1); g.lineTo(rr - 6, rb - 3); g.lineTo(cx, rt + 8); g.fill(); // 屋頂背光那面的陰影
  g.fillStyle = 'rgba(225,235,252,.85)';
  for (let x = rl + 6; x < rr - 6; x += rand(5, 11)) { const L = rand(3, 11); g.beginPath(); g.moveTo(x - 1.5, rb); g.lineTo(x + 1.5, rb); g.lineTo(x, rb + L); g.fill(); }
  // 煙囪
  const chx = cx + cw * .26, chTop = rt + (rb - rt) * .28;
  g.fillStyle = '#2a2024'; g.fillRect(chx - cw * .045, chTop, cw * .09, (rb - rt) * .35);
  g.fillStyle = '#eef3fc'; g.fillRect(chx - cw * .055, chTop - 3, cw * .11, 4);
  WORLD.pos.chimney = { x: chx / w, y: (chTop - 3) / h };
  // 窗戶灑在雪地上的暖光（靜態的一層，動畫畫布再疊會閃的光）
  g.save(); g.translate(cx, cy + ch * .25); g.scale(1, .22); glow(g, 0, 0, cw * 1.1, '255,185,100', .38); g.restore();
  // 從門口延伸到畫面下方的小路和腳印
  g.strokeStyle = 'rgba(150,168,210,.35)'; g.lineWidth = cw * .14; g.lineCap = 'round';
  g.beginPath(); g.moveTo(cx, cy + 2); g.bezierCurveTo(cx + cw * .1, h * .82, cx + cw * .6, h * .88, w * .55, h * 1.02); g.stroke();
  for (let i = 0; i < 16; i++) {
    const t = i / 16, bx = (1 - t) ** 3 * cx + 3 * (1 - t) ** 2 * t * (cx + cw * .1) + 3 * (1 - t) * t * t * (cx + cw * .6) + t ** 3 * w * .55;
    const by = (1 - t) ** 3 * (cy + 2) + 3 * (1 - t) ** 2 * t * h * .82 + 3 * (1 - t) * t * t * h * .88 + t ** 3 * h * 1.02;
    const side = i % 2 ? 1 : -1, sz = 1.5 + t * 4;
    g.fillStyle = 'rgba(90,108,155,.45)'; g.beginPath(); g.ellipse(bx + side * sz * 1.2, by, sz * .55, sz, -.3, 0, 7); g.fill();
  }
  // ---- 路燈 ----
  const px = w * .62, pb = h * .775, ph = ch * 1.6;
  g.fillStyle = '#151a26'; g.fillRect(px - 1.5, pb - ph, 3, ph);
  g.fillRect(px - 5, pb - 3, 10, 3);
  g.fillStyle = '#1a1f2c'; g.fillRect(px - 6, pb - ph - 12, 12, 12);
  g.fillStyle = '#ffd38a'; g.fillRect(px - 4, pb - ph - 10, 8, 8);
  g.fillStyle = '#eef3fc'; g.fillRect(px - 7, pb - ph - 15, 14, 3);
  WORLD.pos.lamp = { x: px / w, y: (pb - ph - 6) / h };
  g.save(); g.translate(px, pb); g.scale(1, .25); glow(g, 0, 0, ph * .9, '255,205,130', .35); g.restore();
  // ---- 籬笆 ----
  for (let i = 0; i < 9; i++) {
    const fx = w * (.68 + i * .045), fyb = h * (.79 + i * .004), fh = h * .028;
    g.fillStyle = '#251b19'; g.fillRect(fx - 1.5, fyb - fh, 3, fh);
    g.fillStyle = '#eef3fc'; g.fillRect(fx - 2.5, fyb - fh - 2, 5, 3);
    if (i < 8) { g.fillStyle = '#2d221f'; g.fillRect(fx, fyb - fh * .75, w * .045, 2); g.fillRect(fx, fyb - fh * .4, w * .045, 2);
      g.fillStyle = 'rgba(238,243,252,.9)'; g.fillRect(fx, fyb - fh * .75 - 1.5, w * .045, 1.5); }
  }
}

// ---------------------------------------------------------------------
// 5. 前景：畫面兩側的大松樹、前方雪堆（移動最多，最有立體感）
// ---------------------------------------------------------------------
function drawFore(g, w, h) {
  // 前方的雪堆
  for (let i = 0; i < 3; i++) {
    const y0 = h * (.9 + i * .035);
    const gr = g.createLinearGradient(0, y0 - h * .04, 0, h);
    gr.addColorStop(0, i === 0 ? '#d7e0f2' : '#e9eef9'); gr.addColorStop(1, '#f4f7fd');
    g.fillStyle = gr; g.beginPath(); g.moveTo(0, h);
    for (let x = 0; x <= w; x += 4) g.lineTo(x, y0 - (fbm(x / w * 2.5, 11 + i, 4) + .5) * h * .045);
    g.lineTo(w, h); g.fill();
    // 雪堆頂端被月光照亮的邊
    g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 1.2; g.beginPath();
    for (let x = 0; x <= w; x += 4) { const y = y0 - (fbm(x / w * 2.5, 11 + i, 4) + .5) * h * .045; x ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  }
  // 左右兩邊的大松樹（被畫面切掉一部分，像從樹林裡往外看）
  pine(g, -w * .04, h * 1.02, h * .62, '#0b111e', 'rgba(232,240,252,.9)', .65);
  pine(g, w * .1, h * 1.03, h * .4, '#0d1422', 'rgba(228,236,250,.88)', .65);
  pine(g, w * 1.05, h * 1.02, h * .55, '#0b111e', 'rgba(232,240,252,.9)', .65);
  pine(g, w * .9, h * 1.04, h * .3, '#0e1524', 'rgba(228,236,250,.88)', .65);
}

// ---------------------------------------------------------------------
// 建立整個世界（第一次進入雪景、或畫面大小改變時）
// ---------------------------------------------------------------------
function buildWorld() {
  const w = Math.round(innerWidth * 1.12), h = Math.round(innerHeight * 1.12);
  const R = Math.min(window.devicePixelRatio || 1, 3);        // 你說跑得動，所以最高用到 3 倍解析度
  WORLD.w = w; WORLD.h = h; WORLD.R = R;
  const draws = { wSky: drawSky, wFar: drawFar, wMid: drawMid, wNear: drawNear, wFore: drawFore };
  for (const id of WORLD_LAYERS) {
    const L = WORLD.layers[id];
    for (const c of [L.st, L.an]) if (c) { c.width = Math.round(w * R); c.height = Math.round(h * R); }
    L.sctx.setTransform(R, 0, 0, R, 0, 0); L.sctx.clearRect(0, 0, w, h);
    draws[id](L.sctx, w, h);
  }
  WORLD.smoke = Array.from({ length: 22 }, (_, i) => ({ age: i / 22 * 7, life: 7, drift: rand(.6, 1.4) }));
  WORLD.built = true;
}
let worldResizeTimer = 0;
addEventListener('resize', () => { if (!WORLD.built) return; clearTimeout(worldResizeTimer); worldResizeTimer = setTimeout(buildWorld, 250); });

// ---------------------------------------------------------------------
// 每一格：會動的部分
// ---------------------------------------------------------------------
const AURORA = document.createElement('canvas'); AURORA.width = 240; AURORA.height = 90;
const auroraCtx = AURORA.getContext('2d'), auroraImg = auroraCtx.createImageData(240, 90);
function drawAuroraTo(g, x0, y0, ww, hh, t, alpha) {
  const d = auroraImg.data;
  for (let x = 0; x < 240; x++) {
    const base = 60 + noise(x * .018, t * .05) * 20 + Math.sin(x * .045 + t * .28) * 4;
    const base2 = 40 + noise(x * .025 + 30, t * .04) * 18;                          // 第二道比較淡的簾幕
    const bright = Math.max(0, .4 + noise(x * .04 + 10, t * .12) * 1.0);
    const bright2 = Math.max(0, .2 + noise(x * .05 + 50, t * .1) * .8);
    for (let y = 0; y < 90; y++) {
      const dy = base - y, dy2 = base2 - y;
      let a = (dy < 0 ? Math.exp(-dy * dy / 5) : Math.exp(-dy / 18)) * bright;
      let a2 = (dy2 < 0 ? Math.exp(-dy2 * dy2 / 5) : Math.exp(-dy2 / 14)) * bright2 * .7;
      // 簾幕的直條紋
      const ray = .75 + .25 * noise(x * .35, t * .6 + y * .01);
      a *= ray; a2 *= ray;
      const up = Math.min(1, Math.max(0, dy / 40)), up2 = Math.min(1, Math.max(0, dy2 / 30));
      const i = (y * 240 + x) * 4;
      d[i] = Math.min(255, (60 + up * 140) * a + (180 + up2 * 60) * a2);
      d[i + 1] = Math.min(255, (255 - up * 160) * a + (90 + up2 * 40) * a2);
      d[i + 2] = Math.min(255, (160 + up * 80) * a + (220) * a2);
      d[i + 3] = Math.min(255, (a + a2) * 230);
    }
  }
  auroraCtx.putImageData(auroraImg, 0, 0);
  g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = alpha;
  g.imageSmoothingEnabled = true; g.drawImage(AURORA, x0, y0, ww, hh); g.restore();
}

function worldFrame(dt) {
  if (!WORLD.built || WORLD.el.hidden) return;
  const w = WORLD.w, h = WORLD.h, R = WORLD.R;
  WORLD.t += dt; const t = WORLD.t;
  const auroraAlpha = .8 + .2 * Math.sin(t * .17);

  // ---- 天空：閃爍的星星、極光、流星 ----
  let g = WORLD.layers.wSky.actx;
  g.setTransform(R, 0, 0, R, 0, 0); g.clearRect(0, 0, w, h);
  drawAuroraTo(g, -w * .05, h * .02, w * 1.1, h * .42, t, auroraAlpha);
  for (const s of WORLD.stars) {
    const a = .2 + .8 * Math.pow(.5 + .5 * Math.sin(t * s.sp + s.ph), 3);
    g.fillStyle = `rgba(${s.col},${a})`; g.beginPath(); g.arc(s.x, s.y, s.r * .7, 0, 7); g.fill();
    if (s.big && a > .6) {                                                       // 最亮的幾顆有十字星芒
      g.strokeStyle = `rgba(${s.col},${(a - .6) * 1.5})`; g.lineWidth = .6;
      g.beginPath(); g.moveTo(s.x - 6, s.y); g.lineTo(s.x + 6, s.y); g.moveTo(s.x, s.y - 6); g.lineTo(s.x, s.y + 6); g.stroke();
    }
  }
  // 流星：每 6～14 秒一顆
  if (!WORLD.shooting && t > WORLD.nextShoot) {
    const a = rand(.35, .6);
    WORLD.shooting = { x: rand(.1, .8) * w, y: rand(.03, .25) * h, vx: Math.cos(a) * w * .9, vy: Math.sin(a) * w * .9, life: 0, max: rand(.6, 1) };
  }
  if (WORLD.shooting) {
    const s = WORLD.shooting; s.life += dt;
    const k = s.life / s.max, x = s.x + s.vx * s.life, y = s.y + s.vy * s.life, fade = Math.sin(Math.min(k, 1) * Math.PI);
    const tx = x - s.vx * .12, ty = y - s.vy * .12;
    const sg = g.createLinearGradient(tx, ty, x, y);
    sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(1, `rgba(255,255,255,${.9 * fade})`);
    g.strokeStyle = sg; g.lineWidth = 1.6; g.lineCap = 'round'; g.beginPath(); g.moveTo(tx, ty); g.lineTo(x, y); g.stroke();
    glow(g, x, y, 6, '220,235,255', .8 * fade);
    if (k >= 1) { WORLD.shooting = null; WORLD.nextShoot = t + rand(6, 14); }
  }

  // ---- 中景：村莊燈火 ----
  g = WORLD.layers.wMid.actx;
  g.setTransform(R, 0, 0, R, 0, 0); g.clearRect(0, 0, w, h);
  for (const L of WORLD.lights) {
    const a = .55 + .45 * Math.sin(t * L.sp + L.ph) * Math.sin(t * L.sp * 2.3 + L.ph * 2);
    glow(g, L.x, L.y, 7, '255,190,110', .5 * a);
    g.fillStyle = `rgba(255,220,160,${.6 + .4 * a})`; g.fillRect(L.x - L.r / 2, L.y - L.r / 2, L.r, L.r);
  }

  // ---- 近景：窗戶和路燈的光、炊煙、湖面上月光和極光的倒影 ----
  g = WORLD.layers.wNear.actx;
  g.setTransform(R, 0, 0, R, 0, 0); g.clearRect(0, 0, w, h);
  const S = Math.min(w, h * .75);
  const flick = .6 + .25 * noise(t * 2.2, 3.3) + .15 * noise(t * 7, 9.1);
  for (const key of ['window', 'window2']) {
    const p = WORLD.pos[key]; glow(g, p.x * w, p.y * h, S * .12, '255,175,90', .45 * flick);
  }
  const lp = WORLD.pos.lamp, lf = .85 + .15 * noise(t * 5, 1.1);
  glow(g, lp.x * w, lp.y * h, S * .09, '255,210,140', .6 * lf);
  glow(g, lp.x * w, lp.y * h, S * .025, '255,240,200', .9 * lf);
  // 湖面倒影：月光在湖上拉成一條閃爍的光帶，極光也淡淡地映在冰上
  const lk = WORLD.pos.lake, mx = WORLD.pos.moon.x * w, lx = lk.x * w, ly = lk.y * h, lw = lk.w * w, lh = lk.h * h;
  g.save(); g.beginPath(); g.ellipse(lx, ly, lw, lh, 0, 0, 7); g.clip();
  glow(g, lx, ly - lh, lw * .9, '90,230,170', .12 * auroraAlpha * 2);
  for (let i = 0; i < 26; i++) {
    const yy = ly - lh + (i / 26) * lh * 2, wob = noise(i * .7, t * 1.3) * 10, len = (14 + 22 * (i / 26)) * (.6 + .4 * noise(i, t * 2));
    g.fillStyle = `rgba(230,238,255,${.12 + .25 * (1 - i / 26)})`; g.fillRect(mx + wob - len / 2, yy, len, 1.2);
  }
  g.restore();
  // 炊煙
  const ch = WORLD.pos.chimney;
  for (const sm of WORLD.smoke) {
    sm.age += dt; if (sm.age > sm.life) sm.age -= sm.life;
    const k = sm.age / sm.life;
    const x = ch.x * w + k * S * .25 * sm.drift + (wind / dpr) * k * .25 + Math.sin(t * .7 + k * 6) * 5 * k;
    const y = ch.y * h - k * S * .4, rr = 4 + k * S * .09;
    const sg = g.createRadialGradient(x, y, 0, x, y, rr);
    sg.addColorStop(0, `rgba(205,212,230,${.2 * (1 - k) * Math.min(1, k * 8)})`); sg.addColorStop(1, 'rgba(205,212,230,0)');
    g.fillStyle = sg; g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
}

// 木屋窗戶、路燈在「雪的畫布」上的位置（雪花飄過會被照亮）
// 近景這一層一直在推近、平移，還有傾斜視差，所以每一格用它實際在螢幕上的位置算
function worldLightsOnScreen() {
  const L = WORLD.layers.wNear, rect = L.st.getBoundingClientRect(), k = rect.width / WORLD.w;
  const S = Math.min(WORLD.w, WORLD.h * .75) * k;
  const at = p => ({ x: rect.left + p.x * rect.width, y: rect.top + p.y * rect.height });
  return [
    { ...at(WORLD.pos.window), r: S * .2 },
    { ...at(WORLD.pos.lamp), r: S * .16 }
  ];
}
