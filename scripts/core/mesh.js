import {
  Vector2, Vector3, Vector4, Matrix4,
  Quat, util, math, nstructjs, BaseVector
} from '../path.ux/pathux.js';
import config from '../config/config.js';

'use strict';

export * from './mesh_base.js';
import {MeshFlags, MeshFeatures, MeshTypes} from './mesh_base.js';

const sel = [1, 0.8, 0, 1];
const high = [1, 0.8, 0.7, 1]
const act = [0, 0.3, 0.8, 1];
const actsel = [0.5, 0.3, 0.8, 1];

let mix = (a, b, fac) => new Vector4(a).interp(b, fac);

export const ElemColors = [
  [0, 0, 0, 1], //0    0
  sel, //001  1 Select
  act, //010  2 Active
  mix(sel, actsel, 0.25), //011  3 Select+Active
  high, //100  4 Highlight
  mix(high, sel, 0.5), //101  5 Highlight+Select
  mix(high, actsel, 0.5), //110  6 Highlight+Active
  new Vector4(high).add(sel).add(actsel).mulScalar(0.3333), //111  7 Highlight+Select+Active
];

for (let i = 0; i < ElemColors.length; i++) {
  ElemColors[i] = new Vector4(ElemColors[i]);
}

console.log(ElemColors);

export function getElemColor(list, e) {
  let mask = 0;

  if (e.flag & MeshFlags.SELECT) {
    mask |= 1;
  }

  if (e === list.active) {
    mask |= 2;
  }

  if (e === list.highlight) {
    mask |= 4;
  }

  return ElemColors[mask];
}

export class Element {
  constructor(type) {
    this.type = type;
    this.flag = this.index = 0;
    this.eid = -1;
  }

  [Symbol.keystr]() {
    return this.eid;
  }

  toJSON() {
    return {
      type : this.type,
      flag : this.flag,
      index: this.index,
      eid  : this.eid
    };
  }

  loadJSON(obj) {
    this.type = obj.type;
    this.flag = obj.flag;
    this.index = obj.index;
    this.eid = obj.eid;

    return this;
  }
}

Element.STRUCT = `
mesh.Element {
  type     : int;
  flag     : int;
  index    : int;
  eid      : int;
}
`;
nstructjs.register(Element);

function mixinVector3(cls) {
  let parent = Vector3;
  let lastparent;

  while (parent && parent !== lastparent && parent.prototype) {
    for (let k of Reflect.ownKeys(parent.prototype)) {
      if (k === "buffer" || k === "byteLength" || k === "byteOffset" || k === "length") {
        continue;
      }

      if (!cls.prototype[k]) {
        try {
          cls.prototype[k] = parent.prototype[k];
        } catch (error) {
          util.print_stack(error);
          console.warn("Failed to inherit Vector prototype property " + k);
          continue;
        }
      }
    }

    lastparent = parent;
    parent = parent.__proto__;
  }

  cls.prototype.initVector3 = function () {
    this.length = 3;
    this[0] = this[1] = this[2] = 0.0;
  }

  cls.prototype.load = function (b) {
    this[0] = b[0];
    this[1] = b[1];
    this[2] = b[2];

    return this;
  }
}

//has Vector3 mixin
export class Vertex extends Element {
  constructor(co) {
    super(MeshTypes.VERTEX);
    this.initVector3();

    if (co !== undefined) {
      this.load(co);
    }

    this.edges = [];
  }

  toJSON() {
    let edges = [];
    for (let e of this.edges) {
      edges.push(e.eid);
    }

    return util.merge(super.toJSON(), {
      0    : this[0],
      1    : this[1],
      2    : this[2],
      edges: edges
    });
  }

  otherEdge(e) {
    if (this.edges.length !== 2) {
      throw new Error("otherEdge only works on 2-valence vertices");
    }

    if (e === this.edges[0])
      return this.edges[1];
    else if (e === this.edges[1])
      return this.edges[0];
  }

  loadJSON(obj) {
    super.loadJSON(obj);

    this.edges = obj.edges;
    this[0] = obj[0];
    this[1] = obj[1];
    this[2] = obj[2];

    return this;
  }
}

mixinVector3(Vertex);

Vertex.STRUCT = nstructjs.inherit(Vertex, Element, "mesh.Vertex") + `
  0           : float;
  1           : float;
  2           : float;
  edges       : array(e, int) | e.eid;
}
`;
nstructjs.register(Vertex);

//has Vector3 mixin
export class Handle extends Element {
  constructor(co) {
    super(MeshTypes.HANDLE);
    this.initVector3();

    if (co !== undefined) {
      this.load(co);
    }

    this.owner = undefined;
  }

