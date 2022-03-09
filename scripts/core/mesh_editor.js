import {
  KeyMap, color2css, css2color,
  Vector3, Matrix4, Quat, util, nstructjs, math,
  Vector4, UIBase, HotKey, haveModal, Vector2
} from '../path.ux/scripts/pathux.js';

import {getElemColor, MeshTypes, MeshFlags} from './mesh.js';
import './mesh_ops.js';
import './transform_ops.js';
import './mesh_selectops.js';

import {SelToolModes} from './mesh_ops.js';

export class ToolModeBase {
  constructor(ctx) {
    this.ctx = ctx;
    this.keymap = new KeyMap()
  }

  draw(ctx, canvas, g) {
    this.ctx = ctx;

    let mesh = this.ctx.mesh;

    let w = 8;

    for (let e of mesh.edges.visible) {
      g.strokeStyle = color2css(getElemColor(mesh.edges, e));
      g.beginPath();
      g.moveTo(e.v1[0], e.v1[1]);
      g.lineTo(e.v2[0], e.v2[1]);
      g.stroke();
    }

    for (let h of mesh.handles.visible) {
      g.strokeStyle = color2css(getElemColor(mesh.handles, h));
      let v = h.owner.vertex(h);

      g.beginPath();
      g.moveTo(v[0], v[1]);
      g.lineTo(h[0], h[1]);
      g.stroke();
    }

    for (let list of [mesh.verts, mesh.handles]) {
      for (let v of list.visible) {
        g.fillStyle = color2css(getElemColor(list, v));
        g.beginPath();
        g.rect(v[0] - w*0.5, v[1] - w*0.5, w, w);
        g.fill();
      }
    }

    for (let f of mesh.faces.visible) {
      g.beginPath();
      let color = new Vector4(getElemColor(mesh.faces, f));
      color[3] = 0.15;

      g.fillStyle = color2css(color);
      for (let list of f.lists) {
        let first = true;
        for (let l of list) {
          if (first) {
            first = false;
            g.moveTo(l.v[0], l.v[1]);
          } else {
            g.lineTo(l.v[0], l.v[1]);
          }
        }

        g.closePath();
      }

      g.fill();
    }
  }

  getEditMenu() {
    return [];
  }

  on_mousedown(localX, localY, e) {

  }

  on_mousemove(localX, localY, e) {

  }

  on_mouseup(localX, localY, e) {

  }

  draw() {

  }

  getKeymap() {
    return this.keymap;
  }
}

export class PickData {
  constructor(elem, type, dist) {
    this.elem = elem;
    this.type = type;
    this.dist = dist;
  }

  load(elem, type, dist) {
    this.elem = elem;
    this.type = type;
    this.dist = dist;

    return this;
  }
}

let pick_cachering = util.cachering.fromConstructor(PickData, 32);

export class MeshEditor extends ToolModeBase {
  constructor(ctx) {
    super(ctx);

    this.startMpos = new Vector2();
    this.mpos = new Vector2();

    this.keymap = new KeyMap([
      new HotKey("A", ["CTRL"], "mesh.toggle_select_all(mode='ADD')"),
      new HotKey("A", [], "mesh.toggle_select_all(mode='ADD')"),
      new HotKey("A", ["ALT"], "mesh.toggle_select_all(mode='SUB')"),
      new HotKey("A", ["CTRL", "SHIFT"], "mesh.toggle_select_all(mode='SUB')"),
      new HotKey("G", [], "transform.translate()"),
      new HotKey("S", [], "transform.scale()"),
      new HotKey("R", [], "transform.rotate()"),
      new HotKey("E", [], "mesh.split_edge()"),
      new HotKey("D", [], "mesh.dissolve_vertex()"),
      new HotKey("X", [], "mesh.delete()"),
      new HotKey("Delete", [], "mesh.delete()"),
    ])

    this.mdown = false;
  }

  getEditMenu() {
    let ret = [];

    for (let hk in this.keymap) {
      if (typeof hk === "string") {
        ret.push(hk.action);
      }
    }

    return ret;
  }

  pick(localX, localY, selmask = MeshTypes.VERTEX | MeshTypes.HANDLE, limit = 25) {
    let mesh = this.ctx.mesh;

    let mpos = new Vector3();
    mpos[0] = localX;
    mpos[1] = localY;
    mpos[2] = 0.0;

    let dpi = UIBase.getDPI();
    limit *= dpi;

    let mindis, minret;

    let vlist = (list) => {
      for (let v of list) {
        mpos[2] = v.length > 2 ? v[2] : 0.0;

        let dis = v.vectorDistance(mpos);
        if (dis >= limit) {
          continue;
        }

        if (!minret || dis < mindis) {
          mindis = dis;
          minret = pick_cachering.next().load(v, v.type, dis);
        }
      }
    }

    if (selmask & MeshTypes.VERTEX) {
      vlist(mesh.verts);
    }

    if (selmask & MeshTypes.HANDLE) {
      vlist(mesh.handles);
    }

    return minret ? minret.elem : undefined;
  }

  on_mousedown(localX, localY, e) {
    this.mdown = true;
    this.startMpos.loadXY(localX, localY);

    this.updateHighlight(localX, localY);

    let mesh = this.ctx.mesh;

    if (mesh.hasHighlight) {
      let type, elem;

      for (let k in mesh.elists) {
        let elist = mesh.elists[k];

        if (elist.highlight) {
          type = elist.type;
          elem = elist.highlight;
        }
      }

      let mode;

      if (e.shiftKey) {
        mode = elem.flag & MeshFlags.SELECT ? SelToolModes.SUB : SelToolModes.ADD;
      } else {
        mode = SelToolModes.ADD;
      }

      this.ctx.api.execTool(this.ctx, "mesh.select_one", {
        mode,
        unique : !e.shiftKey,
        elemEid: elem.eid,
      });
    }
  }

  updateHighlight(localX, localY) {
    let elem = this.pick(localX, localY);
    let mesh = this.ctx.mesh;

    let update = false;

    /* Clear all other highlight. */
    mesh.setHighlight(undefined);
    update = mesh.setHighlight(elem);
    //console.log("set highlight", update);

    if (update) {
      window.redraw_all();
    }
    return update;
  }

  on_mousemove(localX, localY, e) {
    this.mpos.loadXY(localX, localY);

    if (haveModal()) {
      this.mdown = false;
      return;
    }

    this.updateHighlight(localX, localY);

    if (this.mdown) {
      let mesh = this.ctx.mesh;

      let act = mesh.verts.selected.length > 0 || mesh.handles.selected.length > 0;

      if (act && this.mpos.vectorDistance(this.startMpos) > 10) {
        this.mdown = false;
        this.ctx.api.execTool(this.ctx, "transform.translate()");
      }
    }
  }

  on_mouseup(localX, localY, e) {
    this.mdown = false;
  }
}
