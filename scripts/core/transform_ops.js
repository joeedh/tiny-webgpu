import config from '../config/config.js';

import {
  util, math, Vector2, Vector3, Vector4, Matrix4,
  nstructjs, ToolOp, IntProperty, FloatProperty,
  Vec3Property, Vec4Property, Vec2Property, FlagProperty, keymap
} from '../path.ux/pathux.js';

import {Vertex, MeshTypes, MeshFlags} from './mesh.js';

const VecProperty = (new Vertex()).length === 3 ? Vec3Property : Vec2Property;
const Vector = (new Vertex()).length === 3 ? Vector3 : Vector2;
const VectorSize = (new Vertex()).length;

export class TransformList extends Array {
  constructor(typeName, selmask) {
    super();

    this.typeName = typeName;
    this.selMask = selmask;
  }
}

export const TransformClasses = [];

export class TransformElem {
  constructor() {

  }

  static undoPre(mesh, selMask, list) {
    throw new Error("implement me!");
  }

  static undo(mesh, selMask, data) {
    throw new Error("implement me!");
  }

  static create(mesh, selMask) {
    throw new Error("implement me!");
  }

  static transformDefine() {
    return {
      typeName: "",
      uiName  : "",
      selMask : 0
    }
  }

  static register(cls) {
    TransformClasses.push(cls);
  }

  static getClass(typeName) {
    for (let cls of TransformClasses) {
      if (cls.transformDefine().typeName === typeName) {
        return cls;
      }
    }
  }

  minmax(min, max) {
    throw new Error("implement me!");
  }

  apply(matrix) {
    throw new Error("implement me!");
  }
}

export class TransformVert extends TransformElem {
  constructor(v) {
    super();

    this.v = v;
    this.start = new Vector(v);
  }

  static create(mesh, selMask) {
    let list = new TransformList(this.transformDefine().typeName, selMask);

    let doList = (elist) => {
      for (let v of elist.selected.editable) {
        list.push(new this(v));
      }
    }

    if (selMask & MeshTypes.VERTEX) {
      doList(mesh.verts);
    }

    if (mesh.haveHandles && (selMask & MeshTypes.HANDLE)) {
      doList(mesh.handles);
    }

    return list;
  }

  static undoPre(mesh, selMask, list) {
    let ret = [];

    for (let td of list) {
      let vlen = td.v.length;

      for (let td of list) {
        ret.push(td.v.eid);

        for (let i = 0; i < vlen; i++) {
          ret.push(td.v[i]);
        }
      }
    }

    return ret;
  }

  static undo(mesh, selMask, data) {
    let vlen = VectorSize + 1;

    for (let i = 0; i < data.length; i += vlen) {
      let eid = data[i];

      let elem = mesh.eidMap.get(eid);
      if (!elem) {
        console.error("Missing element " + eid);
        continue;
      }

      for (let j = 0; j < VectorSize; j++) {
        elem[j] = data[i + j + 1];
      }
    }
  }

  static transformDefine() {
    return {
      typeName: "verts",
      uiName  : "verts",
      selMask : MeshTypes.VERTEX | MeshTypes.HANDLE
    }
  }

  minmax(min, max) {
    min.min(this.start);
    max.max(this.start);
  }

  apply(matrix) {
    this.v.load(this.start);
    this.v.multVecMatrix(matrix);
  }
}

TransformElem.register(TransformVert);

export class TransformOp extends ToolOp {
  constructor() {
    super();

    this.transData = undefined;

    this.deltaMpos = new Vector2();
    this.startMpos = new Vector2();
    this.lastMpos = new Vector2();
    this._lastMpos = new Vector2();
    this.mpos = new Vector2();

    this.first = true;
  }

  static tooldef() {
    return {
      inputs: {
        selMask: new FlagProperty(config.SELECTMASK, MeshTypes),
        center : new VecProperty()
      }
    }
  }

