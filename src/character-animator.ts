/**
 * Three- or five-part SVG IDLE / WALK / JUMP / BACKFLIP controller. No renderer, scheduler or framework dependency.
 * deltaTime: milliseconds; movementSpeed: nonnegative SVG user units / second.
 * Move the world/container by movementSpeed * deltaTime / 1000 in the facing
 * direction. Do not separately scale time: use the same speed for both systems.
 * Convert world pixels/sec to SVG units/sec when the rendered scale is not 1:1.
 * Only the outer part transforms and a runtime rotation wrapper are written; inner art is untouched.
 * BACKFLIP uses externally supplied normalized flight progress (monotonic 0..1),
 * notifyFlightProgress(p) or notifyAirborne(vy, proximity, p). No flight timer.
 * cancelJump() cancels preparation or settles an interrupted airborne action;
 * contact must still be confirmed externally. notifyCollision(grounded) is a convenience.
 * Use an inline SVG with an unclipped ancestor or a sufficiently padded render target.
 * stopWalk blends to IDLE; resetPose restores the exact original outer transforms.
 * update must be called in IDLE and JUMP too. World movement remains the caller’s responsibility.
 * JUMP: playJump(); wait for isReadyForTakeoff; notifyTakeoff() at physics impulse;
 * call notifyAirborne(vy, proximity) with world vertical velocity (down-positive)
 * and optional contact proximity 0..1; notifyLanding() at confirmed ground contact.
 * The root/world trajectory is never moved by this controller. Flight has no timeout.
 * playIdle/playWalk while jumping queue locomotion after recovery.
 * BACKFLIP: playBackflip(); wait for isReadyForTakeoff (or cancelJump());
 * notifyTakeoff() at the physical impulse; each tick supply external flight progress
 * via notifyAirborne(vy, proximity, progress), then update(deltaTime, movementSpeed).
 * isJumping covers both airborne actions; backflipPhase is the seven-phase readout.
 * A non-ground collision uses notifyCollision(false); ground contact uses notifyLanding().
 * Early landing eases to the nearest upright orientation; the physical caller owns
 * collision clearance and any world-position correction. Angle is reset only at identity.
 * Instantiate one animator per inline SVG instance; runtime wrapper is not source art.
 */
export type Facing = 'left' | 'right';
export type Foot = 'foot_far' | 'foot_near';
export type Arm = 'arm_far' | 'arm_near';
const ARMS = ['arm_far','arm_near'] as const;
export interface ArmPose { x: number; y: number; angle: number }
export interface ArmsConfig {
  enabled: boolean; intensity: number;
  idleSwayDeg: number;
  walkSwingDeg: number; walkShift: number;
  jumpTakeoffDeg: number; jumpAirDeg: number; jumpLift: number;
  backflipTuckDeg: number; backflipLift: number; backflipInward: number;
  overrideBlendMs: number;
}
export const DEFAULT_ARMS: Readonly<ArmsConfig> = Object.freeze({
  enabled:true, intensity:1, idleSwayDeg:1.6, walkSwingDeg:10, walkShift:2.5,
  jumpTakeoffDeg:9, jumpAirDeg:6, jumpLift:2,
  backflipTuckDeg:12, backflipLift:3, backflipInward:3, overrideBlendMs:125
});
const armNeutral = (): ArmPose => ({x:0,y:0,angle:0});
const mixArm = (a:ArmPose,b:ArmPose,w:number): ArmPose => ({x:a.x+(b.x-a.x)*w,y:a.y+(b.y-a.y)*w,angle:a.angle+(b.angle-a.angle)*w});

