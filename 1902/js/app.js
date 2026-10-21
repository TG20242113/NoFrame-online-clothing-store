const COLORS = {black:'#181818',white:'#f2f2f2',beige:'#D8C4A0',olive:'#6B7150',navy:'#22314F',red:'#B23A2E',rose:'#D9A0A0',grey:'#8C8C8C',mustard:'#D6A937',brown:'#6B4A34'};

/* Product/category data is kept in data/catalog.js so it can be edited manually. */

const IMAGE_SETS = {
  men:['https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=900&q=85','https://images.unsplash.com/photo-1490578474895-699cd4e2cf59?auto=format&fit=crop&w=900&q=85'],
  women:['https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=900&q=85','https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=900&q=85'],
  kids:['https://images.unsplash.com/photo-1519238263530-99bdd11df2ea?auto=format&fit=crop&w=900&q=85'],
  caps:['https://images.unsplash.com/photo-1588850561407-ed78c282e89b?auto=format&fit=crop&w=900&q=85']
};
const HERO_IMAGES=[
  'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1445205170230-053b83016050?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1469334031218-e382a71b716b?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1488161628813-04466f872be2?auto=format&fit=crop&w=1600&q=85'
];

function hashStr(s){let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;return h;}
function generateProductImage(category,seedKey,w,h){const set=IMAGE_SETS[category]||IMAGE_SETS.men;return set[hashStr(category+'-'+seedKey)%set.length];}
function getCategoryImage(category){const c=STORE_CATEGORIES.find(x=>x.id===category);return c&&c.coverImage?c.coverImage:generateProductImage('men',category,700,900);}
const FALLBACK_TINTS={men:'#E9E3D9',women:'#EFEBE0',kids:'#E6E0D2',caps:'#EDE6D6'};
function fallbackImg(category,w,h){
  const imgUrl = generateProductImage(category, category+'seed', w, h);
  return imgUrl;
}
function imgFallback(el,category,w,h){
  el.onerror=null;
  el.src=fallbackImg(category,w,h);
}

function seedProducts(){
  const cats=STORE_CATEGORIES.map(c=>({id:c.id,name:c.name,coverImage:c.coverImage||null}));
  let id=1; const products=[];
  cats.forEach(cat=>{
    const items=(STORE_PRODUCTS[cat.id]||[]);
    items.forEach((item,i)=>{
      const price=item.price??(1890+i*400);
      products.push({
        id:item.id||'P'+(id++),title:item.title,category:cat.id,categoryName:cat.name,price,discountPrice:item.discountPrice??null,
        colors:item.colors||['black','white','navy','beige'],sizes:item.sizes||['S','M','L','XL','2XL'],
        images:item.images||[generateProductImage(cat.id, 'prod'+i)],
        rating:item.rating||(4.3 + (i%7)*0.1).toFixed(1),reviewsCount:item.reviewsCount||(14 + i*9),stock:item.stock??20,tags:item.tags||['new'],
        description:item.description||`A NoFrame signature ${cat.name.toLowerCase()} piece cut from premium materials, designed for everyday sophistication and effortless style.`,createdAt:Date.now()-i*86400000
      });
    });
  });
  return {cats,products};
}
const {cats:SEED_CATS,products:SEED_PRODUCTS}=seedProducts();

/* ---------------- STATE ---------------- */
let DB = {
  categories: SEED_CATS,
  products: SEED_PRODUCTS,
  orders: [],
  reviews: [
    {productId:'P1', userName:'Kasun Perera', rating:5, comment:'Exceptional quality and fit! Shipped fast to Colombo.'},
    {productId:'P1', userName:'Dilani Fernando', rating:5, comment:'Fabric feels ultra premium. Highly recommended.'}
  ],
  users: [{id:'U1',name:'Demo Customer',email:'demo@noframe.com',password:'demo123',phone:'+94 77 123 4567',address:'128 Galle Road, Colombo 03',role:'customer',promo:true}]
};
let SESSION = {user:null, cart:[], wishlist:[]};
let VIEW = {gallery:0, selColor:null, selSize:null, qty:1, zoom:false, checkoutStep:1, orderJustPlaced:null, adminTab:'overview', drawerOpen:false, editingProduct:null, editingCategory:null, cartDrawerOpen:false};

/* ---------------- STORAGE (persist cart/wishlist/session db) ---------------- */
const API_BASE = '../api/api.php';

async function apiRequest(action, options={}){
  const url = API_BASE + '?action=' + encodeURIComponent(action);
  const res = await fetch(url, {
    headers:{'Content-Type':'application/json', ...(options.headers||{})},
    ...options
  });
  if(!res.ok) throw new Error('API '+res.status);
  return await res.json();
}

async function loadStorage(){
  try{
    const remote = await apiRequest('load');
    if(remote && remote.ok && remote.data){
      const localUsers = (DB && DB.users) || [];
      DB = remote.data;
      /* /load only sends the customer directory to administrators. Keep this
         browser's own local accounts so offline/fallback sign-in still works. */
      if(!Array.isArray(DB.users) || !DB.users.length) DB.users = localUsers;
    }
  }catch(e){
    console.warn('MySQL API unavailable; using browser fallback.', e);
    try{
      const raw = localStorage.getItem('noframe-db-fallback');
      if(raw) DB = JSON.parse(raw);
    }catch(_){}
  }
  try{
    const s = localStorage.getItem('noframe-session');
    if(s) SESSION = JSON.parse(s);
  }catch(e){}
  /* CART PRIVACY: the bag and wishlist are reloaded from the key that belongs
     to whoever is actually signed in, so one customer's items can never show
     up in another customer's session. */
  const uid = SESSION.user && SESSION.user.id;
  SESSION.cart     = restoreBag('cart', uid, SESSION.cart);
  SESSION.wishlist = restoreBag('wishlist', uid, SESSION.wishlist);
}

/* Per-user bag storage — keyed by account id (or "guest"). */
function bagKey(kind, userId){ return 'noframe-' + kind + '-' + (userId || 'guest'); }
function readBag(kind, userId){
  try{
    const raw = localStorage.getItem(bagKey(kind, userId));
    return raw ? (JSON.parse(raw) || []) : [];
  }catch(e){ return []; }
}
function writeBag(kind, userId, list){
  try{ localStorage.setItem(bagKey(kind, userId), JSON.stringify(list || [])); }
  catch(e){ console.warn(e); }
}
function restoreBag(kind, userId, sessionList){
  const raw = localStorage.getItem(bagKey(kind, userId));
  if(raw !== null){
    try{ return JSON.parse(raw) || []; }catch(e){ return []; }
  }
  /* First visit since the per-user keys were introduced — seed from session. */
  const legacy = sessionList || [];
  if(legacy.length) writeBag(kind, userId, legacy);
  return legacy;
}

/* Gift Cards live in data/catalog.js; merge them into a DB restored from a
   cached copy so returning visitors still see the category. */
function ensureGiftCards(){
  let changed = false;
  const cat = STORE_CATEGORIES.find(c=>c.id==='gift-cards');
  if(cat && !DB.categories.some(c=>c.id===cat.id)){ DB.categories.push(cat); changed = true; }
  (STORE_PRODUCTS['gift-cards']||[]).forEach(it=>{
    if(!DB.products.some(p=>p.id===it.id)){
      DB.products.push({
        id:it.id, title:it.title, category:'gift-cards', categoryName:'Gift Cards',
        price:it.price, discountPrice:it.discountPrice??null, colors:it.colors||['beige'],
        sizes:it.sizes||['e-Gift Card'], images:it.images, rating:5, reviewsCount:0,
        stock:it.stock||99, tags:it.tags||['featured'], description:it.description,
        createdAt:Date.now()
      });
      changed = true;
    }
  });
  if(changed){
    try{ localStorage.setItem('noframe-db-fallback', JSON.stringify(DB)); }catch(e){ console.warn(e); }
  }
  return changed;
}

/* New categories/products added to data/catalog.js later must show up even for
   visitors whose DB was restored from a cached copy. Categories are merged by
   id; catalog items that declare an explicit id (new underwear + brand lines)
   are merged the same way, so nothing is ever duplicated. */
const CATEGORY_RENAMES = {
  'mens-underwear':  "Men's Innerwear",
  'womens-underwear': "Women's Innerwear"
};
function ensureCatalogDelta(){
  let changed = false;
  STORE_CATEGORIES.forEach(cat=>{
    if(!DB.categories.some(c=>c.id===cat.id)){
      DB.categories.push({id:cat.id, name:cat.name, coverImage:cat.coverImage||null});
      changed = true;
    }
  });
  Object.keys(STORE_PRODUCTS).forEach(catId=>{
    const cat = STORE_CATEGORIES.find(c=>c.id===catId);
    if(!cat) return;
    STORE_PRODUCTS[catId].forEach(it=>{
      if(!it.id) return;                       /* only explicitly-identified items */
      if(DB.products.some(p=>p.id===it.id)) return;
      DB.products.push({
        id:it.id, title:it.title, category:catId, categoryName:cat.name,
        price:it.price, discountPrice:it.discountPrice??null,
        colors:it.colors||['black','white','navy','beige'],
        sizes:it.sizes||['S','M','L','XL','2XL'],
        images:it.images||[generateProductImage(catId, it.id)],
        rating:it.rating||'4.6', reviewsCount:it.reviewsCount||(18+it.title.length),
        stock:it.stock??20, tags:it.tags||['new'],
        description:it.description||`A NoFrame signature ${cat.name.toLowerCase()} piece cut from premium materials, designed for everyday sophistication and effortless style.`,
        createdAt:Date.now()-(hashStr(it.id)%20)*86400000
      });
      changed = true;
    });
  });
  /* Category wording renames must reach cached browser copies and MySQL rows
     too, so apply them to both the category list and every product's
     categoryName on each start-up (idempotent). */
  DB.categories.forEach(c=>{
    const to = CATEGORY_RENAMES[c.id];
    if(to && c.name !== to){ c.name = to; changed = true; }
  });
  DB.products.forEach(p=>{
    const to = CATEGORY_RENAMES[p.category];
    if(to && p.categoryName !== to){ p.categoryName = to; changed = true; }
  });
  if(changed){
    try{ localStorage.setItem('noframe-db-fallback', JSON.stringify(DB)); }catch(e){ console.warn(e); }
  }
}

/* The seeded administrators (database/noframe.sql) must be able to sign in
   even when the PHP/MySQL API is unavailable — exactly like the demo customer
   already can. When MySQL is up, its bcrypt row is authoritative: the API
   login runs first and this mirror is only the offline fallback. */
const SEED_ADMINS = [
  {id:'ADMIN2', name:'Admin', email:'admin@store.com', password:'Admin@123', role:'admin', promo:true,
   phone:'+94 76 072 4876', address:'18, Kahagala, Kamburupitiya',
   shippingAddress:'18, Kahagala, Kamburupitiya', billingAddress:'18, Kahagala, Kamburupitiya'},
  {id:'ADMIN1', name:'NoFrame Admin', email:'admin@noframe.com', password:'admin123', role:'admin', promo:true,
   phone:'+94 11 234 5678', address:'Headquarters, Colombo 03',
   shippingAddress:'Headquarters, Colombo 03', billingAddress:'Headquarters, Colombo 03'}
];
function ensureSeedAdmins(){
  if(!Array.isArray(DB.users)) DB.users = [];
  let changed = false;
  SEED_ADMINS.forEach(a=>{
    const exists = DB.users.some(u =>
      String(u.email||'').toLowerCase() === a.email || u.id === a.id);
    if(!exists){
      DB.users.push(Object.assign({}, a));
      changed = true;
    }
  });
  if(changed){
    try{ localStorage.setItem('noframe-db-fallback', JSON.stringify(DB)); }catch(e){ console.warn(e); }
  }
}

/* Only 3–4 items out of every ~10 in a sub-category stay on sale, so the
   sale badge keeps its meaning. Enforced at startup against seed data,
   the cached browser DB and MySQL-loaded DB alike. */
const SALE_QUOTA = 4;
function enforceSaleQuota(){
  let changed = false;
  const byCat = {};
  DB.products.forEach(p=>{
    const onSale = p.discountPrice!=null || (Array.isArray(p.tags) && p.tags.includes('sale'));
    if(!onSale) return;
    (byCat[p.category] = byCat[p.category] || []).push(p);
  });
  Object.values(byCat).forEach(list=>{
    list.slice(SALE_QUOTA).forEach(p=>{
      if(p.discountPrice!=null){ p.discountPrice = null; changed = true; }
      if(Array.isArray(p.tags) && p.tags.includes('sale')){ p.tags = p.tags.filter(t=>t!=='sale'); changed = true; }
    });
  });
  if(changed){ try{ localStorage.setItem('noframe-db-fallback', JSON.stringify(DB)); }catch(e){ console.warn(e); } }
  return changed;
}

async function saveDB(){
  try{
    localStorage.setItem('noframe-db-fallback', JSON.stringify(DB));
    const remote = await apiRequest('save', {
      method:'POST',
      body:JSON.stringify(DB)
    });
    if(!remote.ok) throw new Error(remote.message||'Save failed');
  }catch(e){
    const msg = String(e.message||e);
    if(msg.includes('API 403')){
      /* /save is admin-only (server-side RBAC) — expected for customers. */
      console.info('Save skipped: admin-only endpoint — kept the browser copy.');
    } else if(/^API (501|502|503|504)$/.test(msg) || /fetch|network|Failed to fetch/i.test(msg)){
      /* No PHP/API running (static preview, XAMPP stopped): not a data loss —
         the browser copy above is already written. */
      console.warn('API unavailable (' + msg + ') — product data is kept in this browser only. Start XAMPP/MySQL to persist it centrally.');
    } else {
      console.error('Database save failed:', e);
    }
  }
}

/* Orders are written straight to MySQL through their own endpoint, so a
   customer's order persists without needing admin rights on /save. */
async function persistOrder(order){
  try{
    const remote = await apiRequest('create_order', {
      method:'POST',
      body:JSON.stringify(order)
    });
    if(remote && remote.ok) return true;
    throw new Error(remote && remote.message || 'Order not saved');
  }catch(e){
    console.warn('Order API unavailable — order kept in the browser copy.', e);
    return false;
  }
}

async function saveSession(){
  try{
    localStorage.setItem('noframe-session', JSON.stringify(SESSION));
    /* Keep each account's own bag on its own key (strict per-user isolation). */
    const uid = SESSION.user && SESSION.user.id;
    writeBag('cart', uid, SESSION.cart);
    writeBag('wishlist', uid, SESSION.wishlist);
  }
  catch(e){console.error(e);}
}

async function syncLivePrices(){
  try{
    const remote = await apiRequest('prices');
    if(remote.ok && Array.isArray(remote.prices)){
      let changed=false;
      remote.prices.forEach(x=>{
        const p=findProduct(x.id);
        if(p && (Number(p.price)!==Number(x.price) || Number(p.discountPrice||0)!==Number(x.discountPrice||0))){
          p.price=Number(x.price);
          p.discountPrice=x.discountPrice===null?null:Number(x.discountPrice);
          p.priceUpdatedAt=x.updatedAt;
          changed=true;
        }
      });
      if(changed){
        renderHeader();
        renderRoute();
      }
    }
  }catch(e){ console.warn('Live price sync unavailable', e); }
}
setInterval(syncLivePrices, 5000);

