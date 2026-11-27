import {CharacterAnimator, type Arm, type ArmPose, type Facing, type Point} from './character-animator';

/** Weapon points are in the source weapon SVG viewBox; offset is in native character rig units. */
export interface WeaponConfig {
  weaponId:string; scale:number; nativeFacing:Facing; pivot:Point; offset:Point;
  grip_near:Point; grip_far:Point; muzzle:Point; minAimAngle:number; maxAimAngle:number;
  /** Legacy placement values are accepted; equipped safety order always puts both paws above weapon/body. */
  renderOrder: `before:${Arm|'body'|'foot_far'|'foot_near'}`|'front';
}
export interface WeaponAsset {config:WeaponConfig; svg:SVGSVGElement;}
export type WeaponAvailability = (animator:CharacterAnimator)=>boolean;
const NS='http://www.w3.org/2000/svg';
const ARMS_WEAPON=['arm_far','arm_near'] as const;
const applyPoint=(m:DOMMatrixReadOnly,p:Point):Point=>{const q=m.transformPoint(new DOMPoint(p.x,p.y));return {x:q.x,y:q.y};};
const checked=(n:number,name:string):number=>{if(!Number.isFinite(n))throw new TypeError(name+' must be finite');return n;};
const cap=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
const ease=(t:number)=>{const u=cap(t,0,1);return u*u*(3-2*u);};
const normAngle=(n:number)=>((n+180)%360+360)%360-180;