export interface Point { x: number; y: number }
export interface RigPart { pivot?: Point; position?: Point; rotation_deg?: number; svg_id?: string; data_part?: string; pivotX?: number; pivotY?: number; grip?: Point; gripX?: number; gripY?: number }
export interface CharacterRig {
  viewBox: readonly number[];
  coordinate_system?: { forward?: string };
  parts: Record<Foot | 'body', RigPart> & Partial<Record<Arm,RigPart>>;
}
export interface WalkConfig {
  cycleDurationMs: number;
  /** One-sided horizontal reach; nominal stance travel = 2 * stepAmplitude. */
  stepAmplitude: number;
  liftHeight: number;
  footRotationDeg: number;
  bodyBob: number;
  bodyTiltDeg: number;
  squashStretch: number;
  stanceRatio: number;
  phaseOffset: number;
  bodyPivot?: Point;
  groundY?: number;
  /** Optional lower silhouette support points, in global SVG coordinates.
   * For clipped artwork supply these to prevent rotated toes penetrating ground.
   * Without them a conservative pivot-centred approximation is used. */
  solePoints?: Partial<Record<Foot, readonly Point[]>>;
}
export const DEFAULT_WALK: Readonly<WalkConfig> = Object.freeze({
  cycleDurationMs: 580, stepAmplitude: 14, liftHeight: 11, footRotationDeg: 12,
  bodyBob: 4, bodyTiltDeg: 2.2, squashStretch: 0.009, stanceRatio: 0.6, phaseOffset: 0.5
});
export interface IdleConfig {
  cycleDurationMs: number;
  heightChange: number;
  widthChange: number;
  bodyBob: number;
  intensity: number;
  transitionDurationMs: number;
}
export const DEFAULT_IDLE: Readonly<IdleConfig> = Object.freeze({
  cycleDurationMs: 2000, heightChange: 0.02, widthChange: 0.01,
  bodyBob: 2, intensity: 1, transitionDurationMs: 125
});
export interface JumpConfig {
  anticipationDurationMs: number;
  anticipationSquash: number;
  anticipationWiden: number;
  anticipationDrop: number;
  anticipationIntensity: number;
  takeoffDurationMs: number;
  takeoffStretch: number;
  takeoffNarrow: number;
  airborneBlendMs: number;
  airborneFootLift: number;
  airborneFootRotationDeg: number;
  footTuckIntensity: number;
  bodyTiltDeg: number;
  landingDurationMs: number;
  landingSquash: number;
  landingWiden: number;
  landingDrop: number;
  landingIntensity: number;
  recoveryDurationMs: number;
}
export const DEFAULT_JUMP: Readonly<JumpConfig> = Object.freeze({
  anticipationDurationMs:100, anticipationSquash:.12, anticipationWiden:.06,
  anticipationDrop:2, anticipationIntensity:1,
  takeoffDurationMs:70, takeoffStretch:.08, takeoffNarrow:.04,
  airborneBlendMs:85, airborneFootLift:14, airborneFootRotationDeg:15,
  footTuckIntensity:1, bodyTiltDeg:5, landingDurationMs:135,
  landingSquash:.10, landingWiden:.05, landingDrop:3, landingIntensity:1,
  recoveryDurationMs:125
});
export type JumpPhase = 'anticipation' | 'takeoff' | 'airborne' | 'falling' | 'landing' | 'recovery';
export type BackflipPhase = 'anticipation' | 'takeoff' | 'tuck' | 'rotation' | 'untuck' | 'landing' | 'recovery';
export interface BackflipConfig {
  anticipationDurationMs: number; anticipationSquash: number; anticipationWiden: number;
  anticipationDrop: number; anticipationIntensity: number; takeoffDurationMs: number;
  takeoffStretch: number; takeoffNarrow: number; tuckLift: number; tuckRotationDeg: number;
  tuckIntensity: number; tuckSquash: number; tuckWiden: number;
  rotationAngleDeg: number; rotationSpeed: number; rotationStart: number; rotationEnd: number;
  tuckEnd: number; untuckStart: number; landingDurationMs: number; landingSquash: number;
  landingWiden: number; landingDrop: number; landingIntensity: number; recoveryDurationMs: number;
  interruptDurationMs: number; rotationPivot?: Point;
}
export const DEFAULT_BACKFLIP: Readonly<BackflipConfig> = Object.freeze({
  anticipationDurationMs:120, anticipationSquash:.15, anticipationWiden:.08,
  anticipationDrop:2, anticipationIntensity:1, takeoffDurationMs:70,
  takeoffStretch:.08, takeoffNarrow:.04, tuckLift:19, tuckRotationDeg:20,
  tuckIntensity:1, tuckSquash:.035, tuckWiden:.025, rotationAngleDeg:360,
  rotationSpeed:1, rotationStart:.08, rotationEnd:.90, tuckEnd:.24, untuckStart:.76,
  landingDurationMs:150, landingSquash:.12, landingWiden:.06, landingDrop:3,
  landingIntensity:1, recoveryDurationMs:125, interruptDurationMs:150
});
export type AnimationState = 'neutral' | 'idle' | 'walk' | 'jump' | 'backflip';
type Locomotion = 'idle' | 'walk';
export interface FootPose { x: number; y: number; angle: number; planted: boolean }
export interface WalkPose { arms?: Partial<Record<Arm,ArmPose>>; foot_far: FootPose; foot_near: FootPose; body: { y: number; angle: number; sx: number; sy: number } }
const TAU = 2 * Math.PI;
const mod = (x: number) => ((x % 1) + 1) % 1;
const fmt = (n: number) => Math.abs(n) < 0.0000005 ? '0' : String(+n.toFixed(6));
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const finite = (n: number, label: string) => { if (!Number.isFinite(n)) throw new TypeError(label + ' must be finite'); return n; };
const point = (p: Point | undefined, label: string): Point => {
  if (!p) throw new Error('Missing ' + label);
  return {x: finite(p.x, label + '.x'), y: finite(p.y, label + '.y')};
};
export function nominalMovementSpeed(c: WalkConfig): number {
  return 2000 * c.stepAmplitude / (c.stanceRatio * c.cycleDurationMs);
}
function validate(c: WalkConfig): WalkConfig {
  for (const k of ['cycleDurationMs','stepAmplitude','liftHeight','footRotationDeg','bodyBob','bodyTiltDeg','squashStretch','stanceRatio','phaseOffset'] as const) finite(c[k], k);
  if (c.cycleDurationMs <= 0 || c.stepAmplitude <= 0 || c.liftHeight < 0 || c.footRotationDeg < 0 || c.bodyBob < 0 || c.bodyTiltDeg < 0 || c.squashStretch < 0 || c.squashStretch >= 1 || c.stanceRatio < 0.5 || c.stanceRatio >= 1 || c.phaseOffset !== 0.5) throw new RangeError('Invalid WALK configuration (phaseOffset must be 0.5)');
  if (c.bodyPivot) point(c.bodyPivot, 'bodyPivot');
  for (const foot of ['foot_far','foot_near'] as const) for (const p of c.solePoints?.[foot] || []) point(p, foot + ' sole');
  return c;
}
function validateIdle(c: IdleConfig): IdleConfig {
  for (const k of ['cycleDurationMs','heightChange','widthChange','bodyBob','intensity','transitionDurationMs'] as const) finite(c[k], k);
  if (c.cycleDurationMs <= 0 || c.heightChange < 0 || c.heightChange > .02 || c.widthChange < 0 || c.widthChange > .01 || c.bodyBob < 0 || c.bodyBob > 2 || c.intensity < 0 || c.intensity > 1 || c.transitionDurationMs < 100 || c.transitionDurationMs > 150) throw new RangeError('Invalid IDLE configuration');
  return c;
}
function validateJump(c: JumpConfig): JumpConfig {
  const durations = ['anticipationDurationMs','takeoffDurationMs','airborneBlendMs','landingDurationMs','recoveryDurationMs'] as const;
  for (const k of durations) if (finite(c[k], k) <= 0) throw new RangeError(k + ' must be positive');
  const limits: Partial<Record<keyof JumpConfig, number>> = {
    anticipationSquash:.25, anticipationWiden:.20, anticipationDrop:12, anticipationIntensity:1,
    takeoffStretch:.20, takeoffNarrow:.15, airborneFootLift:18, airborneFootRotationDeg:15,
    footTuckIntensity:1, bodyTiltDeg:5, landingSquash:.25, landingWiden:.20, landingDrop:12, landingIntensity:1
  };
  for (const k of Object.keys(limits) as (keyof JumpConfig)[]) {
    if (finite(c[k], k) < 0 || c[k] > limits[k]!) throw new RangeError('Invalid JUMP parameter: ' + k);
  }
  return c;
}
function validateBackflip(c: BackflipConfig): BackflipConfig {
  for (const k of ['anticipationDurationMs','takeoffDurationMs','landingDurationMs','recoveryDurationMs','interruptDurationMs'] as const)
    if (finite(c[k],k)<=0) throw new RangeError(k+' must be positive');
  const limits: Partial<Record<keyof BackflipConfig,number>> = {
    anticipationSquash:.25, anticipationWiden:.2, anticipationDrop:12, anticipationIntensity:1,
    takeoffStretch:.2, takeoffNarrow:.15, tuckLift:22, tuckRotationDeg:20, tuckIntensity:1,
    tuckSquash:.10, tuckWiden:.10, landingSquash:.25, landingWiden:.20, landingDrop:12, landingIntensity:1
  };
  for (const k of Object.keys(limits) as (keyof BackflipConfig)[]) {
    const v=c[k] as number; if(finite(v,k)<0||v>limits[k]!) throw new RangeError('Invalid BACKFLIP parameter: '+k);
  }
  if(finite(c.rotationAngleDeg,'rotationAngleDeg')<=0||c.rotationAngleDeg%360!==0||c.rotationAngleDeg>360)
    throw new RangeError('BACKFLIP requires one complete 360 degree turn');
  if(finite(c.rotationSpeed,'rotationSpeed')<.5||c.rotationSpeed>2) throw new RangeError('rotationSpeed must be .5..2');
  for(const k of ['rotationStart','rotationEnd','tuckEnd','untuckStart'] as const) if(finite(c[k],k)<0||c[k]>1) throw new RangeError(k+' must be 0..1');
  if(c.rotationStart>=c.rotationEnd||c.tuckEnd<=0||c.untuckStart<c.tuckEnd||c.untuckStart>=1) throw new RangeError('Invalid BACKFLIP flight windows');
  if(c.rotationPivot) point(c.rotationPivot,'rotationPivot');
  return c;
}
const smooth = (t: number) => { const u = clamp(t,0,1); return u*u*(3-2*u); };
function neutralPose(): WalkPose {
  return {foot_far: {x:0,y:0,angle:0,planted:true}, foot_near:{x:0,y:0,angle:0,planted:true}, body:{y:0,angle:0,sx:1,sy:1}};
}
function blendPose(a: WalkPose, b: WalkPose, w: number): WalkPose {
  if (w <= 0) return a;
  if (w >= 1) return b;
  const mix = (x:number,y:number) => x+(y-x)*w;
  const foot = (x:FootPose,y:FootPose): FootPose => ({x:mix(x.x,y.x),y:mix(x.y,y.y),angle:mix(x.angle,y.angle),planted:x.planted && y.planted});
  const result: WalkPose = {foot_far:foot(a.foot_far,b.foot_far),foot_near:foot(a.foot_near,b.foot_near),body:{y:mix(a.body.y,b.body.y),angle:mix(a.body.angle,b.body.angle),sx:mix(a.body.sx,b.body.sx),sy:mix(a.body.sy,b.body.sy)}};
  if(a.arms||b.arms){result.arms={};for(const n of ARMS)if(a.arms?.[n]||b.arms?.[n])result.arms[n]=mixArm(a.arms?.[n]||armNeutral(),b.arms?.[n]||armNeutral(),w);}
  return result;
}
export class CharacterAnimator {
  private readonly groups: Record<Foot | 'body', SVGGElement>;
  private readonly armGroups: Partial<Record<Arm,SVGGElement>> = {};
  private readonly armOriginal: Partial<Record<Arm,string|null>> = {};
  private readonly armPivots: Partial<Record<Arm,Point>> = {};
  private readonly armGrips: Partial<Record<Arm,Point>> = {};
  private armsConfig: ArmsConfig;
  private armWeight = 1;
  private armWeightFrom = 1;
  private armWeightElapsed = 125;
  private armOverrides: Partial<Record<Arm,{pose:ArmPose;from:ArmPose;weight:number;fromWeight:number;targetWeight:number;elapsed:number}>> = {};
  private weaponArmOwner = false;
  // Direct, frame-owned visual grip channel. Base pose and clocks remain untouched.
  private weaponDirect: Partial<Record<Arm,ArmPose>> | null = null;
  private weaponBodyRecoil = 0;
  private appliedArms: Partial<Record<Arm,ArmPose>> = {};