  toJSON() {
    return Object.assign({
      0    : this[0],
      1    : this[1],
      owner: this.owner ? this.owner.eid : -1
    }, super.toJSON());
  }

  loadJSON(obj) {
    super.loadJSON(obj);

    this[0] = obj[0];
    this[1] = obj[1];
    this.owner = obj.owner;

    return this;
  }
}

mixinVector3(Handle);

Handle.STRUCT = nstructjs.inherit(Handle, Element, "mesh.Handle") + `
  0           : float;
  1           : float;
  2           : float;
  owner       : int | this.owner ? this.owner.eid : -1;
}
`;
nstructjs.register(Handle);

let _evaluate_vs = util.cachering.fromConstructor(Vector3, 64);

export class Edge extends Element {
  constructor() {
    super(MeshTypes.EDGE);

    this.h1 = this.h2 = undefined;
    this.v1 = this.v2 = undefined;
    this.l = undefined;
  }

  get loops() {
    let this2 = this;

    return (function* () {
      if (!this2.l) {
        return;
      }

      let l = this2.l;
      let _i = 0;

      do {
        if (_i++ > 100) {
          console.warn("Infinite loop detected!", this2.eid);
          break;
        }

        yield l;

        l = l.radial_next;
      } while (l !== this2.l);
    })();
  }

  evaluate(t) {
    return _evaluate_vs.next().load(this.v1).interp(this.v2, t);
  }

  derivative(t) {
    let df = 0.0001;
    let a = this.evaluate(t - df);
    let b = this.evaluate(t + df);

    return b.sub(a).mulScalar(0.5/df);
  }

  derivative2(t) {
    let df = 0.0001;
    let a = this.derivative(t - df);
    let b = this.derivative(t + df);

    return b.sub(a).mulScalar(0.5/df);
  }

  curvature(t) {
    let dv1 = this.derivative(t);
    let dv2 = this.derivative2(t);

    let ret = (dv1[0]*dv2[1] - dv1[1]*dv2[0])/Math.pow(dv1.dot(dv1), 3.0/2.0);

    return ret;
  }

  toJSON() {
    return util.merge(super.toJSON(), {
      v1: this.v1.eid,
      v2: this.v2.eid,

      h1: this.h1 ? this.h1.eid : -1,
      h2: this.h2 ? this.h2.eid : -1,
      l : this.l ? this.l.eid : -1
    });
  }

  handle(v) {
    return v === this.v1 ? this.h1 : this.h2;
  }

  vertex(h) {
    return h === this.h1 ? this.v1 : this.v2;
  }

  loadJSON(obj) {
    super.loadJSON(obj);

    this.v1 = obj.v1;
    this.v2 = obj.v2;

    this.h1 = obj.h1;
    this.h2 = obj.h2;
    this.l = obj.l;

    return this;
  }

  otherVertex(v) {
    if (v === undefined)
      throw new Error("v cannot be undefined in Edge.prototype.otherVertex()");

    if (v === this.v1)
      return this.v2;
    if (v === this.v2)
      return this.v1;

    throw new Error("vertex " + v.eid + " not in edge");
  }
}

Edge.STRUCT = nstructjs.inherit(Edge, Element, "mesh.Edge") + `
  v1   : int | this.v1.eid;
  v2   : int | this.v2.eid;
  h1   : int | this.h1 ? this.h1.eid : -1;
  h2   : int | this.h2 ? this.h2.eid : -1;
  l    : int | this.l ? this.l.eid : -1;
}`;
nstructjs.register(Edge);

export class Loop extends Element {
  constructor() {
    super(MeshTypes.LOOP);

    this.f = undefined;
    this.radial_next = undefined;
    this.radial_prev = undefined;
    this.v = undefined;
    this.e = undefined;
    this.next = undefined;
    this.prev = undefined;
    this.list = undefined;
  }

  toJSON() {
    return Object.assign({
      v          : this.v.eid,
      e          : this.e.eid,
      f          : this.f.eid,
      radial_next: this.radial_next.eid,
      radial_prev: this.radial_prev.eid,
      next       : this.next.eid,
      prev       : this.prev.eid,
      list       : this.list.eid
    }, super.toJSON());
  }

  loadJSON(obj) {
    super.loadJSON(obj);

    this.v = obj.v;
    this.e = obj.e;
    this.f = obj.f;

    this.radial_next = obj.radial_next;
    this.radial_prev = obj.radial_prev;

    this.next = obj.next;
    this.prev = obj.prev;

    this.list = obj.list;

    return this;
  }
}

