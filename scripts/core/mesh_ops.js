import config from '../config/config.js';

import {
  Vector2, Vector3, Vector4, util, math,
  nstructjs, Matrix4, Quat, ToolOp,
  FloatProperty, BoolProperty, IntProperty,
  EnumProperty, FlagProperty, Vec3Property
} from '../path.ux/pathux.js';
import {Mesh, MeshFlags, MeshTypes} from './mesh.js';

export let SelToolModes = {
  ADD : 0,
  SUB : 1,
  AUTO: 2
};

function saveUndoMesh(mesh) {
  let data = [];
  nstructjs.writeObject(data, mesh);

  return new DataView(new Uint8Array(data).buffer);
}

function loadUndoMesh(mesh, data) {
  let mesh2 = nstructjs.readObject(data, Mesh);

  for (let k in mesh2) {
    mesh[k] = mesh2[k];
  }

  window.redraw_all();
}

export class MeshOp extends ToolOp {
  undoPre(ctx) {
    this._undo = saveUndoMesh(ctx.mesh);
  }

  undo(ctx) {
    loadUndoMesh(ctx.mesh, this._undo);
  }

  execPost(ctx) {
    window.redraw_all();
  }
}

export class SplitEdgeOp extends MeshOp {
  static tooldef() {
    return {
      uiname  : "Split Edge",
      toolpath: "mesh.split_edge",
      inputs  : ToolOp.inherit({})
    }
  }

  exec(ctx) {
    let mesh = ctx.mesh;

    for (let e of new Set(mesh.edges.selected.editable)) {
      mesh.splitEdge(e);
    }
  }
}

ToolOp.register(SplitEdgeOp);


export class DissolveVertOp extends MeshOp {
  static tooldef() {
    return {
      uiname  : "Dissolve Vertex",
      toolpath: "mesh.dissolve_vertex",
      inputs  : ToolOp.inherit({})
    }
  }

  exec(ctx) {
    let mesh = ctx.mesh;

    for (let v of new Set(mesh.verts.selected.editable)) {
      mesh.dissolveVertex(v);
    }
  }
}

ToolOp.register(DissolveVertOp);


export class DeleteOp extends MeshOp {
  static tooldef() {
    return {
      uiname  : "Delete",
      toolpath: "mesh.delete",
      inputs  : ToolOp.inherit({
        selMask: new FlagProperty(config.SELECTMASK, MeshTypes)
      })
    }
  }

  static invoke(ctx, args) {
    let tool = super.invoke(ctx, args);

    console.log("DELETE", ctx.selMask, ctx);
    if (!("selMask" in args)) {
      tool.inputs.selMask.setValue(ctx.selMask);
    }

    return tool;
  }

  exec(ctx) {
    let mesh = ctx.mesh;
    let {selMask} = this.getInputs();

    console.log("Delete!", selMask);

    if (selMask & MeshTypes.FACE) {
      for (let v of new Set(mesh.faces.selected.editable)) {
        mesh.killFace(v);
      }
    }

    if (selMask & MeshTypes.EDGE) {
      for (let v of new Set(mesh.edges.selected.editable)) {
        mesh.killEdge(v);
      }
    }

    if (selMask & MeshTypes.VERTEX) {
      for (let v of new Set(mesh.verts.selected.editable)) {
        mesh.killVertex(v);
      }
    }
  }
}

ToolOp.register(DeleteOp);


export class TriangulateOp extends MeshOp {
  static tooldef() {
    return {
      uiname  : "Triangulate",
      toolpath: "mesh.triangulate",
      inputs  : ToolOp.inherit({})
    }
  }

  exec(ctx) {
    let mesh = ctx.mesh;

    mesh.triangulate();
    window.redraw_all();
  }
}

ToolOp.register(TriangulateOp);

export class ExtrudeVertOp extends MeshOp {
  static tooldef() {
    return {
      uiname  : "Extrude Vertex",
      toolpath: "mesh.extrude_vertex",
      inputs  : ToolOp.inherit({
        co : new Vec3Property()
      })
    }
  }

  exec(ctx) {
    let mesh = ctx.mesh;

    let {co} = this.getInputs();
    let actv = mesh.verts.active;

    let v = mesh.makeVertex(co);
    let ne;

    if (actv && (actv.flag & MeshFlags.SELECT)) {
      ne = mesh.makeEdge(v, actv);
    }

    mesh.selectNone();

    mesh.verts.setSelect(v, true);
    mesh.verts.active = v;

    if (ne) {
      mesh.edges.setSelect(ne, true);
      mesh.edges.active = ne;
    }

    window.redraw_all();
  }
}
ToolOp.register(ExtrudeVertOp);


export class MakeFaceOp extends MeshOp {
  static tooldef() {
    return {
      uiname  : "Make Face",
      toolpath: "mesh.make_face",
      inputs  : ToolOp.inherit({
        co : new Vec3Property()
      })
    }
  }

  exec(ctx) {
    let mesh = ctx.mesh;

    let vs = util.list(mesh.verts.selected.editable);
    vs = vs.sort((a, b) => a.edges.length - b.edges.length);
    vs = new Set(vs);

    let segs = [];
    let visit = new WeakSet();

    for (let v of vs) {
      if (visit.has(v)) {
        continue;
      }

      let v2 = v;
      let seg = [v];

      segs.push(seg);

      let _i = 0;
      while (1) {
        let newe;

        for (let e of v2.edges) {
          let v3 = e.otherVertex(v2);

          if (vs.has(v3) && !visit.has(e)) {
            newe = e;
            break;
          }
        }

        if (!newe) {
          break;
        }

        visit.add(newe);

        v2 = newe.otherVertex(v2);
        visit.add(v2);
        seg.push(v2);

        if (_i++ > 10000) {
          console.error("Infinite loop error!");
          break;
        }

      }
    }

    for (let seg of segs) {
      let f = mesh.makeFace(seg);

      let rev = false;

      for (let l of f.loops) {
        if (l.radial_next !== l && l.radial_next.v === l.v) {
          rev = true;
          break;
        }
      }

      if (rev) {
        mesh.reverseWinding(f);
      }

      for (let l of f.loops) {
        if (l.radial_next === l) {
          continue;
        }

        let l2 = l.radial_next;
        if (l2.v === l.v) {
          l2 = l2.next;
        }

        mesh.copyElemData(l, l2);
      }
    }
  }
}
ToolOp.register(MakeFaceOp);

export class FixWindingsOp extends MeshOp {
  static tooldef() {
    return {
      uiname : "Fix Windings",
      toolpath : "mesh.fix_windings",
      inputs : ToolOp.inherit({})
    }
  }

  exec(ctx) {
    let mesh = ctx.mesh;

    for (let f of mesh.faces.selected.editable) {
      let l = f.lists[0].l;

      if (math.normal_tri(l.v, l.next.v, l.next.next.v)[2] < 0.0) {
        mesh.reverseWinding(f);
        console.log(f.eid, f);
      }
    }
  }
}
ToolOp.register(FixWindingsOp);

export class FixMeshOp extends MeshOp {
  static tooldef() {
    return {
      uiname : "Fix Mesh",
      toolpath : "mesh.repair",
      inputs : ToolOp.inherit({})
    }
  }

  exec(ctx) {
    let mesh = ctx.mesh;

    mesh.validate();
  }
}
ToolOp.register(FixMeshOp);