  private readonly root: SVGGElement;
  private readonly defaultRotationPivot: Point;
  private backflipConfig: BackflipConfig;
  private backflipActive: BackflipConfig | null = null;
  private flightProgress = 0;
  private backAngle = 0; // unsigned rotation in the native backward direction
  private settleFrom = 0;
  private settleTo = 0;
  private interrupted: {from: WalkPose; angle: number; target: number; elapsed: number} | null = null;
  private launchPose: WalkPose = neutralPose();
  private readonly original: Record<Foot | 'body', string | null>;
  private readonly pivots: Record<Foot, Point>;
  private readonly nativeFacing: Facing;
  private readonly box: readonly number[];
  private readonly nativeSign: number;
  private config: WalkConfig;
  private facing: Facing;
  private phase = 0;
  private idleConfig: IdleConfig;
  private idlePhase = 0;
  private state: AnimationState = 'neutral';
  private requested: 'neutral' | Locomotion = 'neutral';
  private jumpConfig: JumpConfig;
  private jumpActive: JumpConfig | null = null;
  private jumpStage: JumpPhase | null = null;
  private jumpElapsed = 0;
  private jumpCancelled=false;
  private jumpFrom: WalkPose = neutralPose();
  private verticalVelocity = 0;
  private landingProximity = 0;
  private recoveryTarget: Locomotion | null = null;
  private transition: {from: WalkPose; elapsed: number; duration: number} | null = null;
  private lastPose: WalkPose | null = null;