Loop.STRUCT = nstructjs.inherit(Loop, Element, "mesh.Loop") + `
  v : int | this.v.eid;
  e : int | this.e.eid;
}`;
nstructjs.register(Loop);

export class LoopListIter {
  constructor() {
    this.ret = {done: false, value: undefined};
    this.stack = undefined;
    this.l = undefined;
    this.list = undefined;
    this.done = false;
    this.i = 0;
  }

  [Symbol.iterator]() {
    return this;
  }

  reset(list, stack) {
    this.stack = stack;
    this.list = list;
    this.done = false;
    this.l = list.l;
    this.i = 0;

    return this;
  }

  next() {
    let ret = this.ret;

    let l = this.l;

    if (this.i++ > 100000) {
      console.warn("Infinite loop error!");
      return this.finish();
    }

    if (!l) {
      return this.finish();
    }

    this.l = this.l.next;
    if (this.l === this.list.l) {
      this.l = undefined;
    }

    ret.value = l;
    ret.done = false;

    return ret;
  }

  finish() {
    if (!this.done) {
      this.list = undefined;
      this.l = undefined;
      this.ret.value = undefined;
      this.ret.done = true;
      this.stack.cur--;
      this.done = true;
    }

    return this.ret;
  }

  return() {
    return this.finish();
  }
}

let loopstack = new Array(1024);
loopstack.cur = 0;
for (let i = 0; i < loopstack.length; i++) {
  loopstack[i] = new LoopListIter();
}

export class LoopList extends Element {
  constructor() {
    super(MeshTypes.LOOPLIST);

    this.length = 0;

    this.l = undefined;
    this._loops = undefined; //used by serialization
  }

  get verts() {
    let this2 = this;
    return (function* () {
      for (let l of this2) {
        yield l.v;
      }
    })();
  }

  [Symbol.iterator]() {
    return loopstack[loopstack.cur++].reset(this, loopstack);

    let this2 = this;
    return (function* () {
      let l = this2.l;
      let _i = 0;

      do {
        if (_i++ > 10000) {
          console.warn("Infinite loop detected!");
          break;
        }

        yield l;

        l = l.next;
      } while (l !== this2.l);
    })();
  }

  toJSON() {
    return Object.assign({
      l: this.l.eid,
    }, super.toJSON());
  }

  loadJSON(obj) {
    super.loadJSON(obj);

    this.l = obj.l;

    return this;
  }

  _save_loops() {
    return util.list(this).map(l => l.eid);
  }
}

LoopList.STRUCT = nstructjs.inherit(LoopList, Element, "mesh.LoopList") + `
  _loops : iter(int) | this._save_loops();
}
`
nstructjs.register(LoopList);

class Face extends Element {
  constructor() {
    super(MeshTypes.FACE);
    this.lists = [];
    this.blur = 0.0;
    this.center = new Vector3();
    this.fillColor = new Vector4([0.5, 0.5, 0.5, 1]);
  }

  get loops() {
    let this2 = this;
    let ret = (function* () {
      for (let list of this2.lists) {
        for (let l of list) {
          yield l;
        }
      }
    })();
    Object.defineProperty(ret, "length", {
      get: function () {
        let count = 0;
        for (let list of this2.lists) {
          for (let l of list) {
            count++;
          }
        }

        return count;
      }
    });

    return ret;
  }

  get verts() {
    let this2 = this;
    let ret = (function* () {
      for (let list of this.lists) {
        for (let l of list) {
          yield l.v;
        }
      }
    })();

    Object.defineProperty(ret, "length", {
      get: function () {
        let count = 0;
        for (let list of this2.lists) {
          for (let l of list) {
            count++;
          }
        }

        return count;
      }
    });

    return ret;
  }

  toJSON() {
    let lists = [];

    for (let list of this.lists) {
      lists.push(list.eid);
    }

    return Object.assign({
      lists    : lists,
      center   : this.center,
      blur     : this.blur,
      fillColor: this.fillColor
    }, super.toJSON());
  }

  calcCenter() {
    this.center.zero();
    let tot = 0;

    for (let l of this.loops) {
      this.center.add(l.v);
      tot++;
    }

    if (tot) {
      this.center.mulScalar(1.0/tot);
    }

    return this.center;
  }

  loadJSON(obj) {
    super.loadJSON(obj);

    this.center = new Vector3(obj.center);
    if (isNaN(this.center[2])) {
      this.center[2] = 0.0;
    }

    this.lists = obj.lists;
    this.blur = obj.blur || 0.0;
    this.fillColor = new Vector4(obj.fillColor);

    return this;
  }
}

