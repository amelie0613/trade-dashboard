const {useState,useEffect,useMemo,useRef} = React;

/* ---------- constants ---------- */
const CATEGORIES = ['主機','輔機','電機/電力系統','甲板機械','導航/通訊設備','消防安全設備','救生設備','冷凍空調系統','液壓/氣壓系統','船體/艤裝','科研儀器設備','其他'];
const STATUS_FLOW = ['草稿','待審核','待報價','採購中','待施工','施工中','待驗收','已結案'];
const STATUS_COLOR = {
  '草稿':{bg:'#e2e8f0',fg:'#475569'},
  '待審核':{bg:'#dbeafe',fg:'#1d4ed8'},
  '待報價':{bg:'#fef3c7',fg:'#b45309'},
  '採購中':{bg:'#ede9fe',fg:'#6d28d9'},
  '待施工':{bg:'#e0f2fe',fg:'#0369a1'},
  '施工中':{bg:'#ccfbf1',fg:'#0f766e'},
  '待驗收':{bg:'#dcfce7',fg:'#15803d'},
  '已結案':{bg:'#f1f5f9',fg:'#334155'},
};
const SIGNOFF_STEPS = [
  {key:'applicant',label:'申請人'},
  {key:'firstOfficer',label:'大副/大管輪'},
  {key:'captain',label:'船長/輪機長'},
  {key:'center',label:'中心核准'},
];
const NAV_ITEMS = [
  {key:'dashboard',label:'儀表板',icon:'dashboard',status:'done'},
  {key:'orders',label:'工程修理單',icon:'orders',status:'done'},
  {key:'ai',label:'AI 工程助理',icon:'ai',status:'done'},
  {key:'settings',label:'報告 / 設定',icon:'settings',status:'done'},
  {key:'equipment',label:'設備資料',icon:'equipment',status:'wip'},
  {key:'finance',label:'金額分析',icon:'finance',status:'wip'},
  {key:'faults',label:'故障追蹤',icon:'faults',status:'wip'},
];
const MODEL_OPTIONS = ['claude-sonnet-5','claude-opus-4-8','claude-haiku-4-5-20251001'];
const SYSTEM_PROMPT = `你是「研究船工程修理單管理系統」的 AI 工程助理,服務對象為船舶工程與輪機部門人員。
回答時請優先依序參考:
1) 系統內部修理單紀錄(隨提問即時附上)
2) 部門上傳的原廠設備說明書(如有附上文件)
3) 網路搜尋工具查得的海事案例、法規與船級協會官方頁面
技術規範類問題請優先參考十大船級協會官方頁面:ABS、DNV、LR、BV、ClassNK、CCS、KR、RINA、IRS、PRS。
回答時務必清楚標示每項資訊來自「系統紀錄」「原廠說明書」或「網路搜尋」,不要混淆來源。
網路搜尋內容是你當下摘要整理,不是逐字原文,若涉及法規或安全依循,請提醒使用者核對官方原文。
請一律使用繁體中文,語氣專業精簡。`;

const LS = {
  orders:'srs_orders', manuals:'srs_manuals', chat:'srs_chat', settings:'srs_settings',
};

