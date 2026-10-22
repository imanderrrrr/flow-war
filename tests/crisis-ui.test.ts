import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {renderToStaticMarkup} from 'react-dom/server';import React from 'react';import Crisis from '../src/Crisis.js';
test('C04,C12,C13 siren visibility and nonblocking accessible reduced-motion presentation',()=>{const state={active:true,enteredAt:0,episode:1,lastReputation:34};const html=renderToStaticMarkup(React.createElement(Crisis,{state,tick:60}));assert.match(html,/crisis-siren/);assert.equal((html.match(/class="pixel-paper/g)||[]).length,7);assert.match(html,/aria-hidden="true"/);assert.equal(renderToStaticMarkup(React.createElement(Crisis,{state:{...state,active:false,exitedAt:60},tick:64})), '');const css=readFileSync('src/styles.css','utf8');assert.match(css,/prefers-reduced-motion:reduce/);assert.match(css,/pointer-events:none/);assert.match(css,/3\.6s ease-in-out/);});
test('C09,C10 paused reconnect presents accumulated papers visibly instead of freezing opacity zero',()=>{const css=readFileSync('src/styles.css','utf8');assert.match(css,/\.crisis-surface\[data-paused="true"\] \.pixel-paper\{animation:none!important\}/);});
test('an active crisis raises a full-screen alarm that stays static in calm mode',()=>{const css=readFileSync('src/styles.css','utf8');
 const alarm=/\.crisis-surface\.in-crisis:after\{([^}]*)\}/.exec(css);assert(alarm,'falta la capa de alarma a pantalla completa');
 for(const rule of [/position:fixed/,/inset:0/,/pointer-events:none/,/animation:crisis-alarm /,/opacity:\.\d+/])assert.match(alarm[1],rule,alarm[1]);
 assert.match(css,/@keyframes crisis-alarm\{/,'la alarma no tiene pulso propio');
 // The alarm has to paint over the header too, or the top strip of the screen stays unlit.
 const header=/\.site-header\{[^}]*z-index:(\d+)/.exec(css)!,surface=/\.crisis-surface\.in-crisis\{[^}]*z-index:(\d+)/.exec(css);
 assert(surface&&Number(surface[1])>Number(header[1]),'la alarma debe pintarse sobre la cabecera');
 // "REDUCIR PARPADEO" keeps the warning and drops the blinking: photosensitivity in a room of 30 students.
 const calm=/html\[data-calm="true"\] \.crisis-surface\.in-crisis:after\{([^}]*)\}/.exec(css);
 assert(calm,'el modo calmo no deja la alarma estática');assert.match(calm[1],/animation:none/);
 assert.doesNotMatch(calm[1],/display:none|opacity:0/,'el modo calmo silencia el parpadeo, no el aviso');});