Face.STRUCT = nstructjs.inherit(Face, Element, "mesh.Face") + `
  lists     : iter(list, int) | list.eid;
  fillColor : vec4;
  blur      : float;
}
`;
nstructjs.register(Face);

export class ElementSet extends Set {
  constructor(type) {
    super();
    this.type = type;
  }

  get editable() {
    let this2 = this;
    return (function* () {
      for (let item of this2) {
        if (!(item.flag & MeshFlags.HIDE)) {
          yield item;
        }
      }
    })();
  }

  get length() {
    return this.size;
  }

  remove(item) {
    this.delete(item);
  }
}

export class ElementArray {
  constructor(type) {
    this.list = [];
    this.length = 0;
    this.type = type;
    this.selected = new ElementSet(type);
    this.on_selected = undefined;
    this.highlight = this.active = undefined;
    this.freelist = [];
  }

  get visible() {
    let this2 = this;

    return (function* () {
      for (let item of this2) {
        if (!(item.flag & MeshFlags.HIDE)) {
          yield item;
        }
      }
    })();
  }

  get editable() {
    return this.visible;
  }

  [Symbol.iterator]() {
    let this2 = this;

    return (function* () {
      let list = this2.list;

      for (let i = 0; i < list.length; i++) {
        if (list[i] !== undefined) {
          yield list[i];
        }
      }
    })();
  }

  concat(b) {
    let ret = [];

    for (let item of this) {
      ret.push(item);
    }

    for (let item of b) {
      ret.push(item);
    }

    return ret;
  }

  toJSON() {
    let arr = [];

    for (let item of this) {
      arr.push(item);
    }

    let sel = [];
    for (let v of this.selected) {
      sel.push(v.eid);
    }

    return {
      type     : this.type,
      array    : arr,
      selected : sel,
      active   : this.active !== undefined ? this.active.eid : -1,
      highlight: this.highlight !== undefined ? this.highlight.eid : -1
    };
  }

  loadJSON(obj) {
    this.list.length = [];
    this.length = 0;
    this.freelist.length = 0;
    this.selected = new util.set();
    this.active = this.highlight = undefined;
    this.type = obj.type;

    for (let e of obj.array) {
      let e2 = undefined;

      switch (e.type) {
        case MeshTypes.VERTEX:
          e2 = new Vertex();
          break;
        case MeshTypes.HANDLE:
          e2 = new Handle();
          break;
        case MeshTypes.EDGE:
          e2 = new Edge();
          break;
        case MeshTypes.LOOP:
          e2 = new Loop();
          break;
        case MeshTypes.LOOPLIST:
          e2 = new LoopList();
          break;
        case MeshTypes.FACE:
          e2 = new Face();
          break;
        default:
          console.log(e);
          throw new Error("bad element " + e);
      }

      e2.loadJSON(e);
      e2._index = this.list.length;
      this.list.push(e2);
      this.length++;

      if (e2.flag & MeshFlags.SELECT) {
        this.selected.add(e2);
      }

      if (e2.eid === obj.active) {
        this.active = e2;
      } else if (e2.eid === obj.highlight) {
        this.highlight = e2;
      }
    }
  }

  push(v) {
    v._index = this.list.length;
    this.list.push(v);
    this.length++;

    if (v.flag & MeshFlags.SELECT) {
      this.selected.add(v);
    }

    return this;
  }

  remove(v) {
    if (this.selected.has(v)) {
      this.selected.remove(v);
    }

    if (this.active === v)
      this.active = undefined;
    if (this.highlight === v)
      this.highlight = undefined;

    if (v._index < 0 || this.list[v._index] !== v) {
      throw new Error("element not in array");
    }

    this.freelist.push(v._index);

    this.list[v._index] = undefined;
    v._index = -1;
    this.length--;

    //super.remove(v);

    return this;
  }

  selectNone() {
    for (let e of this) {
      this.setSelect(e, false);
    }
  }

  selectAll() {
    for (let e of this) {
      this.setSelect(e, true);
    }
  }

  setSelect(v, state) {
    if (state) {
      v.flag |= MeshFlags.SELECT;

      this.selected.add(v);
    } else {
      v.flag &= ~MeshFlags.SELECT;

      this.selected.remove(v, true);
    }

    return this;
  }

  loadSTRUCT(reader) {
    reader(this);

    for (let elem of this) {
      if (elem.flag & MeshFlags.SELECT) {
        this.selected.add(elem);
      }
    }
  }
}