/* ---------- utils ---------- */
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
function todayStr(){ return new Date().toISOString().slice(0,10); }
function loadLS(key, fallback){
  try{ const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch(e){ return fallback; }
}
function saveLS(key, val){
  try{ localStorage.setItem(key, JSON.stringify(val)); return true; }
  catch(e){ console.warn('儲存失敗(可能超過瀏覽器容量上限)', e); return false; }
}
function isOverdue(order){
  return !!order.plannedDate && !['待驗收','已結案'].includes(order.status) && order.plannedDate < todayStr();
}
function bytesToSize(bytes){
  if(!bytes) return '0 KB';
  if(bytes < 1024*1024) return (bytes/1024).toFixed(0)+' KB';
  return (bytes/1024/1024).toFixed(2)+' MB';
}
function suggestCode(orders){
  const now = new Date();
  const yy = String(now.getFullYear()%100).padStart(2,'0');
  const mm = String(now.getMonth()+1).padStart(2,'0');
  const prefix = `${yy}RE${mm}-`;
  const nums = orders.filter(o=>o.code && o.code.startsWith(prefix))
    .map(o=>parseInt(o.code.slice(prefix.length),10)||0);
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return prefix + String(next).padStart(2,'0');
}
function readFileAsDataURL(file){
  return new Promise((resolve,reject)=>{
    const r = new FileReader();
    r.onload = ()=>resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
function readFileAsText(file){
  return new Promise((resolve,reject)=>{
    const r = new FileReader();
    r.onload = ()=>resolve(r.result);
    r.onerror = reject;
    r.readAsText(file);
  });
}
function downloadTextFile(filename, text, mime){
  const blob = new Blob([text], {type: mime || 'text/plain;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function toCSV(orders){
  const cols = ['code','category','equipmentName','location','issueDescription','occurredDate','plannedDate','completedDate','amount','voyageAffected','downtimeHours','voyageNumber','applicant','status'];
  const headers = ['維修編號','系統分類','設備名稱','位置','故障現象與原因','發生日期','預定完成日','完成日期','金額','影響航次','停機時數','航次編號','申請人','目前狀態'];
  const esc = v => `"${String(v==null?'':v).replace(/"/g,'""')}"`;
  const lines = [headers.map(esc).join(',')];
  orders.forEach(o=>{ lines.push(cols.map(c=>esc(o[c])).join(',')); });
  return '﻿' + lines.join('\r\n');
}

/* ---------- icons ---------- */
const ICON_PATHS = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></>,
  orders: <><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="14" y2="18"/></>,
  ai: <path d="M21 11.5a8.4 8.4 0 0 1-8.4 8.4 8.3 8.3 0 0 1-3.8-.9L3 21l1.9-5.7a8.3 8.3 0 0 1-.9-3.8A8.4 8.4 0 0 1 12.5 3.1a8.4 8.4 0 0 1 8.4 8.4z"/>,
  settings: <><circle cx="4.5" cy="8" r="2"/><circle cx="12" cy="14" r="2"/><circle cx="19.5" cy="6.5" r="2"/><line x1="4.5" y1="10" x2="4.5" y2="21"/><line x1="4.5" y1="3" x2="4.5" y2="6"/><line x1="12" y1="16" x2="12" y2="21"/><line x1="12" y1="3" x2="12" y2="12"/><line x1="19.5" y1="8.5" x2="19.5" y2="21"/><line x1="19.5" y1="3" x2="19.5" y2="4.5"/></>,
  equipment: <><rect x="3" y="7.5" width="18" height="12.5" rx="1.5"/><path d="M8 7.5V5.2A2.2 2.2 0 0 1 10.2 3h3.6A2.2 2.2 0 0 1 16 5.2v2.3"/></>,
  finance: <><line x1="5" y1="21" x2="5" y2="10"/><line x1="12" y1="21" x2="12" y2="4"/><line x1="19" y1="21" x2="19" y2="14"/></>,
  faults: <><path d="M12 2.5 1.5 21h21z"/><line x1="12" y1="9.5" x2="12" y2="14.5"/><circle cx="12" cy="17.5" r="0.9" fill="currentColor" stroke="none"/></>,
  anchor: <><circle cx="12" cy="5.2" r="2"/><line x1="12" y1="7.2" x2="12" y2="21"/><path d="M5 13a7 7 0 0 0 14 0"/><line x1="5" y1="13" x2="2.3" y2="13"/><line x1="19" y1="13" x2="21.7" y2="13"/></>,
  plus: <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>,
  edit: <><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></>,
  trash: <><line x1="4" y1="7" x2="20" y2="7"/><path d="M6 7v13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7"/><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/></>,
  close: <><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></>,
  search: <><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.3" y2="16.3"/></>,
  download: <><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 20h16"/></>,
  paperclip: <path d="M21 12.5 12.5 21a5 5 0 0 1-7-7L14 5.5a3.5 3.5 0 0 1 5 5L10.5 19a2 2 0 0 1-3-3L15 8.5"/>,
  warn: <><path d="M12 8.5v4.2"/><circle cx="12" cy="16.2" r="0.9" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="9"/></>,
  send: <><line x1="21" y1="3" x2="10.5" y2="13.5"/><polygon points="21 3 14.5 21 10.5 13.5 3 9.5 21 3"/></>,
  eye: <><path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z"/><circle cx="12" cy="12" r="3"/></>,
};
function Icon({name,size=16,style}){
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={style}>
      {ICON_PATHS[name]}
    </svg>
  );
}
function Badge({text}){
  const c = STATUS_COLOR[text] || {bg:'#e2e8f0',fg:'#475569'};
  return <span className="badge" style={{background:c.bg,color:c.fg}}>{text}</span>;
}

/* ---------- Sidebar ---------- */
function Sidebar({page,setPage}){
  return (
    <div className="sidebar">
      <div className="sidebar-brand">
        <Icon name="anchor" size={22}/>
        <div>
          <div className="name">研究船工程修理單</div>
          <div className="sub">管理系統</div>
        </div>
      </div>
      <div className="nav-list">
        {NAV_ITEMS.map(item=>(
          <button key={item.key} className={"nav-item"+(page===item.key?" active":"")} onClick={()=>setPage(item.key)}>
            <Icon name={item.icon} size={16}/>
            <span>{item.label}</span>
            {item.status==='wip' && <span className="badge-wip">建置中</span>}
          </button>
        ))}
      </div>
      <div className="sidebar-foot">部門共用資料 · 本機瀏覽器儲存</div>
    </div>
  );
}

/* ---------- Dashboard ---------- */
function StarField(){
  const stars = useMemo(()=>{
    let s = '';
    for(let i=0;i<70;i++){
      const x = Math.round(Math.random()*100);
      const y = Math.round(Math.random()*100);
      const o = (0.25 + Math.random()*0.65).toFixed(2);
      s += `${x}% ${y}% 0 rgba(255,255,255,${o}), `;
    }
    return s.slice(0,-2);
  },[]);
  return (
    <div className="stars" style={{
      backgroundImage:`radial-gradient(1.5px 1.5px at ${stars.split(', ')[0]}, transparent)`,
      boxShadow: stars,
      width:'2px',height:'2px'
    }}/>
  );
}
function Banner(){
  const hour = new Date().getHours();
  let greet = '早安', sub='新的一天,祝工程順利、航行平安。';
  if(hour < 5){ greet='夜間值班辛苦了'; sub='深夜的甲板,願一切平安。'; }
  else if(hour < 11){ greet='早安'; sub='新的一天,祝工程順利、航行平安。'; }
  else if(hour < 14){ greet='午安'; sub='別忘了休息一下再繼續。'; }
  else if(hour < 18){ greet='午後好'; sub='今天的進度,辛苦了。'; }
  else { greet='晚安'; sub='收工前再確認一次逾期項目吧。'; }
  return (
    <div className="banner">
      <StarField/>
      <div className="banner-content">
        <div className="banner-greet">{greet},勵進號 工程團隊</div>
        <div className="banner-sub">{sub}</div>
      </div>
      <div className="banner-wave">
        <svg viewBox="0 0 1440 60" width="100%" height="44" preserveAspectRatio="none">
          <path fill="#f8fafc" d="M0,32 C240,60 480,4 720,24 C960,44 1200,58 1440,28 L1440,60 L0,60 Z"/>
        </svg>
      </div>
    </div>
  );
}
function Dashboard({orders,setPage,openNewOrder,setOverdueOnly,exportCSV}){
  const stats = useMemo(()=>{
    const total = orders.length;
    const inProgress = orders.filter(o=>['待審核','待報價','採購中','待施工','施工中'].includes(o.status)).length;
    const overdue = orders.filter(isOverdue).length;
    const pendingAcceptance = orders.filter(o=>o.status==='待驗收').length;
    const ym = todayStr().slice(0,7);
    const monthClosedAmount = orders.filter(o=>o.status==='已結案' && o.completedDate && o.completedDate.slice(0,7)===ym)
      .reduce((s,o)=>s+(Number(o.amount)||0),0);
    return {total,inProgress,overdue,pendingAcceptance,monthClosedAmount};
  },[orders]);

  const riskEquipment = useMemo(()=>{
    const map = {};
    orders.forEach(o=>{
      if(!o.equipmentName) return;
      if(!map[o.equipmentName]) map[o.equipmentName] = {count:0, amount:0};
      map[o.equipmentName].count += 1;
      map[o.equipmentName].amount += Number(o.amount)||0;
    });
    return Object.entries(map).filter(([,v])=>v.count>=3)
      .sort((a,b)=>b[1].count-a[1].count).slice(0,6);
  },[orders]);

  const quickActions = [
    {label:'新增修理單', sub:'建立新的工程修理單', icon:'plus', onClick:()=>{ setPage('orders'); openNewOrder(); }},
    {label:'查看逾期清單', sub:`目前 ${stats.overdue} 件逾期`, icon:'warn', onClick:()=>{ setOverdueOnly(true); setPage('orders'); }},
    {label:'AI 工程助理', sub:'向 AI 詢問維修相關問題', icon:'ai', onClick:()=>setPage('ai')},
    {label:'上傳原廠說明書', sub:'新增設備參考文件', icon:'paperclip', onClick:()=>setPage('settings')},
    {label:'匯出全部紀錄', sub:'下載 CSV 報表', icon:'download', onClick:exportCSV},
    {label:'設備資料', sub:'建置中', icon:'equipment', onClick:()=>setPage('equipment')},
  ];

  return (
    <div>
      <Banner/>
      <div className="stat-row">
        <div className="stat-card"><div className="label">總修理單數</div><div className="value">{stats.total}</div></div>
        <div className="stat-card"><div className="label">進行中</div><div className="value">{stats.inProgress}</div></div>
        <div className={"stat-card"+(stats.overdue>0?" warn":"")}><div className="label">逾期件數</div><div className="value">{stats.overdue}</div></div>
        <div className="stat-card"><div className="label">待驗收</div><div className="value">{stats.pendingAcceptance}</div></div>
        <div className="stat-card"><div className="label">本月已結案金額</div><div className="value">{stats.monthClosedAmount.toLocaleString()}</div></div>
      </div>

      <div className="section-title">快捷功能</div>
      <div className="quick-grid">
        {quickActions.map((q,i)=>(
          <button key={i} className="quick-card" onClick={q.onClick}>
            <span className="qicon"><Icon name={q.icon} size={17}/></span>
            <span>
              <div className="qlabel">{q.label}</div>
              <div className="qsub">{q.sub}</div>
            </span>
          </button>
        ))}
      </div>

      <div className="section-title">高風險關注設備(累計維修 ≥ 3 次)</div>
      {riskEquipment.length===0 ? (
        <div className="empty-box">目前尚無累計維修達 3 次以上的設備。</div>
      ) : (
        <div className="risk-grid">
          {riskEquipment.map(([name,v])=>(
            <div key={name} className="risk-card">
              <div className="name">{name}</div>
              <div className="meta">累計 {v.count} 次修理 · 總金額 {v.amount.toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Order form modal ---------- */
function OrderFormModal({order,orders,onClose,onSave}){
  const isEdit = !!order;
  const [form,setForm] = useState(()=> order ? {...order} : {
    id:uid(), code:suggestCode(orders), category:CATEGORIES[0], equipmentName:'', location:'',
    issueDescription:'', occurredDate:todayStr(), plannedDate:'', completedDate:'', amount:'',
    voyageAffected:'否', downtimeHours:'', voyageNumber:'', applicant:'', status:'草稿',
    signoff:{applicant:false,firstOfficer:false,captain:false,center:false},
    timeline:[{id:uid(),text:'建立修理單',at:new Date().toISOString()}],
    attachments:[], createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(),
  });
  const [err,setErr] = useState('');

  function update(k,v){ setForm(f=>({...f,[k]:v})); }

  function handleSave(){
    const code = (form.code||'').trim();
    if(!code){ setErr('維修編號不可空白'); return; }
    const dup = orders.some(o=>o.code===code && o.id!==form.id);
    if(dup){ setErr('維修編號重複,請改用其他編號'); return; }
    let timeline = form.timeline||[];
    if(isEdit && order.status !== form.status){
      timeline = [...timeline, {id:uid(), text:`狀態由「${order.status}」變更為「${form.status}」`, at:new Date().toISOString()}];
    }
    onSave({...form, code, timeline, updatedAt:new Date().toISOString()});
  }

  return (
    <div className="modal-overlay" onMouseDown={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div className="modal-dark">
        <div className="modal-header">
          <h3>{isEdit ? '編輯修理單' : '新增修理單'}</h3>
          <button className="icon-btn" style={{color:'#94a3b8'}} onClick={onClose}><Icon name="close"/></button>
        </div>
        <div className="modal-body">
          <div className="grid2">
            <div className="field">
              <label>維修編號</label>
              <input value={form.code} onChange={e=>update('code',e.target.value)} placeholder="例:26RE07-01"/>
              <div className="hint">系統已自動帶出建議編號,可自訂或比照紙本編號。</div>
              {err && <div className="err-text">{err}</div>}
            </div>
            <div className="field">
              <label>系統分類</label>
              <select value={form.category} onChange={e=>update('category',e.target.value)}>
                {CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="grid2">
            <div className="field">
              <label>設備名稱</label>
              <input value={form.equipmentName} onChange={e=>update('equipmentName',e.target.value)}/>
            </div>
            <div className="field">
              <label>位置</label>
              <input value={form.location} onChange={e=>update('location',e.target.value)}/>
            </div>
          </div>
          <div className="field">
            <label>故障現象與原因</label>
            <textarea value={form.issueDescription} onChange={e=>update('issueDescription',e.target.value)}/>
          </div>
          <div className="grid3">
            <div className="field">
              <label>發生日期</label>
              <input type="date" value={form.occurredDate} onChange={e=>update('occurredDate',e.target.value)}/>
            </div>
            <div className="field">
              <label>預定完成日</label>
              <input type="date" value={form.plannedDate} onChange={e=>update('plannedDate',e.target.value)}/>
            </div>
            <div className="field">
              <label>完成日期</label>
              <input type="date" value={form.completedDate} onChange={e=>update('completedDate',e.target.value)}/>
            </div>
          </div>
          <div className="grid3">
            <div className="field">
              <label>金額</label>
              <input type="number" value={form.amount} onChange={e=>update('amount',e.target.value)}/>
            </div>
            <div className="field">
              <label>影響航次</label>
              <select value={form.voyageAffected} onChange={e=>update('voyageAffected',e.target.value)}>
                <option value="否">否</option><option value="是">是</option>
              </select>
            </div>
            <div className="field">
              <label>停機時數</label>
              <input type="number" value={form.downtimeHours} onChange={e=>update('downtimeHours',e.target.value)}/>
            </div>
          </div>
          <div className="grid3">
            <div className="field">
              <label>航次編號</label>
              <input value={form.voyageNumber} onChange={e=>update('voyageNumber',e.target.value)}/>
            </div>
            <div className="field">
              <label>申請人</label>
              <input value={form.applicant} onChange={e=>update('applicant',e.target.value)}/>
            </div>
            <div className="field">
              <label>目前狀態(工程進度)</label>
              <select value={form.status} onChange={e=>update('status',e.target.value)}>
                {STATUS_FLOW.map(s=><option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={handleSave}>{isEdit?'儲存變更':'建立修理單'}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Order detail modal ---------- */
function OrderDetailModal({order,onClose,onUpdate}){
  const [noteText,setNoteText] = useState('');
  const fileRef = useRef(null);

  function toggleSignoff(key){
    onUpdate({...order, signoff:{...order.signoff,[key]:!order.signoff[key]}});
  }
  function addNote(){
    if(!noteText.trim()) return;
    const timeline = [...(order.timeline||[]), {id:uid(), text:noteText.trim(), at:new Date().toISOString()}];
    onUpdate({...order, timeline});
    setNoteText('');
  }
  async function handleFile(e){
    const file = e.target.files[0];
    if(!file) return;
    if(file.size > 1.2*1024*1024){
      alert(`此檔案為 ${bytesToSize(file.size)},建議附件單檔在 1.2MB 內,仍會繼續上傳。`);
    }
    const dataUrl = await readFileAsDataURL(file);
    const attachments = [...(order.attachments||[]), {id:uid(), name:file.name, size:file.size, dataUrl, uploadedAt:new Date().toISOString()}];
    onUpdate({...order, attachments});
    e.target.value = '';
  }
  function removeAttachment(id){
    onUpdate({...order, attachments:(order.attachments||[]).filter(a=>a.id!==id)});
  }

  return (
    <div className="modal-overlay" onMouseDown={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div className="modal-dark">
        <div className="modal-header">
          <h3>{order.code} · {order.equipmentName || '（未命名設備）'}</h3>
          <button className="icon-btn" style={{color:'#94a3b8'}} onClick={onClose}><Icon name="close"/></button>
        </div>
        <div className="modal-body">
          <div style={{marginBottom:14}}><Badge text={order.status}/>{isOverdue(order) && <span className="overdue-flag" style={{marginLeft:10}}><Icon name="warn" size={13}/> 已逾期</span>}</div>
          <div className="detail-grid">
            <div className="detail-item"><div className="k">系統分類</div><div className="v">{order.category}</div></div>
            <div className="detail-item"><div className="k">位置</div><div className="v">{order.location||'—'}</div></div>
            <div className="detail-item" style={{gridColumn:'1 / -1'}}><div className="k">故障現象與原因</div><div className="v">{order.issueDescription||'—'}</div></div>
            <div className="detail-item"><div className="k">發生日期</div><div className="v">{order.occurredDate||'—'}</div></div>
            <div className="detail-item"><div className="k">預定完成日</div><div className="v">{order.plannedDate||'—'}</div></div>
            <div className="detail-item"><div className="k">完成日期</div><div className="v">{order.completedDate||'—'}</div></div>
            <div className="detail-item"><div className="k">金額</div><div className="v">{order.amount || '—'}</div></div>
            <div className="detail-item"><div className="k">影響航次</div><div className="v">{order.voyageAffected}</div></div>
            <div className="detail-item"><div className="k">停機時數</div><div className="v">{order.downtimeHours||'—'}</div></div>
            <div className="detail-item"><div className="k">航次編號</div><div className="v">{order.voyageNumber||'—'}</div></div>
            <div className="detail-item"><div className="k">申請人</div><div className="v">{order.applicant||'—'}</div></div>
          </div>

          <div className="divider-dark"/>
          <div className="subhead">簽核狀態(SMF-10-04C)</div>
          <div className="signoff-row">
            {SIGNOFF_STEPS.map(s=>(
              <button key={s.key} className={"signoff-chip"+(order.signoff && order.signoff[s.key]?" checked":"")} onClick={()=>toggleSignoff(s.key)}>
                <Icon name={order.signoff && order.signoff[s.key] ? 'eye' : 'plus'} size={13}/>
                {s.label}
              </button>
            ))}
          </div>

          <div className="divider-dark"/>
          <div className="subhead">時間軸</div>
          <div className="timeline">
            {(order.timeline||[]).slice().reverse().map(t=>(
              <div key={t.id} className="tl-item">
                <div className="tl-dot"/>
                <div>
                  <div className="tl-text">{t.text}</div>
                  <div className="tl-at">{new Date(t.at).toLocaleString('zh-TW')}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="note-add">
            <input placeholder="新增備註…" value={noteText} onChange={e=>setNoteText(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter') addNote(); }}/>
            <button className="btn btn-primary btn-sm" onClick={addNote}>加入</button>
          </div>

          <div className="divider-dark"/>
          <div className="subhead">附件</div>
          {(order.attachments||[]).map(a=>(
            <div key={a.id} className="att-row">
              <Icon name="paperclip" size={14}/>
              <span className="an">{a.name}</span>
              <span className="as">{bytesToSize(a.size)}</span>
              <button className="icon-btn" style={{color:'#f87171'}} onClick={()=>removeAttachment(a.id)}><Icon name="trash" size={14}/></button>
            </div>
          ))}
          <input ref={fileRef} type="file" style={{display:'none'}} onChange={handleFile}/>
          <button className="btn btn-ghost btn-sm" onClick={()=>fileRef.current.click()}>
            <Icon name="paperclip" size={13}/> 上傳附件(建議單檔 1.2MB 內)
          </button>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>關閉</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Orders page ---------- */
function OrdersPage({orders,setOrders,formOpen,setFormOpen,editingOrder,setEditingOrder,detailOrder,setDetailOrder,overdueOnly,setOverdueOnly}){
  const [statusFilter,setStatusFilter] = useState('全部');
  const [categoryFilter,setCategoryFilter] = useState('全部');
  const [keyword,setKeyword] = useState('');

  const filtered = useMemo(()=>{
    return orders.filter(o=>{
      if(statusFilter!=='全部' && o.status!==statusFilter) return false;
      if(categoryFilter!=='全部' && o.category!==categoryFilter) return false;
      if(overdueOnly && !isOverdue(o)) return false;
      if(keyword){
        const k = keyword.toLowerCase();
        const hay = `${o.code} ${o.equipmentName} ${o.location}`.toLowerCase();
        if(!hay.includes(k)) return false;
      }
      return true;
    }).sort((a,b)=> (b.updatedAt||'').localeCompare(a.updatedAt||''));
  },[orders,statusFilter,categoryFilter,keyword,overdueOnly]);

  function saveOrder(order){
    setOrders(prev=>{
      const exists = prev.some(o=>o.id===order.id);
      const next = exists ? prev.map(o=>o.id===order.id?order:o) : [...prev, order];
      return next;
    });
    setFormOpen(false); setEditingOrder(null);
  }
  function deleteOrder(id){
    if(!confirm('確定要刪除此修理單?此動作無法復原。')) return;
    setOrders(prev=>prev.filter(o=>o.id!==id));
  }
  function exportCSV(){
    downloadTextFile(`工程修理單_${todayStr()}.csv`, toCSV(filtered), 'text/csv;charset=utf-8');
  }

  return (
    <div className="page">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
        <div>
          <h1 className="page-title">工程修理單</h1>
          <p className="page-desc">列表、篩選、新增/編輯/刪除、狀態切換,逾期項目自動標紅。</p>
        </div>
        <div style={{display:'flex',gap:8}}>
          <button className="btn btn-ghost" onClick={exportCSV}><Icon name="download" size={14}/> 匯出 CSV</button>
          <button className="btn btn-primary" onClick={()=>{ setEditingOrder(null); setFormOpen(true); }}><Icon name="plus" size={14}/> 新增修理單</button>
        </div>
      </div>

      <div className="filter-bar">
        <input type="text" placeholder="搜尋編號 / 設備 / 位置" value={keyword} onChange={e=>setKeyword(e.target.value)}/>
        <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
          <option value="全部">全部狀態</option>
          {STATUS_FLOW.map(s=><option key={s} value={s}>{s}</option>)}
        </select>
        <select value={categoryFilter} onChange={e=>setCategoryFilter(e.target.value)}>
          <option value="全部">全部分類</option>
          {CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
        <label className="chk-inline">
          <input type="checkbox" checked={overdueOnly} onChange={e=>setOverdueOnly(e.target.checked)}/> 只顯示逾期
        </label>
        <span className="spacer"/>
        <span style={{fontSize:12,color:'#94a3b8'}}>共 {filtered.length} 筆</span>
      </div>

      {filtered.length===0 ? (
        <div className="empty-box">尚無符合條件的修理單,點擊「新增修理單」建立第一筆紀錄。</div>
      ) : (
        <table className="order-table">
          <thead>
            <tr>
              <th>維修編號</th><th>設備名稱</th><th>系統分類</th><th>狀態</th><th>預定完成日</th><th>金額</th><th>申請人</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(o=>(
              <tr key={o.id} className={isOverdue(o)?'overdue':''}>
                <td>{o.code}</td>
                <td>{o.equipmentName||'—'}</td>
                <td>{o.category}</td>
                <td><Badge text={o.status}/></td>
                <td>{isOverdue(o) ? <span className="overdue-flag"><Icon name="warn" size={12}/>{o.plannedDate}</span> : (o.plannedDate||'—')}</td>
                <td>{o.amount?Number(o.amount).toLocaleString():'—'}</td>
                <td>{o.applicant||'—'}</td>
                <td>
                  <div className="row-actions">
                    <button className="icon-btn" title="查看" onClick={()=>setDetailOrder(o)}><Icon name="eye" size={15}/></button>
                    <button className="icon-btn" title="編輯" onClick={()=>{ setEditingOrder(o); setFormOpen(true); }}><Icon name="edit" size={15}/></button>
                    <button className="icon-btn" style={{color:'#f87171'}} title="刪除" onClick={()=>deleteOrder(o.id)}><Icon name="trash" size={15}/></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {formOpen && (
        <OrderFormModal order={editingOrder} orders={orders} onClose={()=>{ setFormOpen(false); setEditingOrder(null); }} onSave={saveOrder}/>
      )}
      {detailOrder && (
        <OrderDetailModal order={orders.find(o=>o.id===detailOrder.id) || detailOrder}
          onClose={()=>setDetailOrder(null)}
          onUpdate={(updated)=>{ setOrders(prev=>prev.map(o=>o.id===updated.id?updated:o)); setDetailOrder(updated); }}/>
      )}
    </div>
  );
}

/* ---------- Settings / manuals page ---------- */
function SettingsPage({manuals,setManuals,orders,settings,setSettings}){
  const [tab,setTab] = useState('manuals');
  const [name,setName] = useState('');
  const [category,setCategory] = useState(CATEGORIES[0]);
  const fileRef = useRef(null);

  const totalBytes = useMemo(()=>{
    const manualBytes = manuals.reduce((s,m)=>s+(m.size||0),0);
    const attBytes = orders.reduce((s,o)=>s+(o.attachments||[]).reduce((s2,a)=>s2+(a.size||0),0),0);
    return manualBytes+attBytes;
  },[manuals,orders]);
  const CAP = 8*1024*1024;
  const pct = Math.min(100, Math.round(totalBytes/CAP*100));
  const gaugeClass = pct>90?'danger':pct>70?'warn':'';

  async function handleUpload(e){
    const file = e.target.files[0];
    if(!file) return;
    if(file.size > 2*1024*1024){
      alert(`此檔案為 ${bytesToSize(file.size)},建議說明書單檔在 2MB 內,仍會繼續上傳。`);
    }
    const isText = /text\/(plain|markdown)/.test(file.type) || /\.(txt|md)$/i.test(file.name);
    const content = isText ? await readFileAsText(file) : await readFileAsDataURL(file);
    const kind = isText ? 'text' : (file.type==='application/pdf' ? 'pdf' : 'image');
    const manual = {id:uid(), name:name.trim()||file.name, category, kind, mime:file.type, size:file.size, content, uploadedAt:new Date().toISOString()};
    setManuals(prev=>[...prev, manual]);
    setName(''); e.target.value='';
  }
  function removeManual(id){
    if(!confirm('確定要刪除此說明書?')) return;
    setManuals(prev=>prev.filter(m=>m.id!==id));
  }

  return (
    <div className="page">
      <h1 className="page-title">報告 / 設定</h1>
      <p className="page-desc">原廠設備說明書管理,以及 AI 工程助理的呼叫設定。</p>

      <div className="tab-row">
        <button className={"tab-btn"+(tab==='manuals'?' active':'')} onClick={()=>setTab('manuals')}>原廠說明書</button>
        <button className={"tab-btn"+(tab==='ai'?' active':'')} onClick={()=>setTab('ai')}>AI 助理設定</button>
      </div>

      {tab==='manuals' && (
        <div>
          <div className="upload-card">
            <div className="grid3">
              <div className="field"><label style={{fontSize:11.5,color:'#64748b',display:'block',marginBottom:5}}>文件名稱(選填)</label>
                <input type="text" value={name} onChange={e=>setName(e.target.value)} placeholder="預設使用檔名" style={{width:'100%',height:36,padding:'0 10px',border:'1px solid #e2e8f0',borderRadius:8}}/>
              </div>
              <div className="field"><label style={{fontSize:11.5,color:'#64748b',display:'block',marginBottom:5}}>設備分類標籤</label>
                <select value={category} onChange={e=>setCategory(e.target.value)} style={{width:'100%',height:36,padding:'0 10px',border:'1px solid #e2e8f0',borderRadius:8}}>
                  {CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="field"><label style={{fontSize:11.5,color:'#64748b',display:'block',marginBottom:5}}>選擇檔案</label>
                <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.txt,.md" onChange={handleUpload}/>
              </div>
            </div>
            <div className="hint">支援 PDF、圖片、純文字 / Markdown,建議單檔 2MB 內。上傳後所有部門成員可見,AI 助理提問時會自動一併參考。</div>
            <div className="gauge-wrap"><div className={"gauge-fill "+gaugeClass} style={{width:pct+'%'}}/></div>
            <div className="hint">目前累計容量約 {bytesToSize(totalBytes)}(含附件),建議上限約 8MB。{pct>70 && '接近上限,建議清理較舊或不再需要的檔案。'}</div>
          </div>

          {manuals.length===0 ? (
            <div className="empty-box">尚未上傳任何原廠說明書。</div>
          ) : manuals.map(m=>(
            <div key={m.id} className="manual-row">
              <Icon name="paperclip" size={16}/>
              <div style={{flex:1}}>
                <div className="mn">{m.name}</div>
                <div className="mm">{bytesToSize(m.size)} · 上傳於 {new Date(m.uploadedAt).toLocaleDateString('zh-TW')}</div>
              </div>
              <span className="tag-pill">{m.category}</span>
              <button className="icon-btn" style={{color:'#f87171'}} onClick={()=>removeManual(m.id)}><Icon name="trash" size={15}/></button>
            </div>
          ))}
        </div>
      )}

      {tab==='ai' && (
        <div className="upload-card" style={{maxWidth:520}}>
          <div className="field" style={{marginBottom:14}}>
            <label style={{fontSize:11.5,color:'#64748b',display:'block',marginBottom:5}}>Anthropic API Key</label>
            <input type="password" value={settings.apiKey} placeholder="sk-ant-…"
              onChange={e=>setSettings(s=>({...s,apiKey:e.target.value}))}
              style={{width:'100%',height:38,padding:'0 11px',border:'1px solid #e2e8f0',borderRadius:8}}/>
            <div className="hint">此金鑰僅儲存在本機瀏覽器,提問時會直接呼叫 Anthropic API,不會經過任何第三方伺服器。</div>
          </div>
          <div className="field" style={{marginBottom:14}}>
            <label style={{fontSize:11.5,color:'#64748b',display:'block',marginBottom:5}}>使用模型</label>
            <select value={settings.model} onChange={e=>setSettings(s=>({...s,model:e.target.value}))}
              style={{width:'100%',height:38,padding:'0 11px',border:'1px solid #e2e8f0',borderRadius:8}}>
              {MODEL_OPTIONS.map(m=><option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <label className="chk-inline">
            <input type="checkbox" checked={settings.searchEnabled} onChange={e=>setSettings(s=>({...s,searchEnabled:e.target.checked}))}/>
            啟用網路搜尋(海事案例、法規、船級協會官方頁面)
          </label>
        </div>
      )}
    </div>
  );
}

/* ---------- AI assistant ---------- */
function buildContextText(orders){
  if(orders.length===0) return '(目前系統內尚無任何修理單紀錄)';
  return orders.map(o=>
    `#${o.code} [${o.status}] ${o.category}/${o.equipmentName||'未填'} @ ${o.location||'未填'} | 故障:${o.issueDescription||'未填'} | 發生:${o.occurredDate||'-'} 預定完成:${o.plannedDate||'-'} 完成:${o.completedDate||'-'} | 金額:${o.amount||0} | 停機:${o.downtimeHours||0}h | 航次:${o.voyageNumber||'-'} | 申請人:${o.applicant||'-'}`
  ).join('\n');
}
function buildManualBlocks(manuals){
  const blocks = [];
  manuals.forEach(m=>{
    if(m.kind==='text'){
      blocks.push({type:'text', text:`【原廠說明書:${m.name}(分類:${m.category})】\n${m.content}`});
    } else {
      const [, mediaType, , data] = m.content.match(/^data:(.*?)(;base64)?,(.*)$/s) ? m.content.match(/^data:(.*?)(;base64)?,(.*)$/s) : [];
      if(!data) return;
      if(m.kind==='pdf'){
        blocks.push({type:'document', source:{type:'base64', media_type: mediaType||'application/pdf', data}});
      } else {
        blocks.push({type:'image', source:{type:'base64', media_type: mediaType||'image/png', data}});
      }
    }
  });
  return blocks;
}
async function askClaude({apiKey, model, searchEnabled, orders, manuals, history, question}){
  const contentBlocks = [
    {type:'text', text:`【系統修理單資料,共 ${orders.length} 筆】\n${buildContextText(orders)}`},
    ...buildManualBlocks(manuals),
    {type:'text', text:`【使用者提問】\n${question}`},
  ];
  const apiMessages = [
    ...history.map(m=>({role:m.role, content:m.text})),
    {role:'user', content:contentBlocks},
  ];
  const body = {model, max_tokens:1600, system:SYSTEM_PROMPT, messages:apiMessages};
  if(searchEnabled) body.tools = [{type:'web_search_20250305', name:'web_search'}];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:'POST',
    headers:{
      'content-type':'application/json',
      'x-api-key': apiKey,
      'anthropic-version':'2023-06-01',
      'anthropic-dangerous-direct-browser-access':'true',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if(!res.ok){ throw new Error((data && data.error && data.error.message) || `API 錯誤(狀態碼 ${res.status})`); }
  let text = ''; const sources = [];
  (data.content||[]).forEach(block=>{
    if(block.type==='text') text += block.text;
    if(block.type==='web_search_tool_result' && Array.isArray(block.content)){
      block.content.forEach(r=>{ if(r.url) sources.push({title:r.title||r.url,url:r.url}); });
    }
  });
  return {text: text || '（AI 未回傳文字內容)', sources};
}

function AIPage({orders,manuals,settings,chat,setChat}){
  const [question,setQuestion] = useState('');
  const [loading,setLoading] = useState(false);
  const [limit,setLimit] = useState(50);
  const scrollRef = useRef(null);

  useEffect(()=>{ if(scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; },[chat]);

  const visible = useMemo(()=>{
    if(limit==='all') return chat;
    return chat.slice(-limit);
  },[chat,limit]);

  async function send(){
    const q = question.trim();
    if(!q || loading) return;
    if(!settings.apiKey){ alert('請先至「報告 / 設定」頁面設定 Anthropic API Key。'); return; }
    const userMsg = {id:uid(), role:'user', text:q, at:new Date().toISOString()};
    const history = chat.map(m=>({role:m.role,text:m.text}));
    setChat(prev=>[...prev,userMsg]);
    setQuestion(''); setLoading(true);
    try{
      const {text,sources} = await askClaude({apiKey:settings.apiKey, model:settings.model, searchEnabled:settings.searchEnabled, orders, manuals, history, question:q});
      setChat(prev=>[...prev, {id:uid(), role:'assistant', text, sources, at:new Date().toISOString()}]);
    }catch(err){
      setChat(prev=>[...prev, {id:uid(), role:'assistant', text:'發生錯誤:'+err.message, at:new Date().toISOString()}]);
    }finally{
      setLoading(false);
    }
  }
  function exportChat(){
    const lines = chat.map(m=>`[${new Date(m.at).toLocaleString('zh-TW')}] ${m.role==='user'?'使用者':'AI'}: ${m.text}`);
    downloadTextFile(`AI對話紀錄_${todayStr()}.txt`, lines.join('\n\n'));
  }
  function clearChat(){
    if(!confirm('確定要清空對話紀錄?此為部門共用清空,所有人都會看到空白紀錄。')) return;
    setChat([]);
  }

  let lastDay = '';

  return (
    <div className="page">
      <h1 className="page-title">AI 工程助理</h1>
      <p className="page-desc">對話式查詢,部門共用紀錄,可匯出 / 清空。</p>

      {!settings.apiKey && (
        <div className="ai-warn-banner">尚未設定 Anthropic API Key,請至「報告 / 設定」頁面的「AI 助理設定」分頁輸入金鑰後才能提問。</div>
      )}

      <div className="ai-shell">
        <div className="ai-toolbar">
          <select value={limit} onChange={e=>setLimit(e.target.value==='all'?'all':Number(e.target.value))} style={{height:34,padding:'0 8px',border:'1px solid #e2e8f0',borderRadius:8,fontSize:12.5}}>
            <option value={20}>顯示最近 20 筆</option>
            <option value={50}>顯示最近 50 筆</option>
            <option value={100}>顯示最近 100 筆</option>
            <option value="all">顯示全部</option>
          </select>
          <span className="spacer"/>
          <button className="btn btn-ghost btn-sm" onClick={exportChat}><Icon name="download" size={13}/> 匯出 .txt</button>
          <button className="btn btn-danger btn-sm" onClick={clearChat}><Icon name="trash" size={13}/> 清空對話</button>
        </div>

        <div className="chat-scroll" ref={scrollRef}>
          {visible.length===0 && <div className="empty-box">尚無對話紀錄,輸入問題開始詢問 AI 工程助理。</div>}
          {visible.map(m=>{
            const day = new Date(m.at).toLocaleDateString('zh-TW');
            const showDiv = day!==lastDay;
            lastDay = day;
            return (
              <React.Fragment key={m.id}>
                {showDiv && <div className="chat-daydiv">{day}</div>}
                <div className={"msg-row "+m.role}>
                  <div className="msg-bubble">
                    {m.text}
                    {m.sources && m.sources.length>0 && (
                      <div className="msg-sources">
                        {m.sources.map((s,i)=>(
                          <a key={i} className="msg-source-chip" href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </React.Fragment>
            );
          })}
          {loading && <div className="msg-row assistant"><div className="msg-bubble">思考中…</div></div>}
        </div>

        <div className="chat-input-bar">
          <textarea placeholder="輸入問題,例如:主機近三個月維修狀況如何?"
            value={question} onChange={e=>setQuestion(e.target.value)}
            onKeyDown={e=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); send(); } }}/>
          <button className="btn btn-primary" disabled={loading || !settings.apiKey} onClick={send}><Icon name="send" size={15}/></button>
        </div>
        <div className="reminder-box">
          提醒:AI 會即時參考系統修理單資料、原廠說明書與網路搜尋結果並標示來源,這是即時提供參考資料,不是訓練或微調模型;網路搜尋內容為 AI 當下摘要整理而非逐字原文,涉及法規或安全依循時請核對官方原文。
        </div>
      </div>
    </div>
  );
}

/* ---------- Placeholder page ---------- */
function PlaceholderPage({title,note}){
  return (
    <div className="page">
      <h1 className="page-title">{title}</h1>
      <p className="page-desc">建置中,尚未開發。</p>
      <div className="placeholder-card">
        <div className="picon"><Icon name="warn" size={30}/></div>
        <h3>此頁面尚未開發</h3>
        <p>{note}</p>
      </div>
    </div>
  );
}

/* ---------- App ---------- */
function App(){
  const [page,setPage] = useState('dashboard');
  const [orders,setOrdersRaw] = useState(()=>loadLS(LS.orders, []));
  const [manuals,setManualsRaw] = useState(()=>loadLS(LS.manuals, []));
  const [chat,setChatRaw] = useState(()=>loadLS(LS.chat, []));
  const [settings,setSettingsRaw] = useState(()=>loadLS(LS.settings, {apiKey:'', model:MODEL_OPTIONS[0], searchEnabled:true}));

  const [formOpen,setFormOpen] = useState(false);
  const [editingOrder,setEditingOrder] = useState(null);
  const [detailOrder,setDetailOrder] = useState(null);
  const [overdueOnly,setOverdueOnly] = useState(false);

  function setOrders(updater){ setOrdersRaw(prev=>{ const next = typeof updater==='function'?updater(prev):updater; saveLS(LS.orders,next); return next; }); }
  function setManuals(updater){ setManualsRaw(prev=>{ const next = typeof updater==='function'?updater(prev):updater; saveLS(LS.manuals,next); return next; }); }
  function setChat(updater){ setChatRaw(prev=>{ const next = typeof updater==='function'?updater(prev):updater; saveLS(LS.chat,next); return next; }); }
  function setSettings(updater){ setSettingsRaw(prev=>{ const next = typeof updater==='function'?updater(prev):updater; saveLS(LS.settings,next); return next; }); }

  function exportCSV(){ downloadTextFile(`工程修理單_${todayStr()}.csv`, toCSV(orders), 'text/csv;charset=utf-8'); }
  function openNewOrder(){ setEditingOrder(null); setFormOpen(true); }

  return (
    <div className="app-shell">
      <Sidebar page={page} setPage={setPage}/>
      <div className="main">
        {page==='dashboard' && (
          <Dashboard orders={orders} setPage={setPage} openNewOrder={openNewOrder} setOverdueOnly={setOverdueOnly} exportCSV={exportCSV}/>
        )}
        {page==='orders' && (
          <OrdersPage orders={orders} setOrders={setOrders}
            formOpen={formOpen} setFormOpen={setFormOpen}
            editingOrder={editingOrder} setEditingOrder={setEditingOrder}
            detailOrder={detailOrder} setDetailOrder={setDetailOrder}
            overdueOnly={overdueOnly} setOverdueOnly={setOverdueOnly}/>
        )}
        {page==='ai' && <AIPage orders={orders} manuals={manuals} settings={settings} chat={chat} setChat={setChat}/>}
        {page==='settings' && <SettingsPage manuals={manuals} setManuals={setManuals} orders={orders} settings={settings} setSettings={setSettings}/>}
        {page==='equipment' && <PlaceholderPage title="設備資料" note="佔位頁面,尚未開發。"/>}
        {page==='finance' && <PlaceholderPage title="金額分析" note="佔位頁面,尚未開發。"/>}
        {page==='faults' && <PlaceholderPage title="故障追蹤" note="佔位頁面,尚未開發(原系統的紅卡診斷概念尚待移植)。"/>}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
