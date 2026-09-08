(function(){'use strict';
const STATES={idle:{label:'タイトル・通常',line:'……。',duration:4.8,loop:true},thinking:{label:'思考中・ヒント・待った・助言',line:'ここを、よう見てみい。',duration:3.2,loop:true},nod:{label:'頷き（良い手）',line:'',duration:1.6},good:{label:'段階2「良い手じゃな」',line:'良い手じゃな',duration:5.6},doubtful:{label:'段階3「むう…」・王手',line:'むう…',duration:2.6,loop:true},bad:{label:'段階4「それは悪手じゃろう」',line:'それは悪手じゃろう',duration:2.2},angry:{label:'段階5「ばかもーん！」',line:'ばかもーん！',duration:2.2},surprised:{label:'勝ち（オジジが負け）',line:'な、なんじゃと…！',duration:1.6}};
const MANIFEST={heads:{neutral:[36,136,348,326],blink:[421,137,342,327],think:[809,140,339,328],sip:[1172,143,335,326],sour:[36,530,345,328],shout:[426,529,338,332],surprise:[810,535,335,326],brow:[1180,532,339,329]},parts:{body:[8,60,370,412],sleeve:[462,68,242,400],finger:[830,18,226,470],point:[1190,124,289,325],relaxed:[60,624,263,236],cup:[420,566,275,393],cupSip:[795,540,283,425],pointNear:[1195,550,300,422]}};
const clamp=x=>Math.max(0,Math.min(1,x)),ease=x=>{x=clamp(x);return x*x*(3-2*x);},mix=(a,b,t)=>a+(b-a)*t;
function teaPose(t){const lift=ease((t-.35)/1.2)*(1-ease((t-4.0)/1.15));return {lift,sipping:t>1.65&&t<3.95,tilt:ease((t-1.65)/.35)*(1-ease((t-3.65)/.3))};}
function motion(state,t){const s=STATES[state],local=s.loop?t%s.duration:Math.min(t,s.duration);const breathe=Math.sin(local*2*Math.PI/4.8)*1.8;const result={state,t:local,bodyY:breathe,headY:breathe*.7,headAngle:0,face:'neutral',leftAngle:-.08,rightAngle:.08,wrist:0,hand:'relaxed',jump:0,shakeX:0,shakeY:0,scale:1,effects:0};
 if(state==='idle')result.face=(local>3.7&&local<3.84)?'blink':'neutral';
 if(state==='thinking'){result.face='think';result.hand='finger';result.leftAngle=-.13;result.wrist=Math.sin(local*Math.PI*2/3.2)*.20;}
 if(state==='nod'){const n=Math.sin(clamp(local/1.4)*Math.PI);result.face='blink';result.headAngle=n*.14;result.headY+=n*10;}
 if(state==='good'){const tea=teaPose(local);result.face=tea.sipping?'sip':'think';result.hand=tea.tilt>.5?'cupSip':'cup';result.leftAngle=mix(-.05,-1.04,tea.lift);result.wrist=-result.leftAngle;result.headAngle=-tea.tilt*.055;result.headY-=tea.tilt*3;}
 if(state==='doubtful'){const pulse=(local>.55&&local<.66)||(local>.8&&local<.91);result.face='sour';result.brow=pulse;}
 if(state==='bad'){const thrust=ease(local/.48)*(1-ease((local-1.25)/.7));result.face='sour';result.hand=thrust>.68?'pointNear':'point';result.leftAngle=mix(-.08,-.36,thrust);result.wrist=.10*thrust;result.scale=1+.14*thrust;}
 if(state==='angry'){const a=1-ease((local-1.5)/.7);result.face='shout';result.hand='pointNear';result.leftAngle=-.29;result.scale=1.12;result.shakeX=Math.sin(local*77)*4*a;result.shakeY=Math.cos(local*67)*2*a;result.effects=a*(.35+.65*(.5+.5*Math.sin(local*12.56)));}
 if(state==='surprised'){result.face='surprise';result.jump=-34*Math.sin(clamp(local/.7)*Math.PI);result.leftAngle=-.08-.20*Math.sin(clamp(local/.85)*Math.PI);result.rightAngle=-result.leftAngle;result.headAngle=.06*Math.sin(local*14)*Math.exp(-local*4);}
 return result;
}
class RaizoRig extends HTMLElement{
 static get observedAttributes(){return ['state'];}
 constructor(){super();this.attachShadow({mode:'open'});this.shadowRoot.innerHTML='<style>:host{display:block;width:420px;max-width:100%;aspect-ratio:500/620}canvas{display:block;width:100%;height:100%}</style><canvas role="img" aria-label="雷蔵"></canvas>';this.canvas=this.shadowRoot.querySelector('canvas');this.ctx=this.canvas.getContext('2d');this._state='idle';this.time=0;this.paused=false;this.ready=false;this.sprites={};this.reduce=matchMedia('(prefers-reduced-motion:reduce)');this._onFrame=this._onFrame.bind(this);}
 connectedCallback(){this.connected=true;if(!this.loading)this.load();this.last=performance.now();cancelAnimationFrame(this.raf);this.raf=requestAnimationFrame(this._onFrame);}
 disconnectedCallback(){this.connected=false;cancelAnimationFrame(this.raf);}
 attributeChangedCallback(n,o,v){if(o!==v&&v!==this._state)this.play(v);}
 get state(){return this._state;}
 play(state){if(!STATES[state])throw Error('Unknown state: '+state);this._state=state;this.time=0;this.completed=false;if(this.getAttribute('state')!==state)this.setAttribute('state',state);this.canvas.setAttribute('aria-label','雷蔵：'+STATES[state].label);this.renderAt(0);this.dispatchEvent(new CustomEvent('raizo-statechange',{detail:{state}}));}
 pause(){this.paused=true;} resume(){this.paused=false;} seek(t){this.time=Math.max(0,t);this.renderAt(this.time);}
 async load(){this.loading=true;try{if(window.RAIZO_RIG_SPRITES){await Promise.all(Object.entries(window.RAIZO_RIG_SPRITES).map(async([name,src])=>{const img=new Image();img.src=src;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const cx=c.getContext('2d');cx.drawImage(img,0,0);if(name==='teaWrap'){const p=cx.getImageData(0,0,c.width,c.height),d=p.data;for(let i=0;i<d.length;i+=4){const k=Math.min(d[i],d[i+2])-d[i+1];if(k>80)d[i+3]=Math.round(255*(1-clamp((k-80)/90)));}cx.putImageData(p,0,0);}this.sprites[name]=c;}));this.ready=true;this.renderAt(this.time);this.dispatchEvent(new CustomEvent('raizo-ready'));return;}for(const kind of ['heads','parts']){const img=new Image();img.src=window.RAIZO_RIG_ASSETS?.[kind]||new URL(kind+'.png',document.baseURI).href;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(img,0,0);const pixels=x.getImageData(0,0,c.width,c.height),d=pixels.data;for(let i=0;i<d.length;i+=4){const key=Math.min(d[i],d[i+2])-d[i+1];if(key>80){const a=1-clamp((key-80)/90);d[i+3]=Math.round(d[i+3]*a);if(a>0){d[i]=Math.min(d[i],d[i+1]+65);d[i+2]=Math.min(d[i+2],d[i+1]+55);}}}x.putImageData(pixels,0,0);for(const [name,r] of Object.entries(MANIFEST[kind])){const cut=document.createElement('canvas');cut.width=r[2];cut.height=r[3];cut.getContext('2d').drawImage(c,...r,0,0,r[2],r[3]);this.sprites[name]=cut;}}this.ready=true;this.renderAt(this.time);this.dispatchEvent(new CustomEvent('raizo-ready'));}catch(error){this.shadowRoot.innerHTML='<p>雷蔵の素材を読み込めませんでした。</p>';this.dispatchEvent(new CustomEvent('raizo-error',{detail:String(error)}));}}
 // Every part uses translation, rotation and UNIFORM scale. No vertex deformation.
 draw(name,x,y,width,angle=0,ax=.5,ay=.5,flip=false){const img=this.sprites[name],c=this.ctx,h=width*img.height/img.width;c.save();c.translate(x,y);c.rotate(angle);c.scale(flip?-1:1,1);c.drawImage(img,-width*ax,-h*ay,width,h);c.restore();}
 // side is SCREEN side. The sleeve drawing belongs on screen-right:
 // its elbow is outside, while its open cuff points inward.
 arm(side,angle,hand,wrist=0,scale=1,handOnly=false){
 const c=this.ctx,screenLeft=side==='left',mirror=screenLeft?-1:1;
 const shoulder={x:screenLeft?154:346,y:352};
 const tea=hand==='cup'||hand==='cupSip',sleeveWidth=tea?90:106;
 const sleeveHeight=sleeveWidth*this.sprites.sleeve.height/this.sprites.sleeve.width;
 c.save();c.translate(shoulder.x,shoulder.y);c.rotate(angle);
 if(!handOnly)this.draw('sleeve',0,0,sleeveWidth,0,.44,.075,screenLeft);
 // Same source-space shoulder/cuff landmarks are used for both sides.
 // Mirror the joint coordinates together with the sleeve, never independently.
 c.translate(mirror*(.40-.44)*sleeveWidth,(.84-.075)*sleeveHeight);
 c.rotate(wrist);
 if(hand==='relaxed')this.draw(hand,0,0,70,mirror*-.72,.84,.40,screenLeft);
 else if(hand==='finger')this.draw(hand,0,3,73,0,.48,.90,!screenLeft);
 else if(tea)this.draw(hand,0,4,90,0,.66,.90,!screenLeft);
 else this.draw(hand,0,4,100*scale,0,.50,.88,!screenLeft);
 c.restore();
 }
 teaArms(s){
 const p=teaPose(s.t),width=190,top=mix(330,262,p.lift),c=this.ctx;
 // Both wrists follow the same cup pose; sleeves meet those exact anchors.
 for(const screenLeft of [true,false]){
 const shoulder={x:screenLeft?154:346,y:352};
 const wrist={x:250+(screenLeft?-1:1)*width*.29,y:top+width*.82};
 const dx=wrist.x-shoulder.x,dy=wrist.y-shoulder.y;
 const mirror=screenLeft?-1:1;
 const localX=mirror*(.40-.44),localY=(.84-.075)*this.sprites.sleeve.height/this.sprites.sleeve.width;
 const scale=Math.hypot(dx,dy)/Math.hypot(localX,localY);
 const angle=Math.atan2(dy,dx)-Math.atan2(localY,localX);
 this.draw('sleeve',shoulder.x,shoulder.y,scale,angle,.44,.075,screenLeft);
 }
 this.draw('teaWrap',250,top,width,0,.5,0);
 }
 renderAt(seconds){if(!this.ready)return;const dpr=Math.min(devicePixelRatio||1,2),w=Math.round((this.clientWidth||420)*dpr),h=Math.round(w*620/500);if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}const c=this.ctx;c.setTransform(w/500,0,0,h/620,0,0);c.clearRect(0,0,500,620);const s=motion(this._state,this.reduce.matches?0:seconds);c.save();c.translate(s.shakeX,s.jump+s.shakeY);if(s.effects>0){c.save();c.globalAlpha=s.effects;c.strokeStyle='#74381f';c.lineWidth=4;for(let i=0;i<12;i++){const a=i*Math.PI/6+.12;c.beginPath();c.moveTo(250+Math.cos(a)*190,300+Math.sin(a)*185);c.lineTo(250+Math.cos(a)*220,300+Math.sin(a)*225);c.stroke();}c.restore();}
 c.save();c.translate(0,s.bodyY);this.draw('body',250,300,280,0,.5,0);if(this._state!=='good'){this.arm('right',s.rightAngle,'relaxed');this.arm('left',s.leftAngle,s.hand,s.wrist,s.scale);}c.restore();
 // Head is a separately painted rigid part, pivoted at the neck.
 this.draw(s.face,250,337+s.headY,290,s.headAngle,.5,.95);
 // Tea must pass IN FRONT of the lips; redraw that one arm after the head.
 if(this._state==='good'){c.save();c.translate(0,s.bodyY);this.teaArms(s);c.restore();}
 if(s.brow){const source=this.sprites.brow;const target=this.sprites.sour;c.save();c.translate(250,337+s.headY);c.rotate(s.headAngle);const width=290,height=width*target.height/target.width;c.drawImage(source,65,110,213,68,-width*.5+width*65/target.width,-height*.95+height*110/target.height,width*213/target.width,height*68/target.height);c.restore();}c.restore();}
 _onFrame(now){if(!this.connected)return;const dt=Math.min((now-this.last)/1000,.05);this.last=now;if(!this.paused&&!document.hidden)this.time+=dt;this.renderAt(this.time);const s=STATES[this._state];if(!s.loop&&this.time>=s.duration&&!this.completed){this.completed=true;this.dispatchEvent(new CustomEvent('raizo-complete',{detail:{state:this._state}}));}this.raf=requestAnimationFrame(this._onFrame);}
}
window.RaizoRigStates=STATES;window.RaizoRigManifest=MANIFEST;window.RaizoRigMotion=motion;customElements.define('raizo-rig',RaizoRig);
})();