ElementArray.STRUCT = `
mesh.ElementArray {
  this        : iter(abstract(mesh.Element));
  highlight   : int | this.highlight ? this.highlight.eid : -1;
  active      : int | this.active ? this.active.eid : -1;
  type        : int;
}
`
nstructjs.register(ElementArray);

export class Mesh {
  constructor() {
    this.eidgen = new util.IDGen();
    this.eidMap = new Map();

    this.verts = undefined;
    this.lists = undefined;
    this.handles = undefined;
    this.edges = undefined;
    this.loops = undefined;
    this.faces = undefined;

    this.elists = {};

    this.makeElists();

    this.features = 0;

    if (config.MESH_HANDLES) {
      this.features |= MeshFeatures.HANDLES;
    }
  }

  get haveHandles() {
    return this.features & MeshFeatures.HANDLES;
  }

  get elements() {
    return this.eidMap.values();
  }

  get hasHighlight() {
    for (let k in this.elists) {
      if (this.elists[k].highlight) {
        return true;
      }
    }

    return false;
  }

  getElists() {
    let ret = [];

    for (let k in this.elists) {
      ret.push(this.elists[k]);
    }

    return ret;
  }

  addElistAliases() {
    this.verts = this.elists[MeshTypes.VERTEX];
    this.handles = this.elists[MeshTypes.HANDLE];
    this.edges = this.elists[MeshTypes.EDGE];
    this.loops = this.elists[MeshTypes.LOOP];
    this.lists = this.elists[MeshTypes.LOOPLIST];
    this.faces = this.elists[MeshTypes.FACE];
  }

  makeElists() {
    for (let k in MeshTypes) {
      let type = parseInt(MeshTypes[k]);

      this.elists[type] = new ElementArray(type);
    }

    this.addElistAliases();
  }

  _element_init(e) {
    e.eid = this.eidgen.next();
    this.eidMap.set(e.eid, e);
  }

  setActive(elem) {
    if (!elem) {
      for (let k in this.elists) {
        this.elists[k].active = undefined;
      }
    } else {
      this.elists[elem.type].active = elem;
    }

    return this;
  }

  setHighlight(elem) {
    let ret = false;

    if (!elem) {
      for (let k in this.elists) {
        ret = ret || this.elists[k].highlight;
        this.elists[k].highlight = undefined;
      }
    } else {
      ret = this.elists[elem.type].highlight !== elem;
      this.elists[elem.type].highlight = elem;
    }

    return ret;
  }

  makeVertex(co) {
    let v = new Vertex(co);

    this._element_init(v);
    this.verts.push(v);

    return v;
  }

  makeHandle(co) {
    let h = new Handle(co);
    this._element_init(h);
    this.handles.push(h);
    return h;
  }

  getEdge(v1, v2) {
    for (let e of v1.edges) {
      if (e.otherVertex(v1) === v2)
        return e;
    }

    return undefined;
  }

  ensureEdge(v1, v2) {
    let e = this.getEdge(v1, v2);

    if (!e) {
      e = this.makeEdge(v1, v2);
    }

    return e;
  }

  makeEdge(v1, v2) {
    let e = new Edge();

    e.v1 = v1;
    e.v2 = v2;

    if (this.features & MeshFeatures.HANDLES) {
      e.h1 = this.makeHandle(v1);
      e.h1.interp(v2, 1.0/2.0);
      e.h1.owner = e;

      e.h2 = this.makeHandle(v1);
      e.h2.interp(v2, 2.0/3.0);
      e.h2.owner = e;
    }

    v1.edges.push(e);
    v2.edges.push(e);

    this._element_init(e);
    this.edges.push(e);

    return e;
  }

  killVertex(v) {
    if (v.eid === -1) {
      console.trace("Warning: vertex", v.eid, "already freed", v);
      return;
    }

    let _i = 0;

    while (v.edges.length > 0) {
      this.killEdge(v.edges[0]);

      if (_i++ >= 100) {
        console.warn("mesh integrity warning, infinite loop detected in killVertex");
      }
    }

    this.eidMap.delete(v.eid);
    this.verts.remove(v);

    v.eid = -1;
  }

  killEdge(e) {
    if (e.eid === -1) {
      console.trace("Warning: edge", e.eid, "already freed", e);
      return;
    }

    let _i = 0;
    while (e.l) {
      this.killFace(e.l.f);

      if (_i++ > 1000) {
        console.log("infinite loop detected");
        break;
      }
    }

    this.edges.remove(e);
    this.eidMap.delete(e.eid);

    if (this.features & MeshFeatures.HANDLES) {
      this.eidMap.delete(e.h1.eid);
      this.handles.remove(e.h1);

      this.eidMap.delete(e.h2.eid);
      this.handles.remove(e.h2);
    }

    e.eid = -1;

    e.v1.edges.remove(e);
    e.v2.edges.remove(e);
  }