  constructor(svg: SVGSVGElement, rig: CharacterRig, config: Partial<WalkConfig> = {}, idleConfig: Partial<IdleConfig> = {}, jumpConfig: Partial<JumpConfig> = {}, backflipConfig: Partial<BackflipConfig> = {}, armsConfig: Partial<ArmsConfig> = {}) {
    this.box = Array.from(rig.viewBox);
    if (this.box.length !== 4 || this.box.some(n => !Number.isFinite(n)) || this.box[2] <= 0 || this.box[3] <= 0) throw new Error('Invalid rig.viewBox');
    this.nativeFacing = rig.coordinate_system?.forward === 'right' ? 'right' : 'left';
    this.nativeSign = this.nativeFacing === 'left' ? -1 : 1;
    this.facing = this.nativeFacing;
    const group = (name: Foot | 'body') => {
      const g = Array.from(svg.children).find(el => el.localName === 'g' && el.getAttribute('data-part') === name);
      if (!g) throw new Error('Missing outer SVG group: ' + name);
      return g as SVGGElement;
    };
    this.groups = {foot_far: group('foot_far'), body: group('body'), foot_near: group('foot_near')};
    this.original = {foot_far: this.groups.foot_far.getAttribute('transform'), body: this.groups.body.getAttribute('transform'), foot_near: this.groups.foot_near.getAttribute('transform')};
    this.pivots = {foot_far: point(rig.parts.foot_far.pivot, 'foot_far pivot'), foot_near: point(rig.parts.foot_near.pivot, 'foot_near pivot')};
    this.armsConfig = this.validateArms({...DEFAULT_ARMS,...armsConfig});
    this.armWeight=this.armWeightFrom=this.armsConfig.enabled?this.armsConfig.intensity:0;this.armWeightElapsed=this.armsConfig.overrideBlendMs;
    for(const n of ARMS){
      const g=Array.from(svg.children).find(el=>el.localName==='g'&&el.getAttribute('data-part')===n) as SVGGElement|undefined;
      if(!g)continue;
      const r=rig.parts[n]; if(!r)throw new Error('Missing rig part '+n);
      this.armGroups[n]=g; this.armOriginal[n]=g.getAttribute('transform');
      this.armPivots[n]=point(r.pivot||(r.pivotX!==undefined&&r.pivotY!==undefined?{x:r.pivotX,y:r.pivotY}:undefined),n+' pivot');
      const grip=r.grip||(r.gripX!==undefined&&r.gripY!==undefined?{x:r.gripX,y:r.gripY}:undefined);
      if(grip)this.armGrips[n]=point(grip,n+' grip');
    }
    this.config = validate({...DEFAULT_WALK, ...config});
    this.idleConfig = validateIdle({...DEFAULT_IDLE, ...idleConfig});
    this.jumpConfig = validateJump({...DEFAULT_JUMP, ...jumpConfig});
    this.backflipConfig = validateBackflip({...DEFAULT_BACKFLIP,...backflipConfig});
    // Bounding-box centre of the primary mass; a per-race override is recommended.
    let center={x:this.box[0]+this.box[2]/2,y:this.box[1]+this.box[3]*.46};
    try {const b=this.groups.body.getBBox(); if(b.width>0&&b.height>0) center={x:b.x+b.width/2,y:b.y+b.height/2};} catch { /* detached SVG fallback */ }
    this.defaultRotationPivot=center;
    this.root=svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg','g');
    this.root.setAttribute('data-animation-root','rotation');
    const ordered=Array.from(svg.children).filter(el=>[...Object.values(this.groups),...Object.values(this.armGroups)].some(g=>g===el));
    svg.insertBefore(this.root,ordered[0]); ordered.forEach(el=>this.root.appendChild(el));
    svg.style.overflow='visible';
    this.phase = this.config.stanceRatio / 2;
  }
  private validateArms(c:ArmsConfig): ArmsConfig {
    if(typeof c.enabled!=='boolean')throw new TypeError('arms enabled must be boolean');
    const limits = {intensity:1,idleSwayDeg:2,walkSwingDeg:12,walkShift:6,jumpTakeoffDeg:20,jumpAirDeg:20,jumpLift:8,backflipTuckDeg:25,backflipLift:10,backflipInward:10,overrideBlendMs:1000} as const;
    for(const k of Object.keys(limits) as (keyof typeof limits)[])if(finite(c[k],k)<0||c[k]>limits[k])throw new RangeError('Invalid ARMS '+k);
    if(c.overrideBlendMs<1)throw new RangeError('overrideBlendMs must be positive');return c;
  }
  get hasArms(): boolean {return ARMS.some(n=>!!this.armGroups[n]);}
  setArmsConfig(config:Partial<ArmsConfig>): void {
    const old=this.armsConfig;this.armsConfig=this.validateArms({...old,...config});
    if(old.enabled!==this.armsConfig.enabled||old.intensity!==this.armsConfig.intensity){this.armWeightFrom=this.armWeight;this.armWeightElapsed=0;}
  }
  /** Disable independent swings, not body attachment. Changes blend on external update. */
  setArmsEnabled(enabled:boolean):void {this.setArmsConfig({enabled});}
  /** Future weapon pose in native SVG coordinates, relative to the moving body.
   * null releases the override; undefined leaves that arm unchanged. No weapon logic. */
  setArmOverride(overrides:Partial<Record<Arm,ArmPose|null>>):void {
    if(this.weaponArmOwner)return;
    this.retargetArmOverrides(overrides);
  }
  /** Weapon ownership takes priority over base motion and generic overrides. */
  setWeaponArmOverride(overrides:Partial<Record<Arm,ArmPose|null>>):void {
    if(!this.weaponArmOwner){this.armOverrides={};this.weaponArmOwner=true;}
    this.retargetArmOverrides(overrides);
  }
  releaseWeaponArmOverride():void {
    this.weaponDirect=null;
    this.weaponArmOwner=false;this.retargetArmOverrides({arm_near:null,arm_far:null});
  }
  /** Exact local arm pose, before mirror/body/global rotation. */
  getAppliedArmPose(n:Arm):ArmPose {return {...(this.appliedArms[n]||armNeutral())};}
  getBaseArmPose(n:Arm):ArmPose {return mixArm(armNeutral(),this.lastPose?.arms?.[n]||armNeutral(),this.armWeight);}
  /** Grip controller owns the blend clock; this setter never restarts it. */
  setWeaponArmPoseImmediate(poses:Partial<Record<Arm,ArmPose>>|null):void {
    if(poses){for(const v of Object.values(poses))if(v)for(const k of ['x','y','angle'] as const)finite(v[k],k);}
    this.weaponDirect=poses?structuredClone(poses):null;this.weaponArmOwner=!!poses;this.armOverrides={};
  }
  /** Additive visual tilt only, in native body space; not written into WalkPose. */
  setWeaponBodyRecoil(angle:number):void {this.weaponBodyRecoil=finite(angle,'weapon body recoil');}
  private visualBody(pose:WalkPose):WalkPose['body'] {return {...pose.body,angle:pose.body.angle+this.weaponBodyRecoil};}
  private retargetArmOverrides(overrides:Partial<Record<Arm,ArmPose|null>>):void {
    for(const n of ARMS){const v=overrides[n];if(v===undefined||!this.armGroups[n])continue;
      const old=this.armOverrides[n];const from=this.appliedArms[n]||armNeutral();
      if(v){
        for(const k of ['x','y','angle'] as const)finite(v[k],n+' '+k);
        if(old?.targetWeight===1) { old.pose={...v}; } // retarget, never restart an active blend
        else this.armOverrides[n]={pose:{...v},from:{...from},weight:0,fromWeight:0,targetWeight:1,elapsed:0};
      } else if(old?.targetWeight===1) this.armOverrides[n]={pose:{...from},from:{...from},weight:1,fromWeight:1,targetWeight:0,elapsed:0};
    }
  }
  /** Refresh targets in the same frame, without advancing any animation or blend clock. */
  refreshArmOverrides():void {
    if(this.lastPose)this.render(this.lastPose);else {this.render(neutralPose());this.lastPose=null;}
  }
  /** Runtime group in which an independent prop may be inserted. Rotation is inherited once. */
  get attachmentRoot():SVGGElement {return this.root;}
  /** Assembled native rig space -> runtime root coordinates, excluding global rotation. */
  getBodyFrame():DOMMatrix {
    const b=this.visualBody(this.lastPose||neutralPose());
    const p=this.config.bodyPivot||{x:(this.pivots.foot_far.x+this.pivots.foot_near.x)/2,y:(this.pivots.foot_far.y+this.pivots.foot_near.y)/2};
    const m=new DOMMatrix();
    if(this.facing!==this.nativeFacing)m.translateSelf(2*this.box[0]+this.box[2],0).scaleSelf(-1,1);
    return m.translateSelf(0,b.y).translateSelf(p.x,p.y).rotateSelf(b.angle).scaleSelf(b.sx,b.sy).translateSelf(-p.x,-p.y);
  }
  /** Rig pivots and grips, before body / local / facing transformations. */
  getArmRig(n:Arm):{pivot:Point;grip:Point}|null {
    const pivot=this.armPivots[n],grip=this.armGrips[n];return pivot&&grip?{pivot:{...pivot},grip:{...grip}}:null;
  }
  getArmOverrideWeight(n:Arm):number {return this.weaponDirect?.[n]?1:this.armOverrides[n]?.weight||0;}
  /** Runtime root -> assembled SVG coordinates (no CSS/world placement). */
  getRootFrame():DOMMatrix {const p=this.rotationPivot;return new DOMMatrix().translateSelf(p.x,p.y).rotateSelf(this.rotationAngle).translateSelf(-p.x,-p.y);}
  private advanceArms(dt:number):void {
    const ms=this.armsConfig.overrideBlendMs;
    this.armWeightElapsed=Math.min(ms,this.armWeightElapsed+dt);
    const dest=this.armsConfig.enabled?this.armsConfig.intensity:0;
    this.armWeight=this.armWeightFrom+(dest-this.armWeightFrom)*smooth(this.armWeightElapsed/ms);
    for(const n of ARMS){const o=this.armOverrides[n];if(!o)continue;o.elapsed=Math.min(ms,o.elapsed+dt);o.weight=o.fromWeight+(o.targetWeight-o.fromWeight)*smooth(o.elapsed/ms);if(o.targetWeight===0&&o.elapsed===ms)delete this.armOverrides[n];}
  }
  private withArms(p:WalkPose,fn:(n:Arm)=>ArmPose):WalkPose {
    if(this.hasArms){p.arms={};for(const n of ARMS)if(this.armGroups[n])p.arms[n]=fn(n);}return p;
  }
  get isWalking(): boolean { return this.state === 'walk'; }
  get animationState(): AnimationState { return this.state; }
  get isTransitioning(): boolean { return this.transition !== null; }
  get transitionProgress(): number { return this.transition ? this.transition.elapsed / this.transition.duration : 1; }
  get currentPhase(): number { return this.state === 'backflip' ? this.backflipPhaseProgress : this.state === 'jump' ? this.jumpPhaseProgress : this.state === 'idle' ? this.idlePhase : this.phase; }
  get jumpPhase(): JumpPhase | null { return this.jumpStage; }
  /** True for either airborne action, including preparation and recovery. */
  get isJumping(): boolean { return this.state === 'jump' || this.state === 'backflip'; }
  get isBackflipping(): boolean { return this.state === 'backflip'; }
  get rotationPivot(): Point {
    const p=(this.backflipActive||this.backflipConfig).rotationPivot||this.defaultRotationPivot;
    return {x:this.facing===this.nativeFacing?p.x:2*this.box[0]+this.box[2]-p.x,y:p.y};
  }
  get rotationAngle(): number { return this.backAngle*(this.facing==='left'?1:-1); }
  get backflipPhase(): BackflipPhase | null {
    if(!this.isBackflipping||!this.jumpStage) return null;
    if(this.jumpStage==='anticipation'||this.jumpStage==='landing'||this.jumpStage==='recovery') return this.jumpStage;
    if(this.interrupted) return 'untuck';
    if(this.jumpStage==='takeoff') return 'takeoff';
    const c=this.backflipActive!;
    return this.flightProgress<c.tuckEnd?'tuck':this.flightProgress<c.untuckStart?'rotation':'untuck';
  }
  get backflipPhaseProgress(): number {
    const p=this.backflipPhase,c=this.backflipActive;
    if(!p||!c)return 0;
    if(p==='tuck')return clamp(this.flightProgress/c.tuckEnd,0,1);
    if(p==='rotation')return clamp((this.flightProgress-c.tuckEnd)/Math.max(1e-6,c.untuckStart-c.tuckEnd),0,1);
    if(p==='untuck')return this.interrupted?clamp(this.interrupted.elapsed/c.interruptDurationMs,0,1):clamp((this.flightProgress-c.untuckStart)/(1-c.untuckStart),0,1);
    return this.jumpPhaseProgress;
  }
  get isReadyForTakeoff(): boolean { return this.jumpStage === 'anticipation' && this.jumpPhaseProgress >= 1; }
  get jumpPhaseProgress(): number {
    const c = this.jumpActive;
    if (!c || !this.jumpStage) return 0;
    switch (this.jumpStage) {
      case 'anticipation': return clamp(this.jumpElapsed/c.anticipationDurationMs,0,1);
      case 'takeoff': return clamp(this.jumpElapsed/c.takeoffDurationMs,0,1);
      case 'airborne': return clamp(this.jumpElapsed/c.airborneBlendMs,0,1);
      case 'falling': return this.landingProximity;
      case 'landing': return clamp(this.jumpElapsed/c.landingDurationMs,0,1);
      case 'recovery': return clamp(this.jumpElapsed/c.recoveryDurationMs,0,1);
    }
  }
  get direction(): Facing { return this.facing; }
  getNativeFacing(): Facing {return this.nativeFacing;}
  get referenceSpeed(): number { return nominalMovementSpeed(this.config); }
  get cycleMs(): number { return this.config.cycleDurationMs; }
  get idleCycleMs(): number { return this.idleConfig.cycleDurationMs; }
  get pose(): WalkPose | null { return this.lastPose; }
  /** Live tuning is supported for preview, but changing amplitude during a planted step may reposition the foot. */
  setConfig(config: Partial<WalkConfig>): void {
    this.config = validate({...this.config, ...config});
    if (this.state === 'neutral') this.phase = this.config.stanceRatio / 2;
    else if (this.state === 'walk' && !this.transition) this.render(this.sample(this.phase));
  }
  setIdleConfig(config: Partial<IdleConfig>): void {
    this.idleConfig = validateIdle({...this.idleConfig, ...config});
    if (this.state === 'idle' && !this.transition) this.render(this.sampleIdle(this.idlePhase));
  }
  playWalk(): void { this.requested = 'walk'; if (!this.isJumping) this.switchTo('walk'); }
  playIdle(): void { this.requested = 'idle'; if (!this.isJumping) this.switchTo('idle'); }
  /** Tunables are snapshotted at jump start so live edits cannot snap an airborne pose. */
  setJumpConfig(config: Partial<JumpConfig>): void {
    this.jumpConfig = validateJump({...this.jumpConfig, ...config});
  }
  setBackflipConfig(config: Partial<BackflipConfig>): void {
    this.backflipConfig=validateBackflip({...this.backflipConfig,...config});
  }
  /** Start preparation; shared JUMP anticipation, landing and locomotion recovery. */
  playBackflip(): boolean {
    if(this.isJumping)return false;
    if(this.requested==='neutral')this.requested='idle';
    this.state='backflip'; this.transition=null;
    const c=this.backflipActive={...this.backflipConfig,rotationPivot:this.backflipConfig.rotationPivot?{...this.backflipConfig.rotationPivot}:undefined};
    this.jumpActive={...DEFAULT_JUMP,anticipationDurationMs:c.anticipationDurationMs,anticipationSquash:c.anticipationSquash,
      anticipationWiden:c.anticipationWiden,anticipationDrop:c.anticipationDrop,anticipationIntensity:c.anticipationIntensity,
      takeoffDurationMs:c.takeoffDurationMs,takeoffStretch:c.takeoffStretch,takeoffNarrow:c.takeoffNarrow,
      landingDurationMs:c.landingDurationMs,landingSquash:c.landingSquash,landingWiden:c.landingWiden,
      landingDrop:c.landingDrop,landingIntensity:c.landingIntensity,recoveryDurationMs:c.recoveryDurationMs};
    this.flightProgress=0; this.backAngle=0; this.interrupted=null; this.verticalVelocity=0; this.landingProximity=0;
    this.recoveryTarget=null;this.enterJump('anticipation');return true;
  }
  /** External normalized flight progress, monotonic per flight; no internal flight clock. */
  notifyFlightProgress(progress: number): boolean {
    finite(progress,'flightProgress'); if(progress<0||progress>1)throw new RangeError('flightProgress must be 0..1');
    if(!this.isBackflipping||this.interrupted||!['takeoff','airborne','falling'].includes(this.jumpStage||''))return false;
    this.flightProgress=Math.max(this.flightProgress,progress);return true;
  }
  /** Cancel a failed launch, or smoothly settle an interrupted airborne action.
   * Airborne cancellation never fabricates a ground contact. Call notifyLanding later. */
  cancelJump(): boolean {
    if(!this.isJumping||!this.jumpStage)return false;
    if(this.jumpStage==='anticipation') {this.enterJump('recovery');return true;}
    if(this.jumpStage==='landing'||this.jumpStage==='recovery')return false;
    if(this.isBackflipping) {
      if(this.interrupted)return false;
      this.interrupted={from:this.lastPose||neutralPose(),angle:this.backAngle,target:Math.round(this.backAngle/360)*360,elapsed:0};
      this.enterJump('falling');return true;
    }
    // JUMP interrupted in flight: open feet smoothly; keep waiting for real contact.
    if(this.jumpCancelled)return false;
    this.jumpCancelled=true;this.landingProximity=1;this.enterJump('falling');return true;
  }
  notifyCollision(grounded=false): boolean {return grounded?this.notifyLanding():this.cancelJump();}
  /** Start preparation. Returns false if a jump is already active. */
  playJump(): boolean {
    if (this.isJumping) return false;
    if (this.requested === 'neutral') this.requested = 'idle';
    this.state = 'jump'; this.transition = null;
    this.jumpActive = {...this.jumpConfig}; this.jumpCancelled=false;
    this.verticalVelocity = 0; this.landingProximity = 0; this.recoveryTarget = null;
    this.enterJump('anticipation');
    return true;
  }
  /** Call when the external physics actually launches the character.
   * May be called early for a forced launch, or after the anticipation-ready flag. */
  notifyTakeoff(): boolean {
    if (this.jumpStage !== 'anticipation') return false;
    this.enterJump('takeoff'); this.launchPose=this.lastPose||neutralPose(); return true;
  }
  /** Report physical airborne motion each update. Positive vy = falling (SVG y-down).
   * Optional proximity 0..1 approaches one at contact; it opens the tucked feet.
   * No flight timer or root motion. Ascending again (bounce) can re-enter airborne. */
  notifyAirborne(verticalVelocity: number, landingProximity = 0, flightProgress?: number): boolean {
    finite(verticalVelocity,'verticalVelocity'); finite(landingProximity,'landingProximity');
    if (landingProximity < 0 || landingProximity > 1) throw new RangeError('landingProximity must be 0..1');
    if (this.jumpStage !== 'takeoff' && this.jumpStage !== 'airborne' && this.jumpStage !== 'falling') return false;
    this.verticalVelocity = verticalVelocity;
    if(this.isBackflipping) {if(flightProgress!==undefined)this.notifyFlightProgress(flightProgress);this.landingProximity=landingProximity;return true;}
    if(this.jumpCancelled)return true;
    this.landingProximity = verticalVelocity > 0 ? landingProximity : 0;
    if (this.jumpStage !== 'takeoff') {
      const next = verticalVelocity > 0 ? 'falling' : 'airborne';
      if (this.jumpStage !== next) this.enterJump(next);
    }
    return true;
  }
  /** Call once on confirmed physical contact. No automatic landing on a timer. */
  notifyLanding(): boolean {
    if (this.jumpStage !== 'takeoff' && this.jumpStage !== 'airborne' && this.jumpStage !== 'falling') return false;
    if(this.isBackflipping){this.settleFrom=this.backAngle;this.settleTo=Math.round(this.backAngle/360)*360;}
    this.enterJump('landing'); return true;
  }
  private enterJump(stage: JumpPhase): void {
    this.jumpStage = stage; this.jumpElapsed = 0;
    this.jumpFrom = this.lastPose || neutralPose();
  }
  private locomotionTarget(speed: number): Locomotion {
    return this.requested === 'walk' && speed > 0 ? 'walk' : 'idle';
  }
  private jumpTarget(stage: JumpPhase, c: JumpConfig): WalkPose {
    const p = neutralPose();
    if (stage === 'anticipation') {
      const a = c.anticipationIntensity;
      p.body = {y:c.anticipationDrop*a,angle:0,sx:1+c.anticipationWiden*a,sy:1-c.anticipationSquash*a};
      return p;
    }
    if (stage === 'landing') {
      const a = c.landingIntensity;
      p.body = {y:c.landingDrop*a,angle:0,sx:1+c.landingWiden*a,sy:1-c.landingSquash*a};
      return p;
    }
    // Takeoff and flight are local poses only. All root displacement is external.
    const takingOff = stage === 'takeoff';
    const falling = stage === 'falling';
    const open = falling ? smooth(this.landingProximity) : 0;
    const retain = 1-open;
    p.body = {y:0,angle:this.nativeSign*c.bodyTiltDeg*(takingOff ? .65 : falling ? .45 : 1)*retain,
      sx:1-(takingOff?c.takeoffNarrow:.012)*retain,
      sy:1+(takingOff?c.takeoffStretch:falling ? .025 : .015)*retain};
    for (const n of ['foot_far','foot_near'] as const) {
      const asym = n === 'foot_near' ? 1 : .82;
      const tuck = c.footTuckIntensity*retain*(takingOff ? .42 : falling ? .7 : 1)*asym;
      const angle = -this.nativeSign*c.airborneFootRotationDeg*tuck;
      p[n] = {x:0,y:-c.airborneFootLift*tuck-this.soleCorrection(n,angle),angle,planted:false};
    }
    return this.withArms(p,n=>{const a=this.armsConfig;const lift=(takingOff?a.jumpTakeoffDeg:a.jumpAirDeg)*retain*(falling?.6:1)*(n==='arm_far'?.75:1);return {angle:-this.nativeSign*lift,x:0,y:-a.jumpLift*retain*(takingOff?.7:falling?.5:1)};});
  }
  private flipFlightPose(progress:number,c:BackflipConfig): WalkPose {
    const tuck=smooth(progress/c.tuckEnd)*(1-smooth((progress-c.untuckStart)/(1-c.untuckStart)))*c.tuckIntensity;
    const p=neutralPose();
    p.body={y:0,angle:0,sx:1+c.tuckWiden*tuck,sy:1-c.tuckSquash*tuck};
    for(const n of ['foot_far','foot_near'] as const){
      const a=(n==='foot_far'?-1:1)*c.tuckRotationDeg*tuck;
      p[n]={x:0,y:-c.tuckLift*tuck-this.soleCorrection(n,a),angle:a,planted:false};
    }
    return this.withArms(p,n=>{const a=this.armsConfig,sign=n==='arm_near'?-1:1;return {angle:this.nativeSign*sign*a.backflipTuckDeg*tuck,x:-this.nativeSign*sign*a.backflipInward*tuck,y:-a.backflipLift*tuck};});
  }
  private advanceBackflipFlight(delta:number): WalkPose {
    const c=this.backflipActive!;
    if(this.interrupted){
      const q=this.interrupted;q.elapsed=Math.min(c.interruptDurationMs,q.elapsed+delta);
      const w=smooth(q.elapsed/c.interruptDurationMs);this.backAngle=q.angle+(q.target-q.angle)*w;
      const open=neutralPose();open.foot_far.planted=open.foot_near.planted=false;
      return this.render(blendPose(q.from,open,w));
    }
    this.jumpElapsed+=delta;
    const t=this.flightProgress, mid=(c.rotationStart+c.rotationEnd)/2;
    const half=(c.rotationEnd-c.rotationStart)/(2*c.rotationSpeed);
    const start=Math.max(0,mid-half),end=Math.min(1,mid+half);
    // Quintic easing: zero angular velocity and acceleration at both boundaries.
    const u=clamp((t-start)/(end-start),0,1);
    this.backAngle=c.rotationAngleDeg*u*u*u*(10+u*(-15+6*u));
    const target=this.flipFlightPose(t,c);
    // Stretch is a transient envelope, not a flight-duration constraint.
    const take=smooth(this.jumpElapsed/c.takeoffDurationMs);
    const stretch=(1-smooth(t/c.tuckEnd))*Math.sin(Math.PI*.5*take);
    target.body.sy+=c.takeoffStretch*stretch;target.body.sx-=c.takeoffNarrow*stretch;
    for(const n of ARMS){const arm=target.arms?.[n];if(arm){arm.angle-=this.nativeSign*this.armsConfig.jumpTakeoffDeg*.65*stretch;arm.y-=this.armsConfig.jumpLift*stretch;}}
    const pose=blendPose(this.launchPose,target,take);
    if(this.jumpStage==='takeoff'&&take>=1)this.enterJump('airborne');
    // enterJump resets jumpElapsed. Keep the takeoff envelope fully elapsed afterwards.
    if(this.jumpStage==='airborne')this.jumpElapsed=Math.max(c.takeoffDurationMs,this.jumpElapsed);
    return this.render(pose);
  }
  private advanceJump(delta: number, speed: number): WalkPose {
    const c = this.jumpActive!;
    let remaining = delta;
    // Consume timed phase boundaries even with a coarse or variable external tick.
    // Anticipation holds for physics; airborne/falling have no expiry.
    while (true) {
      const stage = this.jumpStage!;
      if(this.isBackflipping&&(stage==='takeoff'||stage==='airborne'||stage==='falling'))return this.advanceBackflipFlight(remaining);
      if (stage === 'airborne' || stage === 'falling') {
        this.jumpElapsed = Math.min(c.airborneBlendMs,this.jumpElapsed+remaining);
        const target = this.jumpTarget(stage,c);
        return this.render(blendPose(this.jumpFrom,target,smooth(this.jumpElapsed/c.airborneBlendMs)));
      }
      if (stage === 'recovery') {
        const dest = this.locomotionTarget(speed);
        if (this.recoveryTarget !== dest) {
          this.recoveryTarget = dest; this.jumpFrom = this.lastPose || neutralPose(); this.jumpElapsed=0;
          if (dest === 'walk') this.phase = this.config.stanceRatio/2; else this.idlePhase=0;
        }
        const used = Math.min(remaining,c.recoveryDurationMs-this.jumpElapsed);
        this.jumpElapsed += used; remaining -= used;
        let target: WalkPose;
        if (dest === 'walk') {
          this.phase=mod(this.phase+speed*(used/1000)*this.config.stanceRatio/(2*this.config.stepAmplitude));
          target=this.sample(this.phase);
        } else {
          this.idlePhase=mod(this.idlePhase+used/this.idleConfig.cycleDurationMs); target=this.sampleIdle(this.idlePhase);
        }
        const pose=this.render(blendPose(this.jumpFrom,target,smooth(this.jumpElapsed/c.recoveryDurationMs)));
        if (this.jumpElapsed >= c.recoveryDurationMs) {
          this.state=dest; this.jumpStage=null; this.jumpActive=null; this.recoveryTarget=null;
          this.backflipActive=null;this.interrupted=null;this.backAngle=0;this.applyRoot();this.jumpCancelled=false;
          return remaining>0 ? this.updateCore(remaining,speed)! : pose;
        }
        return pose;
      }
      const duration = stage==='anticipation'?c.anticipationDurationMs:stage==='takeoff'?c.takeoffDurationMs:c.landingDurationMs;
      const used = Math.min(remaining,duration-this.jumpElapsed);
      this.jumpElapsed += used; remaining -= used;
      const t = clamp(this.jumpElapsed/duration,0,1);
      let pose: WalkPose;
      if (stage === 'landing') {
        const compressed=this.jumpTarget(stage,c), peak=.36;
        if(this.isBackflipping){const w=smooth(t/Math.max(peak,.65));this.backAngle=this.settleFrom+(this.settleTo-this.settleFrom)*w;}
        // Fast impact, slower elastic release; feet return to their original support.
        pose=t<=peak?blendPose(this.jumpFrom,compressed,smooth(t/peak)):
          blendPose(compressed,neutralPose(),.72*smooth((t-peak)/(1-peak)));
        if (t>=peak) { pose.foot_near.planted=true; pose.foot_far.planted=true; }
      } else {
        pose=blendPose(this.jumpFrom,this.jumpTarget(stage,c),smooth(t));
      }
      this.render(pose);
      if (stage==='anticipation'||t<1) return pose;
      this.enterJump(stage==='takeoff'?(this.verticalVelocity>0?'falling':'airborne'):'recovery');
      if (remaining<=0) return pose;
    }
  }
  /** Stop walking smoothly and continue breathing. Use resetPose for an immediate neutral reset. */
  stopWalk(): void { this.playIdle(); }
  private switchTo(state: 'idle' | 'walk'): void {
    if (this.state === state) return;
    // Capture the actually rendered pose, including any interrupted blend.
    this.transition = {from: this.lastPose || neutralPose(), elapsed:0, duration:this.idleConfig.transitionDurationMs};
    this.state = state;
    if (state === 'walk') this.phase = this.config.stanceRatio / 2;
    else this.idlePhase = 0;
  }
  setFacing(direction: Facing): void {
    if (direction !== 'left' && direction !== 'right') throw new TypeError('Invalid facing');
    this.facing = direction;
    if (this.lastPose) this.render(this.lastPose); else {this.restore();this.renderArms(neutralPose(),'');}
  }
  resetPose(): void {
    this.state = this.requested = 'neutral'; this.transition = null;
    this.jumpStage=null; this.jumpActive=null; this.jumpElapsed=0; this.recoveryTarget=null;
    this.verticalVelocity=0; this.landingProximity=0;
    this.phase = this.config.stanceRatio / 2; this.idlePhase = 0;
    this.backflipActive=null;this.interrupted=null;this.backAngle=0;this.flightProgress=0;this.jumpCancelled=false;
    this.weaponArmOwner=false;this.weaponDirect=null;this.weaponBodyRecoil=0;this.armOverrides={};this.appliedArms={};this.armWeight=this.armWeightFrom=this.armsConfig.enabled?this.armsConfig.intensity:0;this.armWeightElapsed=this.armsConfig.overrideBlendMs;
    this.lastPose = null; this.restore();
  }
  /** deltaTime in milliseconds; movementSpeed in nonnegative SVG units/sec.
   * A zero-speed WALK request blends to IDLE and resumes WALK when speed returns.
   * Explicit playIdle/stopWalk cancel the WALK request. No internal scheduler. */
  update(deltaTime: number, movementSpeed: number): WalkPose | null {
    finite(deltaTime,'deltaTime');finite(movementSpeed,'movementSpeed');if(deltaTime<0||movementSpeed<0)throw new RangeError('deltaTime and movementSpeed must be nonnegative');
    this.advanceArms(deltaTime);return this.updateCore(deltaTime,movementSpeed);
  }
  private updateCore(deltaTime: number, movementSpeed: number): WalkPose | null {
    finite(deltaTime, 'deltaTime'); finite(movementSpeed, 'movementSpeed');
    if (deltaTime < 0 || movementSpeed < 0) throw new RangeError('deltaTime and movementSpeed must be nonnegative');
    if (this.isJumping) return this.advanceJump(deltaTime,movementSpeed);
    if (this.requested === 'neutral') {this.refreshArmOverrides();return null;}
    this.switchTo(this.requested === 'walk' && movementSpeed > 0 ? 'walk' : 'idle');
    let target: WalkPose;
    if (this.state === 'walk') {
      this.phase = mod(this.phase + movementSpeed * (deltaTime / 1000) * this.config.stanceRatio / (2 * this.config.stepAmplitude));
      target = this.sample(this.phase);
    } else {
      this.idlePhase = mod(this.idlePhase + deltaTime / this.idleConfig.cycleDurationMs);
      target = this.sampleIdle(this.idlePhase);
    }
    if (this.transition) {
      const t = this.transition;
      t.elapsed = Math.min(t.duration, t.elapsed + deltaTime);
      const u = t.elapsed / t.duration;
      // Smoothstep: zero weight derivative at both blend boundaries.
      target = blendPose(t.from, target, u*u*(3-2*u));
      if (u >= 1) this.transition = null;
    }
    return this.render(target);
  }
  /** Pure IDLE evaluation: at phase 0 the original pose, at .5 full inhale.
   * The same lower body pivot as WALK anchors the expansion near the feet. */
  sampleIdle(phase: number): WalkPose {
    const c = this.idleConfig;
    const breath = (0.5 - 0.5 * Math.cos(TAU * mod(finite(phase, 'phase')))) * c.intensity;
    const pose = neutralPose();
    pose.body = {y:-c.bodyBob*breath,angle:0,sx:1-c.widthChange*breath,sy:1+c.heightChange*breath};
    return this.withArms(pose,n=>({x:0,y:0,angle:Math.sin(TAU*mod(phase))*c.intensity*this.armsConfig.idleSwayDeg*(n==='arm_near'?1:-.7)}));
  }
  /** Pure pose evaluation at any normalized cycle phase; useful for tooling. */
  sample(phase: number): WalkPose {
    const c = this.config;
    const p = mod(finite(phase, 'phase'));
    const wave = Math.cos(TAU * 2 * (p - c.stanceRatio / 2));
    const sy = 1 + c.squashStretch * wave;
    const pose:WalkPose = {
      foot_near: this.foot('foot_near', p),
      foot_far: this.foot('foot_far', mod(p + c.phaseOffset)),
      body: { y: -c.bodyBob * (0.5 + 0.5 * wave), angle: this.nativeSign * c.bodyTiltDeg * (0.62 + 0.38 * Math.sin(TAU * p)), sx: 1 / sy, sy }
    };
    return this.withArms(pose,n=>{const f=pose[n==='arm_near'?'foot_near':'foot_far'];const swing=clamp(f.x/c.stepAmplitude,-1,1);return {angle:swing*this.armsConfig.walkSwingDeg,x:-swing*this.armsConfig.walkShift,y:0};});
  }
  private foot(name: Foot, p: number): FootPose {
    const c = this.config, a = c.stepAmplitude, s = c.stanceRatio;
    if (p < s) return { x: this.nativeSign * (a - 2 * a * p / s), y: 0, angle: 0, planted: true };
    const t = clamp((p - s) / (1 - s), 0, 1);
    // Hermite: position and velocity continuous with the linear stance at both ends.
    const h = t * t * (3 - 2 * t), tangent = -2 * a * (1 - s) / s;
    const forward = -a + 2 * a * h + tangent * (2*t*t*t - 3*t*t + t);
    const lift = Math.sin(Math.PI * t) ** 2;
    // Rock toe-up then toe-down; angular velocity vanishes at contact.
    const angle = -this.nativeSign * c.footRotationDeg * lift * Math.sin(TAU * t);
    const y = -c.liftHeight * lift - this.soleCorrection(name, angle);
    return {x: this.nativeSign * forward, y, angle, planted: false};
  }
  private soleCorrection(name: Foot, angle: number): number {
    const pivot = this.pivots[name];
    const a = angle * Math.PI / 180, co = Math.cos(a), si = Math.sin(a);
    const width = this.box[2];
    const fallback = [{x:pivot.x - width * .10, y:pivot.y + this.box[3] * .10}, {x:pivot.x + width * .10, y:pivot.y + this.box[3] * .10}];
    const supplied = this.config.solePoints?.[name];
    const points = supplied?.length ? supplied : fallback;
    let flat = -Infinity, rotated = -Infinity;
    for (const p of points) {
      flat = Math.max(flat, p.y);
      rotated = Math.max(rotated, pivot.y + (p.x-pivot.x)*si + (p.y-pivot.y)*co);
    }
    return rotated - flat;
  }
  private mirror(): string {
    return this.facing === this.nativeFacing ? '' : `translate(${fmt(2*this.box[0]+this.box[2])} 0) scale(-1 1)`;
  }
  private apply(name: Foot | 'body', animation = ''): void {
    const value = [this.mirror(), animation, this.original[name]].filter(Boolean).join(' ');
    if (value) this.groups[name].setAttribute('transform', value);
    else if (this.original[name] === null) this.groups[name].removeAttribute('transform');
    else this.groups[name].setAttribute('transform', this.original[name]!);
  }
  private applyRoot(): void {
    const a=this.rotationAngle,p=this.rotationPivot;
    // Multiples of 360 are exactly the identity: remove the attribute without a visual jump.
    if(Math.abs(a%360)<1e-8)this.root.removeAttribute('transform');
    else this.root.setAttribute('transform',`rotate(${fmt(a)} ${fmt(p.x)} ${fmt(p.y)})`);
  }
  private applyArm(n:Arm,bodyAnimation:string,pose:ArmPose):void {
    const g=this.armGroups[n],p=this.armPivots[n];if(!g||!p)return;
    const local=pose.x===0&&pose.y===0&&pose.angle===0?'':`translate(${fmt(pose.x)} ${fmt(pose.y)}) rotate(${fmt(pose.angle)} ${fmt(p.x)} ${fmt(p.y)})`;
    const value=[this.mirror(),bodyAnimation,local,this.armOriginal[n]].filter(Boolean).join(' ');
    if(value)g.setAttribute('transform',value);else if(this.armOriginal[n]===null)g.removeAttribute('transform');else g.setAttribute('transform',this.armOriginal[n]||'');
    this.appliedArms[n]=pose;
  }
  /** Actual pivot/grip in SVG root user coordinates, including mirror, body and global rotation.
   * Rig points are in assembled SVG space before the animation (not path-local coordinates). */
  getArmAnchors(n:Arm): {pivot:Point;grip?:Point}|null {
    const pivot=this.armPivots[n];if(!pivot)return null;
    const b=this.visualBody(this.lastPose||neutralPose()), p=this.config.bodyPivot||{x:(this.pivots.foot_far.x+this.pivots.foot_near.x)/2,y:(this.pivots.foot_far.y+this.pivots.foot_near.y)/2};
    const arm=this.appliedArms[n]||armNeutral();
    const rot=(v:Point,c:Point,deg:number):Point=>{const a=deg*Math.PI/180,dx=v.x-c.x,dy=v.y-c.y;return {x:c.x+dx*Math.cos(a)-dy*Math.sin(a),y:c.y+dx*Math.sin(a)+dy*Math.cos(a)};};
    const transform=(v:Point):Point=>{let q=rot(v,pivot,arm.angle);q={x:q.x+arm.x,y:q.y+arm.y};q=rot({x:p.x+(q.x-p.x)*b.sx,y:p.y+(q.y-p.y)*b.sy},p,b.angle);q.y+=b.y;if(this.facing!==this.nativeFacing)q.x=2*this.box[0]+this.box[2]-q.x;return rot(q,this.rotationPivot,this.rotationAngle);};
    const grip=this.armGrips[n];return {pivot:transform(pivot),...(grip?{grip:transform(grip)}:{})};
  }
  private restore(): void { this.apply('foot_far'); this.apply('body'); this.apply('foot_near');for(const n of ARMS)this.applyArm(n,'',armNeutral()); this.applyRoot(); }
  private renderArms(pose:WalkPose,bodyAnimation:string):void {
    for(const n of ARMS){if(!this.armGroups[n])continue;let local=mixArm(armNeutral(),pose.arms?.[n]||armNeutral(),this.armWeight);const o=this.armOverrides[n];if(o){if(o.targetWeight===1)local=mixArm(o.from,o.pose,smooth(o.elapsed/this.armsConfig.overrideBlendMs));else local=mixArm(local,o.pose,o.weight);}this.applyArm(n,bodyAnimation,this.weaponDirect?.[n]||local);}
  }
  private render(pose: WalkPose): WalkPose {
    for (const name of ['foot_far','foot_near'] as const) {
      const f = pose[name], p = this.pivots[name];
      this.apply(name, f.x === 0 && f.y === 0 && f.angle === 0 ? '' : `translate(${fmt(f.x)} ${fmt(f.y)}) rotate(${fmt(f.angle)} ${fmt(p.x)} ${fmt(p.y)})`);
    }
    const b = this.visualBody(pose), p = this.config.bodyPivot || {x: (this.pivots.foot_far.x + this.pivots.foot_near.x)/2, y: (this.pivots.foot_far.y + this.pivots.foot_near.y)/2};
    const bodyAnimation = b.y === 0 && b.angle === 0 && b.sx === 1 && b.sy === 1 ? '' : `translate(0 ${fmt(b.y)}) translate(${fmt(p.x)} ${fmt(p.y)}) rotate(${fmt(b.angle)}) scale(${fmt(b.sx)} ${fmt(b.sy)}) translate(${fmt(-p.x)} ${fmt(-p.y)})`;
    this.apply('body',bodyAnimation);
    this.renderArms(pose,bodyAnimation);
    this.applyRoot();
    return this.lastPose = pose;
  }
}