export type WeaponState='unequipped'|'equipping'|'equipped'|'recoil'|'unequipping';
export interface WeaponMotionConfig {
  equipDurationMs:number; unequipDurationMs:number; lowerDistance:number; lowerAngleDeg:number;
  recoilDistance:number; recoilAngleDeg:number; recoilDurationMs:number; recoveryDurationMs:number; bodyRecoilDeg:number;
}
export const DEFAULT_WEAPON_MOTION:Readonly<WeaponMotionConfig>=Object.freeze({equipDurationMs:200,unequipDurationMs:180,lowerDistance:38,lowerAngleDeg:22,recoilDistance:14,recoilAngleDeg:4,recoilDurationMs:50,recoveryDurationMs:180,bodyRecoilDeg:1.4});
/** Visual attachment only. Caller updates animator first, then this controller, once per frame. */
export class WeaponController {
  private readonly assets=new Map<string,WeaponAsset>();
  private selected:string|null=null;
  private active:string|null=null;
  private node:SVGGElement|null=null;
  private matrix:DOMMatrix|null=null;
  private config:WeaponConfig|null=null;
  private aim=0;
  private originalOrder:Element[]|null=null;
  private recoilOffset=0;
  private motion:WeaponMotionConfig={...DEFAULT_WEAPON_MOTION};
  private state:WeaponState='unequipped';
  private progress=0;
  private recoilElapsed:number|null=null;
  private recoilLevel=0;
  private recoilStop:{from:number;elapsed:number;duration:number}|null=null;
  private recoilMotion:WeaponMotionConfig={...DEFAULT_WEAPON_MOTION};
  private graspReverse:{from:Partial<Record<Arm,ArmPose>>;progress:number;toward:0|1}|null=null;
  private startArms:Partial<Record<Arm,ArmPose>>={};
  private pending:string|null=null;
  private front=false;
  private originalFarOpacity:string|null=null;
  private available:WeaponAvailability=()=>true;
  private overrides:Partial<Record<Arm,ArmPose>>={};
  constructor(private readonly animator:CharacterAnimator, assets:readonly WeaponAsset[],motion:Partial<WeaponMotionConfig>={}){
    this.setMotionConfig(motion);
    for(const a of assets){this.validate(a.config);if(this.assets.has(a.config.weaponId))throw new Error('Duplicate weapon ID');this.assets.set(a.config.weaponId,a);}
  }
  private validate(c:WeaponConfig):void {
    if(!c.weaponId||!['left','right'].includes(c.nativeFacing))throw new TypeError('Invalid weapon identity');
    if(checked(c.scale,'scale')<=0||checked(c.minAimAngle,'minAimAngle')>checked(c.maxAimAngle,'maxAimAngle'))throw new RangeError('Invalid weapon range');
    if(!/^(front|before:(arm_far|arm_near|body|foot_far|foot_near))$/.test(c.renderOrder))throw new Error('Invalid render order');
    for(const key of ['pivot','offset','grip_near','grip_far','muzzle'] as const){checked(c[key].x,key+'.x');checked(c[key].y,key+'.y');}
  }
  setMotionConfig(changes:Partial<WeaponMotionConfig>):void {
    const c={...this.motion,...changes};for(const k of Object.keys(c) as (keyof WeaponMotionConfig)[]){if(checked(c[k],k)<0)throw new RangeError(k+' must be nonnegative');}
    for(const k of ['equipDurationMs','unequipDurationMs','recoilDurationMs','recoveryDurationMs'] as const)if(c[k]<1)throw new RangeError(k+' must be positive');
    this.motion=c;
  }
  getWeaponState():WeaponState {return this.state;}
  canShoot():boolean {return this.state==='equipped'&&this.selected!==null&&this.recoilLevel===0&&this.available(this.animator);}
  playRecoil():boolean {if(!this.canShoot())return false;this.recoilMotion={...this.motion};this.recoilElapsed=0;this.recoilStop=null;this.state='recoil';this.update(0);return true;}
  equip(weaponId:string):boolean {
    const asset=this.assets.get(weaponId);if(!asset)throw new Error('Unknown weapon '+weaponId);
    if(!ARMS_WEAPON.every(n=>this.animator.getArmRig(n)))return false;
    if(this.active&&this.active!==weaponId){this.pending=weaponId;this.selected=null;this.update(0);return true;}
    this.pending=null;this.selected=weaponId;
    if(!this.config||this.config.weaponId!==weaponId){this.config=structuredClone(asset.config);this.aim=cap(this.aim,this.config.minAimAngle,this.config.maxAimAngle);}
    this.update(0);return true;
  }
  unequip():void {this.pending=null;this.selected=null;this.update(0);}
  reset():void {this.pending=null;this.selected=null;this.detach();this.config=null;this.aim=0;this.recoilOffset=0;}
  isEquipped():boolean {return this.state==='equipped'||this.state==='recoil';}
  get selectedWeaponId():string|null {return this.selected;}
  get aimAngle():number {return this.aim;}
  get settings():WeaponConfig|null {return this.config?structuredClone(this.config):null;}
  setAvailability(rule:WeaponAvailability):void {this.available=rule;this.update(0);}
  setAimAngle(angle:number):void {checked(angle,'angle');this.aim=this.config?cap(angle,this.config.minAimAngle,this.config.maxAimAngle):angle;if(this.active!==null)this.update(0);}
  setFacing(direction:Facing):void {this.animator.setFacing(direction);this.update(0);}
  setPlacement(changes:Partial<Pick<WeaponConfig,'scale'|'offset'>>):void {
    if(!this.config)return;const next={...this.config,...changes,offset:{...(changes.offset||this.config.offset)}};this.validate(next);this.config=next;if(this.active!==null)this.update(0);
  }
  /** Optional visual displacement along the barrel, without implementing firing. */
  setRecoilOffset(units:number):void {this.recoilOffset=cap(checked(units,"recoilOffset"),0,12);if(this.active!==null)this.update(0);}
  private setFront(front:boolean):void {
    if(this.front===front||!this.originalOrder||!this.node)return;
    const root=this.animator.attachmentRoot;
    for(const el of this.originalOrder)root.appendChild(el);
    if(front){root.appendChild(this.node);for(const n of ARMS_WEAPON)root.appendChild(root.querySelector(':scope > [data-part="'+n+'"]')!);}
    else root.appendChild(this.node); // hidden during the neutral-order portion
    this.front=front;
  }
  private detach():void {
    if(this.active!==null){
      const far=this.animator.attachmentRoot.querySelector('[data-part="arm_far"]');
      if(far){if(this.originalFarOpacity===null)far.removeAttribute('opacity');else far.setAttribute('opacity',this.originalFarOpacity);}
      this.animator.setWeaponArmPoseImmediate(null);this.animator.setWeaponBodyRecoil(0);this.animator.refreshArmOverrides();
    }
    this.node?.remove();if(this.originalOrder){for(const el of this.originalOrder)if(el.parentNode===this.animator.attachmentRoot)this.animator.attachmentRoot.appendChild(el);this.originalOrder=null;}
    this.node=null;this.active=null;this.matrix=null;this.overrides={};this.startArms={};this.state='unequipped';this.progress=0;this.recoilElapsed=null;this.recoilStop=null;this.recoilLevel=0;this.graspReverse=null;this.front=false;
  }
  private attach(id:string,c:WeaponConfig):void {
    const root=this.animator.attachmentRoot, asset=this.assets.get(id)!;
    const g=root.ownerDocument.createElementNS(NS,'g');g.setAttribute('data-weapon',id);
    // Preserve all source paths/attributes and source coordinate system; nested SVG is an independent asset.
    const svg=root.ownerDocument.importNode(asset.svg,true) as SVGSVGElement;
    const vb=svg.viewBox.baseVal;if(!(vb.width>0&&vb.height>0))throw new Error('Weapon needs a valid viewBox');
    svg.setAttribute('x',String(vb.x));svg.setAttribute('y',String(vb.y));svg.setAttribute('width',String(vb.width));svg.setAttribute('height',String(vb.height));svg.setAttribute('overflow','visible');
    // Imported SVGs with IDs should be instance-namespaced by the asset loader before registration.
    g.appendChild(svg);
    this.originalOrder=Array.from(root.children);
    this.originalFarOpacity=root.querySelector(':scope > [data-part="arm_far"]')!.getAttribute('opacity');
    for(const n of ARMS_WEAPON)this.startArms[n]=this.animator.getAppliedArmPose(n);
    root.appendChild(g);this.node=g;this.active=id;this.front=false;
  }
  private captureGraspReverse(toward:0|1):void {
    const from:Partial<Record<Arm,ArmPose>>={};for(const n of ARMS_WEAPON)from[n]=this.animator.getAppliedArmPose(n);
    this.graspReverse={from,progress:this.progress,toward};
  }
  update(deltaTime:number):void {
    if(checked(deltaTime,'deltaTime')<0)throw new RangeError('deltaTime must be nonnegative');
    let c=this.config,id=this.selected;const wanted=!!(c&&id&&this.available(this.animator));
    if(!this.node){if(!wanted)return;this.attach(id!,c!);this.state='equipping';}
    c=this.config!;const k=this.motion;
    if(!wanted&&this.state!=='unequipping'){
      if(this.progress<.25&&this.progress>0)this.captureGraspReverse(0);
      else this.graspReverse=null;
      this.state='unequipping';this.recoilStop={from:this.recoilLevel,elapsed:0,duration:Math.max(1,this.progress*k.unequipDurationMs)};this.recoilElapsed=null;
    }else if(wanted&&this.state==='unequipping'){
      if(this.progress<.25)this.captureGraspReverse(1);else this.graspReverse=null;
      this.state='equipping';
    }
    if(this.recoilElapsed!==null){this.recoilElapsed+=deltaTime;const t=this.recoilElapsed,r=this.recoilMotion;
      this.recoilLevel=t<r.recoilDurationMs?ease(t/r.recoilDurationMs):1-ease((t-r.recoilDurationMs)/r.recoveryDurationMs);
      if(t>=r.recoilDurationMs+r.recoveryDurationMs){this.recoilElapsed=null;this.recoilLevel=0;if(this.state==='recoil')this.state='equipped';}
    }
    if(this.recoilStop){this.recoilStop.elapsed+=deltaTime;this.recoilLevel=this.recoilStop.from*(1-ease(this.recoilStop.elapsed/this.recoilStop.duration));if(this.recoilLevel===0)this.recoilStop=null;}
    if(this.state==='equipping'){this.progress=cap(this.progress+deltaTime/k.equipDurationMs,0,1);if(this.progress>=1-1e-10){this.progress=1;this.state='equipped';}}
    if(this.state==='unequipping'){this.progress=cap(this.progress-deltaTime/k.unequipDurationMs,0,1);if(this.progress<=1e-10){this.detach();if(!this.selected){this.config=null;this.recoilOffset=0;}const next=this.pending;this.pending=null;if(next)this.equip(next);return;}}
    // First/last quarter: concealed prop, arms acquire/release a rigid two-point grip.
    // Remaining travel: both grips exact, weapon revealed at the lowered pose, then lifted.
    const grasp=.25,p=this.progress,lift=ease((p-grasp)/(1-grasp)),gripWeight=ease(p/grasp);
    const front=p>=.125;this.setFront(front);
    // Only during concealed grasp, soften the occlusion change as the far paw crosses the body layer.
    const far=this.animator.attachmentRoot.querySelector('[data-part="arm_far"]')!;
    const farFade=p<grasp?1-ease(1-Math.abs(p-.125)/.125):1;
    if(farFade===1){if(this.originalFarOpacity===null)far.removeAttribute('opacity');else far.setAttribute('opacity',this.originalFarOpacity);}
    else far.setAttribute('opacity',String(farFade*(this.originalFarOpacity===null?1:Number(this.originalFarOpacity))));
    const recoil=this.recoilMotion;
    const nativeSign=this.animator.getNativeFacing()==='left'?1:-1;
    this.animator.setWeaponBodyRecoil(nativeSign*recoil.bodyRecoilDeg*this.recoilLevel);
    const body=this.animator.getBodyFrame(),inverse=body.inverse(), facing=this.animator.direction;
    const mount=applyPoint(body,{x:c.offset.x,y:c.offset.y+k.lowerDistance*(1-lift)}),sign=facing==='left'?-1:1,mirror=c.nativeFacing===facing?1:-1;
    const aim=cap(this.aim-k.lowerAngleDeg*(1-lift),c.minAimAngle,c.maxAimAngle)+recoil.recoilAngleDeg*this.recoilLevel;
    const m=new DOMMatrix().translateSelf(mount.x,mount.y).rotateSelf(-sign*aim).translateSelf(-sign*(this.recoilOffset+recoil.recoilDistance*this.recoilLevel),0).scaleSelf(c.scale*mirror,c.scale).translateSelf(-c.pivot.x,-c.pivot.y);
    this.matrix=m;this.node!.setAttribute('transform',`matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`);
    const poses:Partial<Record<Arm,ArmPose>>={};
    for(const n of ARMS_WEAPON){
      const rig=this.animator.getArmRig(n)!;const target=applyPoint(inverse,applyPoint(m,n==='arm_near'?c.grip_near:c.grip_far));
      const {pivot:pv,grip:g}=rig,dx=g.x-pv.x,dy=g.y-pv.y;
      const wm=inverse.multiply(m),nativeWeaponSign=c.nativeFacing==='right'?1:-1,nativeForward=this.animator.getNativeFacing()==='left'?-1:1;
      let angle=normAngle(Math.atan2(wm.b*nativeWeaponSign,wm.a*nativeWeaponSign)*180/Math.PI-(nativeForward===-1?180:0));
      const prev=this.overrides[n]?.angle;if(prev!==undefined)angle=prev+normAngle(angle-prev);
      const a=angle*Math.PI/180,gx=pv.x+dx*Math.cos(a)-dy*Math.sin(a),gy=pv.y+dx*Math.sin(a)+dy*Math.cos(a);
      const dest={x:target.x-gx,y:target.y-gy,angle};this.overrides[n]=dest;
      const base=this.state==='unequipping'?this.animator.getBaseArmPose(n):this.startArms[n]||this.animator.getBaseArmPose(n);
      const mix=(from:ArmPose,to:ArmPose,t:number):ArmPose=>({x:from.x+(to.x-from.x)*t,y:from.y+(to.y-from.y)*t,angle:from.angle+normAngle(to.angle-from.angle)*t});
      const turn=this.graspReverse;
      if(p<grasp&&turn?.from[n]){
        const u=turn.toward===1?ease((p-turn.progress)/Math.max(1e-9,grasp-turn.progress)):ease((turn.progress-p)/Math.max(1e-9,turn.progress));
        poses[n]=mix(turn.from[n]!,turn.toward===1?dest:this.animator.getBaseArmPose(n),u);
      }else poses[n]=mix(base,dest,gripWeight);
    }
    if(p>=grasp)this.graspReverse=null;
    this.animator.setWeaponArmPoseImmediate(poses);this.animator.refreshArmOverrides();
    this.node!.setAttribute('opacity',String(ease((p-grasp)/.12)));
  }
  getAnchors():{pivot:Point;grip_near:Point;grip_far:Point;muzzle:Point}|null {
    if(!this.matrix||!this.config||this.progress<=.25)return null;const m=this.animator.getRootFrame().multiply(this.matrix),c=this.config;
    return {pivot:applyPoint(m,c.pivot),grip_near:applyPoint(m,c.grip_near),grip_far:applyPoint(m,c.grip_far),muzzle:applyPoint(m,c.muzzle)};
  }
  getMuzzlePosition():Point|null {return this.getAnchors()?.muzzle||null;}
  /** Unit vector in assembled SVG coordinates (including global character rotation). */
  getAimDirection():Point|null {
    if(!this.matrix||!this.config||this.progress<=.25)return null;const m=this.animator.getRootFrame().multiply(this.matrix),sign=this.config.nativeFacing==='right'?1:-1;
    const length=Math.hypot(m.a,m.b);return {x:sign*m.a/length,y:sign*m.b/length};
  }
  /** Cursor in assembled SVG user coordinates; positive angles mean upward relative to facing. */
  aimAt(target:Point):void {
    if(!this.config)return;const a=applyPoint(this.animator.getRootFrame().inverse(),target),p=applyPoint(this.animator.getBodyFrame(),this.config.offset);
    const sign=this.animator.direction==='left'?-1:1;
    const u=sign*(a.x-p.x),v=a.y-p.y,r=Math.hypot(u,v);
    if(r<1e-8)return;
    // Aim the actual muzzle ray, not merely the line from the mount. The transverse
    // offset is invariant under the horizontal facing reflection.
    const transverse=(this.config.muzzle.y-this.config.pivot.y)*this.config.scale;
    const angle=Math.atan2(-v,u)+Math.asin(cap(transverse/r,-1,1));
    this.setAimAngle(normAngle(angle*180/Math.PI));
  }
}