  radialLoopRemove(e, l) {
    if (e.l === l) {
      e.l = e.l.radial_next;
    }

    if (e.l === l) {
      e.l = undefined;
      return;
    }

    l.radial_next.radial_prev = l.radial_prev;
    l.radial_prev.radial_next = l.radial_next;
  }

  radialLoopInsert(e, l) {
    if (!e.l) {
      e.l = l;
      l.radial_next = l.radial_prev = l;
    } else {
      l.radial_prev = e.l;
      l.radial_next = e.l.radial_next;

      e.l.radial_next.radial_prev = l;
      e.l.radial_next = l;
    }
  }

  _killList(list) {
    this.eidMap.delete(list.eid);
    this.lists.remove(list);
    list.eid = -1;
  }

  killFace(f) {
    for (let list of f.lists) {
      for (let l of list) {
        this.radialLoopRemove(l.e, l);

        this._killLoop(l);
      }

      this._killList(list);
    }

    this.eidMap.delete(f.eid);
    this.faces.remove(f);
    f.eid = -1;
  }

  addLoopList(f, vs) {
    let list = new LoopList();
    this._element_init(list);
    this.lists.push(list);

    let lastl, firstl;

    for (let i = 0; i < vs.length; i++) {
      let v1 = vs[i], v2 = vs[(i + 1)%vs.length];

      let e = this.getEdge(v1, v2);
      if (!e) {
        e = this.makeEdge(v1, v2);
      }

      let l = new Loop();
      this._element_init(l);
      this.loops.push(l);

      l.v = v1;
      l.e = e;
      l.f = f;
      l.list = list;

      this.radialLoopInsert(e, l);

      if (!firstl) {
        firstl = l;
      } else {
        lastl.next = l;
        l.prev = lastl;
      }

      lastl = l;
    }

    firstl.prev = lastl;
    lastl.next = firstl;

    list.l = firstl;

    f.lists.push(list);
  }

  makeFace(vs) {
    let f = new Face();
    this._element_init(f);
    this.faces.push(f);

    let list = new LoopList();
    this._element_init(list);
    this.lists.push(list);

    let lastl, firstl;

    for (let i = 0; i < vs.length; i++) {
      let v1 = vs[i], v2 = vs[(i + 1)%vs.length];

      let e = this.getEdge(v1, v2);
      if (!e) {
        e = this.makeEdge(v1, v2);
      }

      let l = new Loop();
      this._element_init(l);
      this.loops.push(l);

      l.v = v1;
      l.e = e;
      l.f = f;
      l.list = list;

      this.radialLoopInsert(e, l);

      if (!firstl) {
        firstl = l;
      } else {
        lastl.next = l;
        l.prev = lastl;
      }

      lastl = l;
      list.length++;
    }

    firstl.prev = lastl;
    lastl.next = firstl;

    list.l = firstl;

    f.lists.push(list);
    return f;
    /*
      f           : this.f.eid,
      radial_next : this.radial_next.eid,
      radial_prev : this.radial_prev.eid,
      v           : this.v.eid,
      e           : this.e.eid,
      next        : this.next.eid,
      prev        : this.prev.eid,
      list        : this.list.eid
    */
  }

  selectFlush(selmode) {
    if (selmode & MeshTypes.VERTEX) {
      this.edges.selectNone();
      this.faces.selectNone();

      let set_active = this.edges.active === undefined;
      set_active = set_active || !(this.edges.active && ((this.edges.active.v1.flag | this.edges.active.v2.flag) & MeshFlags.SELECT));

      for (let e of this.edges) {
        if ((e.v1.flag & MeshFlags.SELECT) && (e.v2.flag & MeshFlags.SELECT)) {
          this.edges.setSelect(e, true);

          if (this.features & MeshFeatures.HANDLES) {
            this.handles.setSelect(e.h1, true);
            this.handles.setSelect(e.h2, true);
          }

          if (set_active) {
            this.edges.active = e;
          }
        }
      }

      for (let f of this.faces) {
        let ok = true;

        for (let l of f.loops) {
          if (!(l.e.flag & MeshFlags.SELECT)) {
            ok = false;
            break;
          }
        }

        if (ok) {
          this.faces.setSelect(f, true);
        }
      }
    } else if (selmode & MeshTypes.EDGE) {
      this.verts.selectNone();

      for (let v of this.verts) {
        for (let e of v.edges) {
          if (e.flag & MeshFlags.SELECT) {
            this.verts.setSelect(v, true);
            break;
          }
        }
      }
    }
  }

