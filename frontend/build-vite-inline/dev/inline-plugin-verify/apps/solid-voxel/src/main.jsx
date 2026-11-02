import { render } from 'solid-js/web';
import App from './App.jsx';
if (typeof window.__p !== 'undefined') window.__p.order.push('solid-main');
render(App, document.getElementById('root'));
