// Verification-only preload (NODE_OPTIONS): for every state:update the server encodes outside the stock encode()
// (the StateUpdateEncoder fast path), re-encode the same packet with the stock Encoder and compare the strings.
// Loaded in every Node process of a harness run; it only acts where socket.io-parser resolves from FLOW_VERIFY_ROOT.
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const root=process.env.FLOW_VERIFY_ROOT,out=process.env.FLOW_VERIFY_OUT;
let parser;try{parser=createRequire(path.join(root,'node_modules','socket.io','package.json'))('socket.io-parser');}catch{}
if(parser&&process.argv.some(a=>a.endsWith('server/index.ts'))){
 const {Encoder}=parser,encode=Encoder.prototype.encode,encodeAsString=Encoder.prototype.encodeAsString;let inside=0,fast=0,stock=0,mismatches=0,bytes=0;
 // Stock encode() bound to the original encodeAsString, so the reference encoding is invisible to other wrappers.
 const pristine=Object.create(Encoder.prototype);pristine.encodeAsString=encodeAsString;
 Encoder.prototype.encode=function(p){inside++;try{const r=encode.call(this,p);if(p.data?.[0]==='state:update')stock++;return r;}finally{inside--;}};
 Encoder.prototype.encodeAsString=function(p){const s=encodeAsString.call(this,p);if(!inside&&p.data?.[0]==='state:update'){inside++;try{const ref=encode.call(pristine,p);fast++;bytes+=Buffer.byteLength(s);if(ref.length!==1||ref[0]!==s)mismatches++;}finally{inside--;}}return s;};
 const file=path.join(out,`encoder-${process.pid}.json`),write=()=>fs.writeFileSync(file,JSON.stringify({pid:process.pid,fastPathPackets:fast,stockPathPackets:stock,mismatches,fastPathBytes:bytes}));
 setInterval(write,500).unref();process.on('exit',write);
}