  splitEdge(e, t = 0.5) {
    let nv = this.makeVertex(e.v1).interp(e.v2, t);
    let ne = this.makeEdge(nv, e.v2);

    e.v2.edges.remove(e);
    e.v2 = nv;
    nv.edges.push(e);

    let vector = e.v1.length === 2 ? Vector2 : Vector3;

    //e.h.interp(e.v1, 1.0/3.0);
    //ne.h.load(h).interp(ne.v2, 0.5);
    //nv.interp(h, 0.5);

    if (this.features & MeshFeatures.HANDLES) {
      ne.h1.load(nv).interp(ne.v2, 1.0/3.0);
      ne.h2.load(nv).interp(ne.v2, 2.0/3.0);

      e.h2.load(e.v1).interp(nv, 2.0/3.0);
    }

    if (e.flag & MeshFlags.SELECT) {
      this.edges.setSelect(ne, true);
      this.verts.setSelect(nv, true);
    }

    if (e.l) {
      let l = e.l;
      let ls = [];
      let _i = 0;
      do {
        if (_i++ > 10) {
          console.warn("infinite loop detected");
          break;
        }

        ls.push(l);
        l = l.radial_next;
      } while (l !== e.l);

      for (let l of ls) {
        let l2 = new Loop();
        this._element_init(l2);
        this.loops.push(l2);

        l2.f = l.f;
        l2.list = l.list;

        if (l.e === e) {
          l2.v = nv;
          l2.e = ne;
          l2.prev = l;
          l2.next = l.next;
          l.next.prev = l2;
          l.next = l2;

          this.radialLoopInsert(ne, l2);
        } else {
          this.radialLoopRemove(e, l);

          l2.v = nv;
          l.e = ne;
          l2.e = e;

          this.radialLoopInsert(ne, l);
          this.radialLoopInsert(e, l2);

          l.next.prev = l2;
          l2.prev = l;
          l2.next = l.next;
          l.next = l2;

          /*
         v1 <--l2--<--l--- v2
             --e1--|--ne--
             --l--->--l2-->

          */
        }
      }
    }

    return [ne, nv];
  }

  copyElemData(dst, src) {
    this.setSelect(dst, src.flag & MeshFlags.SELECT);
    dst.flag = src.flag;

    if (dst instanceof Vertex) {
      dst.load(src)
    }
  }

  validate() {
    let ls = new Set();

    for (let f of this.faces) {
      for (let l of f.loops) {
        ls.add(l);
      }
    }

    for (let l of ls) {
      this.radialLoopRemove(l.e, l);
    }

    for (let l of this.loops) {
      if (!ls.has(l)) {
        console.warn("Orphaned loop");
        this._killLoop(l);
      }
    }

    for (let l of ls) {
      let e = l.e;
      l.e = this.ensureEdge(l.v, l.next.v);

      if (l.e !== e) {
        console.warn("Loop had wrong edge");
      }

      this.radialLoopInsert(l.e, l);
    }

    this.structureGen++;
  }

  reverseWinding(f) {
    for (let list of f.lists) {
      for (let l of list) {
        this.radialLoopRemove(l.e, l);
      }
    }

    for (let list of f.lists) {
      let es = [];

      let ls = [];
      for (let l of new Set(list)) {
        let t = l.next;
        l.next = l.prev;
        l.prev = t;

        es.push(l.e);
        ls.push(l);
      }

      let i = 0;
      for (let l of ls) {
        l.e = es[(i - 1 + es.length)%es.length];
        i++;
      }
    }

    for (let list of f.lists) {
      for (let l of list) {
        this.radialLoopInsert(l.e, l);
      }
    }
  }


  clearHighlight() {
    let exist = this.hasHighlight;

    for (let k in this.elists) {
      this.elists[k].highlight = undefined;
    }

    return exist;
  }

  unlinkFace(f) {
    for (let list of f.lists) {
      for (let l of list) {
        this.radialLoopRemove(l.e, l);
      }
    }
  }

  linkFace(f, forceRelink = true) {
    for (let list of f.lists) {
      for (let l of list) {
        if (forceRelink || !l.e) {
          l.e = this.getEdge(l.v, l.next.v);

          if (!l.e) {
            l.e = this.makeEdge(l.v, l.next.v);
          }
        }

        this.radialLoopInsert(l.e, l);
      }
    }
  }

