import './style.css';
import dot from './dot.png';
import svg from './dot.svg';
import './garden.js';
__p.order.push('module-main');window.__assets=[dot.slice(0,10),svg.slice(0,10)];
import('./lazy.js').then(m=>{window.__lazy=m.lazy;__p.order.push('lazy-done')});
document.addEventListener('DOMContentLoaded',()=>__p.order.push('module-dcl'));
