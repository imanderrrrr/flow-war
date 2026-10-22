import test from 'node:test';import assert from 'node:assert/strict';
import {NOTICE_LIFETIME,NOTICE_VISIBLE,dropExpired,freshComplaints,pushNotices} from '../src/notices.js';
import type {SlackMessage} from '../shared/observability.js';

const complaint=(id:string,channel='soporte-clientes',source='customer'):SlackMessage=>({id,sequence:Number(id.slice(1)),companyId:0,channel,source,author:'Cliente c1',at:10,cause:0,dedup:id,text:`queja ${id}`,refs:[],mentions:[]} as SlackMessage);

test('un primer snapshot vacío no convierte el histórico posterior en novedades',()=>{
 // Sin datos todavía: nada que recordar, porque recordar un histórico vacío haría pasar por nuevas las quejas viejas.
 const nothing=freshComplaints(null,undefined);
 assert.equal(nothing.seen,null,'un snapshot ausente no debe quedar registrado como histórico');
 assert.deepEqual(nothing.fresh,[]);
 // El histórico que llega después es historia, no novedad.
 const history=[complaint('m1'),complaint('m2')],first=freshComplaints(nothing.seen,history);
 assert.deepEqual(first.fresh,[]);
 assert.deepEqual([...first.seen!],['m1','m2']);
 // Y una queja nueva sí se anuncia.
 const later=freshComplaints(first.seen,[...history,complaint('m3')]);
 assert.deepEqual(later.fresh.map(m=>m.id),['m3']);
});

test('un primer snapshot con datos y sin quejas sí queda registrado',()=>{
 const empty=freshComplaints(null,[complaint('s1','alertas-sistema','system')]);
 assert.deepEqual([...empty.seen!],[],'recibí datos y no había quejas');
 assert.deepEqual(freshComplaints(empty.seen,[complaint('s1','alertas-sistema','system'),complaint('m1')]).fresh.map(m=>m.id),['m1']);
});

test('cada notificación expira a los 9 s de haber entrado, no al último cambio de la pila',()=>{
 const first=pushNotices([],[complaint('m1')],1000);
 assert.deepEqual(first,[{message:first[0].message,until:1000+NOTICE_LIFETIME}]);
 // Una segunda queja 5 s después no le regala tiempo a la primera.
 const both=pushNotices(first,[complaint('m2')],6000);
 assert.deepEqual(both.map(n=>n.until),[1000+NOTICE_LIFETIME,6000+NOTICE_LIFETIME]);
 // A los 9 s de la primera, solo ella se va.
 assert.deepEqual(dropExpired(both,both[0].until).map(n=>n.message.id),['m2']);
 assert.deepEqual(dropExpired(both,both[1].until),[]);
 // La pila nunca pasa del máximo visible y conserva las últimas.
 const many=pushNotices(both,[complaint('m3'),complaint('m4'),complaint('m5')],7000);
 assert.equal(many.length,NOTICE_VISIBLE);
 assert.deepEqual(many.map(n=>n.message.id),['m3','m4','m5']);
});