  _killLoop(l) {
    this.eidMap.delete(l.eid);
    this.loops.remove(l);
    l.eid = -1;
  }

  dissolveVertex(v) {
    if (v.edges.length !== 2) {
      throw new Error("can't dissolve vertex with more than two edges");
    }

    let loops = new Set();
    let faces = new Set();

    for (let e of v.edges) {
      for (let l of e.loops) {
        if (l.v !== v) {
          l = l.next;
        }

        loops.add(l);
        faces.add(l.f);
      }
    }

    for (let f of faces) {
      this.unlinkFace(f);
    }

    for (let l of loops) {
      if (l.v !== v) {
        l = l.next;
      }

      l.prev.next = l.next;
      l.next.prev = l.prev;

      if (l === l.list.l) {
        l.list.l = l.list.l.next;
      }

      if (l === l.list.l) {
        console.warn("Destroying face");

        l.f.lists.remove(l.list);
        this._killList(l.list);

        if (l.f.lists.length === 0) {
          faces.delete(l.f);
          this.killFace(l.f);
          continue;
        }
      } else {
        l.list.length--;
      }

      this._killLoop(l);
    }

    let e1 = v.edges[0], e2 = v.edges[1];
    let v1 = e1.otherVertex(v), v2 = e2.otherVertex(v);

    let flag = (e1.flag | e2.flag) & ~MeshFlags.HIDE;

    this.killVertex(v);
    if (1) {
      let e3 = this.makeEdge(v1, v2);

      if (flag & MeshFlags.SELECT) {
        this.edges.setSelect(e3, true);
      }

      e3.flag |= flag;
    }

    for (let f of faces) {
      this.linkFace(f, true);
    }
  }

  getList(type) {
    return this.elists[type];
  }

  setSelect(e, state) {
    this.getList(e.type).setSelect(e, state);
  }

  selectNone() {
    for (let k in this.elists) {
      this.elists[k].selectNone();
    }
  }

  selectAll() {
    for (let k in this.elists) {
      this.elists[k].selectAll();
    }
  }

  regen_render() {
    window.redraw_all();
  }

  loadSTRUCT(reader) {
    reader(this);

    let elists = this.elists;
    this.elists = {};

    for (let elist of elists) {
      this.elists[elist.type] = elist;
    }

    this.addElistAliases();

    let eidMap = this.eidMap = new Map();

    for (let list of this.getElists()) {
      for (let elem of list) {
        eidMap.set(elem.eid, elem);
      }
    }

    for (let v of this.verts) {
      for (let i = 0; i < v.edges.length; i++) {
        v.edges[i] = eidMap.get(v.edges[i]);
      }
    }

    for (let h of this.handles) {
      h.owner = eidMap.get(h.owner);
    }

    let eloops = new Map();

    for (let e of this.edges) {
      e.v1 = eidMap.get(e.v1);
      e.v2 = eidMap.get(e.v2);
      e.h1 = eidMap.get(e.h1);
      e.h2 = eidMap.get(e.h2);
      eloops.set(e, eidMap.get(e.l));
      e.l = undefined;

      if (e.h1) {
        this.features |= MeshFeatures.HANDLES;
      }
    }

    for (let l of this.loops) {
      l.v = eidMap.get(l.v);
      l.e = eidMap.get(l.e);
    }

    for (let list of this.lists) {
      let loops = list._loops;
      list._loops = undefined;

      loops = loops.map(l => eidMap.get(l));

      list.l = loops[0];

      for (let i = 0; i < loops.length; i++) {
        let l1 = loops[(i - 1 + loops.length)%loops.length];
        let l2 = loops[i];
        let l3 = loops[(i + 1)%loops.length];

        l1.next = l2;
        l2.prev = l1;
        l2.next = l3;
        l3.prev = l2;
      }
    }

    for (let f of this.faces) {
      for (let i = 0; i < f.lists.length; i++) {
        f.lists[i] = eidMap.get(f.lists[i]);
      }

      for (let list of f.lists) {
        list.length = 0;

        for (let l of list) {
          l.f = f;
          l.list = list;
          this.radialLoopInsert(l.e, l);
          list.length++;
        }
      }
    }

    for (let [e, l] of eloops) {
      e.l = l;
    }

    for (let elist of this.getElists()) {
      elist.active = eidMap.get(elist.active);
      elist.highlight = eidMap.get(elist.highlight);
    }
  }
}

Mesh.STRUCT = `
mesh.Mesh {
  elists : array(mesh.ElementArray) | this.getElists();
  eidgen : IDGen;  
}
`;
nstructjs.register(Mesh);