  calcTransCenter(tdata) {
    let min = new Vector();
    let max = new Vector();

    min.addScalar(1e17);
    max.addScalar(-1e17);
    for (let list of tdata) {
      for (let td of list) {
        td.minmax(min, max);
      }
    }

    this.inputs.center.setValue(min.interp(max, 0.5));
  }

  getTransData(ctx, doCenter = true) {
    if (this.transData) {
      if (doCenter) {
        this.calcTransCenter(this.transData);
      }

      return this.transData;
    }

    let ret = [];
    let mesh = ctx.mesh;
    let selMask = this.inputs.selMask.getValue();

    for (let list of TransformClasses) {
      ret.push(list.create(mesh, selMask));
    }

    if (doCenter) {
      this.calcTransCenter(ret);
    }

    this.transData = ret;
    return ret;
  }

  execPost(ctx) {
    this.transData = undefined;
    window.redraw_all();
  }

  execPre(ctx) {
    this.getTransData(ctx);
    window.redraw_all();
  }

  modalStart(ctx) {
    super.modalStart(ctx);
    this.getTransData(ctx);
  }

  undoPre(ctx) {
    this._undo = {};
    this._undoSelMask = this.inputs.selMask.getValue();

    let tdata = this.getTransData(ctx)

    let selMask = this.inputs.selMask.getValue();
    let mesh = ctx.mesh;

    for (let list of tdata) {
      let cls = TransformElem.getClass(list.typeName);
      this._undo[list.typeName] = cls.undoPre(ctx.mesh, selMask, list);
    }

    window.redraw_all();
  }

  undo(ctx) {
    let mesh = ctx.mesh;

    for (let k in this._undo) {
      TransformElem.getClass(k).undo(mesh, this._undoSelMask, this._undo[k]);
    }

    window.redraw_all();
  }

  on_pointerup(e) {
    this.modalEnd(false);
  }

  on_pointercancel(e) {
    this.modalEnd(true); //will cancel
  }

  on_keydown(e) {
    switch (e.keyCode) {
      case keymap["Enter"]:
      case keymap["Space"]:
        this.modalEnd(false);
        break;
      case keymap["Escape"]:
      case keymap["Backspace"]:
      case keymap["Delete"]:
        this.modalEnd(true);
        break;
    }
  }

  on_pointermove(e) {
    let ctx = this.modal_ctx;

    let workspace = ctx.workspace;

    let mpos = workspace.getLocalMouse(e.x, e.y);

    if (this.first) {
      this.startMpos.load(mpos);
      this.lastMpos.load(mpos);
      this.deltaMpos.zero();
      this.mpos.load(mpos);
      this._lastMpos.load(mpos);

      this.first = false;
      return;
    }

    this.lastMpos.load(this._lastMpos);
    this.deltaMpos.load(mpos).sub(this.lastMpos);

    this.mpos.load(mpos);
    this._lastMpos.load(mpos);
  }
}

export class TranslateOp extends TransformOp {
  constructor() {
    super();
  }

  static tooldef() {
    return {
      uiname  : "Move",
      toolpath: "transform.translate",
      inputs  : ToolOp.inherit({
        offset: new VecProperty()
      }),
      is_modal: true,
    }
  }

  on_pointermove(e) {
    super.on_pointermove(e);

    let delta = new Vector2(this.mpos).sub(this.startMpos);
    delta = new Vector().loadXY(delta[0], delta[1]);

    this.inputs.offset.setValue(delta);
    this.exec(this.modal_ctx);
  }

  exec(ctx) {
    let delta = this.inputs.offset.getValue();

    let matrix = new Matrix4();
    matrix.translate(delta[0], delta[1], delta[2] ?? 0.0);

    let tdata = this.getTransData(ctx);

    for (let tlist of tdata) {
      for (let td of tlist) {
        td.apply(matrix);
      }
    }

    window.redraw_all();
  }
}