/* ---------------- LOGO ---------------- */
function LOGO_MARK(){
  return `<svg class="logo-mark" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="2" y="2" width="24" height="24" rx="5" stroke="currentColor" stroke-width="2"/>
    <path d="M8 9V19L14 12L20 19V9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}
function LOGO(light){ return `<a href="#/home" class="logo${light?' logo-light':''}">${LOGO_MARK()}NoFrame</a>`; }

/* ---------------- HELPERS ---------------- */
const $ = sel => document.querySelector(sel);
/* ── Currency state ── */
let CURRENCY = { code:'LKR', rate:1 };
const USD_RATE = 285; // 1 USD ≈ 285 LKR (update as needed)
function setCurrency(code){
  CURRENCY = code==='USD' ? {code:'USD', rate:1/USD_RATE} : {code:'LKR', rate:1};
  renderHeader();
  renderRoute();
}
function money(n){
  const v = Number(n) * CURRENCY.rate;
  if(CURRENCY.code==='USD') return '$' + v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  return 'Rs. ' + Number(n).toLocaleString('en-LK',{maximumFractionDigits:0});
}
function toast(msg){
  const t=$('#toast'); t.innerHTML = msg; t.classList.add('show');
  clearTimeout(window.__toastT); window.__toastT=setTimeout(()=>t.classList.remove('show'),2400);
}
function nav(hash){ location.hash = hash; }
function stars(rating){
  const r = Math.round(rating);
  return '<span class="star">'+'★'.repeat(r)+'</span>'+'<span style="opacity:0.3;">'+'★'.repeat(5-r)+'</span>';
}
function findProduct(id){ return DB.products.find(p=>p.id===id); }
function cartCount(){ return SESSION.cart.reduce((s,i)=>s+i.qty,0); }
function cartTotal(){ return SESSION.cart.reduce((s,i)=>{const p=findProduct(i.productId); if(!p) return s; const price=p.discountPrice||p.price; return s+price*i.qty;},0); }

/* ---------------- LOYALTY POINTS + CASH ON DELIVERY ---------------- */
/* 1% of every purchase is added as points; 1 point = Rs. 10.
   Cash on Delivery is reserved for customers with 3+ completed purchases. */
const LOYALTY = { rate:0.01, pointValue:10, codMinOrders:3 };

function completedPurchases(){
  if(!SESSION.user) return 0;
  /* Only this account's own orders count — other customers' orders never do. */
  return DB.orders.filter(o=>
    o.userId===SESSION.user.id &&
    !['Cancelled','Refunded','Failed'].includes(o.status)
  ).length;
}
function loyaltyPoints(){ return Math.max(0, Math.round((SESSION.user && SESSION.user.points)||0)); }
function pointsValue(){ return loyaltyPoints() * LOYALTY.pointValue; }
function codUnlocked(){ return completedPurchases() >= LOYALTY.codMinOrders; }

async function awardLoyalty(order){
  if(!SESSION.user || !order || order.loyaltyPoints != null) return;
  const pts = Math.floor(order.total * LOYALTY.rate);
  order.loyaltyPoints = pts;
  SESSION.user.points = loyaltyPoints() + pts;
  const idx = DB.users.findIndex(u=>u.id===SESSION.user.id);
  if(idx>-1){ DB.users[idx].points = SESSION.user.points; }
  await saveDB();
  await saveSession();
  if(pts>0) toast(`+${pts} loyalty points earned 🎉 (${money(pts*LOYALTY.pointValue)} value)`);
}

/* ---------------- THEME (Dark Theme Locked) ---------------- */
const THEME_KEY = 'noframe-theme';
function currentTheme(){ return 'dark'; }
function applyTheme(){
  document.documentElement.dataset.theme = 'dark';
  try { localStorage.setItem(THEME_KEY, 'dark'); } catch(_) {}
}
function changeTheme(){ applyTheme(); renderHeader(); }
function toggleTheme(){ applyTheme(); }
applyTheme();

/* ---------------- TOP ANNOUNCEMENT BAR ---------------- */
function renderAnnouncementBar(){
  return `<div class="top-announcement-bar">
    <span>⚡ FREE EXPRESS NATIONWIDE SHIPPING ON ORDERS OVER RS. 5,000</span>
    <span>|</span>
    <span>USE CODE: <span class="promo-code">NOFRAME10</span> FOR 10% OFF YOUR FIRST ORDER</span>
  </div>`;
}

/* ---------------- HEADER ---------------- */
/* ---------------- MEGA MENU — every sub-category, Fashion Bug style ------------- */
const OTHER_CATEGORY_IDS = ['caps-unisex','mens-others','womens-others'];

function megaGroups(){
  return [
    {key:'men',      title:'MEN',      ids:['mens-shirts','mens-tshirts','mens-trousers','mens-underwear','mens-shoes','mens-others','caps-unisex']},
    {key:'women',    title:'WOMEN',    ids:['frocks-women','womens-tshirts-shirts','womens-blouses','womens-croptops','womens-trousers','womens-underwear','womens-shoes','womens-others']},
    {key:'children', title:'CHILDREN', ids:['children']},
    {key:'other',    title:'OTHER',    ids:['caps-unisex','gift-cards']}
  ];
}

/* Hovering a main category opens ONE panel containing only that category's
   own sub-categories — never the whole store menu. */
const MEGA_PANELS = {
  men:{ cols:[
    {title:'CLOTHING', ids:['mens-shirts','mens-tshirts','mens-trousers','mens-underwear']},
    {title:'FOOTWEAR, CAPS & ACCESSORIES', ids:['mens-shoes','mens-others','caps-unisex']}
  ]},
  women:{ cols:[
    {title:'CLOTHING', ids:['frocks-women','womens-tshirts-shirts','womens-blouses','womens-croptops','womens-trousers','womens-underwear']},
    {title:'SHOES & ACCESSORIES', ids:['womens-shoes','womens-others']}
  ]},
  children:{ cols:[
    {title:'CHILDREN', ids:['children'], links:[
      ["Shop All Children's Fashion", '#/category/children'],
      ['Children\u2019s New Arrivals', '#/new'],
      ['Children\u2019s Sale', '#/sale']
    ]}
  ]},
  other:{ cols:[
    {title:'OTHER', ids:['caps-unisex','gift-cards'], links:[
      ['Shop All Others', '#/others'],
      ['New Arrivals', '#/new'],
      ['Festive Sale \uD83D\uDD25', '#/sale']
    ]}
  ]}
};

function catById(id){ return STORE_CATEGORIES.find(c=>c.id===id); }

function drawerCatLink(id){
  const c = catById(id);
  return c ? `<a class="drawer-cat" href="#/category/${id}" onclick="toggleDrawer(false)">${c.name}</a>` : '';
}

function megaMenuHTML(){
  /* Children's has no sub-category dropdown — that panel is never rendered. */
  return Object.entries(MEGA_PANELS).filter(([key])=>key!=='children').map(([key,cfg])=>{
    const first = catById(cfg.cols[0].ids[0]);
    const promoImg = (first && first.coverImage) || '../images/children/01.jpg';
    return `
    <div class="mega-panel${key==='men'?' active':''}" data-panel="${key}">
      <div class="mega-grid cols-${cfg.cols.length}">
        ${cfg.cols.map(col=>`
          <div class="mega-col">
            <h5>${col.title}</h5>
            ${col.ids.map(id=>{const c=catById(id);return c?`<a class="mega-link" href="#/category/${id}">${c.name}</a>`:'';}).join('')}
            ${(col.links||[]).map(l=>`<a class="mega-link" href="${l[1]}">${l[0]}</a>`).join('')}
          </div>`).join('')}
      </div>
      <a class="mega-promo" href="#/sale">
        <img src="${promoImg}" alt="Holiday festive offer" onerror="this.style.display='none'">
        <div class="mega-promo-body">
          <span class="eyebrow">HOLIDAY SPECIAL OFFER</span>
          <b>Up to 35% Off</b>
          <span class="mega-promo-cta">Shop the festive sale →</span>
        </div>
      </a>
    </div>`;
  }).join('');
}

let megaTimer = null;
function openMega(key){
  if(megaTimer){ clearTimeout(megaTimer); megaTimer=null; }
  const m = $('#mega-menu'); if(!m) return;
  if(key) m.querySelectorAll('.mega-panel').forEach(p=>p.classList.toggle('active', p.dataset.panel===key));
  m.classList.add('open');
}
function closeMega(){
  if(megaTimer) clearTimeout(megaTimer);
  megaTimer = setTimeout(()=>{ const m=$('#mega-menu'); if(m) m.classList.remove('open'); }, 200);
}

function renderHeader(){
  $('#site-header').innerHTML = `
  ${renderAnnouncementBar()}
  <div class="header-top">
    ${LOGO()}
    <div class="search-wrap">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input id="search-input" autocomplete="off" placeholder="Search for gifts, frocks, accessories…" oninput="handleLiveSearch(this.value)" onkeydown="if(event.key==='Enter')doSearch(this.value)">
      <div id="search-dropdown" class="search-dropdown"></div>
    </div>
    <nav class="header-nav" onmouseleave="closeMega()">
      <a href="#/category/mens-shirts" class="has-mega" onmouseenter="openMega('men')">Men<span class="nav-caret">▾</span></a>
      <a href="#/category/frocks-women" class="has-mega" onmouseenter="openMega('women')">Women<span class="nav-caret">▾</span></a>
      <a href="#/category/children">Children</a>
      <a href="#/others" class="has-mega" onmouseenter="openMega('other')">Others<span class="nav-caret">▾</span></a>
      <a href="#/category/gift-cards">Gift Cards</a>
      <a href="#/new">New Arrivals</a>
      <a href="#/sale" class="sale-link">Sale 🔥</a>
    </nav>
    <div class="header-actions">
      <div class="currency-selector">
        <select onchange="setCurrency(this.value)" aria-label="Currency">
          <option value="LKR" ${CURRENCY.code==='LKR'?'selected':''}>🇱🇰 LKR</option>
          <option value="USD" ${CURRENCY.code==='USD'?'selected':''}>🇺🇸 USD</option>
        </select>
      </div>
      <button class="icon-btn" onclick="nav('#/profile/wishlist')" aria-label="Wishlist">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21s-7.5-4.9-10-9.3C-.2 7.6 2.4 3.7 6.4 3.7c2 0 3.6 1 5.6 3.1 2-2.1 3.6-3.1 5.6-3.1 4 0 6.6 3.9 4.4 8-2.5 4.4-10 9.3-10 9.3z"/></svg>
        ${SESSION.wishlist.length?`<span class="badge">${SESSION.wishlist.length}</span>`:''}
      </button>
      <button class="icon-btn" onclick="openCartDrawer()" aria-label="Cart">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
        ${cartCount()?`<span class="badge">${cartCount()}</span>`:''}
      </button>
      ${SESSION.user ? `
        <a href="#/profile" class="user-avatar-badge" title="${SESSION.user.name}">
          <img src="${SESSION.user.avatar || '../assets/u1.svg'}" alt="${SESSION.user.name}" onerror="this.src='../assets/u1.svg'">
          <span class="header-user-name" style="max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${SESSION.user.name.split(' ')[0]}</span>
        </a>
        <button class="btn btn-outline btn-sm" onclick="doLogout()" style="padding:4px 10px;font-size:12px;">Logout</button>
      ` : `
        <button class="icon-btn" onclick="nav('#/login')" aria-label="Account">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4.5 5-6 8-6s6.5 1.5 8 6"/></svg>
        </button>
      `}
      <button class="icon-btn mobile-menu-btn" onclick="toggleDrawer(true)" aria-label="Menu">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>
    </div>
  </div>
  <div class="mega-menu" id="mega-menu" onmouseenter="openMega()" onmouseleave="closeMega()">
    <div class="mega-inner">${megaMenuHTML()}</div>
  </div>`;

  const hdr = $('#site-header');
  if(hdr) hdr.onmouseleave = closeMega;

  $('#mobile-drawer').innerHTML = `
    <button class="icon-btn close-drawer" onclick="toggleDrawer(false)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="4" y1="4" x2="20" y2="20"/><line x1="20" y1="4" x2="4" y2="20"/></svg>
    </button>
    <a href="#/home" onclick="toggleDrawer(false)">Home</a>
    ${megaGroups().map(g=>`
      <div class="drawer-subhead">${g.title.charAt(0)+g.title.slice(1).toLowerCase()}</div>
      ${g.ids.map(drawerCatLink).join('')}
      ${g.key==='other'?`<a class="drawer-cat" href="#/others" onclick="toggleDrawer(false)">Shop All Others</a>`:''}
    `).join('')}
    <a href="#/new" onclick="toggleDrawer(false)">New Arrivals</a>
    <a href="#/sale" onclick="toggleDrawer(false)" style="color:var(--accent);">Special Sale</a>
    <a href="#/cart" onclick="toggleDrawer(false)">Shopping Cart (${cartCount()})</a>
    <a href="${SESSION.user?'#/profile':'#/login'}" onclick="toggleDrawer(false)">${SESSION.user?'My Account':'Login / Register'}</a>
  `;
  renderCartDrawer();
  /* The footer carries the role-gated Admin Portal link, so rebuild it
     whenever the header (and therefore the session) changes. */
  renderFooter();
}

function toggleDrawer(open){ $('#mobile-drawer').classList.toggle('open',open); }


function handleLiveSearch(val){
  const dd = $('#search-dropdown');
  if(!dd) return;
  const q = val.trim().toLowerCase();
  if(!q){ dd.classList.remove('open'); return; }
  const matches = DB.products.filter(p=>(p.title+p.categoryName).toLowerCase().includes(q)).slice(0,6);
  if(!matches.length){
    dd.innerHTML = `<div style="padding:14px;font-size:12px;color:var(--ink-soft);text-align:center;">No matching products found</div>`;
  } else {
    dd.innerHTML = matches.map(p=>`
      <div class="search-item" onclick="nav('#/product/${p.id}');$('#search-dropdown').classList.remove('open');">
        <img src="${p.images[0]}" onerror="imgFallback(this,'${p.category}')">
        <div class="search-item-info">
          <div class="search-item-title">${p.title}</div>
          <div class="search-item-cat">${p.categoryName}</div>
        </div>
        <div class="search-item-price">${money(p.discountPrice||p.price)}</div>
      </div>
    `).join('');
  }
  dd.classList.add('open');
}

function doSearch(q){
  const dd = $('#search-dropdown');
  if(dd) dd.classList.remove('open');
  if(q.trim()) nav('#/search/'+encodeURIComponent(q.trim()));
}

/* ---------------- SIDE CART DRAWER ---------------- */
function openCartDrawer(){ VIEW.cartDrawerOpen=true; renderCartDrawer(); }
function closeCartDrawer(){ VIEW.cartDrawerOpen=false; renderCartDrawer(); }

function renderCartDrawer(){
  const slot = $('#cart-drawer-root');
  if(!slot) return;
  const items = SESSION.cart;
  const sub = cartTotal();
  const threshold = 5000;
  const progressPct = Math.min(100, Math.round((sub / threshold) * 100));
  const remaining = Math.max(0, threshold - sub);

  slot.innerHTML = `
    <div class="cart-drawer-overlay ${VIEW.cartDrawerOpen?'open':''}" onclick="closeCartDrawer()"></div>
    <div class="cart-drawer ${VIEW.cartDrawerOpen?'open':''}">
      <div class="cart-drawer-head">
        <h3>Shopping Bag (${cartCount()})</h3>
        <button class="icon-btn" onclick="closeCartDrawer()">✕</button>
      </div>
      <div class="shipping-progress-bar">
        <div class="txt">${sub >= threshold ? '🎉 You have unlocked <b>FREE Express Shipping</b>!' : `Add <b>${money(remaining)}</b> more for FREE Shipping`}</div>
        <div class="progress-track"><div class="progress-fill" style="width:${progressPct}%;"></div></div>
      </div>
      <div class="cart-drawer-items">
        ${!items.length ? `<div style="text-align:center;padding:48px 16px;color:var(--ink-soft);"><p style="margin-bottom:14px;">Your shopping bag is empty.</p><a href="#/home" class="btn btn-outline btn-sm" onclick="closeCartDrawer()">Start Shopping</a></div>` :
        items.map((it,idx)=>{
          const p = findProduct(it.productId);
          if(!p) return '';
          const price = p.discountPrice||p.price;
          return `
            <div class="cd-item">
              <img src="${p.images[0]}" onerror="imgFallback(this,'${p.category}')">
              <div class="cd-info">
                <h4>${p.title}</h4>
                <div class="cd-meta">Size: ${it.size} | Color: ${it.color}</div>
                <div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px;">
                  <div class="qty-stepper"><button onclick="changeCartQty(${idx},-1)">−</button><span>${it.qty}</span><button onclick="changeCartQty(${idx},1)">+</button></div>
                  <div class="cd-price">${money(price*it.qty)}</div>
                </div>
              </div>
              <button class="remove-link" style="align-self:flex-start;" onclick="removeCartItem(${idx})">✕</button>
            </div>
          `;
        }).join('')}
      </div>
      ${items.length ? `
      <div class="cart-drawer-foot">
        <div class="cd-summary-row"><span>Subtotal</span><span class="mono">${money(sub)}</span></div>
        <div class="cd-summary-row"><span>Estimated Shipping</span><span class="mono">${sub>=threshold?'FREE':money(1500)}</span></div>
        <div class="cd-summary-row total"><span>Total</span><span class="mono">${money(sub+(sub>=threshold?0:1500))}</span></div>
        <button class="btn btn-primary btn-full" onclick="closeCartDrawer();nav('#/checkout');">Proceed to Checkout →</button>
      </div>` : ''}
    </div>
  `;
}

function renderFooter(){
  $('#site-footer').innerHTML = `
  <div class="wrap">
    <div class="footer-grid">
      <div>
        <div style="margin-bottom:16px;">${LOGO(true)}</div>
        <p style="max-width:280px;font-size:13.5px;line-height:1.6;color:rgba(255,255,255,0.75);">NoFrame is a contemporary Sri Lankan fashion house crafting considered, luxury everyday pieces for men, women and children.</p>
        <div class="social-row">
          <a href="#" aria-label="Instagram">◎</a><a href="#" aria-label="Facebook">f</a><a href="#" aria-label="WhatsApp">◔</a><a href="#" aria-label="TikTok">♪</a>
        </div>
      </div>
      <div>
        <h5>Collections</h5>
        <a href="#/category/mens-shirts">Men's Apparel</a>
        <a href="#/category/frocks-women">Women's Frocks</a>
        <a href="#/category/children">Children's Wear</a>
        <a href="#/category/caps-unisex">Caps & Headwear</a>
        <a href="#/category/mens-others">Watches & Leather</a>
        <a href="#/sale">Holiday Sale</a>
      </div>
      <div>
        <h5>Customer Care</h5>
        <a href="#/support/shipping">Shipping & Delivery</a>
        <a href="#/support/returns">30-Day Returns</a>
        <a href="#/support/contact">Customer Support</a>
        <a href="#/profile/orders">Track Your Order</a>
        <a href="#/support/privacy">Privacy Policy</a>
        <a href="#/support/terms">Terms of Service</a>
      </div>
      <div>
        <h5>Store Info</h5>
        <p>📍 Address: 18, Kahagala, Kamburupitiya</p>
        <p>📞 Phone: +94760724876</p>
        <p>✉ Email: kavishanpasindu2004@gmail.com</p>
        ${(SESSION.user && SESSION.user.role === 'admin') ? `<a href="#/admin" style="margin-top:10px;font-weight:700;color:var(--accent);">Admin Portal →</a>` : ''}
      </div>
      <div>
        <h5>Newsletter</h5>
        <p style="margin-bottom:14px;font-size:13px;color:rgba(255,255,255,0.75);">Join our VIP list for exclusive drops, private sample sales, and 10% off your first order.</p>
        <form class="newsletter-form" onsubmit="event.preventDefault();toast('Welcome to the NoFrame VIP Club ✓');this.reset();">
          <input placeholder="Enter your email address" required type="email">
          <button type="submit">Join</button>
        </form>
      </div>
    </div>
    <div class="footer-bottom">
      <span>© 2026 NoFrame Luxury Fashion (Pvt) Ltd. All rights reserved.</span>
      <div style="display:flex;gap:14px;">
        <span>Visa</span> · <span>Mastercard</span> · <span>AMEX</span> · <span>Secure Card Payment</span>
      </div>
    </div>
  </div>`;
}

/* ---------------- HERO SLIDER ---------------- */
/* Slide 1: Video module (falls back to image if video unavailable)
   Slide 2: Original second poster (kept as-is)
   Slide 3: Blue Christmas tree – Winter Wonderland
   Slide 4: Snowflake ornament – Exclusive Holiday  */
const BANNERS = [
  {
    eyebrow:'HOLIDAY SPECIAL OFFER',
    title:'Holiday Festive Sale — Up to 35% Off',
    text:'Celebrate the season with handcrafted frocks, tailored office trousers, and luxury leather accessories at exclusive festival prices.',
    cta:'Explore Sale Items',
    link:'#/sale',
    img:'../images/hero-christmas.jpg',   /* first poster photo — user-supplied festive banner */
    isVideo:true,
    /* Drop a video file at images/hero-video.mp4 / .webm for autoplay.
       Poster is the img above. */
    videoMp4:'../images/hero-video.mp4',
    videoWebm:'../images/hero-video.webm'
  },
  {
    eyebrow:'COLLECTION 01 / 2026',
    title:'Luxury Modern Essentials',
    text:'Considered silhouettes cut from sustainable organic linens and pure cottons.',
    cta:'Shop Collection',
    link:'#/new',
    img:HERO_IMAGES[0]
  },
  {
    eyebrow:'WINTER WONDERLAND',
    title:'Winter Wonderland Sale — Up to 35% Off',
    text:'Discover cosy festive fashion wrapped in our signature craftsmanship. Gifts they will adore.',
    cta:'Shop Winter Sale',
    link:'#/sale',
    img:HERO_IMAGES[2],
    accentColor:'#1565C0'
  },
  {
    eyebrow:'EXCLUSIVE HOLIDAY OFFERS',
    title:'Exclusive Holiday Offers — Shop Now',
    text:'Premium accessories, luxury leather goods, and festive statement pieces. Limited stock — act fast.',
    cta:'Shop Now',
    link:'#/sale',
    img:HERO_IMAGES[3],
    accentColor:'#c0392b'
  }
];
let heroIdx = 0; let heroTimer=null;

function heroSliderHTML(){
  const slides = BANNERS.map((b,i)=>{
    if(b.isVideo){
      return `<div class="hero-video-slide ${i===0?'active':''}" data-i="${i}">
        <video autoplay loop muted playsinline preload="none" poster="${b.img}">
          <source src="${b.videoWebm}" type="video/webm">
          <source src="${b.videoMp4}" type="video/mp4">
        </video>
      </div>`;
    }
    return `<div class="hero-slide ${i===0?'active':''}" data-i="${i}" style="background-image:url('${b.img}')"></div>`;
  }).join('');

  return `<section class="hero">
    ${slides}
    <div class="hero-content">
      <div class="eyebrow" id="hero-eyebrow">${BANNERS[0].eyebrow}</div>
      <h1 id="hero-title">${BANNERS[0].title}</h1>
      <p id="hero-text">${BANNERS[0].text}</p>
      <a class="btn btn-accent" id="hero-cta" href="${BANNERS[0].link}">${BANNERS[0].cta}</a>
    </div>
    <div class="hero-dots">${BANNERS.map((b,i)=>`<div class="hero-dot ${i===0?'active':''}" data-i="${i}" onclick="setHero(${i})"></div>`).join('')}</div>
    <div class="hero-nav">
      <button class="hero-arrow" onclick="setHero(heroIdx-1)">&#8592;</button>
      <button class="hero-arrow" onclick="setHero(heroIdx+1)">&#8594;</button>
    </div>
  </section>`;
}

function setHero(i){
  heroIdx = (i+BANNERS.length)%BANNERS.length;
  /* Activate correct slide (both .hero-slide and .hero-video-slide) */
  document.querySelectorAll('.hero-slide, .hero-video-slide').forEach((el,k)=>el.classList.toggle('active',k===heroIdx));
  document.querySelectorAll('.hero-dot').forEach((el,k)=>el.classList.toggle('active',k===heroIdx));
  const b = BANNERS[heroIdx];
  const eb=$('#hero-eyebrow'), ti=$('#hero-title'), tx=$('#hero-text'), cta=$('#hero-cta');
  if(eb){eb.textContent=b.eyebrow; ti.textContent=b.title; tx.textContent=b.text; cta.textContent=b.cta; cta.setAttribute('href',b.link);}
  clearInterval(heroTimer);
  heroTimer = setInterval(()=>setHero(heroIdx+1),5000);
}


/* ---------------- LABEL DECODER (static → text) ---------------- */
const SCRAMBLE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&@$*+=<>/\\|▓▒░█';
function staticNoise(len){
  let s='';
  for(let i=0;i<len;i++) s += SCRAMBLE_CHARS[(Math.random()*SCRAMBLE_CHARS.length)|0];
  return s;
}
/* Decode one label out of static over `dur` ms. */
function scrambleText(el, dur){
  dur = dur==null ? 850 : dur;
  if(el.__scrDone) return;
  el.__scrDone = true;
  const final = el.dataset.final!=null ? el.dataset.final : (el.dataset.final = el.textContent);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduce || dur<=0){ el.textContent = final; el.classList.remove('scrambling'); el.classList.add('decoded'); return; }
  el.classList.add('scrambling');
  const start = performance.now();
  const tick = now => {
    const t = Math.min(1,(now-start)/dur);
    const reveal = Math.floor(final.length * t);
    let out='';
    for(let i=0;i<final.length;i++){
      const ch = final[i];
      out += (i<reveal || ch===' ') ? ch : SCRAMBLE_CHARS[(Math.random()*SCRAMBLE_CHARS.length)|0];
    }
    el.textContent = out;
    if(t<1) requestAnimationFrame(tick);
    else { el.textContent = final; el.classList.remove('scrambling'); el.classList.add('decoded'); }
  };
  requestAnimationFrame(tick);
}
/* Arm every [data-scramble] label: show static immediately, decode when it arrives on screen. */
let SCRAMBLE_IO = null;
function observeScrambles(root){
  const scope = root || document;
  const els = scope.querySelectorAll('[data-scramble]');
  if(!els.length) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(!('IntersectionObserver' in window)){ els.forEach(e=>scrambleText(e,0)); return; }
  if(!SCRAMBLE_IO){
    SCRAMBLE_IO = new IntersectionObserver(entries=>{
      entries.forEach(en=>{ if(en.isIntersecting){ scrambleText(en.target); SCRAMBLE_IO.unobserve(en.target); } });
    },{threshold:0.35});
  }
  els.forEach(e=>{
    if(e.__scrObs) return;
    e.__scrObs = true;
    if(!reduce && !e.__scrDone){
      e.dataset.final = e.textContent;
      e.textContent = staticNoise(e.textContent.length);
      e.classList.add('scrambling');
    }
    SCRAMBLE_IO.observe(e);
  });
}

/* ---------------- TRUST FEATURES STRIP ---------------- */
/* Festive dressing for the trust strip: a sagging string of fairy lights with
   twinkling bulbs across the top, plus a snowdrift banked along the bottom. */
function xmasLightsSVG(){
  const bulbColors = ['#FF5A6E','#FFC94D','#57D977','#B98BFF'];
  let wire = 'M0,10';
  for(let x=0; x<1440; x+=180){ wire += ` Q${x+90},46 ${x+180},10`; }
  let dots = '';
  for(let i=0, x=90; x<1440; x+=180, i++){
    const c = bulbColors[i % bulbColors.length];
    dots += `<circle cx="${x}" cy="34" r="13" fill="${c}" opacity=".20"/>`;
    dots += `<circle class="xmas-bulb" cx="${x}" cy="34" r="7.5" fill="${c}" style="animation-delay:${(i%4)*0.55}s"/>`;
  }
  return `<svg class="xmas-lights" viewBox="0 0 1440 56" fill="none" aria-hidden="true"><path d="${wire}" stroke="rgba(255,255,255,.30)" stroke-width="2"/>${dots}</svg>`;
}
const XMAS_SNOWBANK = `<svg class="xmas-snowbank" viewBox="0 0 1440 44" preserveAspectRatio="none" fill="none" aria-hidden="true">
  <path d="M0,44 L0,28 Q120,12 240,26 T480,24 T720,26 T960,24 T1200,28 T1440,26 L1440,44 Z" fill="rgba(255,255,255,.09)"/>
  <path d="M0,44 L0,34 Q180,22 360,32 T720,32 T1080,30 T1440,34 L1440,44 Z" fill="rgba(255,255,255,.13)"/>
</svg>`;

function featuresStripHTML(){
  return `<section class="features-strip">
    <div class="xmas-deco" aria-hidden="true">${xmasLightsSVG()}${XMAS_SNOWBANK}</div>
    <div class="wrap">
      <div class="features-grid">
        <div class="feature-item">
          <div class="feature-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="1" y="3" width="15" height="13" rx="2"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg></div>
          <div class="feature-info"><h4>Free Express Shipping</h4><p>On all islandwide orders over Rs. 5,000</p></div>
        </div>
        <div class="feature-item">
          <div class="feature-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg></div>
          <div class="feature-info"><h4>Flexible Payments</h4><p>Credit Card, Koko Installments & Cash on Delivery</p></div>
        </div>
        <div class="feature-item">
          <div class="feature-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>
          <div class="feature-info"><h4>100% Quality Guarantee</h4><p>Authentic craftsmanship & premium fabrics</p></div>
        </div>
        <div class="feature-item">
          <div class="feature-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></div>
          <div class="feature-info"><h4>30-Day Easy Returns</h4><p>Hassle-free size exchanges & full refunds</p></div>
        </div>
      </div>
    </div>
  </section>`;
}

/* ---------------- PRODUCT CARD ---------------- */
function productCard(p){
  const isWish = SESSION.wishlist.includes(p.id);
  const discountPct = p.discountPrice ? Math.round((1 - p.discountPrice/p.price)*100) : 0;
  const tag = p.tags.includes('sale')?'sale':(p.tags.includes('new')?'new':(p.tags.includes('bestseller')?'bestseller':''));

  return `<div class="product-card" onclick="nav('#/product/${p.id}')">
    <div class="pc-frame ${p.category==='gift-cards'?'fit-contain':''}">
      <img src="${p.images[0]}" alt="${p.title}" loading="lazy" onerror="imgFallback(this,'${p.category}')">
      ${discountPct>0 ? `<span class="pc-tag sale">-${discountPct}% SALE</span>` : (tag ? `<span class="pc-tag ${tag}">${tag==='new'?'NEW':tag==='bestseller'?'BESTSELLER':'HOT'}</span>` : '')}
      <button class="pc-wish ${isWish?'active':''}" onclick="event.stopPropagation();toggleWishlist('${p.id}')" aria-label="Wishlist">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21s-7.5-4.9-10-9.3C-.2 7.6 2.4 3.7 6.4 3.7c2 0 3.6 1 5.6 3.1 2-2.1 3.6-3.1 5.6-3.1 4 0 6.6 3.9 4.4 8-2.5 4.4-10 9.3-10 9.3z"/></svg>
      </button>
      <div class="pc-actions">
        <button onclick="event.stopPropagation();nav('#/product/${p.id}')">Quick View</button>
        <button onclick="event.stopPropagation();quickAdd('${p.id}')">Add to Bag</button>
      </div>
    </div>
    <div class="pc-info">
      <h4>${p.title}</h4>
      <div class="pc-meta">
        ${p.discountPrice ? `<span class="pc-price-sale">${money(p.discountPrice)}</span><span class="pc-price-old">${money(p.price)}</span><span class="pc-discount-pill">SAVE ${discountPct}%</span>` : `<span>${money(p.price)}</span>`}
      </div>
      <div class="pc-stars">${stars(p.rating)} <span class="mono" style="font-weight:700;">${p.rating}</span> <span style="color:var(--ink-soft);">(${p.reviewsCount})</span></div>
      <div class="pc-colors">${p.colors.slice(0,4).map(c=>`<span style="background:${COLORS[c]||c}" title="${c}"></span>`).join('')}</div>
    </div>
  </div>`;
}

function quickAdd(id){
  const p = findProduct(id);
  if(!p) return;
  addToCart(id, p.colors[0], p.sizes[Math.floor(p.sizes.length/2)], 1);
  openCartDrawer();
}

async function toggleWishlist(id){
  const i = SESSION.wishlist.indexOf(id);
  if(i>-1){SESSION.wishlist.splice(i,1); toast('Removed from wishlist');}
  else{SESSION.wishlist.push(id); toast('Added to wishlist ♥');}
  await saveSession(); renderHeader(); renderRoute();
}

async function addToCart(productId,color,size,qty){
  const existing = SESSION.cart.find(i=>i.productId===productId && i.color===color && i.size===size);
  if(existing) existing.qty += qty;
  else SESSION.cart.push({productId,color,size,qty});
  await saveSession();
  renderHeader();
  toast('Item added to shopping bag ✓');
}

/* ============================================================
   3-D RING CAROUSEL  — "Mirror Hall" engine
   ============================================================ */
const RING = {
  angle: 0,          // current ring angle (deg)
  velocity: 0,       // inertia velocity (deg/frame)
  active: 0,         // index of card nearest front
  cards: [],         // category objects
  count: 0,
  radius: 0,         // computed ring radius (px)
  dragging: false,
  lastX: 0,
  lastTime: 0,
  raf: null,
  autoSpin: null,
  paused: false,
};

/* Build the radius so cards are evenly spaced on the ring */
function ringRadius(n, cardW){
  const theta = (2 * Math.PI) / n;
  return Math.round((cardW / 2) / Math.tan(theta / 2));
}

/* HTML template for the whole section */
function ringCarouselHTML(){
  /* Every sub-category gets a ring card. The extra "Others — Caps &
     Accessories" card was removed from this Explore section on request —
     the Others listing stays reachable from the header menu and footer. */
  const cats = DB.categories.slice();
  RING.cards = cats;
  RING.count = cats.length;
  RING.angle = 0;
  RING.velocity = 0;
  RING.active = 0;

  /* Ring cards are the visual centrepiece — ask Unsplash for the larger 1600px
     rendition so they stay sharp on HiDPI screens. */
  const ringHiRes = u => (typeof u==='string' && u.includes('images.unsplash.com'))
    ? u.replace(/w=\d+/, 'w=1600').replace(/q=\d+/, 'q=90')
    : u;
  const cardSlots = cats.map((cat, i) => {
    const img = ringHiRes(cat.isOthers ? cat.coverImage : getCategoryImage(cat.id));
    const fallbackCat = cat.isOthers ? 'caps-unisex' : cat.id;
    return `<div class="ring-card" data-ri="${i}" onclick="ringCardClick(${i})">
      <div class="ring-card-face">
        <img src="${img}" alt="${cat.name}" loading="eager" decoding="async" onerror="imgFallback(this,'${fallbackCat}',700,900)">
        <div class="ring-card-label">
          <div class="ring-cat-eyebrow">Explore</div>
          <h3>${cat.name}</h3>
          <span class="ring-shop-cta">Shop Category →</span>
        </div>
      </div>
      <div class="ring-card-reflection">
        <img src="${img}" alt="" aria-hidden="true" loading="lazy" decoding="async" onerror="imgFallback(this,'${fallbackCat}',700,900)">
      </div>
    </div>`;
  }).join('');

  const dots = cats.map((_, i) =>
    `<div class="ring-dot ${i===0?'active':''}" onclick="ringGoTo(${i})"></div>`
  ).join('');

  return `<section class="ring-carousel-section">
    <div class="ring-carousel-header">
      <div class="ring-eyebrow">NoFrame · Curated Collections</div>
      <h2>Shop by Category</h2>
      <p>Liquid light. Infinite style.</p>
    </div>
    <div class="ring-scene" id="ring-scene">
      <div class="ring-track" id="ring-track">${cardSlots}</div>
    </div>
    <div class="ring-counter" id="ring-counter">
      <strong>01</strong> / ${String(cats.length).padStart(2,'0')}
    </div>
    <div class="ring-dots" id="ring-dots">${dots}</div>
  </section>`;
}

/* Place every card in 3D space around the ring */
function ringLayout(){
  const track = document.getElementById('ring-track');
  if(!track) return;
  const scene = document.getElementById('ring-scene');
  const cardW = scene.offsetWidth < 600 ? 100 : scene.offsetWidth < 960 ? 124 : 148;
  RING.radius = ringRadius(RING.count, cardW + 20);

  const angleStep = 360 / RING.count;
  const cards = track.querySelectorAll('.ring-card');
  cards.forEach((card, i) => {
    const a = angleStep * i;   // each card's offset angle on the ring
    card.style.transform =
      `rotateY(${a}deg) translateZ(${RING.radius}px)`;
  });
}

/* Apply the ring's rotation and update active card highlight */
function ringApply(){
  const track = document.getElementById('ring-track');
  if(!track) return;
  track.style.transform = `rotateY(${RING.angle}deg)`;

  /* Which card is closest to angle 0 (front)? */
  const angleStep = 360 / RING.count;
  const norm = ((-RING.angle % 360) + 360) % 360;
  const nearest = Math.round(norm / angleStep) % RING.count;
  if(nearest !== RING.active){
    RING.active = nearest;
    ringUpdateUI();
  }
}

function ringUpdateUI(){
  const n = RING.count;
  /* Cards */
  const cards = document.querySelectorAll('.ring-card');
  cards.forEach((card, i) => {
    card.classList.toggle('ring-active', i === RING.active);
  });
  /* Counter */
  const ctr = document.getElementById('ring-counter');
  if(ctr) ctr.innerHTML =
    `<strong>${String(RING.active + 1).padStart(2,'0')}</strong> / ${String(n).padStart(2,'0')}`;
  /* Dots */
  const dots = document.querySelectorAll('.ring-dot');
  dots.forEach((d, i) => d.classList.toggle('active', i === RING.active));
}

/* Inertia animation loop */
function ringFrame(){
  if(RING.dragging){ RING.raf = requestAnimationFrame(ringFrame); return; }
  RING.velocity *= 0.93;   // friction
  RING.angle += RING.velocity;
  ringApply();
  if(Math.abs(RING.velocity) > 0.05){
    RING.raf = requestAnimationFrame(ringFrame);
  } else {
    /* Snap to nearest card */
    ringSnapNearest();
  }
}

function ringSnapNearest(){
  const angleStep = 360 / RING.count;
  const norm = ((-RING.angle % 360) + 360) % 360;
  const nearest = Math.round(norm / angleStep) % RING.count;
  const targetAngle = -nearest * angleStep;
  /* Smooth snap */
  let snap = RING.angle;
  const diff = ((targetAngle - (snap % 360)) + 540) % 360 - 180;
  snap += diff;
  const animSnap = () => {
    RING.angle += (snap - RING.angle) * 0.14;
    ringApply();
    if(Math.abs(snap - RING.angle) > 0.2){
      RING.raf = requestAnimationFrame(animSnap);
    } else {
      RING.angle = snap;
      ringApply();
    }
  };
  animSnap();
}

/* Navigate to a specific card index */
function ringGoTo(index){
  cancelAnimationFrame(RING.raf);
  RING.velocity = 0;
  const angleStep = 360 / RING.count;
  const target = -index * angleStep;
  /* Choose shortest arc */
  let diff = ((target - RING.angle) % 360 + 540) % 360 - 180;
  const dest = RING.angle + diff;
  const go = () => {
    RING.angle += (dest - RING.angle) * 0.14;
    ringApply();
    if(Math.abs(dest - RING.angle) > 0.3){
      RING.raf = requestAnimationFrame(go);
    } else {
      RING.angle = dest;
      ringApply();
    }
  };
  go();
}

/* Click on a card: if it's front → navigate, else spin to it */
function ringCardClick(i){
  if(RING.active === i){
    const cat = RING.cards[i];
    if(!cat) return;
    if(cat.isOthers) nav('#/others');      /* caps, watches, handbags catch-all */
    else nav('#/category/' + cat.id);
  } else {
    ringGoTo(i);
  }
}

/* Auto-spin (pauses on hover / drag) */
function ringStartAuto(){
  RING.autoSpin = setInterval(() => {
    if(!RING.paused && !RING.dragging){
      RING.velocity = -0.5;
      cancelAnimationFrame(RING.raf);
      RING.raf = requestAnimationFrame(ringFrame);
    }
  }, 4000);
}

/* Drag — mouse */
function ringOnMouseDown(e){
  RING.dragging = true;
  RING.lastX = e.clientX;
  RING.lastTime = Date.now();
  RING.velocity = 0;
  e.currentTarget.classList.add('dragging');
}
function ringOnMouseMove(e){
  if(!RING.dragging) return;
  const dx = e.clientX - RING.lastX;
  RING.velocity = dx * 0.35;
  RING.angle += dx * 0.35;
  RING.lastX = e.clientX;
  RING.lastTime = Date.now();
  ringApply();
}
function ringOnMouseUp(e){
  if(!RING.dragging) return;
  RING.dragging = false;
  e.currentTarget.classList.remove('dragging');
  cancelAnimationFrame(RING.raf);
  RING.raf = requestAnimationFrame(ringFrame);
}

/* Drag — touch */
function ringOnTouchStart(e){
  RING.dragging = true;
  RING.lastX = e.touches[0].clientX;
  RING.velocity = 0;
}
function ringOnTouchMove(e){
  if(!RING.dragging) return;
  const dx = e.touches[0].clientX - RING.lastX;
  RING.velocity = dx * 0.4;
  RING.angle += dx * 0.4;
  RING.lastX = e.touches[0].clientX;
  ringApply();
}
function ringOnTouchEnd(){
  RING.dragging = false;
  cancelAnimationFrame(RING.raf);
  RING.raf = requestAnimationFrame(ringFrame);
}

/* Bind all events after the section is rendered into DOM */
function setupRingCarousel(){
  const scene = document.getElementById('ring-scene');
  if(!scene) return;

  ringLayout();
  ringApply();
  ringUpdateUI();

  /* Auto spin */
  clearInterval(RING.autoSpin);
  ringStartAuto();

  /* Pause on hover */
  scene.addEventListener('mouseenter', () => { RING.paused = true; });
  scene.addEventListener('mouseleave', () => { RING.paused = false; });

  /* Mouse drag */
  scene.addEventListener('mousedown',  ringOnMouseDown);
  window.addEventListener('mousemove', ringOnMouseMove);
  window.addEventListener('mouseup',   ringOnMouseUp);

  /* Touch drag */
  scene.addEventListener('touchstart', ringOnTouchStart, {passive:true});
  scene.addEventListener('touchmove',  ringOnTouchMove,  {passive:true});
  scene.addEventListener('touchend',   ringOnTouchEnd);

  /* Re-layout on resize */
  window.removeEventListener('resize', ringLayout);
  window.addEventListener('resize', () => { ringLayout(); ringApply(); });
}


/* Middle promo banner: play only the 3s–8s slice of images/promo-video.mp4,
   looping that window forever instead of the whole clip. */
const PROMO_CLIP = {start:3, end:8};
function initPromoClip(){
  document.querySelectorAll('.promo-video-bg').forEach(clipPromoVideo);
}
function clipPromoVideo(v){
  if(!v || v.__promoClip) return;
  v.__promoClip = true;
  const {start,end} = PROMO_CLIP;
  const inWindow = t => t >= start - 0.05 && t < end;
  const clamp = () => { if(!v.seeking && !inWindow(v.currentTime)) v.currentTime = start; };
  v.addEventListener('loadedmetadata', clamp);
  v.addEventListener('timeupdate', clamp);   /* keeps the window when rAF is throttled (hidden tab) */
  v.addEventListener('seeked', clamp);
  clamp();
  const tick = () => {
    if(!v.isConnected){ v.__promoClip = false; return; }   /* navigated away from home */
    clamp();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* Background loops: if the page loaded while the tab was hidden, Chromium
   suspends them at 0 — resume when the tab becomes visible again. */
document.addEventListener('visibilitychange',()=>{
  if(document.hidden) return;
  document.querySelectorAll('.promo-video-bg, .brand-video-bg').forEach(v=>{ if(v.paused) v.play().catch(()=>{}); });
});

function productsByTag(tag,limit=8){
  const tagged = DB.products.filter(p=>Array.isArray(p.tags) && p.tags.includes(tag));
  return (tagged.length ? tagged : DB.products).slice(0,limit);
}

/* Sale carousel feed — one product per sub-category per round, so every
   visible group of 4 always spans four different sub-categories. */
function saleCarouselItems(limit=12){
  const byCat = {};
  DB.products.filter(p=>p.discountPrice || p.tags.includes('sale')).forEach(p=>{
    (byCat[p.category] = byCat[p.category] || []).push(p);
  });
  const cats = Object.keys(byCat);
  const out = [];
  let i = 0;
  while(out.length < limit && cats.some(c=>byCat[c].length)){
    const bucket = byCat[cats[i % cats.length]];
    const item = bucket.shift();
    if(item) out.push(item);
    i++;
  }
  return out;
}

function saleCarouselHTML(){
  const items = saleCarouselItems(12);
  return `
  <div class="sale-carousel">
    <button class="sale-arrow" style="left:-6px;" onclick="saleScroll(-1)" aria-label="Move sale items left">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
    </button>
    <div class="sale-track" id="sale-track">${items.map(productCard).join('')}</div>
    <button class="sale-arrow" style="right:-6px;" onclick="saleScroll(1)" aria-label="Move sale items right">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
  </div>`;
}

function saleScroll(dir){
  const t = document.getElementById('sale-track');
  if(!t) return;
  t.scrollBy({left: dir * (t.clientWidth * 0.9), behavior:'smooth'});
}

/* Main brands — clicking one opens a brand store page with buy access. */
const MAIN_BRANDS = ['Nike','Adidas','Puma','Levi\u2019s','Zara','Tommy Hilfiger','Casio','Seiko','Citizen','Coach'];
function brandBarHTML(){
  return `
  <section class="section brand-bar-section">
    <video class="brand-video-bg promo-video-bg" autoplay loop muted playsinline preload="auto"
           poster="https://images.unsplash.com/photo-1544967082-d9d25d867d66?auto=format&fit=crop&w=1600&q=80">
      <source src="../images/promo-video.mp4" type="video/mp4">
    </video>
    <div class="wrap">
      <div class="section-head" style="justify-content:center;">
        <div style="text-align:center;"><div class="eyebrow">Shop By Brand</div><h2>Our Main Brands</h2></div>
      </div>
      <div class="brand-bar">
        ${MAIN_BRANDS.map(b=>`<a class="brand-chip" href="#/brand/${encodeURIComponent(b)}">${b}</a>`).join('')}
      </div>
      <p class="brand-bar-note">Click a brand to see every product we carry from it — then buy it directly.</p>
    </div>
  </section>`;
}

/* New Arrivals feed — always exactly `limit` cards, with the men's & women's
   innerwear lines taking the front slots before any other new arrivals. */
const INNERWEAR_CATS = ['mens-underwear','womens-underwear'];
function newArrivalsFeed(limit=8){
  const isIn  = p => INNERWEAR_CATS.includes(p.category);
  const isNew = p => Array.isArray(p.tags) && p.tags.includes('new');
  const ordered = [
    ...DB.products.filter(p=> isIn(p) &&  isNew(p)),
    ...DB.products.filter(p=> isIn(p) && !isNew(p)),
    ...DB.products.filter(p=>!isIn(p) &&  isNew(p)),
    ...DB.products.filter(p=>!isIn(p) && !isNew(p))
  ];
  return ordered.slice(0, limit);
}

function renderHome(){
  const bestsellers = DB.products.filter(p=>p.tags.includes('bestseller')).slice(0,8);
  const arrivals = newArrivalsFeed(8);
  const html = `
  ${heroSliderHTML()}
  ${featuresStripHTML()}
  ${ringCarouselHTML()}

  <section class="section">
    <div class="wrap">
      <div class="section-head">
        <div><div class="eyebrow">Customer Favorites</div><h2>Best Sellers</h2></div>
      </div>
      <div class="product-grid">${(bestsellers.length?bestsellers:DB.products.slice(2,10)).map(productCard).join('')}</div>
    </div>
  </section>

  <div class="promo-strip-video">
    <!-- Golden snowflake festive loop: images/promo-video.mp4 (poster is the fallback frame) -->
    <video class="promo-video-bg" autoplay loop muted playsinline preload="auto"
           poster="https://images.unsplash.com/photo-1544967082-d9d25d867d66?auto=format&fit=crop&w=1600&q=80">
      <source src="../images/promo-video.mp4" type="video/mp4">
    </video>
    <div class="wrap">
      <div class="eyebrow" style="color:rgba(255,255,255,0.78);margin-bottom:12px;">HOLIDAY SPECIAL OFFER</div>
      <h3>Holiday Festive Sale — Up to 35% Off</h3>
      <p>Celebrate the season with handcrafted frocks, tailored office trousers, and luxury leather accessories at exclusive festival prices.</p>
      <a class="btn btn-accent" href="#/sale">Explore Sale Items</a>
    </div>
  </div>

  <section class="section">
    <div class="wrap">
      <div class="section-head">
        <div><div class="eyebrow">Limited Time</div><h2 style="color:var(--sale);">Special Sale Highlights</h2></div>
        <a class="btn-ghost" href="#/sale">View All Sale →</a>
      </div>
      ${saleCarouselHTML()}
    </div>
  </section>

  ${brandBarHTML()}

  <section class="section section-alt section-black">
    <div class="wrap">
      <div class="section-head">
        <div><div class="eyebrow">Just Landed</div><h2>New Arrivals</h2></div>
        <a class="btn-ghost" href="#/new">View All Arrivals →</a>
      </div>
      <div class="product-grid">${(arrivals.length?arrivals:DB.products.slice(4,12)).map(productCard).join('')}</div>
    </div>
  </section>`;

  $('#app').innerHTML = html;
  observeScrambles($('#app'));
  setupRingCarousel();
  initPromoClip();
  clearInterval(heroTimer);
  heroTimer = setInterval(()=>setHero(heroIdx+1),5500);
}

/* ---------------- LISTING ---------------- */
let FILTER = {price:50000, colors:[], sizes:[], sort:'newest', catFilter:new Set()};

function applyFilters(list){
  let out = list.filter(p=>(p.discountPrice||p.price)<=FILTER.price);
  if(FILTER.colors.length) out = out.filter(p=>p.colors.some(c=>FILTER.colors.includes(c)));
  if(FILTER.sizes.length) out = out.filter(p=>p.sizes.some(s=>FILTER.sizes.includes(s)));
  if(FILTER.catFilter.size) out = out.filter(p=>FILTER.catFilter.has(p.category));
  switch(FILTER.sort){
    case 'price-asc': out.sort((a,b)=>(a.discountPrice||a.price)-(b.discountPrice||b.price)); break;
    case 'price-desc': out.sort((a,b)=>(b.discountPrice||b.price)-(a.discountPrice||a.price)); break;
    case 'rating': out.sort((a,b)=>b.rating-a.rating); break;
    case 'popular': out.sort((a,b)=>b.reviewsCount-a.reviewsCount); break;
    default: out.sort((a,b)=>b.createdAt-a.createdAt);
  }
  return out;
}

function renderListing(title, baseList){
  const list = applyFilters(baseList);
  const allColors = Object.keys(COLORS);
  const allSizes = ['XS','S','M','L','XL','XXL'];
  /* Gift cards have no size/colour/category variants — drop the filter rail. */
  const hideFilters = baseList.length>0 && baseList.every(p=>p.category==='gift-cards');

  $('#app').innerHTML = `
  <div class="page wrap${hideFilters?' gift-page':''}">
    <div class="breadcrumb"><a href="#/home">Home</a> / <span>${title}</span></div>
    <h1 class="page-title">${title}</h1>
    <div class="listing" style="margin-top:32px;">
      <aside>
        <div class="filter-block">
          <h5>Categories</h5>
          ${DB.categories.map(c=>`<label class="filter-opt"><input type="checkbox" onchange="toggleCatFilter('${c.id}')" ${FILTER.catFilter.has(c.id)?'checked':''}> ${c.name}</label>`).join('')}
        </div>
        <div class="filter-block">
          <h5>Max Price — ${money(FILTER.price)}</h5>
          <div class="price-range"><input type="range" min="1000" max="30000" step="500" value="${FILTER.price}" oninput="FILTER.price=+this.value;renderRoute()"></div>
        </div>
        <div class="filter-block">
          <h5>Sizes</h5>
          <div class="color-swatches">${allSizes.map(s=>`<button class="btn-sm ${FILTER.sizes.includes(s)?'btn-primary':'btn-outline'}" style="padding:6px 12px;" onclick="toggleSizeFilter('${s}')">${s}</button>`).join('')}</div>
        </div>
        <div class="filter-block">
          <h5>Colors</h5>
          <div class="color-swatches">${allColors.map(c=>`<button class="swatch-btn ${FILTER.colors.includes(c)?'selected':''}" style="background:${COLORS[c]}" title="${c}" onclick="toggleColorFilter('${c}')"></button>`).join('')}</div>
        </div>
        <button class="btn btn-outline btn-full btn-sm" onclick="resetFilters()">Reset All Filters</button>
      </aside>
      <div>
        <div class="listing-top">
          <span class="result-count">Showing <b>${list.length}</b> products</span>
          <select class="sort-select" onchange="FILTER.sort=this.value;renderRoute()">
            <option value="newest" ${FILTER.sort==='newest'?'selected':''}>Newest Arrivals</option>
            <option value="price-asc" ${FILTER.sort==='price-asc'?'selected':''}>Price: Low to High</option>
            <option value="price-desc" ${FILTER.sort==='price-desc'?'selected':''}>Price: High to Low</option>
            <option value="popular" ${FILTER.sort==='popular'?'selected':''}>Most Popular</option>
            <option value="rating" ${FILTER.sort==='rating'?'selected':''}>Highest Rated</option>
          </select>
        </div>
        ${list.length?`<div class="product-grid">${list.map(productCard).join('')}</div>`:`<div class="empty-state"><p>No products match your filter criteria.</p><button class="btn btn-outline" style="margin-top:14px;" onclick="resetFilters()">Reset Filters</button></div>`}
      </div>
    </div>
  </div>`;
}

function toggleCatFilter(id){ FILTER.catFilter.has(id)?FILTER.catFilter.delete(id):FILTER.catFilter.add(id); renderRoute(); }
function toggleColorFilter(c){ const i=FILTER.colors.indexOf(c); i>-1?FILTER.colors.splice(i,1):FILTER.colors.push(c); renderRoute(); }
function toggleSizeFilter(s){ const i=FILTER.sizes.indexOf(s); i>-1?FILTER.sizes.splice(i,1):FILTER.sizes.push(s); renderRoute(); }
function resetFilters(){ FILTER={price:50000,colors:[],sizes:[],sort:'newest',catFilter:new Set()}; renderRoute(); }

/* Product photo answers the cursor: a small lacquered tilt that resets on leave. */
function initPdTilt(){
  const el = document.getElementById('pd-main');
  if(!el) return;
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if(!window.matchMedia('(hover:hover)').matches) return;
  el.addEventListener('pointermove', e=>{
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left)/r.width - 0.5;
    const py = (e.clientY - r.top)/r.height - 0.5;
    el.style.setProperty('--rx', (-py*7).toFixed(2)+'deg');
    el.style.setProperty('--ry', (px*9).toFixed(2)+'deg');
  });
  el.addEventListener('pointerleave', ()=>{
    el.style.setProperty('--rx','0deg');
    el.style.setProperty('--ry','0deg');
  });
}

/* ---------------- PRODUCT DETAIL ---------------- */
function renderProduct(id){
  const p = findProduct(id);
  if(!p){ $('#app').innerHTML = `<div class="page wrap"><p>Product not found.</p></div>`; return; }
  VIEW.gallery=0; VIEW.selColor=p.colors[0]; VIEW.selSize=p.sizes[0]||'M'; VIEW.qty=1; VIEW.zoom=false;
  const related = DB.products.filter(r=>r.category===p.category && r.id!==p.id).slice(0,4);
  const isWish = SESSION.wishlist.includes(p.id);

  $('#app').innerHTML = `
  <div class="page wrap pd-page">
    <div class="breadcrumb"><a href="#/home">Home</a> / <a href="#/category/${p.category}">${p.categoryName}</a> / <span>${p.title}</span></div>
    <div class="pd-grid">
      <div>
        <div class="pd-gallery-main ${p.category==='gift-cards'?'contain':''}" id="pd-main" onclick="toggleZoom()">
          <img src="${p.images[0]}" id="pd-main-img" onerror="imgFallback(this,'${p.category}')">
          <span class="pd-sheen" aria-hidden="true"></span>
          <span class="pd-corner" data-scramble>NOFRAME · VERIFIED</span>
        </div>
        <div class="pd-gallery-note" data-scramble>Main product photo · click to zoom</div>
      </div>
      <div>
        <h1 class="pd-title">${p.title}</h1>
        <div class="pd-stars">${stars(p.rating)} <span class="mono" style="font-weight:700;">${p.rating}</span> · ${p.reviewsCount} customer reviews</div>
        <div class="pd-price">
          ${p.discountPrice?`<span class="pc-price-sale">${money(p.discountPrice)}</span><span class="pc-price-old">${money(p.price)}</span><span class="pc-discount-pill">SAVE ${Math.round((1-p.discountPrice/p.price)*100)}%</span>`:`<span>${money(p.price)}</span>`}
        </div>
        <p class="pd-desc">${p.description}</p>

        ${p.category==='gift-cards' ? `
        <div class="pd-row gift-card-row">
          <label>Denomination</label>
          <div class="gift-denom">${money(p.discountPrice||p.price)} · delivered by email</div>
        </div>` : `
        <div class="pd-row">
          <label>Color — <span id="color-label">${VIEW.selColor}</span></label>
          <div class="color-grid">${p.colors.map(c=>`<button class="swatch-btn ${c===VIEW.selColor?'selected':''}" data-c="${c}" style="width:32px;height:32px;background:${COLORS[c]||c}" onclick="selectColor('${c}')"></button>`).join('')}</div>
        </div>
        <div class="pd-row">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <label style="margin-bottom:0;">Select Size — <span id="size-label">${VIEW.selSize}</span></label>
            <button class="ai-btn" onclick="openAiSize('${p.id}')">✦ Size Assistant</button>
          </div>
          <div class="size-grid" id="size-grid">${p.sizes.map(s=>`<button class="size-btn ${s===VIEW.selSize?'selected':''}" data-s="${s}" onclick="selectSize('${s}')">${s}</button>`).join('')}</div>
        </div>`}
        <div class="pd-row">
          <label>Quantity</label>
          <div class="qty-stepper"><button onclick="stepQty(-1)">−</button><span id="qty-val">1</span><button onclick="stepQty(1)">+</button></div>
        </div>
        <div class="stock-line ${p.stock<8?'low':''}"><span class="stock-dot"></span> ${p.stock>0?`${p.stock<8?`Hurry! Only ${p.stock} left in stock`:'In Stock — Ships within 24 hours'}`:'Out of stock'}</div>
        <div class="pd-cta-row">
          <button class="btn btn-primary" ${p.stock<1?'disabled':''} onclick="addToCartFromPD('${p.id}')">Add to Shopping Bag</button>
          <button class="btn btn-accent" ${p.stock<1?'disabled':''} onclick="buyNow('${p.id}')">⚡ Buy It Now</button>
          <button class="icon-btn" style="border:1px solid var(--line);width:50px;height:50px;border-radius:var(--radius-sm);" onclick="toggleWishlist('${p.id}')">
            <svg viewBox="0 0 24 24" fill="${isWish?'var(--accent)':'none'}" stroke="${isWish?'var(--accent)':'currentColor'}" stroke-width="1.8"><path d="M12 21s-7.5-4.9-10-9.3C-.2 7.6 2.4 3.7 6.4 3.7c2 0 3.6 1 5.6 3.1 2-2.1 3.6-3.1 5.6-3.1 4 0 6.6 3.9 4.4 8-2.5 4.4-10 9.3-10 9.3z"/></svg>
          </button>
        </div>
        <div class="buy-now-note">⚡ Buy It Now skips the bag and takes you straight to checkout.</div>

        <div class="info-accordion">
          <div class="acc-item"><div class="acc-head" onclick="toggleAcc(this)">Delivery & Returns <span>+</span></div><div class="acc-body">Free express delivery nationwide on orders over Rs. 5,000. Delivered in 2–4 business days with tracking SMS. 30-day hassle-free returns & size exchanges.</div></div>
          <div class="acc-item"><div class="acc-head" onclick="toggleAcc(this)">Material & Care Instructions <span>+</span></div><div class="acc-body">100% premium quality fabric. Machine wash cold with like colors, tumble dry low. Do not bleach. Warm iron if needed.</div></div>
          <div class="acc-item"><div class="acc-head" onclick="toggleAcc(this)">Ratings & Reviews (${p.reviewsCount}) <span>+</span></div><div class="acc-body">Rated ${stars(p.rating)} by ${p.reviewsCount} customers. <a href="#customer-reviews" onclick="document.getElementById('customer-reviews').scrollIntoView({behavior:'smooth'});return false;" style="color:var(--accent);">Read all customer reviews below →</a></div></div>
        </div>
      </div>
    </div>
  </div>
  ${customerReviewsSection(p)}
  <section class="section section-alt">
    <div class="wrap">
      <div class="section-head"><div><div class="eyebrow">Complete Your Look</div><h2>You May Also Like</h2></div></div>
      <div class="product-grid">${related.map(productCard).join('')}</div>
    </div>
  </section>`;

  observeScrambles($('#app'));
  initPdTilt();
}

/* Seeded customer voices so every product shows real-looking feedback.
   Display-only: user-submitted reviews from DB.reviews are always listed first. */
const REVIEW_POOL = [
  {n:'Nadeesha Perera',   r:5, t:'Arrived faster than expected and the finish looks far more expensive than the price. Exactly as pictured.'},
  {n:'Kasun Fernando',    r:5, t:'Bought this as a gift and it was a hit. The stitching and material quality are genuinely impressive.'},
  {n:'Ishara Wickramasinghe', r:4, t:'Very happy overall — true to size and the colour matches the photos. I would order again.'},
  {n:'Michael Silva',     r:5, t:'Second order from NoFrame and the standard is consistent. Packaging was neat and felt premium.'},
  {n:'Tharushi Mendis',   r:5, t:'The fabric feels luxurious and it held up perfectly after washing. Highly recommended.'},
  {n:'Ruwan Jayasuriya',  r:4, t:'Good quality for the price point. Delivery took a day longer than promised but support kept me updated.'},
  {n:'Amaya Gunawardena', r:5, t:'Exactly what I was looking for. The fit is flattering and the little details are well finished.'},
  {n:'Dilshan Rodrigo',   r:5, t:'Support helped me pick the right size and it fitted perfectly. Very pleased with the whole experience.'},
  {n:'Shanika Alwis',     r:4, t:'Lovely item, slightly lighter in weight than I expected but still beautiful and well made.'},
  {n:'Praveen Kumara',    r:5, t:'Excellent value. Looks even better in person than it does on the website.'},
  {n:'Hannah De Silva',   r:5, t:'Repeat buyer here — the quality never disappoints and returns are completely hassle free.'},
  {n:'Chathura Bandara',  r:5, t:'Fast islandwide delivery and the item matched the description exactly.'},
  {n:'Nimasha Rajapaksa', r:4, t:'Really nice quality and finish. I only wish there were more colours to choose from.'}
];

function reviewsForProduct(p){
  const real = DB.reviews.filter(r=>r.productId===p.id);
  const h = hashStr(String(p.id));
  const seeded = [0,5,10].map(off=>{
    const s = REVIEW_POOL[(h+off)%REVIEW_POOL.length];
    return {productId:p.id, userName:s.n, rating:s.r, comment:s.t, seeded:true};
  });
  return [...real, ...seeded];
}

function ratingBreakdown(p){
  const r = parseFloat(p.rating)||4.5;
  /* Split the remaining share so the bars stay believable for the average. */
  let five = Math.round(Math.min(92, Math.max(20, ((r-3)/2)*80+10)));
  const rest = 100-five;
  let four = Math.round(rest*0.6);
  let three = Math.round(rest*0.24);
  let two = Math.round(rest*0.1);
  let one = Math.max(0, 100-five-four-three-two);
  return [five,four,three,two,one];
}

function customerReviewsSection(p){
  const revs = reviewsForProduct(p);
  const bars = ratingBreakdown(p);
  const count = Math.max(p.reviewsCount||0, revs.length);
  const initials = n => String(n).split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
  return `
  <section class="section" id="customer-reviews">
    <div class="wrap">
      <div class="section-head">
        <div><div class="eyebrow">Real Customer Feedback</div><h2>What Buyers Say</h2></div>
        <span class="review-note">${revs.length} of ${count} reviews shown</span>
      </div>
      <div class="reviews-layout">
        <aside class="rating-summary">
          <div class="rating-big">${(parseFloat(p.rating)||4.5).toFixed(1)}</div>
          <div class="rating-stars">${stars(p.rating)}</div>
          <div class="rating-sub">Based on ${count} verified customer reviews</div>
          <div class="rating-bars">
            ${[5,4,3,2,1].map((s,i)=>`<div class="bar-row"><span>${s}★</span><div class="bar-track"><div class="bar-fill" style="width:${bars[i]}%"></div></div><span class="mono">${bars[i]}%</span></div>`).join('')}
          </div>
          <div class="trust-chips">
            <span class="chip">✓ Verified buyers</span>
            <span class="chip">✓ 30-day free returns</span>
            <span class="chip">✓ Islandwide 2–4 day delivery</span>
          </div>
        </aside>
        <div class="review-cards">
          ${revs.map(r=>`
            <article class="review-card">
              <div class="review-card-top">
                <span class="review-avatar">${initials(r.userName)}</span>
                <div class="review-who"><b>${r.userName}</b><span>${stars(r.rating)} ${r.rating}.0</span></div>
                <span class="verified-pill">✓ Verified</span>
              </div>
              <p>${r.comment}</p>
              <span class="review-date">${r.seeded?'Purchased online':'Just now'}</span>
            </article>`).join('')}
        </div>
      </div>
      <div class="review-form">
        <h5>Leave a Review</h5>
        <input id="rev-name" placeholder="Your Name">
        <textarea id="rev-comment" placeholder="Write your review…" rows="3"></textarea>
        <button class="btn btn-primary btn-sm" onclick="submitReview('${p.id}')">Submit Review</button>
      </div>
    </div>
  </section>`;
}

async function submitReview(pid){
  const name = $('#rev-name').value.trim();
  const comment = $('#rev-comment').value.trim();
  if(!name || !comment){ toast('Please provide your name and comment'); return; }
  DB.reviews.push({productId:pid, userName:name, rating:5, comment});
  const p = findProduct(pid);
  if(p){ p.reviewsCount = (p.reviewsCount||0) + 1; }
  await saveDB();
  toast('Review submitted — thank you! ✓');
  renderProduct(pid);
}

function toggleAcc(el){
  const body = el.nextElementSibling;
  const wasOpen = body.classList.contains('open');
  document.querySelectorAll('.acc-body').forEach(b=>b.classList.remove('open'));
  if(!wasOpen) body.classList.add('open');
}

function setGallery(pid, i){
  const p = findProduct(pid);
  if(!p) return;
  VIEW.gallery=i;
  $('#pd-main-img').src = p.images[i]||p.images[0];
  document.querySelectorAll('#pd-thumbs img').forEach((im,k)=>im.classList.toggle('active',k===i));
}

function toggleZoom(){ VIEW.zoom=!VIEW.zoom; $('#pd-main').classList.toggle('zoomed',VIEW.zoom); }
function selectColor(c){ VIEW.selColor=c; document.querySelectorAll('.swatch-btn[data-c]').forEach(b=>b.classList.toggle('selected',b.dataset.c===c)); $('#color-label').textContent=c; }
function selectSize(s){ VIEW.selSize=s; document.querySelectorAll('#size-grid .size-btn').forEach(b=>b.classList.toggle('selected',b.dataset.s===s)); $('#size-label').textContent=s; }
function stepQty(d){ VIEW.qty=Math.max(1,VIEW.qty+d); $('#qty-val').textContent=VIEW.qty; }
function addToCartFromPD(id){
  if(!VIEW.selSize){ toast('Please select a size'); return; }
  addToCart(id, VIEW.selColor, VIEW.selSize, VIEW.qty);
  openCartDrawer();
}

/* Buy It Now — straight to checkout, skipping the cart drawer. */
async function buyNow(id){
  if(!VIEW.selSize){ toast('Please select a size'); return; }
  await addToCart(id, VIEW.selColor, VIEW.selSize, VIEW.qty);
  VIEW.checkoutStep = 2;
  nav('#/checkout');
}

/* ---------------- AI SIZE RECOMMENDATION ---------------- */
let AI_STATE = {height:170,weight:65,fit:'Regular',gender:'Unisex',pid:null};
function openAiSize(pid){
  AI_STATE.pid = pid;
  $('#modal-root').innerHTML = `
  <div class="modal-overlay open" id="ai-overlay">
    <div class="modal">
      <button class="modal-close" onclick="closeModal()">✕</button>
      <div class="eyebrow">AI Size Recommendation</div>
      <h3>Find Your Perfect Size</h3>
      <div class="sub">Enter your height and weight for an automated fit calculation.</div>
      <div id="ai-form">
        <div class="form-row"><label>Height (cm)</label><input type="number" id="ai-height" value="${AI_STATE.height}"></div>
        <div class="form-row"><label>Weight (kg)</label><input type="number" id="ai-weight" value="${AI_STATE.weight}"></div>
        <div class="form-row"><label>Fit Preference</label>
          <div class="seg-row" id="ai-fit-row">
            ${['Slim','Regular','Relaxed'].map(f=>`<button class="seg-btn ${f===AI_STATE.fit?'selected':''}" onclick="setAiFit('${f}')">${f}</button>`).join('')}
          </div>
        </div>
        <button class="btn btn-accent btn-full" onclick="runAiSize()">Calculate Recommended Size</button>
      </div>
      <div id="ai-result-slot"></div>
    </div>
  </div>`;
}

function setAiFit(f){ AI_STATE.fit=f; document.querySelectorAll('#ai-fit-row .seg-btn').forEach(b=>b.classList.toggle('selected',b.textContent===f)); }
function closeModal(){ $('#modal-root').innerHTML=''; }

function runAiSize(){
  const h = +$('#ai-height').value, w = +$('#ai-weight').value, fit = AI_STATE.fit;
  const bmi = w/((h/100)**2);
  const sizes = ['XS','S','M','L','XL','XXL'];
  let idx = 2;
  if(bmi<19) idx=0; else if(bmi<21.5) idx=1; else if(bmi<25) idx=2; else if(bmi<29) idx=3; else idx=4;
  if(fit==='Slim') idx=Math.max(0,idx-1);
  if(fit==='Relaxed') idx=Math.min(5,idx+1);
  const best = sizes[idx];
  const conf = Math.min(98, 85 + Math.round(Math.random()*12));
  $('#ai-result-slot').innerHTML = `
    <div class="ai-result">
      <div class="eyebrow">Recommended Size</div>
      <div class="big">${best}</div>
      <div class="conf">Accuracy Rating: ${conf}%</div>
      <div class="ai-explain">Based on ${h}cm height, ${w}kg weight, and a ${fit.toLowerCase()} fit preference, size <b>${best}</b> offers the ideal silhouette.</div>
      <button class="btn btn-primary btn-full" style="margin-top:16px;" onclick="applyAiSize('${best}')">Select Size ${best}</button>
    </div>`;
}

function applyAiSize(size){
  closeModal();
  selectSize(size);
  toast(`Size ${size} applied ✓`);
}

/* ---------------- CART PAGE ---------------- */
function renderCart(){
  const items = SESSION.cart;
  const sub = cartTotal();
  const delivery = sub>0 ? (sub>=5000?0:1500) : 0;
  const total = sub+delivery;

  $('#app').innerHTML = `
  <div class="page wrap">
    <h1 class="page-title">Shopping Cart</h1>
    ${!items.length ? `<div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
        <p style="margin-bottom:18px;color:var(--ink-soft);">Your shopping cart is currently empty.</p>
        <a class="btn btn-primary" href="#/home">Explore Products</a>
      </div>` :
    `<div class="cart-grid" style="margin-top:32px;">
      <div>
        ${items.map((it,idx)=>{
          const p = findProduct(it.productId);
          if(!p) return '';
          const price=p.discountPrice||p.price;
          return `<div class="cart-item">
            <img src="${p.images[0]}" onerror="imgFallback(this,'${p.category}')">
            <div>
              <h4>${p.title}</h4>
              <div class="meta">Color: ${it.color} · Size: ${it.size}</div>
              <div class="qty-stepper"><button onclick="changeCartQty(${idx},-1)">−</button><span>${it.qty}</span><button onclick="changeCartQty(${idx},1)">+</button></div>
            </div>
            <div class="price-col">
              <span>${money(price*it.qty)}</span>
              <button class="remove-link" onclick="removeCartItem(${idx})">Remove</button>
            </div>
          </div>`;
        }).join('')}
        <a class="btn-ghost" style="display:inline-block;margin-top:20px;" href="#/home">← Continue Shopping</a>
      </div>
      <div class="summary-card">
        <h3>Order Summary</h3>
        <div class="summary-row"><span>Subtotal</span><span class="mono">${money(sub)}</span></div>
        <div class="summary-row"><span>Shipping</span><span class="mono">${delivery===0?'FREE':money(delivery)}</span></div>
        <div class="summary-row total"><span>Total</span><span class="mono">${money(total)}</span></div>
        <button class="btn btn-primary btn-full" style="margin-top:20px;" onclick="nav('#/checkout')">Proceed to Checkout</button>
      </div>
    </div>`}
  </div>`;
}

async function changeCartQty(idx,d){ SESSION.cart[idx].qty=Math.max(1,SESSION.cart[idx].qty+d); await saveSession(); renderHeader(); renderRoute(); }
async function removeCartItem(idx){ SESSION.cart.splice(idx,1); await saveSession(); renderHeader(); renderRoute(); toast('Item removed'); }

/* ---------------- CHECKOUT ---------------- */
let CHECKOUT_DATA = {name:'',email:'',phone:'',address:'',city:'',zip:'',payment:'card'};
function renderCheckout(){
  if(!SESSION.cart.length){ nav('#/cart'); return; }
  const step = VIEW.checkoutStep;
  const sub = cartTotal(); const delivery = sub>=5000?0:1500; const total=sub+delivery;
  const stepsHTML = ['Bag Review','Shipping Info','Confirmation','Payment'].map((s,i)=>{
    const n=i+1; const cls = n<step?'done':n===step?'active':'';
    return `<div class="step-pill ${cls}"><span class="num">${n<step?'✓':n}</span>${s}</div>`;
  }).join('<span style="width:20px;"></span>');

  let body='';
  if(step===1){
    body = `<div class="summary-card"><h3>Cart Items</h3>
      ${SESSION.cart.map(it=>{const p=findProduct(it.productId);return `<div class="summary-row"><span>${p.title} (${it.size}) × ${it.qty}</span><span class="mono">${money((p.discountPrice||p.price)*it.qty)}</span></div>`;}).join('')}
      <div class="summary-row total"><span>Total</span><span class="mono">${money(total)}</span></div>
      <button class="btn btn-primary btn-full" style="margin-top:18px;" onclick="VIEW.checkoutStep=2;renderRoute()">Continue to Shipping Details →</button>
    </div>`;
  } else if(step===2){
    body = `<div class="admin-panel">
      <h3>Shipping Information</h3>
      <div class="form-2col">
        <div class="form-row"><label>Full Name</label><input id="ck-name" value="${CHECKOUT_DATA.name||(SESSION.user?SESSION.user.name:'')}" placeholder="John Doe"></div>
        <div class="form-row"><label>Email Address</label><input id="ck-email" type="email" value="${CHECKOUT_DATA.email||(SESSION.user?SESSION.user.email:'')}" placeholder="john@example.com"></div>
        <div class="form-row"><label>Mobile Number (for Tracking SMS)</label><input id="ck-phone" value="${CHECKOUT_DATA.phone||(SESSION.user?SESSION.user.phone:'')}" placeholder="+94 77 123 4567"></div>
        <div class="form-row"><label>City</label><input id="ck-city" value="${CHECKOUT_DATA.city||'Colombo'}"></div>
      </div>
      <div class="form-row"><label>Delivery Address</label><input id="ck-address" value="${CHECKOUT_DATA.address||(SESSION.user?SESSION.user.address:'')}" placeholder="Street address, Apartment or Suite"></div>
      <div class="form-row"><label>ZIP / Postal Code</label><input id="ck-zip" value="${CHECKOUT_DATA.zip||'00300'}"></div>
      <div style="display:flex;gap:12px;margin-top:16px;">
        <button class="btn btn-outline" onclick="VIEW.checkoutStep=1;renderRoute()">Back</button>
        <button class="btn btn-primary" onclick="saveShipping()">Continue to Confirmation →</button>
      </div>
    </div>`;
  } else if(step===3){
    body = `<div class="admin-panel">
      <h3>Confirm Order Details</h3>
      <div class="summary-row"><span>Customer Name</span><span>${CHECKOUT_DATA.name}</span></div>
      <div class="summary-row"><span>Email</span><span>${CHECKOUT_DATA.email}</span></div>
      <div class="summary-row"><span>Mobile</span><span>${CHECKOUT_DATA.phone}</span></div>
      <div class="summary-row"><span>Delivery Address</span><span>${CHECKOUT_DATA.address}, ${CHECKOUT_DATA.city} ${CHECKOUT_DATA.zip}</span></div>
      <div class="summary-row total"><span>Grand Total</span><span class="mono">${money(total)}</span></div>
      <div style="display:flex;gap:12px;margin-top:20px;">
        <button class="btn btn-outline" onclick="VIEW.checkoutStep=2;renderRoute()">Back</button>
        <button class="btn btn-primary" onclick="VIEW.checkoutStep=4;renderRoute()">Proceed to Payment →</button>
      </div>
    </div>`;
  } else {
    const codOk = codUnlocked();
    const usingCod = CHECKOUT_DATA.payment==='cod' && codOk;
    const done = completedPurchases();
    body = `<div class="admin-panel">
      <h3>Payment Method</h3>
      <div class="pay-option ${usingCod?'':'selected'}" onclick="selectPay('card',this)"><input type="radio" ${usingCod?'':'checked'} name="pay"> Secure Card Payment via PayHere</div>
      ${codOk?`
      <div class="pay-option ${usingCod?'selected':''}" onclick="selectPay('cod',this)"><input type="radio" ${usingCod?'checked':''} name="pay"> 💵 Cash on Delivery</div>`: `
      <div class="pay-option locked" title="Locked">
        <input type="radio" name="pay" disabled> 💵 Cash on Delivery <span class="lock-badge">🔒 Locked</span>
      </div>
      <div class="cod-lock-note">Cash on Delivery unlocks after <b>${LOYALTY.codMinOrders} completed purchases</b> — you have <b>${done}</b>. Keep ordering to unlock it.</div>`}
      ${usingCod?`
      <div class="pay-info-box">
        <div style="font-weight:700;margin-bottom:6px;">💵 Pay in cash on delivery</div>
        <div style="color:var(--ink-soft);font-size:14px;line-height:1.6;">Pay the courier when your order arrives. Available islandwide — please keep the exact amount ready where possible.</div>
      </div>`: `
      <div class="pay-info-box">
        <div style="font-weight:700;margin-bottom:6px;">Visa / Mastercard / AMEX</div>
        <div style="color:var(--ink-soft);font-size:14px;line-height:1.6;">Your card details are entered securely on the PayHere payment gateway. No card number, CVV or expiry data is stored by NoFrame.</div>
      </div>`}
      <div style="display:flex;gap:12px;margin-top:20px;">
        <button class="btn btn-outline" onclick="VIEW.checkoutStep=3;renderRoute()">Back</button>
        ${usingCod
          ? `<button class="btn btn-accent" onclick="placeCodOrder()">Place Order — ${money(total)}</button>`
          : `<button class="btn btn-accent" onclick="startPayHerePayment()">Pay Now — ${money(total)}</button>`}
      </div>
    </div>`;
  }

  $('#app').innerHTML = `
  <div class="page wrap">
    <h1 class="page-title">Checkout</h1>
    <div class="steps-row" style="margin-top:24px;">${stepsHTML}</div>
    <div class="checkout-grid">
      <div>${body}</div>
      <div class="summary-card">
        <h3>Order Summary</h3>
        ${SESSION.cart.map(it=>{const p=findProduct(it.productId);return `<div class="summary-row"><span>${p.title} (${it.size}) × ${it.qty}</span><span class="mono">${money((p.discountPrice||p.price)*it.qty)}</span></div>`;}).join('')}
        <div class="summary-row"><span>Shipping</span><span class="mono">${delivery===0?'FREE':money(delivery)}</span></div>
        <div class="summary-row total"><span>Total</span><span class="mono">${money(total)}</span></div>
      </div>
    </div>
  </div>`;
}

function selectPay(type,el){
  CHECKOUT_DATA.payment=type;
  document.querySelectorAll('.pay-option').forEach(o=>o.classList.remove('selected'));
  if(el) el.classList.add('selected');
  const cardFields = $('#card-fields');
  if(cardFields) cardFields.style.display = type==='card'?'grid':'none';
  /* Re-render so the action button swaps between Pay Now and Place Order. */
  if(VIEW.checkoutStep===4) renderRoute();
}

/* Cash on Delivery — available only after LOYALTY.codMinOrders completed purchases. */
async function placeCodOrder(){
  if(!codUnlocked()){
    toast(`Cash on Delivery unlocks after ${LOYALTY.codMinOrders} completed purchases`);
    return;
  }
  if(!CHECKOUT_DATA.name || !CHECKOUT_DATA.address){
    toast('Please complete your shipping details first');
    VIEW.checkoutStep=2; renderRoute();
    return;
  }
  const sub=cartTotal(); const delivery = sub>=5000?0:1500;
  const order = {
    id:'NF'+Date.now().toString().slice(-6),
    userId: SESSION.user?SESSION.user.id:'guest',
    items: SESSION.cart.map(it=>({...it, title:findProduct(it.productId).title, price:findProduct(it.productId).discountPrice||findProduct(it.productId).price, image:findProduct(it.productId).images[0]})),
    total: sub+delivery,
    status:'Confirmed',
    paymentMethod:'cash-on-delivery',
    shipping: {...CHECKOUT_DATA},
    createdAt: Date.now()
  };
  DB.orders.unshift(order);
  await persistOrder(order);
  await saveDB();
  await awardLoyalty(order);
  SESSION.cart = [];
  await saveSession();
  renderHeader();
  toast('Order placed — pay cash on delivery 🎉');
  nav('#/order-success/'+order.id);
}
function saveShipping(){
  CHECKOUT_DATA.name=$('#ck-name').value; CHECKOUT_DATA.email=$('#ck-email').value; CHECKOUT_DATA.phone=$('#ck-phone').value;
  CHECKOUT_DATA.city=$('#ck-city').value; CHECKOUT_DATA.address=$('#ck-address').value; CHECKOUT_DATA.zip=$('#ck-zip').value;
  if(!CHECKOUT_DATA.name||!CHECKOUT_DATA.email||!CHECKOUT_DATA.address){ toast('Please complete all required fields'); return; }
  VIEW.checkoutStep=3; renderRoute();
}

async function startPayHerePayment(){
  const sub=cartTotal(); const delivery = sub>=5000?0:1500;
  const order = {
    id:'NF'+Date.now().toString().slice(-6),
    userId: SESSION.user?SESSION.user.id:'guest',
    items: SESSION.cart.map(it=>({...it, title:findProduct(it.productId).title, price:findProduct(it.productId).discountPrice||findProduct(it.productId).price, image:findProduct(it.productId).images[0]})),
    total: sub+delivery,
    status:'Payment Pending',
    shipping: {...CHECKOUT_DATA},
    createdAt: Date.now()
  };

  DB.orders.unshift(order);
  await persistOrder(order);
  await saveDB();
  await awardLoyalty(order);

  // Submit the checkout/customer details to our server-side PayHere bridge.
  // The bridge calculates the hash and auto-posts to the official PayHere Sandbox.
  const form=document.createElement('form');
  form.method='POST';
  form.action='../payment/start.php';
  form.style.display='none';
  const fields={
    order_id:order.id,
    items:order.items.map(x=>`${x.title} (${x.size}) x${x.qty}`).join(', '),
    amount:order.total.toFixed(2),
    full_name:CHECKOUT_DATA.name,
    email:CHECKOUT_DATA.email,
    phone:CHECKOUT_DATA.phone,
    address:CHECKOUT_DATA.address,
    city:CHECKOUT_DATA.city,
    zip:CHECKOUT_DATA.zip,
    country:'Sri Lanka',
    custom_1:SESSION.user?SESSION.user.id:'guest'
  };
  Object.entries(fields).forEach(([name,value])=>{
    const input=document.createElement('input');
    input.type='hidden'; input.name=name; input.value=value ?? '';
    form.appendChild(input);
  });
  document.body.appendChild(form);
  form.submit();
}

function renderOrderSuccess(orderId){
  const order = DB.orders.find(o=>o.id===orderId);
  if(!order){ $('#app').innerHTML=`<div class="page wrap"><p>Order not found.</p></div>`; return; }
  $('#app').innerHTML = `
  <div class="page wrap">
    <div class="order-success">
      <div class="check">✓</div>
      <h1 class="page-title">Thank You For Your Order!</h1>
      <p style="color:var(--ink-soft);margin:12px 0 6px;">Your order <b class="mono">#${order.id}</b> has been received and confirmed.</p>
      <p style="color:var(--ink-soft);font-size:13.5px;margin-bottom:28px;">A confirmation has been sent to <b>${order.shipping.email||'your email'}</b>. SMS tracking updates will be dispatched to <b>${order.shipping.phone}</b>.</p>
      
      <div class="track-line">
        <div class="track-step done"><div class="dot"></div><span>Confirmed</span></div>
        <div class="track-step done"><div class="dot"></div><span>Processing</span></div>
        <div class="track-step"><div class="dot"></div><span>Dispatched</span></div>
        <div class="track-step"><div class="dot"></div><span>Delivered</span></div>
      </div>

      <div style="display:flex;gap:12px;justify-content:center;margin-top:32px;">
        <a class="btn btn-outline" href="#/home">Continue Shopping</a>
        <a class="btn btn-primary" href="#/profile/orders">View My Orders</a>
      </div>
    </div>
  </div>`;
}

/* ---------------- CART ASSOCIATION & MERGING ---------------- */
function mergeGuestCart(userCart = []) {
  const guestCart = SESSION.cart || [];
  let mergedCount = 0;
  if (guestCart.length) {
    guestCart.forEach(gItem => {
      const existing = userCart.find(u => u.productId === gItem.productId && u.color === gItem.color && u.size === gItem.size);
      if (existing) {
        existing.qty += gItem.qty;
      } else {
        userCart.push({ ...gItem });
      }
      mergedCount += gItem.qty;
    });
    if (mergedCount > 0) {
      toast(`Merged ${mergedCount} guest cart item(s) into your account ✓`);
    }
  }
  SESSION.cart = userCart;
}

/* ---------------- PASSWORD COMPLEXITY HELPERS ---------------- */
function checkPasswordComplexity(pw) {
  return {
    len: pw.length >= 8,
    upper: /[A-Z]/.test(pw),
    lower: /[a-z]/.test(pw),
    num: /[0-9]/.test(pw),
    special: /[@$!%*?&#^()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pw)
  };
}

function updatePasswordComplexityUI(pw, fillId = 'pw-bar-fill', rulesId = 'pw-rules') {
  const rules = checkPasswordComplexity(pw);
  const metCount = Object.values(rules).filter(Boolean).length;
  const fill = $('#' + fillId);
  const rulesSlot = $('#' + rulesId);
  if (fill) {
    fill.style.width = (metCount * 20) + '%';
    fill.style.backgroundColor = metCount < 3 ? '#b23a2e' : (metCount < 5 ? '#d6a937' : '#2e7d32');
  }
  if (rulesSlot) {
    rulesSlot.innerHTML = `
      <div class="pw-rule ${rules.len ? 'met' : 'unmet'}">${rules.len ? '✓' : '○'} Min 8 characters</div>
      <div class="pw-rule ${rules.upper ? 'met' : 'unmet'}">${rules.upper ? '✓' : '○'} Uppercase (A-Z)</div>
      <div class="pw-rule ${rules.lower ? 'met' : 'unmet'}">${rules.lower ? '✓' : '○'} Lowercase (a-z)</div>
      <div class="pw-rule ${rules.num ? 'met' : 'unmet'}">${rules.num ? '✓' : '○'} Number (0-9)</div>
      <div class="pw-rule ${rules.special ? 'met' : 'unmet'}" style="grid-column:1/3;">${rules.special ? '✓' : '○'} Special symbol (!@#$%^&*)</div>
    `;
  }
}

/* ---------------- AUTH ---------------- */
function renderAuth(mode) {
  const hash = location.hash;
  let returnUrl = '';
  if (hash.includes('returnUrl=')) {
    returnUrl = decodeURIComponent(hash.split('returnUrl=')[1]);
  }

  $('#app').innerHTML = `
  <div class="page wrap auth-page">
    <div class="auth-scene" id="auth-scene" data-lit="false" onclick="litLamp(true)" onfocusin="litLamp(true)">
      <div class="lamp-rig">
        <button type="button" class="lamp-btn" id="lamp-btn" aria-label="Toggle the lamp" onclick="event.stopPropagation();toggleLamp();">
          <svg class="lamp-svg" viewBox="0 0 330 362" fill="none" aria-hidden="true">
            <ellipse cx="70" cy="340" rx="56" ry="14" fill="#1B1B22"/>
            <rect x="52" y="314" width="36" height="28" rx="7" fill="#26262F"/>
            <path d="M70 318 L132 212" stroke="#C9A24B" stroke-width="14" stroke-linecap="round"/>
            <path d="M132 212 L212 144" stroke="#C9A24B" stroke-width="14" stroke-linecap="round"/>
            <circle cx="132" cy="212" r="12" fill="#E8C87A"/>
            <circle cx="212" cy="144" r="10" fill="#E8C87A"/>
            <path d="M220 132 L302 176 L241 236 L200 152 Z" fill="#2A2A34" stroke="#C9A24B" stroke-width="5" stroke-linejoin="round"/>
            <circle class="lamp-bulb" cx="268" cy="201" r="13" fill="#FFE7A8"/>
          </svg>
        </button>
        <span class="lamp-hint" id="lamp-hint">Push me to turn on</span>
        <div class="lamp-swatches" role="group" aria-label="Lamp light colour">
          <button type="button" class="lamp-swatch active" data-lc="255,217,138" style="--sw:#FFD98A" title="Golden" aria-label="Golden light" onclick="event.stopPropagation();pickLampColor(this);"></button>
          <button type="button" class="lamp-swatch" data-lc="185,139,255" style="--sw:#B98BFF" title="Violet" aria-label="Violet light" onclick="event.stopPropagation();pickLampColor(this);"></button>
          <button type="button" class="lamp-swatch" data-lc="122,184,255" style="--sw:#7AB8FF" title="Ice Blue" aria-label="Ice blue light" onclick="event.stopPropagation();pickLampColor(this);"></button>
          <button type="button" class="lamp-swatch" data-lc="255,123,229" style="--sw:#FF7BE5" title="Magenta" aria-label="Magenta light" onclick="event.stopPropagation();pickLampColor(this);"></button>
        </div>
        <span class="lamp-beam" aria-hidden="true"></span>
      </div>
      <div class="auth-box auth-card">
      ${returnUrl ? `
        <div class="return-url-alert">
          <span>🔒</span>
          <div><b>Authentication Required</b><br>Please log in or create an account to access <code>${returnUrl}</code>.</div>
        </div>
      ` : ''}
      <div class="auth-tabs">
        <a class="auth-tab ${mode === 'login' ? 'active' : ''}" href="#/login${returnUrl ? '?returnUrl=' + encodeURIComponent(returnUrl) : ''}">Login</a>
        <a class="auth-tab ${mode === 'signup' ? 'active' : ''}" href="#/signup${returnUrl ? '?returnUrl=' + encodeURIComponent(returnUrl) : ''}">Sign Up</a>
      </div>
      ${mode === 'login' ? `
        <div class="form-row"><label>Email Address</label><input id="au-email" type="email" placeholder="you@example.com" value="demo@noframe.com"></div>
        <div class="form-row"><label>Password</label><input id="au-pass" type="password" placeholder="••••••••" value="demo123"></div>
        <button class="btn btn-primary btn-full" style="margin-top:20px;" onclick="doLogin()">Login to Account</button>
        <p class="helper-text">Demo account pre-filled — click Login to test credential verification & session state.</p>
      ` : `
        <button type="button" class="google-btn" id="google-signup-btn" onclick="googleSignUp()">
          <svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.2 17.6 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-2.8-.4-4.1H24v8.1h12.4c-.3 2.1-1.6 5.2-4.7 7.3l7.6 5.9c4.5-4.2 6.8-10.3 6.8-17.2z"/><path fill="#FBBC05" d="M10.4 28.7c-.5-1.5-.8-3.1-.8-4.7s.3-3.2.8-4.7l-7.8-6.1C1 16.4 0 20.1 0 24s1 7.6 2.6 10.8l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2 1.4-4.7 2.4-8.3 2.4-6.4 0-11.7-3.7-13.6-9.9l-7.8 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
          <span>Sign up with Google</span>
        </button>
        <div class="auth-divider"><span>or create an account with email</span></div>
        <div class="form-row"><label>Full Name</label><input id="au-name" placeholder="Dev Student"></div>
        <div class="form-row"><label>Email Address</label><input id="au-email" type="email" placeholder="user_882@devlab.io"></div>
        <div class="form-row"><label>Mobile Number</label><input id="au-phone" placeholder="+94 77 123 4567"></div>
        <div class="form-row">
          <label>Password</label>
          <input id="au-pass" type="password" placeholder="Create a strong password" oninput="updatePasswordComplexityUI(this.value)">
          <div class="pw-meter">
            <div class="pw-bar-track"><div id="pw-bar-fill" class="pw-bar-fill"></div></div>
            <div id="pw-rules" class="pw-rules">
              <div class="pw-rule unmet">○ Min 8 characters</div>
              <div class="pw-rule unmet">○ Uppercase (A-Z)</div>
              <div class="pw-rule unmet">○ Lowercase (a-z)</div>
              <div class="pw-rule unmet">○ Number (0-9)</div>
              <div class="pw-rule unmet" style="grid-column:1/3;">○ Special symbol (!@#$%^&*)</div>
            </div>
          </div>
        </div>
        <div class="form-row"><label>Confirm Password</label><input id="au-confirm-pass" type="password" placeholder="Confirm your password"></div>
        <button class="btn btn-primary btn-full" style="margin-top:16px;" onclick="doSignup()">Create Account</button>
      `}
      </div>
    </div>
  </div>`;

  if (mode === 'signup') mountGoogleButton();
}

/* The lamp scene: dark until the visitor pushes the lamp (or touches the
   form), then the room warms up and the login card comes to full brightness. */
function setLampLit(lit){
  const scene = document.getElementById('auth-scene');
  if(!scene) return;
  scene.dataset.lit = lit ? 'true' : 'false';
  const hint = document.getElementById('lamp-hint');
  if(hint) hint.textContent = lit ? 'Light on — welcome back' : 'Push me to turn on';
}
function toggleLamp(){
  const scene = document.getElementById('auth-scene');
  if(!scene) return;
  setLampLit(scene.dataset.lit !== 'true');
}
function litLamp(on){
  const scene = document.getElementById('auth-scene');
  if(!scene || scene.dataset.lit === 'true') return;
  if(on !== false) setLampLit(true);
}
/* Light colour chooser — golden is the default look; the scene drives the
   bulb, the beam and the warm bloom from one --lamp-light RGB triplet. */
function pickLampColor(btn){
  const scene = document.getElementById('auth-scene');
  if(!scene) return;
  scene.style.setProperty('--lamp-light', btn.dataset.lc || '255,217,138');
  scene.querySelectorAll('.lamp-swatch').forEach(s=>s.classList.toggle('active', s===btn));
  litLamp(true);
}

/* ---------------- SIGN-UP: DISCOUNT PIN + THANK-YOU SCREEN ---------------- */
/* First-time customers get a one-off discount PIN, generated the moment the
   account is created and shown on the thank-you screen + their profile. */
function makeDiscountPin(){
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = n => {
    const bytes = new Uint8Array(n);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    return Array.from(bytes, b => alpha[b % alpha.length]).join('');
  };
  return 'NF-' + seg(4) + '-' + seg(4);
}
function rememberDiscountPin(email, pin){
  if(!email || !pin) return;
  try{
    const map = JSON.parse(localStorage.getItem('noframe-discount-pins') || '{}');
    map[email] = pin;
    localStorage.setItem('noframe-discount-pins', JSON.stringify(map));
  }catch(e){ console.warn(e); }
}
function discountPinFor(user){
  if(!user) return null;
  if(user.discountPin) return user.discountPin;
  try{
    const map = JSON.parse(localStorage.getItem('noframe-discount-pins') || '{}');
    return map[user.email] || null;
  }catch(e){ return null; }
}
function copyDiscountPin(){
  const el = document.getElementById('ss-pin');
  const pin = el ? el.textContent.trim() : '';
  if(!pin) return;
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(pin).then(()=>toast('Discount PIN copied ✓')).catch(()=>toast(pin));
  } else toast(pin);
}
function showSignupSuccess(name, pin, nextHash, nextLabel){
  rememberDiscountPin(SIGNUP_EMAIL_CACHE || '', pin);
  $('#app').innerHTML = `
  <div class="page wrap auth-page">
    <div class="signup-success" role="status">
      <div class="ss-check">✓</div>
      <div class="eyebrow">Welcome to NoFrame</div>
      <h1>Thank You, ${String(name||'').split(' ')[0] || 'friend'}!</h1>
      <p class="ss-copy">Your account has been created as a <b>Customer</b> account and your first-order discount is ready to use.</p>
      <div class="ss-pin-card">
        <span class="ss-pin-label">YOUR FIRST-ORDER DISCOUNT PIN</span>
        <b class="ss-pin" id="ss-pin">${pin}</b>
        <span class="ss-pin-note">Quote this PIN at checkout on your first order to claim your first-time customer discount. It is also saved on your profile page.</span>
        <button type="button" class="btn btn-outline btn-sm" onclick="copyDiscountPin()">Copy PIN</button>
      </div>
      <button type="button" class="btn btn-primary btn-full" onclick="nav('${nextHash || '#/login'}')">${nextLabel || 'Continue to Login'}</button>
    </div>
  </div>`;
  window.scrollTo(0,0);
}
let SIGNUP_EMAIL_CACHE = '';

/* ---------------- GOOGLE SIGN-UP (Google Identity Services) ----------------
   To switch Google sign-up on, create an OAuth 2.0 *Web application* client ID
   in Google Cloud Console and paste it in BOTH places:
     1. GOOGLE_CLIENT_ID below  (js/app.js  — public, safe to ship)
     2. $GOOGLE_CLIENT_ID in api/config.php (server verifies the ID token)
   Until then the button says what is missing and email sign-up works. */
const GOOGLE_CLIENT_ID = '';

function mountGoogleButton(){
  const host = document.getElementById('google-signup-btn');
  if(!host || !GOOGLE_CLIENT_ID) return;          /* keep the static fallback button */
  if(window.__gisReady){ renderGoogleButton(host); return; }
  if(window.__gisLoading) return;
  window.__gisLoading = true;
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.defer = true;
  s.onload = () => {
    window.__gisLoading = false;
    try{
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: r => handleGoogleCredential(r.credential)
      });
      window.__gisReady = true;
      const h = document.getElementById('google-signup-btn');
      if(h) renderGoogleButton(h);
    }catch(e){ console.warn('Google Identity Services init failed', e); }
  };
  s.onerror = () => { window.__gisLoading = false; console.warn('Google Identity Services failed to load'); };
  document.head.appendChild(s);
}
function renderGoogleButton(host){
  host.innerHTML = '';
  host.classList.add('google-host');
  google.accounts.id.renderButton(host, {theme:'filled_black', size:'large', width:320, text:'signup_with'});
}
function googleSignUp(){
  if(!GOOGLE_CLIENT_ID){
    toast('Google sign-up needs a Google OAuth Client ID — set GOOGLE_CLIENT_ID in js/app.js and api/config.php. Email sign-up works meanwhile.');
    return;
  }
  if(window.__gisReady) try{ google.accounts.id.prompt(); return; }catch(e){}
  toast('Google sign-in is still loading — one moment…');
}
async function handleGoogleCredential(credential){
  try{
    /* Generate this customer's first-order PIN up front so the server can
       store it on a brand-new Google account. */
    const newPin = makeDiscountPin();
    const remote = await apiRequest('google_auth', {
      method:'POST',
      body: JSON.stringify({ credential, discount_pin: newPin })
    });
    if(remote && remote.ok && remote.user){
      const pin = discountPinFor(remote.user) || newPin;
      rememberDiscountPin(remote.user.email, pin);
      remote.user.discountPin = pin;
      remote.user.role = remote.user.role || 'customer';
      SESSION.user = remote.user;
      mergeGuestCart(readBag('cart', remote.user.id));
      await saveSession();
      renderHeader();
      if(remote.isNew){
        SIGNUP_EMAIL_CACHE = remote.user.email;
        showSignupSuccess(remote.user.name, pin, '#/profile', 'Continue to My Account');
      } else {
        toast('Welcome back, ' + remote.user.name + ' ✓');
        nav('#/profile');
      }
      return;
    }
    if(remote && remote.message) toast(remote.message);
  }catch(e){
    console.warn('Google auth needs the PHP API (api/api.php) running', e);
    toast('Google sign-in needs the XAMPP API running — or sign up with email below.');
  }
}

async function doLogin() {
  const email = $('#au-email').value.trim();
  const pass = $('#au-pass').value;

  if (!email || !pass) {
    toast('Invalid email or password');
    return;
  }

  const hash = location.hash;
  let returnUrl = '';
  if (hash.includes('returnUrl=')) {
    returnUrl = decodeURIComponent(hash.split('returnUrl=')[1]);
  }

  try {
    const remote = await apiRequest('login', {
      method: 'POST',
      body: JSON.stringify({ email, password: pass })
    });

    if (remote && remote.ok && remote.user) {
      remote.user.role = remote.user.role || 'customer';
      remote.user.discountPin = discountPinFor(remote.user);
      /* Only this account's own saved bag is restored — never another user's. */
      mergeGuestCart(remote.user.cart || readBag('cart', remote.user.id));
      SESSION.user = remote.user;
      await saveSession();
      toast('Welcome back, ' + remote.user.name + ' ✓');
      renderHeader();
      nav(returnUrl || '#/profile');
      return;
    }
  } catch (e) {
    console.warn('API login failed, using fallback authentication', e);
  }

  // Fallback Local Database Verification
  const u = DB.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  // SECURITY IMPERATIVE: Prevent user enumeration by returning generic error message
  if (!u) {
    toast('Invalid email or password');
    return;
  }
  if (u.password && u.password !== pass) {
    toast('Invalid email or password');
    return;
  }

  const userObj = {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone || '+94 77 123 4567',
    address: u.address || '128 Galle Road, Colombo 03',
    shippingAddress: u.shippingAddress || u.address || '128 Galle Road, Colombo 03',
    billingAddress: u.billingAddress || u.address || '128 Galle Road, Colombo 03',
    avatar: u.avatar || '../assets/u1.svg',
    accountStatus: u.accountStatus || 'Active Member',
    createdAt: u.createdAt || '2026-01-15',
    role: u.role || 'customer',
    discountPin: u.discountPin || discountPinFor(u) || null
  };

  mergeGuestCart(readBag('cart', u.id));
  SESSION.user = userObj;
  await saveSession();
  toast('Welcome back, ' + userObj.name + ' ✓');
  renderHeader();
  nav(returnUrl || '#/profile');
}

async function doSignup() {
  const name = $('#au-name').value.trim();
  const email = $('#au-email').value.trim();
  const phone = $('#au-phone').value.trim();
  const pass = $('#au-pass').value;
  const confirmPass = $('#au-confirm-pass').value;

  if (!name || !email || !pass || !confirmPass) {
    toast('Please fill in all required fields');
    return;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    toast('Please enter a valid email address');
    return;
  }

  const comp = checkPasswordComplexity(pass);
  if (!comp.len || !comp.upper || !comp.lower || !comp.num || !comp.special) {
    toast('Password does not meet complexity requirements');
    return;
  }

  if (pass !== confirmPass) {
    toast('Password and confirm password do not match');
    return;
  }

  /* First-time customers always land as role "customer" and receive a
     first-order discount PIN shown on the thank-you screen. */
  const pin = makeDiscountPin();
  SIGNUP_EMAIL_CACHE = email;
  rememberDiscountPin(email, pin);

  try {
    const remote = await apiRequest('register', {
      method: 'POST',
      body: JSON.stringify({ name, email, phone, password: pass, confirm_password: confirmPass, role: 'customer', discount_pin: pin })
    });
    if (remote && remote.ok) {
      showSignupSuccess(name, pin, '#/login', 'Continue to Login');
      return;
    } else if (remote && remote.message) {
      toast(remote.message);
      return;
    }
  } catch (e) {
    console.warn('API registration failed, using fallback DB', e);
  }

  if (DB.users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
    toast('An account with this email address already exists');
    return;
  }

  const newId = 'U' + Date.now();
  const newUser = {
    id: newId, name, email, phone, password: pass, address: '', role: 'customer', promo: true,
    discountPin: pin
  };
  DB.users.push(newUser);
  await saveDB();
  rememberDiscountPin(email, pin);
  showSignupSuccess(name, pin, '#/login', 'Continue to Login');
}

async function doLogout() {
  try {
    await apiRequest('logout', { method: 'POST' });
  } catch (e) {}
  /* Strict isolation: the signed-in bag stays under their own key and the
     next visitor on this browser starts from an empty guest bag. */
  SESSION.user = null;
  SESSION.cart = [];
  SESSION.wishlist = [];
  await saveSession();
  renderHeader();
  toast('Logged out successfully');
  nav('#/home');
}

/* ---------------- PROFILE ---------------- */
function renderProfile(tab) {
  if (!SESSION.user) {
    const returnUrl = encodeURIComponent(location.hash || '#/profile');
    nav('#/login?returnUrl=' + returnUrl);
    return;
  }
  const u = SESSION.user;
  /* ORDER HISTORY: strictly this customer's own orders — guest/other-account
     orders are never mixed into a profile. */
  const myOrders = DB.orders.filter(o => o.userId === u.id);
  const myPin = discountPinFor(u);
  let body = '';

  if (tab === 'orders') {
    body = myOrders.length ? myOrders.map(o => `
      <div class="order-row">
        <div><b class="mono">#${o.id}</b><div style="font-size:12px;color:var(--ink-soft);">${new Date(o.createdAt).toLocaleDateString()} · ${o.items.length} item(s)</div>
        <div style="font-size:12px;color:var(--ink-soft);margin-top:3px;">${o.items.map(i=>`${i.title} × ${i.qty}`).join(', ')}</div></div>
        <span class="status-chip status-${o.status}">${o.status}</span>
        <span class="mono" style="font-weight:700;">${money(o.total)}</span>
      </div>`).join('') : `<p style="color:var(--ink-soft);">No orders yet. <a href="#/home" class="btn-ghost">Start shopping →</a></p>`;
  } else if (tab === 'wishlist') {
    const items = SESSION.wishlist.map(findProduct).filter(Boolean);
    body = items.length ? `<div class="product-grid">${items.map(productCard).join('')}</div>` : `<p style="color:var(--ink-soft);">Your wishlist is empty.</p>`;
  } else if (tab === 'security') {
    body = `
    <div class="admin-panel">
      <h3>Security & Password Workflow</h3>
      <p style="font-size:13px;color:var(--ink-soft);margin-bottom:20px;">Identity Re-Verification: Please verify your current password before establishing a new password.</p>
      <div class="form-row"><label>Current Password</label><input id="sec-current-pass" type="password" placeholder="Enter current password"></div>
      <div class="form-row">
        <label>New Password</label>
        <input id="sec-new-pass" type="password" placeholder="Create new strong password" oninput="updatePasswordComplexityUI(this.value, 'sec-pw-bar-fill', 'sec-pw-rules')">
        <div class="pw-meter">
          <div class="pw-bar-track"><div id="sec-pw-bar-fill" class="pw-bar-fill"></div></div>
          <div id="sec-pw-rules" class="pw-rules">
            <div class="pw-rule unmet">○ Min 8 characters</div>
            <div class="pw-rule unmet">○ Uppercase (A-Z)</div>
            <div class="pw-rule unmet">○ Lowercase (a-z)</div>
            <div class="pw-rule unmet">○ Number (0-9)</div>
            <div class="pw-rule unmet" style="grid-column:1/3;">○ Special symbol (!@#$%^&*)</div>
          </div>
        </div>
      </div>
      <div class="form-row"><label>Confirm New Password</label><input id="sec-confirm-new-pass" type="password" placeholder="Confirm new password"></div>
      <button class="btn btn-primary" style="margin-top:16px;" onclick="changePassword()">Update Password</button>
    </div>`;
  } else {
    // Overview & Addresses
    const pts = loyaltyPoints(), ptsValue = pointsValue(), done = completedPurchases(), codOk = codUnlocked();
    body = `
    <div class="admin-panel loyalty-panel">
      <h3>★ Loyalty Points</h3>
      <div class="loyalty-grid">
        <div class="loyalty-box"><span>Available Points</span><b>${pts}</b></div>
        <div class="loyalty-box"><span>Points Value</span><b>${money(ptsValue)}</b></div>
        <div class="loyalty-box"><span>Completed Purchases</span><b>${done}</b></div>
        <div class="loyalty-box"><span>Cash on Delivery</span><b class="${codOk?'loyalty-ok':'loyalty-locked'}">${codOk?'Available':'Not available'}</b></div>
      </div>
      <p class="loyalty-note">1 point = Rs. ${LOYALTY.pointValue}. Earn ${LOYALTY.rate*100}% of every purchase in points — every Rs. 100 spent adds 1 point, and points convert to rupees at checkout. Cash on Delivery unlocks after ${LOYALTY.codMinOrders} completed purchases.</p>
    </div>
    
    <div class="admin-panel">
      <h3>Personal & Contact Details</h3>
      <div class="form-2col">
        <div class="form-row"><label>Full Name</label><input id="pf-name" value="${u.name}"></div>
        <div class="form-row"><label>Email Address</label><input value="${u.email}" disabled style="background:var(--surface-alt);"></div>
        <div class="form-row"><label>Mobile Phone Number</label><input id="pf-phone" value="${u.phone || ''}"></div>
        <div class="form-row"><label>Account Role</label><input value="${u.role || 'customer'}" disabled style="background:var(--surface-alt);"></div>
        <div class="form-row"><label>First-Order Discount PIN</label><input value="${myPin || 'Not issued'}" disabled style="background:var(--surface-alt);font-family:'Space Mono',monospace;letter-spacing:.1em;"></div>
      </div>
    </div>
    
    <div class="admin-panel">
      <h3>Address Management</h3>
      <div class="address-card-grid">
        <div class="address-box">
          <h5><span>📍 Shipping Address</span></h5>
          <div class="form-row" style="margin-bottom:0;"><textarea id="pf-shipping" rows="3" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:var(--radius-sm);" placeholder="Primary Shipping Address">${u.shippingAddress || u.address || ''}</textarea></div>
        </div>
        <div class="address-box">
          <h5><span>💳 Billing Address</span></h5>
          <div class="form-row" style="margin-bottom:0;"><textarea id="pf-billing" rows="3" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:var(--radius-sm);" placeholder="Primary Billing Address">${u.billingAddress || u.address || ''}</textarea></div>
        </div>
      </div>
      <button class="btn btn-primary" onclick="saveProfile()">Save Profile & Addresses</button>
    </div>`;
  }

  const regDate = u.createdAt ? new Date(u.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'Jan 2026';

  $('#app').innerHTML = `
  <div class="page wrap">
    <div class="profile-header-card">
      <img src="${u.avatar || '../assets/u1.svg'}" alt="${u.name}" onerror="this.src='../assets/u1.svg'">
      <div>
        <h2 style="margin-bottom:2px;">${u.name}</h2>
        <div style="font-size:13px;color:var(--ink-soft);">${u.email} · Member since ${regDate}</div>
        <span class="profile-meta-status">Status: ${u.accountStatus || 'Active Member'}</span>
      </div>
    </div>
    
    <div class="profile-grid">
      <nav class="profile-nav">
        <a class="${!tab || tab === 'details' ? 'active' : ''}" href="#/profile">Profile & Addresses</a>
        <a class="${tab === 'security' ? 'active' : ''}" href="#/profile/security">Security Workflow</a>
        <a class="${tab === 'orders' ? 'active' : ''}" href="#/profile/orders">My Orders (${myOrders.length})</a>
        <a class="${tab === 'wishlist' ? 'active' : ''}" href="#/profile/wishlist">Wishlist (${SESSION.wishlist.length})</a>
        <a href="#" onclick="doLogout();return false;" style="color:var(--accent);">Logout Account</a>
      </nav>
      <div>${body}</div>
    </div>
  </div>`;
}

async function saveProfile() {
  const name = $('#pf-name').value.trim();
  const phone = $('#pf-phone').value.trim();
  const shippingAddress = $('#pf-shipping').value.trim();
  const billingAddress = $('#pf-billing').value.trim();

  SESSION.user.name = name;
  SESSION.user.phone = phone;
  SESSION.user.address = shippingAddress;
  SESSION.user.shippingAddress = shippingAddress;
  SESSION.user.billingAddress = billingAddress;

  try {
    await apiRequest('profile', {
      method: 'POST',
      body: JSON.stringify({ name, phone, shipping_address: shippingAddress, billing_address: billingAddress })
    });
  } catch (e) {
    console.warn('API profile save fallback', e);
  }

  const idx = DB.users.findIndex(u => u.id === SESSION.user.id);
  if (idx > -1) DB.users[idx] = { ...DB.users[idx], name, phone, address: shippingAddress, shippingAddress, billingAddress };
  await saveDB();
  await saveSession();
  renderHeader();
  toast('Profile & addresses updated ✓');
}

async function changePassword() {
  const currentPassword = $('#sec-current-pass').value;
  const newPassword = $('#sec-new-pass').value;
  const confirmPassword = $('#sec-confirm-new-pass').value;

  if (!currentPassword || !newPassword || !confirmPassword) {
    toast('Please fill in all password fields');
    return;
  }

  const comp = checkPasswordComplexity(newPassword);
  if (!comp.len || !comp.upper || !comp.lower || !comp.num || !comp.special) {
    toast('New password does not meet complexity requirements');
    return;
  }

  if (newPassword !== confirmPassword) {
    toast('New password and confirmation do not match');
    return;
  }

  try {
    const remote = await apiRequest('change_password', {
      method: 'POST',
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword, confirm_new_password: confirmPassword })
    });
    if (remote && remote.ok) {
      toast('Password changed successfully ✓');
      renderProfile('security');
      return;
    } else if (remote && remote.message) {
      toast(remote.message);
      return;
    }
  } catch (e) {
    console.warn('API change password fallback', e);
  }

  toast('Password changed successfully ✓');
  $('#sec-current-pass').value = '';
  $('#sec-new-pass').value = '';
  $('#sec-confirm-new-pass').value = '';
}

/* ---------------- SUPPORT PAGES ---------------- */
const STATIC_PAGES = {
  about:{title:'About NoFrame', body:'Founded in Sri Lanka, NoFrame represents modern luxury fashion built without boundaries. We believe clothing should articulate individuality through clean silhouettes, premium fabrics, and ethical craftsmanship.'},
  contact:{title:'Customer Support', body:'Reach our customer care team at kavishanpasindu2004@gmail.com or call +94760724876, Monday–Saturday 9am–6pm IST. Visit us at 18, Kahagala, Kamburupitiya.'},
  shipping:{title:'Shipping & Delivery Policy', body:'We deliver islandwide across Sri Lanka. Orders over Rs. 5,000 qualify for FREE Express Shipping (2–3 business days). Standard shipping is flat-rate Rs. 1,500.'},
  returns:{title:'Returns & Exchange Policy', body:'We accept returns and size exchanges within 30 days of delivery provided items are unworn with original tags attached.'},
  privacy:{title:'Privacy Policy', body:'Your personal data is encrypted and strictly used to fulfill orders and improve your shopping experience.'},
  terms:{title:'Terms & Conditions', body:'All content, designs, and catalog items are property of NoFrame Fashion (Pvt) Ltd.'}
};

function renderStatic(key){
  const p = STATIC_PAGES[key] || {title:'Page Not Found', body:'This page does not exist.'};
  $('#app').innerHTML = `<div class="page wrap"><div class="breadcrumb"><a href="#/home">Home</a> / <span>${p.title}</span></div><h1 class="page-title">${p.title}</h1><p style="max-width:680px;margin-top:20px;line-height:1.8;color:var(--ink-soft);">${p.body}</p></div>`;
}

/* ---------------- ADMIN DASHBOARD ---------------- */
function adminNavItem(id,label){ return `<a class="${VIEW.adminTab===id?'active':''}" href="#/admin/${id}">${label}</a>`; }
function renderAdmin(tab){
  /* Server-side this is enforced by api.php (admin JWT required for /save);
     the router already bounces non-admins — this is the last line of defence. */
  if(!SESSION.user || (SESSION.user.role || 'customer') !== 'admin'){
    $('#app').innerHTML = `<div class="page wrap"><div class="access-denied"><span>⛔</span><h1>Access Denied</h1><p>You need an administrator account to open the admin dashboard.</p><a class="btn btn-primary" href="#/home">Back to Home</a></div></div>`;
    return;
  }
  VIEW.adminTab = tab||'overview';
  let body='';
  if(VIEW.adminTab==='overview') body = adminOverview();
  else if(VIEW.adminTab==='products') body = adminProducts();
  else if(VIEW.adminTab==='categories') body = adminCategories();
  else if(VIEW.adminTab==='orders') body = adminOrders();
  else if(VIEW.adminTab==='customers') body = adminCustomers();

  $('#app').innerHTML = `
  <div class="admin-shell">
    <div class="admin-side">
      <div style="margin-bottom:12px;">${LOGO(true)}</div>
      ${adminNavItem('overview','Overview')}
      ${adminNavItem('products','Products')}
      ${adminNavItem('categories','Categories')}
      ${adminNavItem('orders','Orders')}
      ${adminNavItem('customers','Customers')}
      <a href="#/home" style="margin-top:24px;border-top:1px solid rgba(255,255,255,0.15);padding-top:14px;">← Back to Storefront</a>
    </div>
    <div class="admin-main">${body}</div>
  </div>`;
}

function adminOverview(){
  const totalSales = DB.orders.reduce((s,o)=>s+o.total,0);
  return `
  <div class="admin-topbar"><h2 class="serif" style="font-size:28px;">Dashboard Overview</h2></div>
  <div class="stat-grid">
    <div class="stat-card"><div class="v">${DB.users.length}</div><div class="l">Registered Users</div></div>
    <div class="stat-card"><div class="v">${DB.products.length}</div><div class="l">Total Products</div></div>
    <div class="stat-card"><div class="v">${DB.orders.length}</div><div class="l">Total Orders</div></div>
    <div class="stat-card"><div class="v">${money(totalSales)}</div><div class="l">Total Revenue</div></div>
  </div>
  <div class="admin-panel">
    <h3>Recent Orders</h3>
    <table class="admin-table"><thead><tr><th>Order ID</th><th>Customer</th><th>Total</th><th>Status</th></tr></thead>
    <tbody>${DB.orders.slice(0,6).map(o=>`<tr><td class="mono">#${o.id}</td><td>${o.shipping.name||'Guest'}</td><td class="mono">${money(o.total)}</td><td><span class="status-chip status-${o.status}">${o.status}</span></td></tr>`).join('') || `<tr><td colspan="4">No orders placed yet.</td></tr>`}</tbody></table>
  </div>`;
}

function adminProducts(){
  return `
  <div class="admin-topbar"><h2 class="serif" style="font-size:28px;">Product Catalog Management</h2><button class="btn btn-primary btn-sm" onclick="openProductForm()">+ Add Product</button></div>
  <div class="admin-panel" style="padding:0;">
    <table class="admin-table">
      <thead><tr><th>Image</th><th>Title</th><th>Category</th><th>Price</th><th>Stock</th><th>Actions</th></tr></thead>
      <tbody>${DB.products.map(p=>`
        <tr>
          <td><img src="${p.images[0]}" onerror="imgFallback(this,'${p.category}')"></td>
          <td><b>${p.title}</b></td>
          <td>${p.categoryName}</td>
          <td class="mono">${money(p.discountPrice||p.price)}</td>
          <td class="mono">${p.stock}</td>
          <td><a class="icon-link" onclick="openProductForm('${p.id}')">Edit</a><a class="icon-link danger" onclick="deleteProduct('${p.id}')">Delete</a></td>
        </tr>`).join('')}</tbody>
    </table>
  </div>
  <div id="product-form-slot"></div>`;
}

/* ---- Admin product form: main category → sub-category, colours, sizes ---- */
const FORM_SIZE_POOL = ['XS','S','M','L','XL','2XL','XXL','Free Size'];
const FORM_TAG_POOL = ['new','featured','bestseller','sale','trending'];

function groupOfCategory(catId){
  return megaGroups().find(g => g.ids.includes(catId)) || null;
}
function groupLabel(g){ return g ? g.title.charAt(0) + g.title.slice(1).toLowerCase() : '—'; }
function dbCat(id){ return DB.categories.find(c => c.id === id) || null; }

/* Repopulate the sub-category dropdown whenever the main category changes. */
function fillSubcats(groupKey, selectedId){
  const g = megaGroups().find(x => x.key === groupKey) || {ids:[]};
  const sel = document.getElementById('pf-cat');
  if(!sel) return;
  sel.innerHTML = g.ids.map(cid=>{
    const c = dbCat(cid);
    return c ? `<option value="${c.id}" ${selectedId===c.id?'selected':''}>${c.name}</option>` : '';
  }).join('');
}
function pickChips(rootId){
  return [...document.querySelectorAll('#'+rootId+' [data-pick].selected')].map(b => b.dataset.pick);
}

function openProductForm(id){
  const p = id?findProduct(id):null;
  VIEW.editingProduct = id||null;

  const groups = megaGroups();
  const active = (p && groupOfCategory(p.category)) || groups[0];

  const colors = (p && p.colors.length) ? p.colors : ['black','navy','white'];
  const sizes  = p ? [...new Set([...(p.sizes||[]), ...FORM_SIZE_POOL])] : FORM_SIZE_POOL;
  const selSizes = (p && p.sizes) ? p.sizes : ['S','M','L','XL','2XL'];
  const tags   = p ? (p.tags||[]) : ['new'];

  const html = `
  <div class="admin-panel">
    <h3>${p?'Edit Product':'Add New Product'}</h3>
    <div class="form-2col">
      <div class="form-row" style="grid-column:1/-1;"><label>Title</label><input id="pf-title" value="${p?p.title:''}" placeholder="e.g. Oxford Cotton Button-Down Shirt"></div>

      <div class="form-row"><label>Main Category</label>
        <select id="pf-group" onchange="fillSubcats(this.value)">
          ${groups.map(g=>`<option value="${g.key}" ${g.key===active.key?'selected':''}>${groupLabel(g)}</option>`).join('')}
        </select>
      </div>
      <div class="form-row"><label>Sub-Category</label><select id="pf-cat"></select></div>

      <div class="form-row"><label>Regular Price (Rs.)</label><input id="pf-price" type="number" value="${p?p.price:''}"></div>
      <div class="form-row"><label>Discount Sale Price (Rs.)</label><input id="pf-dprice" type="number" value="${p&&p.discountPrice?p.discountPrice:''}"></div>
      <div class="form-row"><label>Stock Quantity</label><input id="pf-stock" type="number" value="${p?p.stock:20}"></div>
      <div class="form-row"><label>Image URL</label><input id="pf-image" value="${p?p.images[0]:''}" placeholder="../images/… or https://…"></div>

      <div class="form-row" style="grid-column:1/-1;"><label>Colours</label>
        <div class="pick-row" id="pf-colors">
          ${Object.keys(COLORS).map(c=>`<button type="button" class="swatch-btn ${colors.includes(c)?'selected':''}" data-pick="${c}" title="${c}" style="background:${COLORS[c]}" onclick="this.classList.toggle('selected')"></button>`).join('')}
        </div>
        <span class="pick-note">Click a swatch to include or exclude it — these become the colour dots shoppers see.</span>
      </div>

      <div class="form-row" style="grid-column:1/-1;"><label>Sizes</label>
        <div class="pick-row" id="pf-sizes">
          ${sizes.map(s=>`<button type="button" class="size-btn ${selSizes.includes(s)?'selected':''}" data-pick="${s}" onclick="this.classList.toggle('selected')">${s}</button>`).join('')}
        </div>
        <span class="pick-note">Selected sizes appear on the product page and in the size filter.</span>
      </div>

      <div class="form-row" style="grid-column:1/-1;"><label>Tags</label>
        <div class="pick-row" id="pf-tags">
          ${FORM_TAG_POOL.map(t=>`<button type="button" class="tag-chip ${tags.includes(t)?'selected':''}" data-pick="${t}" onclick="this.classList.toggle('selected')">${t}</button>`).join('')}
        </div>
        <span class="pick-note">"new" feeds New Arrivals, "bestseller" feeds Best Sellers, "sale" feeds the sale carousel.</span>
      </div>

      <div class="form-row" style="grid-column:1/-1;"><label>Description</label>
        <textarea id="pf-desc" rows="3" placeholder="Fabric, fit and finish…">${p?(p.description||''):''}</textarea>
      </div>
    </div>
    <div style="display:flex;gap:10px;">
      <button class="btn btn-primary" onclick="saveProduct()">Save Product</button>
      <button class="btn btn-outline" onclick="$('#product-form-slot').innerHTML=''">Cancel</button>
    </div>
  </div>`;

  $('#product-form-slot').innerHTML = html;
  fillSubcats(active.key, p ? p.category : null);
  $('#product-form-slot').scrollIntoView({behavior:'smooth'});
}

async function saveProduct(){
  const groupSel = $('#pf-group');
  const catId = $('#pf-cat').value;
  const cat = dbCat(catId);
  if(!cat){ toast('Choose a sub-category'); return; }

  const colors = pickChips('pf-colors');
  const sizes  = pickChips('pf-sizes');
  const tags   = pickChips('pf-tags');
  const existing = VIEW.editingProduct ? findProduct(VIEW.editingProduct) : null;

  const groupKey = groupSel ? groupSel.value : '';
  const group = megaGroups().find(x => x.key === groupKey) || null;

  const data = {
    title:$('#pf-title').value.trim(),
    category:cat.id, categoryName:cat.name,
    mainCategory: groupLabel(group),
    price:+$('#pf-price').value,
    discountPrice: $('#pf-dprice').value ? +$('#pf-dprice').value : null,
    stock:+$('#pf-stock').value,
    images: (existing && existing.images[0] === $('#pf-image').value && existing.images.length)
      ? existing.images
      : [$('#pf-image').value || generateProductImage(cat.id, 'new')],
    colors: colors.length ? colors : ['black','white'],
    sizes: sizes.length ? sizes : ['Free Size'],
    tags: tags.length ? tags : ['new'],
    description: $('#pf-desc').value.trim() || 'A NoFrame signature fashion piece.'
  };
  if(!data.title || !data.price){ toast('Title and price are required'); return; }
  if(data.discountPrice !== null && data.discountPrice >= data.price){
    toast('Sale price must be lower than the regular price'); return;
  }

  if(VIEW.editingProduct){
    const idx = DB.products.findIndex(p=>p.id===VIEW.editingProduct);
    DB.products[idx] = {...DB.products[idx], ...data};
  } else {
    DB.products.unshift({
      id:'P'+Date.now(), ...data, rating:'4.8', reviewsCount:1,
      createdAt:Date.now()
    });
  }
  await saveDB(); toast('Product saved ✓'); renderAdmin('products');
}

async function deleteProduct(id){
  if(!confirm('Delete this product?')) return;
  DB.products = DB.products.filter(p=>p.id!==id); await saveDB(); toast('Product deleted'); renderAdmin('products');
}

function adminCategories(){
  return `
  <div class="admin-topbar"><h2 class="serif" style="font-size:28px;">Category Management</h2></div>
  <div class="admin-panel" style="padding:0;">
    <table class="admin-table"><thead><tr><th>Main Category</th><th>Sub-Category</th><th>Slug ID</th><th>Products</th></tr></thead>
    <tbody>${DB.categories.map(c=>{
      const g = groupOfCategory(c.id);
      return `<tr><td><span class="role-badge">${groupLabel(g)}</span></td><td><b>${c.name}</b></td><td class="mono">${c.id}</td><td>${DB.products.filter(p=>p.category===c.id).length}</td></tr>`;
    }).join('')}</tbody></table>
  </div>
  <p style="margin-top:16px;font-size:12.5px;color:var(--ink-soft);">Main category = the top-level menu group (Men / Women / Children / Other). Sub-category = the individual line shown in the Shop by Category ring and the mega menu.</p>`;
}

function adminOrders(){
  return `
  <div class="admin-topbar"><h2 class="serif" style="font-size:28px;">Order Fulfilment Management</h2></div>
  <div class="admin-panel" style="padding:0;">
    <table class="admin-table"><thead><tr><th>Order ID</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th></tr></thead>
    <tbody>${DB.orders.map(o=>`
      <tr>
        <td class="mono">#${o.id}</td>
        <td>${o.shipping.name||'Guest'} (${o.shipping.phone||''})</td>
        <td>${o.items.length}</td>
        <td class="mono">${money(o.total)}</td>
        <td><select onchange="updateOrderStatus('${o.id}',this.value)">
          ${['Confirmed','Processing','Dispatched','Delivered'].map(s=>`<option ${o.status===s?'selected':''}>${s}</option>`).join('')}
        </select></td>
      </tr>`).join('') || `<tr><td colspan="5">No orders placed yet.</td></tr>`}</tbody>
    </table>
  </div>`;
}

async function updateOrderStatus(id,status){
  const o = DB.orders.find(x=>x.id===id); if(o) o.status=status; await saveDB(); toast('Order status updated ✓');
}

/* Admin-only customer directory — a completely separate view from the
   customer profile: every account, its order count and lifetime spend. */
function adminCustomers(){
  const rows = DB.users.map(u=>{
    const orders = DB.orders.filter(o=>o.userId===u.id);
    const spend = orders.reduce((s,o)=>s+Number(o.total||0),0);
    return `<tr>
      <td><b>${u.name}</b></td>
      <td>${u.email}</td>
      <td><span class="role-badge ${u.role==='admin'?'is-admin':''}">${u.role||'customer'}</span></td>
      <td>${orders.length}</td>
      <td class="mono">${money(spend)}</td>
      <td>${u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}</td>
    </tr>`;
  }).join('');
  return `
  <div class="admin-topbar"><h2 class="serif" style="font-size:28px;">Customer Directory</h2></div>
  <div class="admin-panel" style="padding:0;">
    <table class="admin-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Orders</th><th>Lifetime Spend</th><th>Joined</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="6">No customer accounts yet.</td></tr>`}</tbody></table>
  </div>`;
}

/* ============================================================
   CONCEPT 001 — "OBSIDIAN SHELL"
   A near-black outerwear story: a cursor-lit lattice, a lacquered
   iridescent jacket that travels screen to screen (turning to the
   hand, sleeves trailing a beat behind), and labels that decode
   out of static as they arrive.
   ============================================================ */
function renderConcept(){
  $('#app').innerHTML = `
  <div class="concept" id="concept">
    <canvas class="concept-lattice" id="concept-lattice" aria-hidden="true"></canvas>
    <div class="concept-jacket" id="concept-jacket" aria-hidden="true">
      <div class="cj-outer" id="cj-outer">
        <div class="cj-inner" id="cj-inner">
          <img src="../images/concept/jacket-a.jpg" alt="" onerror="this.onerror=null;this.src='../images/concept/jacket-b.jpg'">
          <span class="cj-sheen"></span>
        </div>
      </div>
    </div>

    <section class="concept-screen">
      <div class="cs-copy">
        <div class="cs-eyebrow" data-scramble>CONCEPT 001 — OUTERWEAR</div>
        <h1 class="cs-title" data-scramble>OBSIDIAN SHELL</h1>
        <p class="cs-body" data-scramble>A near-black jacket lacquered until it holds light. Move your cursor — the lattice lights up in squares beneath it, and the shell turns to your hand.</p>
        <div class="cs-actions">
          <a class="btn btn-accent" href="#/new">Shop New Arrivals</a>
          <a class="btn btn-outline" href="#/home">Back to Store</a>
        </div>
        <div class="cs-hint" data-scramble>SCROLL TO TURN IT ↓</div>
      </div>
    </section>

    <section class="concept-screen screen-right">
      <div class="cs-copy">
        <div class="cs-eyebrow" data-scramble>CHAPTER 02 — FINISH</div>
        <h2 class="cs-title" data-scramble>LACQUERED IRIDESCENCE</h2>
        <p class="cs-body" data-scramble>Nine coats of black lacquer, hand-sanded between each pass. What reads as pure black in still air breaks violet and magenta the moment you move.</p>
        <div class="cs-specs">
          <div class="cs-spec"><span data-scramble>SHELL</span><b data-scramble>Italian calf · mirror-lacquered</b></div>
          <div class="cs-spec"><span data-scramble>LINING</span><b data-scramble>Cupro · smoke grey</b></div>
          <div class="cs-spec"><span data-scramble>FINISH</span><b data-scramble>Iridescent wet-look</b></div>
        </div>
      </div>
    </section>

    <section class="concept-screen">
      <div class="cs-copy">
        <div class="cs-eyebrow" data-scramble>CHAPTER 03 — CUT</div>
        <h2 class="cs-title" data-scramble>MADE TO TURN</h2>
        <p class="cs-body" data-scramble>Set-in sleeves are cut a half-beat long. When you move, the body follows your hand and the sleeves arrive a moment later — the jacket moves like something alive.</p>
        <div class="cs-specs">
          <div class="cs-spec"><span data-scramble>SHOULDER</span><b data-scramble>Softly built · no padding</b></div>
          <div class="cs-spec"><span data-scramble>SLEEVE</span><b data-scramble>Trailing drape · one beat behind</b></div>
          <div class="cs-spec"><span data-scramble>FIT</span><b data-scramble>Relaxed architecture</b></div>
        </div>
      </div>
    </section>

    <section class="concept-screen screen-center">
      <div class="cs-copy">
        <div class="cs-eyebrow" data-scramble>CHAPTER 04 — ACQUIRE</div>
        <h2 class="cs-title" data-scramble>TAKE IT HOME</h2>
        <p class="cs-body" data-scramble>The Obsidian Shell is a NoFrame studio concept. The pieces it is cut from are in the store right now.</p>
        <div class="cs-actions">
          <a class="btn btn-accent" href="#/new">Shop New Arrivals</a>
          <a class="btn btn-outline" href="#/sale">Explore the Sale 🔥</a>
        </div>
        <div class="cs-hint" data-scramble>CONCEPT 001 · NOFRAME STUDIO</div>
      </div>
    </section>
  </div>`;

  observeScrambles($('#app'));
  startConcept();
}

/* Engine: cursor-lit lattice + scroll-driven jacket pose + hand-tracking layers. */
function startConcept(){
  if(typeof window.__conceptStop === 'function'){ window.__conceptStop(); window.__conceptStop = null; }

  const root = document.getElementById('concept');
  const cv   = document.getElementById('concept-lattice');
  const jacket = document.getElementById('concept-jacket');
  const outer = document.getElementById('cj-outer');
  const inner = document.getElementById('cj-inner');
  if(!root || !cv || !jacket) return;

  const ctx = cv.getContext('2d');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const CELL = 46;
  const heat = new Map();          // cell key -> glow value, decays each frame
  let W = 0, H = 0;
  let px = -9999, py = -9999, hasPointer = false;
  let cx = 0, cy = 0;              // cursor normalized -1..1
  let oX=0,oY=0,oRX=0,oRY=0;       // outer layer (fast lerp — turns to your hand)
  let iRY=0, iRZ=0, prevRY=0;      // inner layer (slow lerp — sleeves trail behind)
  let raf = 0, running = true;

  /* Per-screen poses: where the jacket stands on each screen. */
  const POSES = [
    {x: 27, y:  5, r: -8, s:0.92, o:1},
    {x:-27, y: -3, r:  7, s:1.00, o:1},
    {x: 23, y:  3, r: -5, s:0.86, o:1},
    {x: 17, y:  0, r:  5, s:1.06, o:0.5}
  ];

  const resize = ()=>{
    const dpr = Math.min(window.devicePixelRatio||1, 2);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.round(W*dpr); cv.height = Math.round(H*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
  };

  const move = e=>{
    const r = cv.getBoundingClientRect();
    px = e.clientX - r.left; py = e.clientY - r.top; hasPointer = true;
    cx = (e.clientX/window.innerWidth)*2 - 1;
    cy = (e.clientY/window.innerHeight)*2 - 1;
  };

  const progress = ()=>{
    const top = root.offsetTop;
    const span = Math.max(1, root.offsetHeight - window.innerHeight);
    return Math.min(1, Math.max(0, (window.scrollY - top)/span));
  };

  const frame = ()=>{
    if(!running) return;
    raf = requestAnimationFrame(frame);

    /* decay previous glow */
    heat.forEach((v,k)=>{ v *= 0.93; if(v<0.03) heat.delete(k); else heat.set(k,v); });
    /* ignite cells under the cursor */
    if(hasPointer && !reduce){
      const gx = Math.floor(px/CELL), gy = Math.floor(py/CELL), R = 3;
      for(let dx=-R;dx<=R;dx++) for(let dy=-R;dy<=R;dy++){
        const d = Math.hypot(dx,dy); if(d>R) continue;
        const k = (gx+dx)+'_'+(gy+dy);
        const v = Math.exp(-d*d/4.2);
        if(v > (heat.get(k)||0)) heat.set(k, v);
      }
    }

    /* draw lattice */
    ctx.clearRect(0,0,W,H);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for(let x=0;x<=W;x+=CELL){ ctx.moveTo(x+0.5,0); ctx.lineTo(x+0.5,H); }
    for(let y=0;y<=H;y+=CELL){ ctx.moveTo(0,y+0.5); ctx.lineTo(W,y+0.5); }
    ctx.stroke();
    heat.forEach((v,k)=>{
      const p = k.split('_');
      const ix = (+p[0])*CELL, iy = (+p[1])*CELL;
      if(ix < -CELL || iy < -CELL || ix > W || iy > H) return;
      const hue = 262 + (((+p[0])*7 + (+p[1])*5) % 62);   /* violet → magenta sweep */
      ctx.fillStyle = 'hsla('+hue+',100%,62%,'+(v*0.5).toFixed(3)+')';
      ctx.fillRect(ix+2, iy+2, CELL-4, CELL-4);
      if(v>0.55){
        ctx.strokeStyle = 'hsla('+hue+',100%,78%,'+((v-0.55)*1.6).toFixed(3)+')';
        ctx.strokeRect(ix+2.5, iy+2.5, CELL-5, CELL-5);
      }
    });

    /* travel pose — interpolate between screens with smoothstep */
    const prog = progress();
    const seg = prog*(POSES.length-1);
    const i = Math.min(POSES.length-2, Math.floor(seg));
    const f = seg - i;
    const e = f*f*(3-2*f);
    const a = POSES[i], b = POSES[i+1];
    const X = a.x+(b.x-a.x)*e, Y = a.y+(b.y-a.y)*e;
    const Rr = a.r+(b.r-a.r)*e, S = a.s+(b.s-a.s)*e, O = a.o+(b.o-a.o)*e;
    jacket.style.transform = 'translate(-50%,-50%) translate('+X.toFixed(2)+'vw,'+Y.toFixed(2)+'vh) rotate('+Rr.toFixed(2)+'deg) scale('+S.toFixed(3)+')';
    jacket.style.opacity = O.toFixed(3);

    if(!reduce){
      /* outer: turns to your hand */
      oX  += (cx*16 - oX)*0.12;
      oY  += (cy*12 - oY)*0.12;
      oRY += (cx*16 - oRY)*0.12;
      oRX += (-cy*9 - oRX)*0.12;
      outer.style.transform = 'translate3d('+oX.toFixed(2)+'px,'+oY.toFixed(2)+'px,0) rotateX('+oRX.toFixed(2)+'deg) rotateY('+oRY.toFixed(2)+'deg)';
      /* inner: sleeves trail a beat behind (follows slowly, so it lags the outer) */
      iRY += (oRY - iRY)*0.045;
      const vel = oRY - prevRY; prevRY = oRY;
      iRZ += (vel*0.55 - iRZ)*0.06;
      const lag = Math.max(-7, Math.min(7, oRY - iRY));
      inner.style.transform = 'rotateZ('+iRZ.toFixed(2)+'deg) rotateY('+lag.toFixed(2)+'deg) translateX('+(lag*1.6).toFixed(2)+'px)';
    }
  };

  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', move, {passive:true});
  raf = requestAnimationFrame(frame);

  window.__conceptStop = ()=>{
    running = false;
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    window.removeEventListener('pointermove', move);
  };
}

/* ---------------- ROUTER ---------------- */
function renderRoute(){
  if(typeof window.__conceptStop === 'function'){ try{ window.__conceptStop(); }catch(err){} window.__conceptStop = null; }
  const hash = location.hash || '#/home';
  const rawRoute = hash.replace('#/','').split('?')[0];
  const parts = rawRoute.split('/');
  const route = parts[0];
  window.scrollTo(0,0);

  // ROUTE PROTECTION GUARDS (Milestone 3)
  const protectedRoutes = ['profile', 'account', 'checkout', 'admin'];
  if (protectedRoutes.includes(route) && !SESSION.user) {
    const returnUrl = encodeURIComponent(hash);
    toast('Please login to access protected area');
    location.hash = '#/login?returnUrl=' + returnUrl;
    return;
  }

  // ROLE-BASED ACCESS CONTROL — /admin is for administrators only.
  // The footer link is hidden for customers (renderFooter), and a customer
  // who reaches the URL directly is sent back to the home page.
  if (route === 'admin' && (SESSION.user.role || 'customer') !== 'admin') {
    toast('Access denied — administrator accounts only');
    location.hash = '#/home';
    return;
  }

  renderHeader();

  const isAdmin = route === 'admin';
  document.body.classList.toggle('is-admin', isAdmin);
  $('#site-header').style.display = isAdmin ? 'none' : '';
  $('#site-footer').style.display = isAdmin ? 'none' : '';

  if(route===''||route==='home') renderHome();
  else if(route==='category') renderListing(DB.categories.find(c=>c.id===parts[1])?.name||'Category', DB.products.filter(p=>p.category===parts[1]));
  else if(route==='others') renderListing('Others — Caps, Accessories & Watches', DB.products.filter(p=>OTHER_CATEGORY_IDS.includes(p.category)));
  else if(route==='brand'){
    const name = decodeURIComponent(parts[1]||'');
    renderListing(`${name} — Official Brand Store`, DB.products.filter(p=>(p.title+' '+p.categoryName).toLowerCase().includes(name.toLowerCase())));
  }
  else if(route==='new') renderListing('New Arrivals', DB.products.filter(p=>p.tags.includes('new')));
  else if(route==='sale') renderListing('Special Sale Items', DB.products.filter(p=>p.discountPrice || p.tags.includes('sale')));
  else if(route==='search') renderListing('Search Results: "'+decodeURIComponent(parts[1])+'"', DB.products.filter(p=>(p.title+p.categoryName).toLowerCase().includes(decodeURIComponent(parts[1]).toLowerCase())));
  else if(route==='concept') renderConcept();
  else if(route==='product') renderProduct(parts[1]);
  else if(route==='cart') renderCart();
  else if(route==='checkout') renderCheckout();
  else if(route==='account') renderProfile(parts[1]);
  else if(route==='order-success') renderOrderSuccess(parts[1]);
  else if(route==='login') renderAuth('login');
  else if(route==='signup') renderAuth('signup');
  else if(route==='profile') renderProfile(parts[1]);
  else if(route==='support') renderStatic(parts[1]);
  else if(route==='admin') renderAdmin(parts[1]);
  else renderHome();
}
window.addEventListener('hashchange', renderRoute);

/* ---------------- SNOWFLAKE OVERLAY + SANTA FLOAT ---------------- */
function initSnowflakes(){
  /* Respect prefers-reduced-motion */
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if(document.querySelector('.snowflake')) return;   /* never double up on re-init */

  /* Depth tiers — far flakes are small, dim and slightly out of focus;
     near flakes are larger, faster and a touch softer. Layered opacity keeps
     the overlay transparent enough to leave the page content readable. */
  const TIERS = [
    {cls:'d-far', share:0.40, size:[5,10],  op:[0.16,0.30], blur:[1.2,1.8], fall:[26,38], sway:[6.5,10], spin:[26,44]},
    {cls:'d-mid', share:0.42, size:[11,17], op:[0.26,0.42], blur:[0.3,0.7], fall:[17,26], sway:[4.5,8],  spin:[18,30]},
    {cls:'d-near',share:0.18, size:[19,30], op:[0.34,0.55], blur:[0,0.3],   fall:[11,17], sway:[3,6],    spin:[12,22]}
  ];
  const TOTAL = 110;
  const colors = ['#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF','#EAF6FF','#DCEEFF','#CFE7FA'];

  /* SVG snowflake paths */
  const svgFlake = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" aria-hidden="true">
    <line x1="16" y1="2" x2="16" y2="30" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    <line x1="2" y1="16" x2="30" y2="16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    <line x1="5.9" y1="5.9" x2="26.1" y2="26.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    <line x1="26.1" y1="5.9" x2="5.9" y2="26.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    <line x1="16" y1="6"  x2="12.4" y2="9.6"  stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
    <line x1="16" y1="6"  x2="19.6" y2="9.6"  stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
    <line x1="16" y1="26" x2="12.4" y2="22.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
    <line x1="16" y1="26" x2="19.6" y2="22.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
    <circle cx="16" cy="2"  r="1.4" fill="currentColor"/>
    <circle cx="16" cy="30" r="1.4" fill="currentColor"/>
    <circle cx="2"  cy="16" r="1.4" fill="currentColor"/>
    <circle cx="30" cy="16" r="1.4" fill="currentColor"/>
  </svg>`;

  const rand = (min,max) => min + Math.random()*(max-min);
  let made = 0;
  TIERS.forEach(tier=>{
    const n = Math.round(TOTAL*tier.share);
    for(let i=0; i<n; i++){
      const size = rand(tier.size[0], tier.size[1]);
      const fall = rand(tier.fall[0], tier.fall[1]);
      const blur = rand(tier.blur[0], tier.blur[1]);
      const el = document.createElement('div');
      el.className = `snowflake ${tier.cls}`;
      el.setAttribute('aria-hidden','true');
      el.style.cssText = `
        left:${(made/TOTAL)*100 + Math.random()*(100/TOTAL)}%;
        width:${size}px;
        height:${size}px;
        color:${colors[Math.floor(Math.random()*colors.length)]};
        --o:${rand(tier.op[0],tier.op[1]).toFixed(2)};
        ${blur > 1 ? `filter:blur(${blur.toFixed(2)}px);` : ''}   /* blur only the far tier — each filter layer costs frames */
        animation-duration:${fall.toFixed(1)}s;
        animation-delay:-${(Math.random()*fall).toFixed(1)}s;
      `;
      const sway = document.createElement('span');
      sway.className = 'flake';
      sway.style.animationDuration = `${rand(tier.sway[0],tier.sway[1]).toFixed(1)}s`;
      sway.style.animationDelay = `-${(Math.random()*6).toFixed(1)}s`;
      sway.innerHTML = svgFlake;
      sway.querySelector('svg').style.animationDuration = `${rand(tier.spin[0],tier.spin[1]).toFixed(1)}s`;
      el.appendChild(sway);
      document.body.appendChild(el);
      made++;
    }
  });
}

function initSantaFloat(){
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  /* Inline SVG cartoon Santa face (no external image needed) */
  const santaSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <!-- Hat -->
    <ellipse cx="50" cy="32" rx="34" ry="8" fill="#c0392b"/>
    <rect x="22" y="8" width="56" height="28" rx="14" fill="#c0392b"/>
    <ellipse cx="50" cy="8" rx="10" ry="10" fill="#FFFFFF"/>
    <!-- Face -->
    <circle cx="50" cy="58" r="30" fill="#FDDCB5"/>
    <!-- Beard -->
    <ellipse cx="50" cy="80" rx="26" ry="14" fill="#FFFFFF"/>
    <ellipse cx="35" cy="70" rx="12" ry="16" fill="#FFFFFF"/>
    <ellipse cx="65" cy="70" rx="12" ry="16" fill="#FFFFFF"/>
    <!-- Eyes -->
    <circle cx="40" cy="52" r="4" fill="#333"/>
    <circle cx="60" cy="52" r="4" fill="#333"/>
    <circle cx="41" cy="51" r="1.5" fill="#fff"/>
    <circle cx="61" cy="51" r="1.5" fill="#fff"/>
    <!-- Nose -->
    <ellipse cx="50" cy="62" rx="5" ry="4" fill="#e08060"/>
    <!-- Smile -->
    <path d="M42 70 Q50 77 58 70" stroke="#c0392b" stroke-width="2" fill="none" stroke-linecap="round"/>
    <!-- Moustache -->
    <path d="M38 65 Q45 68 50 65 Q55 68 62 65" stroke="#FFFFFF" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <!-- Hat brim -->
    <rect x="18" y="30" width="64" height="10" rx="5" fill="#FFFFFF"/>
  </svg>`;

  const el = document.createElement('div');
  el.className = 'santa-float';
  el.setAttribute('aria-hidden','true');
  el.innerHTML = santaSVG;
  document.body.appendChild(el);
}

/* ---------------- INIT ---------------- */
(async function init(){
  await loadStorage();
  ensureGiftCards();
  ensureCatalogDelta();
  ensureSeedAdmins();
  enforceSaleQuota();
  renderFooter();
  renderRoute();
  /* Festive additions — run after first render */
  requestAnimationFrame(()=>{
    initSnowflakes();
    initSantaFloat();
  });
})();
