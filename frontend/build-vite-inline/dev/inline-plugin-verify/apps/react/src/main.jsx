import React,{useState,useEffect,lazy,Suspense} from 'react';import {createRoot} from 'react-dom/client';import './a.css';
const Late=lazy(()=>import('./late.jsx'));
function App(){const [n,setN]=useState(()=>{try{return +localStorage.getItem('n')||0}catch(e){return 0}});useEffect(()=>{try{localStorage.setItem('n',n)}catch(e){};document.title='Tugas '+n},[n]);
return <div className="card"><h1>Tugas — 日本語 🌱</h1><p id="count">{n}</p><button id="inc" onClick={()=>setN(n+1)}>Tambah</button>{n>0&&<Suspense fallback={<i>…</i>}><Late/></Suspense>}</div>}
__p.order.push('react-main');createRoot(document.getElementById('root')).render(<App/>);