ToolOp.register(TranslateOp);


export class ScaleOp extends TransformOp {
  constructor() {
    super();
  }

  static tooldef() {
    return {
      uiname  : "Move",
      toolpath: "transform.scale",
      inputs  : ToolOp.inherit({
        scale: new VecProperty()
      }),
      is_modal: true,
    }
  }

  on_pointermove(e) {
    let ctx = this.modal_ctx;
    let workspace = ctx.workspace;

    super.on_pointermove(e);

    this.resetTempGeom();

    let delta = new Vector2(this.mpos).sub(this.startMpos);
    delta = new Vector().loadXY(delta[0], delta[1]);

    let center = this.inputs.center.getValue();

    let l1 = this.startMpos.vectorDistance(center);
    let l2 = this.mpos.vectorDistance(center);

    if (l1 === 0.0 || l2 === 0.0) {
      return;
    }

    let scenter = workspace.getGlobalMouse(center[0], center[1]);

    this.makeTempLine([e.x, e.y], scenter);
    
    let ratio = l2/l1;
    let scale = new Vector().addScalar(1.0);

    scale.loadXY(ratio, ratio);

    this.inputs.scale.setValue(scale);
    this.exec(this.modal_ctx);
  }

  exec(ctx) {
    let scale = this.inputs.scale.getValue();
    let center = this.inputs.center.getValue();

    let tmat1 = new Matrix4();
    let tmat2 = new Matrix4();

    tmat1.translate(-center[0], -center[1], -(center[2] ?? 0.0));
    tmat2.translate(center[0], center[1], (center[2] ?? 0.0));

    let matrix = new Matrix4();

    matrix.multiply(tmat2);
    matrix.scale(scale[0], scale[1], scale[2] ?? 1.0);
    matrix.multiply(tmat1);

    let tdata = this.getTransData(ctx);

    for (let tlist of tdata) {
      for (let td of tlist) {
        td.apply(matrix);
      }
    }

    window.redraw_all();
  }
}

ToolOp.register(ScaleOp);


export class RotateOp extends TransformOp {
  constructor() {
    super();
  }

  static tooldef() {
    return {
      uiname  : "Move",
      toolpath: "transform.rotate",
      inputs  : ToolOp.inherit({
        th: new FloatProperty()
      }),
      is_modal: true,
    }
  }

  on_pointermove(e) {
    let ctx = this.modal_ctx;
    let workspace = ctx.workspace;

    super.on_pointermove(e);

    this.resetTempGeom();

    let {center, th} = this.getInputs();

    let scenter = workspace.getGlobalMouse(center[0], center[1]);
    this.makeTempLine([e.x, e.y], scenter);

    let d1 = new Vector2(this.lastMpos);
    let d2 = new Vector2(this.mpos);

    d1.sub(center).normalize();
    d2.sub(center).normalize();

    let dth = Math.asin((d1[0]*d2[1] - d1[1]*d2[0])*0.99999);

    th += dth;

    this.inputs.th.setValue(th);
    this.exec(this.modal_ctx);

    this.lastMpos.load(this.mpos);
  }

  exec(ctx) {
    let {center, th} = this.getInputs();

    let tmat1 = new Matrix4();
    let tmat2 = new Matrix4();

    tmat1.translate(center[0], center[1], (center[2] ?? 0.0));
    tmat2.translate(-center[0], -center[1], -(center[2] ?? 0.0));

    let matrix = new Matrix4();
    let rotmat = new Matrix4();
    rotmat.euler_rotate(0.0, 0.0, th);

    matrix.multiply(tmat1);
    matrix.multiply(rotmat);
    matrix.multiply(tmat2);

    let tdata = this.getTransData(ctx);

    for (let tlist of tdata) {
      for (let td of tlist) {
        td.apply(matrix);
      }
    }

    window.redraw_all();
  }
}

ToolOp.register(RotateOp);
